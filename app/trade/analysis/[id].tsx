import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../../src/lib/supabase'
import { fetchCandles, calcMFEMAE, normalizeSymbol, normalizeInterval } from '../../../src/lib/binance'
import { analyzeTradeWithClaude, buildAnalysisPrompt } from '../../../src/lib/claude'
import { ANTHROPIC_KEY } from '../../(tabs)/settings'
import type { Trade, TagDefinition, StrategyProfile, ManagementEvent } from '../../../src/types'
import type { MFEMAEResult } from '../../../src/lib/binance'

type Phase = 'loading' | 'prompt' | 'analyzing' | 'result' | 'error'

const PROMPT_INSTRUCTIONS_KEY = 'analysis_prompt_instructions'
const INSTRUCTIONS_START = '\n\nGib eine strukturierte Analyse'

export default function TradeAnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [strategy, setStrategy] = useState<StrategyProfile | null>(null)
  const [ohlcv, setOhlcv] = useState<MFEMAEResult | null>(null)
  const [events, setEvents] = useState<ManagementEvent[]>([])
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState('Lade Trade...')
  const [error, setError] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [strategyEdit, setStrategyEdit] = useState('')
  const [strategyEditOpen, setStrategyEditOpen] = useState(false)
  const [strategySaving, setStrategySaving] = useState(false)
  const [hasCustomTemplate, setHasCustomTemplate] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: tagAssign }, key, { data: evData }] = await Promise.all([
        supabase.from('trades').select('*').eq('id', id).single(),
        supabase.from('trade_tag_assignments').select('*, tag:trade_tag_definitions(*)').eq('trade_id', id),
        AsyncStorage.getItem(ANTHROPIC_KEY),
        supabase.from('trade_management_events').select('*').eq('trade_id', id).order('event_time', { ascending: true }),
      ])
      const loadedEvents: ManagementEvent[] = evData ?? []
      setEvents(loadedEvents)
      if (!t) return
      setTrade(t)
      const loadedTags = (tagAssign ?? []).map((a: any) => a.tag).filter(Boolean)
      setTags(loadedTags)
      setHasKey(!!key)

      let loadedStrategy: StrategyProfile | null = null
      if (t.strategy_id) {
        const { data: strat } = await supabase.from('strategy_profiles').select('*').eq('id', t.strategy_id).single()
        if (strat) {
          setStrategy(strat)
          loadedStrategy = strat
        }
      }

      let loadedOhlcv: MFEMAEResult | null = null
      const interval = normalizeInterval(t.timeframe ?? '')
      if (interval) {
        setStatus('Lade Binance-Kerzen...')
        try {
          const symbol = normalizeSymbol(t.symbol)
          const startMs = new Date(t.opened_at).getTime()
          const endMs = t.closed_at ? new Date(t.closed_at).getTime() : Date.now()
          const candles = await fetchCandles(symbol, interval, startMs, endMs)
          if (candles.length > 0) {
            loadedOhlcv = calcMFEMAE(candles, t.entry_price, t.stop_loss, t.side)
            setOhlcv(loadedOhlcv)
          }
        } catch {
          // OHLCV optional
        }
      }

      // Build fresh prompt, then apply saved instructions if available
      const generated = buildAnalysisPrompt(t, loadedTags, loadedOhlcv, loadedStrategy, loadedEvents)
      const savedInstructions = await AsyncStorage.getItem(PROMPT_INSTRUCTIONS_KEY)
      if (savedInstructions) {
        const sepIdx = generated.indexOf(INSTRUCTIONS_START)
        const context = sepIdx >= 0 ? generated.slice(0, sepIdx) : generated
        setPromptText(context + savedInstructions)
        setHasCustomTemplate(true)
      } else {
        setPromptText(generated)
        setHasCustomTemplate(false)
      }
      setStatus('')
      setPhase('prompt')
    }
    load()
  }, [id])

  async function runAnalysis() {
    if (!trade) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) {
      setError('Kein Anthropic API Key gesetzt. Bitte in Einstellungen eingeben.')
      setPhase('error')
      return
    }
    setPhase('analyzing')
    setError(null)
    setAnalysis(null)
    setStatus('Claude analysiert...')
    try {
      const result = await analyzeTradeWithClaude(key, trade, tags, ohlcv, strategy, promptText, events)
      setAnalysis(result)
      setPhase('result')
    } catch (e: any) {
      setError(e?.message ?? 'Unbekannter Fehler')
      setPhase('error')
    } finally {
      setStatus('')
    }
  }

  function resetToPrompt() {
    setPhase('prompt')
    setAnalysis(null)
    setError(null)
  }

  async function savePromptTemplate() {
    const sepIdx = promptText.indexOf(INSTRUCTIONS_START)
    const instructions = sepIdx >= 0 ? promptText.slice(sepIdx) : promptText
    await AsyncStorage.setItem(PROMPT_INSTRUCTIONS_KEY, instructions)
    setHasCustomTemplate(true)
    Alert.alert('Gespeichert', 'Anweisungen als Vorlage gespeichert. Wird bei jedem neuen Trade geladen.')
  }

  async function resetPromptTemplate() {
    await AsyncStorage.removeItem(PROMPT_INSTRUCTIONS_KEY)
    setHasCustomTemplate(false)
    Alert.alert('Zurückgesetzt', 'Standard-Prompt wird wieder verwendet.')
  }

  function openStrategyEdit() {
    setStrategyEdit(strategy?.description ?? '')
    setStrategyEditOpen(true)
  }

  async function saveStrategyDescription() {
    if (!strategy) return
    setStrategySaving(true)
    const { error } = await supabase
      .from('strategy_profiles')
      .update({ description: strategyEdit.trim() })
      .eq('id', strategy.id)
    setStrategySaving(false)
    if (error) {
      Alert.alert('Fehler', error.message)
      return
    }
    setStrategy(s => s ? { ...s, description: strategyEdit.trim() } : s)
    setStrategyEditOpen(false)
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </TouchableOpacity>
        <Text style={s.title}>KI-Analyse</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {trade && (
          <View style={s.tradeCard}>
            <Text style={s.tradeSymbol}>{trade.symbol} <Text style={trade.side === 'long' ? s.green : s.red}>{trade.side.toUpperCase()}</Text></Text>
            <Text style={s.tradeMeta}>{trade.timeframe ?? '—'} · Entry {trade.entry_price} · SL {trade.stop_loss}</Text>
            {strategy && <Text style={s.stratMeta}>📋 {strategy.name}</Text>}
            {ohlcv && (
              <Text style={s.ohlcvMeta}>MFE {ohlcv.mfe.toFixed(2)}R · MAE {ohlcv.mae.toFixed(2)}R · {ohlcv.candles.length} Kerzen</Text>
            )}
          </View>
        )}

        {!hasKey && phase !== 'loading' && (
          <View style={s.warningBox}>
            <Feather name="alert-circle" size={16} color="#f59e0b" />
            <Text style={s.warningText}>Kein API Key. Bitte in Einstellungen → KI-Analyse eintragen.</Text>
          </View>
        )}

        {phase === 'loading' && (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={s.loadingText}>{status}</Text>
          </View>
        )}

        {phase === 'prompt' && (
          <>
            <View style={s.promptLabelRow}>
              <Text style={s.promptLabel}>Prompt bearbeiten</Text>
              {hasCustomTemplate && (
                <View style={s.customBadge}>
                  <Feather name="bookmark" size={11} color="#f59e0b" />
                  <Text style={s.customBadgeText}>Vorlage aktiv</Text>
                </View>
              )}
            </View>
            <TextInput
              style={s.promptInput}
              value={promptText}
              onChangeText={setPromptText}
              multiline
              placeholderTextColor="#555"
              textAlignVertical="top"
            />
            <View style={s.templateBtns}>
              <TouchableOpacity style={s.templateBtn} onPress={savePromptTemplate}>
                <Feather name="bookmark" size={13} color="#f59e0b" />
                <Text style={s.templateBtnText}>Als Vorlage speichern</Text>
              </TouchableOpacity>
              {hasCustomTemplate && (
                <TouchableOpacity style={s.templateBtn} onPress={resetPromptTemplate}>
                  <Feather name="rotate-ccw" size={13} color="#666" />
                  <Text style={[s.templateBtnText, { color: '#666' }]}>Standard</Text>
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity style={s.analyzeBtn} onPress={runAnalysis} disabled={!hasKey}>
              <Feather name="cpu" size={18} color="#000" />
              <Text style={s.analyzeBtnText}>Analysieren</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'analyzing' && (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={s.loadingText}>{status}</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity onPress={resetToPrompt} style={s.retryBtn}>
              <Text style={s.retryText}>Zurück zum Prompt</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'result' && analysis && (
          <>
            <AnalysisText text={analysis} />
            <TouchableOpacity style={s.rerunBtn} onPress={resetToPrompt}>
              <Feather name="edit-2" size={14} color="#666" />
              <Text style={s.rerunText}>Prompt bearbeiten & neu analysieren</Text>
            </TouchableOpacity>

            {strategy && (
              <View style={s.stratEditBox}>
                <TouchableOpacity style={s.stratEditHeader} onPress={() => strategyEditOpen ? setStrategyEditOpen(false) : openStrategyEdit()}>
                  <Feather name="book-open" size={14} color="#818cf8" />
                  <Text style={s.stratEditTitle}>Strategie-Regelwerk bearbeiten</Text>
                  <Feather name={strategyEditOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#555" />
                </TouchableOpacity>
                {strategyEditOpen && (
                  <>
                    <TextInput
                      style={s.stratEditInput}
                      value={strategyEdit}
                      onChangeText={setStrategyEdit}
                      multiline
                      textAlignVertical="top"
                      placeholderTextColor="#555"
                      placeholder="Strategie-Regeln..."
                    />
                    <View style={s.stratEditBtns}>
                      <TouchableOpacity style={s.stratCancelBtn} onPress={() => setStrategyEditOpen(false)}>
                        <Text style={s.stratCancelText}>Abbrechen</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.stratSaveBtn} onPress={saveStrategyDescription} disabled={strategySaving}>
                        <Text style={s.stratSaveText}>{strategySaving ? '...' : 'Speichern'}</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function AnalysisText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <View style={s.analysisBox}>
      {lines.map((line, i) => {
        const isBold = line.startsWith('**') && line.includes('**', 2)
        if (isBold) {
          const cleaned = line.replace(/\*\*/g, '')
          return <Text key={i} style={s.analysisHeading}>{cleaned}</Text>
        }
        if (line.trim() === '') return <View key={i} style={{ height: 8 }} />
        return <Text key={i} style={s.analysisText}>{line}</Text>
      })}
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  closeBtn: { padding: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 60 },
  tradeCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 16 },
  tradeSymbol: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  tradeMeta: { color: '#666', fontSize: 13 },
  ohlcvMeta: { color: '#444', fontSize: 12, marginTop: 4 },
  stratMeta: { color: '#818cf8', fontSize: 12, marginTop: 4 },
  warningBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1500', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f59e0b33', marginBottom: 16 },
  warningText: { color: '#f59e0b', fontSize: 13, flex: 1 },
  promptLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  promptLabel: { color: '#888', fontSize: 12, fontWeight: '600' },
  customBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1500', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#f59e0b44' },
  customBadgeText: { color: '#f59e0b', fontSize: 11, fontWeight: '600' },
  templateBtns: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  templateBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  templateBtnText: { color: '#f59e0b', fontSize: 12, fontWeight: '600' },
  promptInput: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#2a2a2a', minHeight: 300, lineHeight: 20, marginBottom: 14 },
  analyzeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#22c55e', borderRadius: 12, padding: 16, marginBottom: 16 },
  analyzeBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  loadingBox: { alignItems: 'center', gap: 12, padding: 40 },
  loadingText: { color: '#666', fontSize: 14 },
  errorBox: { backgroundColor: '#2d0a0a', borderRadius: 10, padding: 14, marginBottom: 16 },
  errorText: { color: '#ef4444', fontSize: 13, marginBottom: 10 },
  retryBtn: { alignSelf: 'flex-start' },
  retryText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  analysisBox: { backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1e1e1e' },
  analysisHeading: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 12, marginBottom: 4 },
  analysisText: { color: '#bbb', fontSize: 14, lineHeight: 22 },
  rerunBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'center' },
  rerunText: { color: '#555', fontSize: 13 },
  stratEditBox: { marginTop: 16, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1e1a3a', overflow: 'hidden' },
  stratEditHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  stratEditTitle: { flex: 1, color: '#818cf8', fontSize: 13, fontWeight: '600' },
  stratEditInput: { backgroundColor: '#0f0f0f', margin: 10, marginTop: 0, borderRadius: 8, padding: 12, color: '#fff', fontSize: 13, borderWidth: 1, borderColor: '#2a2a2a', minHeight: 160, lineHeight: 20 },
  stratEditBtns: { flexDirection: 'row', gap: 8, padding: 10, paddingTop: 0 },
  stratCancelBtn: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 8, padding: 12, alignItems: 'center' },
  stratCancelText: { color: '#aaa', fontWeight: '600', fontSize: 14 },
  stratSaveBtn: { flex: 1, backgroundColor: '#818cf8', borderRadius: 8, padding: 12, alignItems: 'center' },
  stratSaveText: { color: '#000', fontWeight: '700', fontSize: 14 },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

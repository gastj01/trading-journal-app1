import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../../src/lib/supabase'
import { fetchCandles, calcMFEMAE, normalizeSymbol, normalizeInterval } from '../../../src/lib/binance'
import { analyzeTradeWithClaude } from '../../../src/lib/claude'
import { ANTHROPIC_KEY } from '../../(tabs)/settings'
import type { Trade, TagDefinition } from '../../../src/types'
import type { MFEMAEResult } from '../../../src/lib/binance'

export default function TradeAnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [ohlcv, setOhlcv] = useState<MFEMAEResult | null>(null)
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Lade Trade...')
  const [error, setError] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: tagAssign }, key] = await Promise.all([
        supabase.from('trades').select('*').eq('id', id).single(),
        supabase.from('trade_tag_assignments').select('*, tag:trade_tag_definitions(*)').eq('trade_id', id),
        AsyncStorage.getItem(ANTHROPIC_KEY),
      ])
      if (!t) return
      setTrade(t)
      setTags((tagAssign ?? []).map((a: any) => a.tag).filter(Boolean))
      setHasKey(!!key)

      const interval = normalizeInterval(t.timeframe ?? '')
      if (interval) {
        setStatus('Lade Binance-Kerzen...')
        try {
          const symbol = normalizeSymbol(t.symbol)
          const startMs = new Date(t.opened_at).getTime()
          const endMs = t.closed_at ? new Date(t.closed_at).getTime() : Date.now()
          const candles = await fetchCandles(symbol, interval, startMs, endMs)
          if (candles.length > 0) setOhlcv(calcMFEMAE(candles, t.entry_price, t.stop_loss, t.side))
        } catch {
          // OHLCV optional, weiter ohne
        }
      }
      setStatus('')
    }
    load()
  }, [id])

  async function runAnalysis() {
    if (!trade) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) {
      setError('Kein Anthropic API Key gesetzt. Bitte in Einstellungen eingeben.')
      return
    }
    setLoading(true)
    setError(null)
    setAnalysis(null)
    setStatus('Claude analysiert...')
    try {
      const result = await analyzeTradeWithClaude(key, trade, tags, ohlcv)
      setAnalysis(result)
    } catch (e: any) {
      setError(e?.message ?? 'Unbekannter Fehler')
    } finally {
      setLoading(false)
      setStatus('')
    }
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

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {trade && (
          <View style={s.tradeCard}>
            <Text style={s.tradeSymbol}>{trade.symbol} <Text style={trade.side === 'long' ? s.green : s.red}>{trade.side.toUpperCase()}</Text></Text>
            <Text style={s.tradeMeta}>{trade.timeframe ?? '—'} · Entry {trade.entry_price} · SL {trade.stop_loss}</Text>
            {ohlcv && (
              <Text style={s.ohlcvMeta}>MFE {ohlcv.mfe.toFixed(2)}R · MAE {ohlcv.mae.toFixed(2)}R · {ohlcv.candles.length} Kerzen</Text>
            )}
          </View>
        )}

        {!hasKey && !loading && (
          <View style={s.warningBox}>
            <Feather name="alert-circle" size={16} color="#f59e0b" />
            <Text style={s.warningText}>Kein API Key. Bitte in Einstellungen → KI-Analyse eintragen.</Text>
          </View>
        )}

        {!analysis && !loading && !error && trade && (
          <TouchableOpacity style={s.analyzeBtn} onPress={runAnalysis} disabled={!hasKey}>
            <Feather name="cpu" size={18} color="#000" />
            <Text style={s.analyzeBtnText}>Jetzt analysieren</Text>
          </TouchableOpacity>
        )}

        {loading && (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={s.loadingText}>{status}</Text>
          </View>
        )}

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity onPress={runAnalysis} style={s.retryBtn}>
              <Text style={s.retryText}>Nochmal versuchen</Text>
            </TouchableOpacity>
          </View>
        )}

        {analysis && (
          <>
            <AnalysisText text={analysis} />
            <TouchableOpacity style={s.rerunBtn} onPress={runAnalysis}>
              <Feather name="refresh-cw" size={14} color="#666" />
              <Text style={s.rerunText}>Neu analysieren</Text>
            </TouchableOpacity>
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
  warningBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1500', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f59e0b33', marginBottom: 16 },
  warningText: { color: '#f59e0b', fontSize: 13, flex: 1 },
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
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

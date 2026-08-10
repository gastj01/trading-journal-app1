import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../../src/lib/supabase'
import type { Trade, ManagementEvent } from '../../../src/types'

type ActionKey =
  | 'sl_moved_to_be'
  | 'sl_moved_manual'
  | 'partial_close'
  | 'tp_hit'
  | 'manual_exit'
  | 'sl_hit'
  | 'note'

interface ActionDef {
  key: ActionKey
  label: string
  icon: string
  color: string
  showPrice: boolean
  showSize: boolean
  closestrade: boolean
  prefilledPrice?: 'entry'
}

const ACTIONS: ActionDef[] = [
  { key: 'sl_moved_to_be', label: 'SL → Break Even', icon: 'shield', color: '#3b82f6', showPrice: true, showSize: false, closestrade: false, prefilledPrice: 'entry' },
  { key: 'sl_moved_manual', label: 'SL verschieben', icon: 'trending-up', color: '#f59e0b', showPrice: true, showSize: false, closestrade: false },
  { key: 'partial_close', label: 'Partial Close', icon: 'scissors', color: '#a855f7', showPrice: true, showSize: true, closestrade: false },
  { key: 'tp_hit', label: 'TP getroffen', icon: 'check-circle', color: '#22c55e', showPrice: true, showSize: true, closestrade: false },
  { key: 'manual_exit', label: 'Manueller Exit', icon: 'log-out', color: '#ef4444', showPrice: true, showSize: false, closestrade: true },
  { key: 'sl_hit', label: 'SL getroffen', icon: 'x-circle', color: '#ef4444', showPrice: true, showSize: false, closestrade: true },
  { key: 'note', label: 'Notiz', icon: 'file-text', color: '#6b7280', showPrice: false, showSize: false, closestrade: false },
]

const EVENT_LABELS: Record<string, string> = {
  sl_moved_to_be: 'SL → Break Even',
  sl_moved_manual: 'SL verschoben',
  partial_close: 'Teilverkauf',
  tp_hit: 'TP getroffen',
  manual_exit: 'Manueller Exit',
  sl_hit: 'SL getroffen',
  note: 'Notiz',
  limit_placed: 'Limit gesetzt',
  limit_filled: 'Limit gefüllt',
  tp_moved_manual: 'TP verschoben',
}

const EVENT_COLORS: Record<string, string> = {
  sl_moved_to_be: '#3b82f6',
  sl_moved_manual: '#f59e0b',
  partial_close: '#a855f7',
  tp_hit: '#22c55e',
  manual_exit: '#ef4444',
  sl_hit: '#ef4444',
  note: '#6b7280',
  limit_placed: '#6b7280',
  limit_filled: '#3b82f6',
  tp_moved_manual: '#f59e0b',
}

export default function ManageTradeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [trade, setTrade] = useState<Trade | null>(null)
  const [events, setEvents] = useState<ManagementEvent[]>([])
  const [accountBalance, setAccountBalance] = useState(0)
  const [activeAction, setActiveAction] = useState<ActionDef | null>(null)
  const [price, setPrice] = useState('')
  const [sizePercent, setSizePercent] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const [{ data: t }, { data: ev }] = await Promise.all([
      supabase.from('trades').select('*').eq('id', id).single(),
      supabase.from('trade_management_events').select('*').eq('trade_id', id).order('event_time', { ascending: false }),
    ])
    setEvents(ev ?? [])
    if (!t) return
    setTrade(t)
    const { data: acc } = await supabase.from('trading_accounts').select('initial_balance').eq('id', t.account_id).single()
    if (acc) setAccountBalance(acc.initial_balance)
  }, [id])

  useEffect(() => {
    if (id) loadData()
  }, [id, loadData])

  function openAction(action: ActionDef) {
    setActiveAction(action)
    setNote('')
    setSizePercent('')
    if (action.prefilledPrice === 'entry' && trade) {
      setPrice(String(trade.entry_price))
    } else {
      setPrice('')
    }
  }

  function closeAction() {
    setActiveAction(null)
    setPrice('')
    setSizePercent('')
    setNote('')
  }

  async function handleSave() {
    if (!activeAction || !trade) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    if (activeAction.showPrice && !price) {
      Alert.alert('Fehler', 'Bitte Preis eingeben.')
      return
    }

    const isClose = activeAction.closestrade || (activeAction.key === 'tp_hit' && parseFloat(sizePercent) === 100)

    setSaving(true)
    const { error: evError } = await supabase.from('trade_management_events').insert({
      trade_id: id,
      user_id: user.id,
      event_type: activeAction.key,
      event_time: new Date().toISOString(),
      price: activeAction.showPrice ? parseFloat(price) : trade.entry_price,
      size_percent: activeAction.showSize && sizePercent ? parseFloat(sizePercent) : null,
      size_absolute: null,
      note: note || null,
    })

    if (evError) {
      setSaving(false)
      Alert.alert('Fehler', evError.message)
      return
    }

    if (isClose) {
      await supabase.from('trades').update({
        status: 'closed',
        exit_price: parseFloat(price),
        closed_at: new Date().toISOString(),
      }).eq('id', id)
    }

    setSaving(false)
    closeAction()
    await loadData()

    if (isClose) {
      router.back()
    }
  }

  if (!trade) {
    return (
      <View style={s.loading}>
        <Text style={s.loadingText}>Laden...</Text>
      </View>
    )
  }

  const isLong = trade.side === 'long'
  const entryPrice = trade.entry_price
  const stopLoss = trade.stop_loss
  const risk = Math.abs(entryPrice - stopLoss)

  // Derive current state from management events (events sorted desc, process asc)
  const eventsAsc = [...events].reverse()
  let currentSL = trade.stop_loss
  let remainingFraction = 1.0
  for (const ev of eventsAsc) {
    if (ev.event_type === 'sl_moved_to_be') currentSL = trade.entry_price
    if (ev.event_type === 'sl_moved_manual') currentSL = ev.price
    if ((ev.event_type === 'partial_close' || ev.event_type === 'tp_hit') && ev.size_percent) {
      remainingFraction *= (1 - ev.size_percent / 100)
    }
  }
  const remainingSize = (trade.position_size ?? 0) * remainingFraction
  const currentRiskPerUnit = Math.abs(trade.entry_price - currentSL)
  const currentRiskAmount = remainingSize * currentRiskPerUnit
  const currentRiskPct = accountBalance > 0 ? (currentRiskAmount / accountBalance) * 100 : 0
  const atBreakEven = currentSL === trade.entry_price

  function calcR(eventPrice: number) {
    if (risk === 0) return null
    const r = isLong
      ? (eventPrice - entryPrice) / risk
      : (entryPrice - eventPrice) / risk
    return r.toFixed(2)
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.symbol}>{trade.symbol}</Text>
          <View style={[s.sidePill, isLong ? s.longPill : s.shortPill]}>
            <Feather
              name={isLong ? 'trending-up' : 'trending-down'}
              size={11}
              color={isLong ? '#22c55e' : '#ef4444'}
            />
            <Text style={[s.sideText, isLong ? s.green : s.red]}>
              {isLong ? 'LONG' : 'SHORT'}
            </Text>
          </View>
        </View>
        <View style={s.headerMeta}>
          <Text style={s.metaText}>Entry: {trade.entry_price.toLocaleString()}</Text>
          <Text style={s.metaSep}>|</Text>
          <Text style={s.metaText}>SL: {trade.stop_loss.toLocaleString()}</Text>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={[s.riskCard, atBreakEven && s.riskCardBE]}>
          <View style={s.riskRow}>
            <View style={s.riskItem}>
              <Text style={s.riskLabel}>Aktueller SL</Text>
              <Text style={[s.riskValue, atBreakEven && s.riskValueBE]}>{currentSL.toLocaleString()}</Text>
            </View>
            <View style={s.riskItem}>
              <Text style={s.riskLabel}>Restgrösse</Text>
              <Text style={s.riskValue}>{remainingSize.toFixed(4)} ({(remainingFraction * 100).toFixed(0)}%)</Text>
            </View>
          </View>
          {atBreakEven ? (
            <Text style={s.beBadge}>Break Even — Kein Risiko</Text>
          ) : (
            <View style={s.riskRow}>
              <View style={s.riskItem}>
                <Text style={s.riskLabel}>Risiko $</Text>
                <Text style={s.riskValueRed}>{currentRiskAmount.toFixed(2)}</Text>
              </View>
              {currentRiskPct > 0 && (
                <View style={s.riskItem}>
                  <Text style={s.riskLabel}>Risiko %</Text>
                  <Text style={s.riskValueRed}>{currentRiskPct.toFixed(2)}%</Text>
                </View>
              )}
            </View>
          )}
        </View>

        <Text style={s.sectionTitle}>Schnellaktionen</Text>
        <View style={s.actionGrid}>
          {ACTIONS.map(action => (
            <TouchableOpacity
              key={action.key}
              style={s.actionBtn}
              onPress={() => openAction(action)}
            >
              <Feather name={action.icon as any} size={20} color={action.color} />
              <Text style={s.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {events.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 24 }]}>Verlauf</Text>
            {events.map(ev => {
              const r = ev.price && ev.event_type !== 'note' ? calcR(ev.price) : null
              return (
                <View key={ev.id} style={s.eventRow}>
                  <View style={[s.eventDot, { backgroundColor: EVENT_COLORS[ev.event_type] ?? '#6b7280' }]} />
                  <View style={s.eventContent}>
                    <View style={s.eventTopRow}>
                      <Text style={s.eventType}>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</Text>
                      {r !== null && (
                        <Text style={[s.eventR, parseFloat(r) >= 0 ? s.green : s.red]}>
                          {parseFloat(r) >= 0 ? '+' : ''}{r}R
                        </Text>
                      )}
                    </View>
                    <Text style={s.eventMeta}>
                      {ev.event_type !== 'note' && ev.price ? `${ev.price.toLocaleString()} · ` : ''}
                      {new Date(ev.event_time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      {ev.size_percent ? ` · ${ev.size_percent}%` : ''}
                    </Text>
                    {ev.note ? <Text style={s.eventNote}>{ev.note}</Text> : null}
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>

      <Modal visible={activeAction !== null} transparent animationType="slide" onRequestClose={closeAction}>
        <KeyboardAvoidingView
          style={s.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={s.modalBackdrop} activeOpacity={1} onPress={closeAction} />
          <View style={s.actionPanel}>
            <View style={s.panelHandle} />
            <Text style={s.panelTitle}>{activeAction?.label}</Text>

            {activeAction?.showPrice && (
              <>
                <Text style={s.inputLabel}>Preis</Text>
                <TextInput
                  style={s.input}
                  value={price}
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                  placeholderTextColor="#555"
                  placeholder="0.00"
                />
              </>
            )}

            {activeAction?.showSize && (
              <>
                <Text style={s.inputLabel}>Grösse %</Text>
                <TextInput
                  style={s.input}
                  value={sizePercent}
                  onChangeText={setSizePercent}
                  keyboardType="decimal-pad"
                  placeholderTextColor="#555"
                  placeholder="z.B. 50"
                />
              </>
            )}

            <Text style={s.inputLabel}>Notiz (optional)</Text>
            <TextInput
              style={[s.input, s.inputMultiline]}
              value={note}
              onChangeText={setNote}
              multiline
              numberOfLines={3}
              placeholderTextColor="#555"
              placeholder="Notiz hinzufügen..."
              textAlignVertical="top"
            />

            <View style={s.panelButtons}>
              <TouchableOpacity style={s.cancelBtn} onPress={closeAction}>
                <Text style={s.cancelBtnText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving}>
                <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  loading: { flex: 1, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#666' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  closeBtn: { padding: 8 },
  headerCenter: { alignItems: 'center', gap: 4 },
  symbol: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sidePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  longPill: { backgroundColor: '#052e16' },
  shortPill: { backgroundColor: '#2d0a0a' },
  sideText: { fontSize: 11, fontWeight: '700' },
  headerMeta: { flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  metaText: { color: '#888', fontSize: 11 },
  metaSep: { color: '#444', fontSize: 11 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  riskCard: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#2a2a2a', gap: 10 },
  riskCardBE: { borderColor: '#22c55e33', backgroundColor: '#0a1f0f' },
  riskRow: { flexDirection: 'row', gap: 24 },
  riskItem: { gap: 2 },
  riskLabel: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  riskValue: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  riskValueBE: { color: '#22c55e' },
  riskValueRed: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  beBadge: { color: '#22c55e', fontSize: 13, fontWeight: '700' },
  sectionTitle: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionBtn: { width: '47%', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#2a2a2a' },
  actionLabel: { color: '#ccc', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  eventRow: { flexDirection: 'row', gap: 12, marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  eventDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  eventContent: { flex: 1 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventType: { color: '#fff', fontSize: 14, fontWeight: '600' },
  eventR: { fontSize: 13, fontWeight: '700' },
  eventMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  eventNote: { color: '#888', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { flex: 1, backgroundColor: '#000000aa' },
  actionPanel: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 0 },
  panelHandle: { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  panelTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 16 },
  inputLabel: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#0f0f0f', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  inputMultiline: { height: 72, textAlignVertical: 'top' },
  panelButtons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontWeight: '600', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#22c55e', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

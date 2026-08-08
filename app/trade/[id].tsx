import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { fetchCandles, calcMFEMAE, normalizeSymbol, normalizeInterval } from '../../src/lib/binance'
import type { Trade, PartialProfit, ManagementEvent, TagDefinition } from '../../src/types'
import type { MFEMAEResult } from '../../src/lib/binance'

interface ChecklistResponseWithItem {
  id: string
  checklist_item_id: string
  status: 'checked' | 'unchecked'
  item: {
    title: string
    category: string
  } | null
}

export default function TradeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tps, setTps] = useState<PartialProfit[]>([])
  const [events, setEvents] = useState<ManagementEvent[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [checklistResponses, setChecklistResponses] = useState<ChecklistResponseWithItem[]>([])
  const [ohlcv, setOhlcv] = useState<MFEMAEResult | null>(null)
  const [ohlcvLoading, setOhlcvLoading] = useState(false)
  const [ohlcvError, setOhlcvError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: tp }, { data: ev }, { data: tagAssign }, { data: clResponses }] = await Promise.all([
        supabase.from('trades').select('*').eq('id', id).single(),
        supabase.from('trade_partial_profits').select('*').eq('trade_id', id).order('label'),
        supabase.from('trade_management_events').select('*').eq('trade_id', id).order('event_time'),
        supabase.from('trade_tag_assignments').select('*, tag:trade_tag_definitions(*)').eq('trade_id', id),
        supabase.from('trade_checklist_responses').select('*, item:strategy_checklist_items(*)').eq('trade_id', id),
      ])
      setTrade(t)
      setTps(tp ?? [])
      setEvents(ev ?? [])
      setTags((tagAssign ?? []).map((a: any) => a.tag).filter(Boolean))
      setChecklistResponses(clResponses ?? [])

      if (t) loadOhlcv(t)
    }

    async function loadOhlcv(t: Trade) {
      const interval = normalizeInterval(t.timeframe ?? '')
      if (!interval) return
      setOhlcvLoading(true)
      setOhlcvError(null)
      try {
        const symbol = normalizeSymbol(t.symbol)
        const startMs = new Date(t.opened_at).getTime()
        const endMs = t.closed_at ? new Date(t.closed_at).getTime() : Date.now()
        const candles = await fetchCandles(symbol, interval, startMs, endMs)
        if (candles.length === 0) {
          setOhlcvError('Keine Kerzen gefunden')
          return
        }
        const result = calcMFEMAE(candles, t.entry_price, t.stop_loss, t.side)
        setOhlcv(result)
      } catch (e: any) {
        setOhlcvError(e?.message ?? 'Binance API Fehler')
      } finally {
        setOhlcvLoading(false)
      }
    }

    if (id) load()
  }, [id])

  async function handleDelete() {
    Alert.alert('Trade löschen', 'Wirklich löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen', style: 'destructive', onPress: async () => {
          await supabase.from('trades').delete().eq('id', id)
          router.back()
        }
      },
    ])
  }

  if (!trade) return <View style={s.loading}><Text style={s.loadingText}>Laden...</Text></View>

  const isLong = trade.side === 'long'
  const isWin = trade.exit_price != null && (isLong ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price)
  const risk = Math.abs(trade.entry_price - trade.stop_loss)
  const rMultiple = trade.exit_price && risk > 0
    ? ((isLong ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price) / risk).toFixed(2)
    : null

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.symbol}>{trade.symbol}</Text>
          <View style={[s.sidePill, isLong ? s.longPill : s.shortPill]}>
            {isLong ? <Feather name="trending-up" size={12} color="#22c55e" /> : <Feather name="trending-down" size={12} color="#ef4444" />}
            <Text style={[s.sideText, isLong ? s.green : s.red]}>{isLong ? 'LONG' : 'SHORT'}</Text>
          </View>
        </View>
        <View style={s.headerActions}>
          {trade.status === 'open' && (
            <TouchableOpacity onPress={() => router.push(`/trade/manage/${id}`)} style={s.manageBtn}>
              <Feather name="activity" size={14} color="#000" />
              <Text style={s.manageBtnText}>Verwalten</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => router.push(`/trade/analysis/${id}`)} style={s.aiBtn}>
            <Feather name="cpu" size={14} color="#818cf8" />
            <Text style={s.aiBtnText}>KI</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/trade/edit/${id}`)} style={s.closeBtn}>
            <Feather name="edit-2" size={18} color="#aaa" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} style={s.closeBtn}>
            <Feather name="trash-2" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {trade.status === 'closed' && rMultiple && (
          <View style={[s.banner, isWin ? s.winBanner : s.lossBanner]}>
            <Text style={[s.bannerR, isWin ? s.green : s.red]}>
              {parseFloat(rMultiple) > 0 ? '+' : ''}{rMultiple}R
            </Text>
            <Text style={[s.bannerLabel, isWin ? s.green : s.red]}>{isWin ? 'WIN' : 'LOSS'}</Text>
          </View>
        )}
        {trade.status === 'open' && (
          <View style={s.openBanner}>
            <Text style={s.openText}>⚡ Position offen</Text>
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Preise</Text>
          <View style={s.priceGrid}>
            <PriceBox label="Entry" value={trade.entry_price} />
            <PriceBox label="Stop Loss" value={trade.stop_loss} negative />
            {trade.exit_price && <PriceBox label="Exit" value={trade.exit_price} positive={isWin} negative={!isWin} />}
            {trade.break_even && <PriceBox label="Break Even" value={trade.entry_price} />}
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Risiko & Position</Text>
          <View style={s.infoGrid}>
            <InfoRow label="Risiko %" value={`${trade.risk_percent}%`} />
            <InfoRow label="Risiko $" value={`$${trade.risk_amount}`} />
            <InfoRow label="Positionsgrösse" value={trade.position_size.toFixed(5)} />
            <InfoRow label="Leverage" value={`${trade.leverage}x`} />
            <InfoRow label="Timeframe" value={trade.timeframe} />
            <InfoRow label="Exchange" value={trade.exchange} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Zeit</Text>
          <InfoRow label="Eröffnet" value={new Date(trade.opened_at).toLocaleString('de-DE')} />
          {trade.closed_at && <InfoRow label="Geschlossen" value={new Date(trade.closed_at).toLocaleString('de-DE')} />}
        </View>

        {tps.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Take Profits</Text>
            {tps.map(tp => (
              <View key={tp.id} style={s.tpRow}>
                <View style={[s.tpDot, tp.filled ? s.filledDot : s.unfilledDot]} />
                <Text style={s.tpLabel}>{tp.label}</Text>
                <Text style={s.tpPrice}>{tp.target_price.toLocaleString()}</Text>
                <Text style={s.tpPct}>{tp.quantity_percent}%</Text>
                {tp.filled && <Text style={s.tpFilled}>✓</Text>}
              </View>
            ))}
          </View>
        )}

        {events.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Trade-Verlauf</Text>
            {events.map(ev => (
              <View key={ev.id} style={s.eventRow}>
                <View style={s.eventDot} />
                <View style={s.eventContent}>
                  <Text style={s.eventType}>{formatEventType(ev.event_type)}</Text>
                  <Text style={s.eventMeta}>
                    {ev.price.toLocaleString()} · {new Date(ev.event_time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {ev.note ? <Text style={s.eventNote}>{ev.note}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {tags.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Tags</Text>
            <View style={s.tagList}>
              {tags.map(tag => (
                <View key={tag.id} style={[s.tag, tag.tag_type === 'mistake' ? s.tagMistake : tag.tag_type === 'execution' ? s.tagExecution : s.tagContext]}>
                  <Text style={s.tagText}>{tag.name.replace(/_/g, ' ')}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {checklistResponses.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Checkliste</Text>
            {checklistResponses.map(resp => (
              <View key={resp.id} style={s.clRow}>
                <Feather
                  name={resp.status === 'checked' ? 'check-square' : 'square'}
                  size={18}
                  color={resp.status === 'checked' ? '#22c55e' : '#555'}
                />
                <Text style={[s.clTitle, resp.status === 'checked' && s.clChecked]}>
                  {resp.item?.title ?? ''}
                </Text>
                {resp.item?.category ? (
                  <View style={s.clBadge}>
                    <Text style={s.clBadgeText}>{resp.item.category}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {(trade.setup || trade.notes) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Notizen</Text>
            {trade.setup ? <Text style={s.noteText}><Text style={s.noteLabel}>Setup: </Text>{trade.setup}</Text> : null}
            {trade.notes ? <Text style={s.noteText}>{trade.notes}</Text> : null}
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>OHLCV Analyse</Text>
          {ohlcvLoading && (
            <View style={s.ohlcvLoading}>
              <ActivityIndicator size="small" color="#22c55e" />
              <Text style={s.ohlcvLoadingText}>Lade Binance-Kerzen...</Text>
            </View>
          )}
          {ohlcvError && !ohlcvLoading && (
            <Text style={s.ohlcvError}>{ohlcvError}</Text>
          )}
          {ohlcv && !ohlcvLoading && (
            <>
              <View style={s.mfeRow}>
                <View style={s.mfeBox}>
                  <Text style={s.mfeLabel}>MFE</Text>
                  <Text style={s.mfeValue}>{ohlcv.mfe > 0 ? '+' : ''}{ohlcv.mfe.toFixed(2)}R</Text>
                  <Text style={s.mfePrice}>{ohlcv.mfePrice.toLocaleString()}</Text>
                  <Text style={s.mfeHint}>Max. Gewinn möglich</Text>
                </View>
                <View style={s.maeBox}>
                  <Text style={s.maeLabel}>MAE</Text>
                  <Text style={s.maeValue}>-{ohlcv.mae.toFixed(2)}R</Text>
                  <Text style={s.maePrice}>{ohlcv.maePrice.toLocaleString()}</Text>
                  <Text style={s.mfeHint}>Max. Drawdown</Text>
                </View>
              </View>
              {rMultiple && ohlcv.mfe > 0 && (
                <View style={s.captureRow}>
                  <Text style={s.captureLabel}>Exit-Effizienz</Text>
                  <Text style={[s.captureValue, parseFloat(rMultiple) / ohlcv.mfe >= 0.7 ? s.green : s.orange]}>
                    {((parseFloat(rMultiple) / ohlcv.mfe) * 100).toFixed(0)}%
                  </Text>
                  <Text style={s.captureHint}> von {ohlcv.mfe.toFixed(2)}R ausgeschöpft</Text>
                </View>
              )}
              <Text style={s.ohlcvMeta}>{ohlcv.candles.length} Kerzen · {trade.timeframe}</Text>
            </>
          )}
          {!ohlcv && !ohlcvLoading && !ohlcvError && (
            <Text style={s.ohlcvError}>Kein Timeframe gesetzt</Text>
          )}
        </View>

        {trade.screenshot_path && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Screenshot</Text>
            <Image
              source={{ uri: supabase.storage.from('trade-screenshots').getPublicUrl(trade.screenshot_path).data.publicUrl }}
              style={s.screenshot}
              resizeMode="contain"
            />
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  )
}

function PriceBox({ label, value, positive, negative }: { label: string; value: number; positive?: boolean; negative?: boolean }) {
  return (
    <View style={s.priceBox}>
      <Text style={s.priceBoxLabel}>{label}</Text>
      <Text style={[s.priceBoxValue, positive && s.green, negative && s.red]}>{value.toLocaleString()}</Text>
    </View>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  )
}

function formatEventType(type: string) {
  const map: Record<string, string> = {
    limit_placed: 'Limit gesetzt',
    limit_filled: 'Limit gefüllt',
    partial_close: 'Teilverkauf',
    manual_exit: 'Manueller Exit',
    sl_moved_to_be: 'SL → Break Even',
    sl_moved_manual: 'SL verschoben',
    sl_hit: 'SL getroffen',
    tp_moved_manual: 'TP verschoben',
    tp_hit: 'TP getroffen',
  }
  return map[type] ?? type
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  loading: { flex: 1, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#666' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  closeBtn: { padding: 8 },
  headerCenter: { alignItems: 'center', gap: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  manageBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#22c55e', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  manageBtnText: { color: '#000', fontWeight: '700', fontSize: 12 },
  aiBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a2d', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#818cf833' },
  aiBtnText: { color: '#818cf8', fontWeight: '700', fontSize: 12 },
  symbol: { color: '#fff', fontSize: 20, fontWeight: '700' },
  sidePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  longPill: { backgroundColor: '#052e16' },
  shortPill: { backgroundColor: '#2d0a0a' },
  sideText: { fontSize: 12, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  banner: { borderRadius: 12, padding: 20, alignItems: 'center', marginBottom: 16 },
  winBanner: { backgroundColor: '#052e16', borderWidth: 1, borderColor: '#22c55e33' },
  lossBanner: { backgroundColor: '#2d0a0a', borderWidth: 1, borderColor: '#ef444433' },
  bannerR: { fontSize: 36, fontWeight: '700' },
  bannerLabel: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  openBanner: { backgroundColor: '#1a1a00', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#f59e0b33' },
  openText: { color: '#f59e0b', fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  priceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priceBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, flex: 1, minWidth: '45%' },
  priceBoxLabel: { color: '#666', fontSize: 11, marginBottom: 4 },
  priceBoxValue: { color: '#fff', fontSize: 16, fontWeight: '700' },
  infoGrid: { gap: 2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  infoLabel: { color: '#666', fontSize: 14 },
  infoValue: { color: '#fff', fontSize: 14, fontWeight: '500' },
  tpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  tpDot: { width: 10, height: 10, borderRadius: 5 },
  filledDot: { backgroundColor: '#22c55e' },
  unfilledDot: { backgroundColor: '#333' },
  tpLabel: { color: '#aaa', fontSize: 13, width: 35 },
  tpPrice: { color: '#fff', fontSize: 14, flex: 1, fontWeight: '600' },
  tpPct: { color: '#666', fontSize: 13, width: 40, textAlign: 'right' },
  tpFilled: { color: '#22c55e', fontSize: 14 },
  eventRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginTop: 4 },
  eventContent: {},
  eventType: { color: '#fff', fontSize: 14, fontWeight: '600' },
  eventMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  eventNote: { color: '#888', fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tagMistake: { backgroundColor: '#2d0a0a', borderWidth: 1, borderColor: '#ef444433' },
  tagExecution: { backgroundColor: '#052e16', borderWidth: 1, borderColor: '#22c55e33' },
  tagContext: { backgroundColor: '#1a1a2d', borderWidth: 1, borderColor: '#818cf833' },
  tagText: { fontSize: 12, color: '#ccc' },
  noteText: { color: '#ccc', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  noteLabel: { color: '#888', fontWeight: '600' },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
  orange: { color: '#f59e0b' },
  screenshot: { width: '100%', height: 220, borderRadius: 10, backgroundColor: '#1a1a1a' },
  ohlcvLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ohlcvLoadingText: { color: '#666', fontSize: 13 },
  ohlcvError: { color: '#555', fontSize: 13, fontStyle: 'italic' },
  ohlcvMeta: { color: '#444', fontSize: 11, marginTop: 8 },
  mfeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  mfeBox: { flex: 1, backgroundColor: '#052e16', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#22c55e33' },
  maeBox: { flex: 1, backgroundColor: '#2d0a0a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#ef444433' },
  mfeLabel: { color: '#22c55e', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  maeLabel: { color: '#ef4444', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  mfeValue: { color: '#22c55e', fontSize: 20, fontWeight: '700' },
  maeValue: { color: '#ef4444', fontSize: 20, fontWeight: '700' },
  mfePrice: { color: '#666', fontSize: 12, marginTop: 2 },
  mfeHint: { color: '#555', fontSize: 11, marginTop: 4 },
  captureRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 8, padding: 10 },
  captureLabel: { color: '#666', fontSize: 13, flex: 1 },
  captureValue: { fontSize: 16, fontWeight: '700' },
  captureHint: { color: '#555', fontSize: 12 },
  clRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  clTitle: { color: '#ccc', fontSize: 14, flex: 1 },
  clChecked: { color: '#22c55e' },
  clBadge: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  clBadgeText: { color: '#888', fontSize: 11 },
})

import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Alert, Image, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { PressFix } from '../../src/components/PressFix'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../src/lib/supabase'
import { fetchCandles, calcMFEMAE, normalizeSymbol, normalizeInterval, getBinanceMarket } from '../../src/lib/binance'
import { calcWeightedR } from '../../src/lib/tradeCalc'
import type { Trade, PartialProfit, ManagementEvent, TagDefinition } from '../../src/types'
import type { MFEMAEResult } from '../../src/lib/binance'
import { ANTHROPIC_KEY } from '../(tabs)/settings'

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
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [ohlcv, setOhlcv] = useState<MFEMAEResult | null>(null)
  const [ohlcvLoading, setOhlcvLoading] = useState(false)
  const [ohlcvError, setOhlcvError] = useState<string | null>(null)
  const [allTagDefs, setAllTagDefs] = useState<TagDefinition[]>([])
  const [kiLoading, setKiLoading] = useState(false)
  const [kiError, setKiError] = useState<string | null>(null)
  const [kiSaved, setKiSaved] = useState(false)
  const [kiFullCandles, setKiFullCandles] = useState(false)

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
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: tdefs } = await supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id)
        setAllTagDefs(tdefs ?? [])
      }

      if (t?.screenshot_path) {
        // Signed URL, not getPublicUrl - the trade-screenshots bucket is
        // private (every other read path in this app already uses signed
        // URLs), so a public URL 401/403s and the image never loads.
        const { data: signed } = await supabase.storage.from('trade-screenshots').createSignedUrl(t.screenshot_path, 3600)
        setScreenshotUrl(signed?.signedUrl ?? null)
      }

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
        const market = await getBinanceMarket()
        const candles = await fetchCandles(symbol, interval, startMs, endMs, market)
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

  async function runKiReview() {
    if (!trade) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) { setKiError('Kein API Key in Einstellungen gesetzt.'); return }

    setKiLoading(true)
    setKiError(null)
    setKiSaved(false)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setKiLoading(false); return }

    const r = trade.exit_price != null ? calcWeightedR(trade, events) : null
    const tagList = allTagDefs.map(t => `${t.tag_type}: ${t.name}`).join(', ') || 'Keine Tags vorhanden'

    // Format candles — cap at 150 total (30 pre + 90 body + 30 post), subsample if needed
    let candleText = ''
    if (ohlcv && ohlcv.candles.length > 0) {
      const entryMs = new Date(trade.opened_at).getTime()
      const exitMs = trade.closed_at ? new Date(trade.closed_at).getTime() : 0
      const all = ohlcv.candles
      const PRE = 30, MAX_BODY = kiFullCandles ? Infinity : 90, POST = 30

      const entryIdx = all.findIndex(c => c.openTime >= entryMs)
      const exitIdx = exitMs ? all.findIndex(c => c.openTime >= exitMs) : all.length - 1
      const safeEntry = entryIdx < 0 ? 0 : entryIdx
      const safeExit = exitIdx < 0 ? all.length - 1 : exitIdx

      const preSlice = all.slice(0, safeEntry).slice(-PRE)
      const body = all.slice(safeEntry, safeExit + 1)
      const postSlice = all.slice(safeExit + 1).slice(0, POST)

      let sampledBody = body
      if (body.length > MAX_BODY) {
        const step = body.length / MAX_BODY
        sampledBody = Array.from({ length: MAX_BODY }, (_, i) => body[Math.round(i * step)]).filter(Boolean)
      }

      const display = [...preSlice, ...sampledBody, ...postSlice]
      const entryD = preSlice.length
      const exitD = preSlice.length + sampledBody.length - 1

      const rows = display.map((c, i) => {
        const dt = new Date(c.openTime)
        const ts = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`
        const mark = i === entryD ? ' ← ENTRY' : i === exitD ? ' ← EXIT' : ''
        return `${ts} O:${c.open} H:${c.high} L:${c.low} C:${c.close}${mark}`
      })
      if (body.length > MAX_BODY) rows.splice(entryD + 1, 0, `... (${body.length - MAX_BODY} ausgedünnt)`)
      candleText = `\nKERZEN (UTC):\n${rows.join('\n')}`
    }

    // Screenshot URL
    let imageContent: any[] = []
    if (trade.screenshot_path) {
      try {
        const { data: compressed } = await supabase.storage.from('trade-screenshots')
          .createSignedUrl(trade.screenshot_path, 3600, { transform: { width: 800, quality: 70 } })
        const url = compressed?.signedUrl
        if (url) imageContent = [{ type: 'image', source: { type: 'url', url } }]
      } catch {
        const { data: orig } = await supabase.storage.from('trade-screenshots').createSignedUrl(trade.screenshot_path, 3600)
        if (orig?.signedUrl) imageContent = [{ type: 'image', source: { type: 'url', url: orig.signedUrl } }]
      }
    }

    const prompt = `Analysiere diesen Trade. Antworte NUR als JSON (kein Markdown, kein Text davor/danach).

TRADE: ${trade.symbol} ${trade.side.toUpperCase()} | Entry:${trade.entry_price} SL:${trade.stop_loss} Exit:${trade.exit_price ?? '—'} Result:${r != null ? (r > 0 ? '+' : '') + r.toFixed(2) + 'R' : 'offen'} | TF:${trade.timeframe || '—'}
Notizen: ${trade.notes || '—'} | Setup: ${trade.setup || '—'}${candleText}

VORHANDENE TAGS: ${tagList}

{"existing_tags":["tag_name"],"new_tags":[{"name":"neuer_tag","type":"context|execution|mistake"}],"ki_note":"2-4 Sätze: Setup erkannt, Ausführung, was lief gut/schlecht."}`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [{ role: 'user', content: [...imageContent, { type: 'text', text: prompt }] }],
        }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      const text = data.content?.[0]?.text ?? ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null
      if (!parsed) throw new Error('Ungültige JSON-Antwort')

      // Save ki_note
      await supabase.from('trades').update({ ki_notes: parsed.ki_note }).eq('id', trade.id)
      setTrade({ ...trade, ki_notes: parsed.ki_note })

      // Create new tags. Captures the inserted rows directly from Supabase's
      // response (with real ids) instead of relying on allTagDefs state,
      // which wouldn't have re-rendered yet in this same function call.
      let createdDefs: TagDefinition[] = []
      if (parsed.new_tags?.length) {
        const existing = new Set(allTagDefs.map((t: TagDefinition) => t.name.toLowerCase()))
        const toCreate = parsed.new_tags.filter((nt: any) => !existing.has(nt.name.toLowerCase()))
        if (toCreate.length) {
          const { data: created } = await supabase.from('trade_tag_definitions')
            .insert(toCreate.map((nt: any) => ({ user_id: user.id, name: nt.name, tag_type: nt.type ?? 'context' })))
            .select()
          if (created) {
            createdDefs = created
            setAllTagDefs(prev => [...prev, ...created])
          }
        }
      }

      // Assign existing + newly-created tags. Additive only - never deletes
      // an assignment the AI didn't re-mention, since existing_tags is the
      // model's best-effort recap, not a ground truth of what should remain
      // assigned (a manually-set tag the model omits must not be lost).
      const allDefsByName = new Map([...allTagDefs, ...createdDefs].map((td: TagDefinition) => [td.name.toLowerCase(), td]))
      const wantedNames = new Set<string>([
        ...((parsed.existing_tags ?? []) as string[]).map(n => n.toLowerCase()),
        ...((parsed.new_tags ?? []) as any[]).map(nt => nt.name.toLowerCase()),
      ])
      const alreadyAssignedIds = new Set(tags.map(t => t.id))
      const toAssign = [...wantedNames]
        .map(name => allDefsByName.get(name))
        .filter((td): td is TagDefinition => !!td && !alreadyAssignedIds.has(td.id))

      if (toAssign.length) {
        const { error: assignErr } = await supabase.from('trade_tag_assignments').insert(
          toAssign.map(td => ({ trade_id: trade.id, tag_id: td.id, user_id: user.id }))
        )
        if (!assignErr) setTags(prev => [...prev, ...toAssign])
      }

      setKiSaved(true)
    } catch (e: any) {
      setKiError(e?.message ?? 'Fehler')
    } finally {
      setKiLoading(false)
    }
  }

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
  const rRaw = trade.exit_price != null ? calcWeightedR(trade, events) : null
  const rMultiple = rRaw != null ? rRaw.toFixed(2) : null
  const isWin = rRaw != null ? rRaw > 0 : false
  const isBreakeven = rRaw === 0

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <PressFix onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </PressFix>
        <View style={s.headerCenter}>
          <Text style={s.symbol}>{trade.symbol}</Text>
          <View style={[s.sidePill, isLong ? s.longPill : s.shortPill]}>
            {isLong ? <Feather name="trending-up" size={12} color="#22c55e" /> : <Feather name="trending-down" size={12} color="#ef4444" />}
            <Text style={[s.sideText, isLong ? s.green : s.red]}>{isLong ? 'LONG' : 'SHORT'}</Text>
          </View>
        </View>
        <View style={s.headerActions}>
          <PressFix onPress={() => router.push(`/trade/manage/${id}`)} style={s.manageBtn}>
            <Feather name="activity" size={14} color="#000" />
            <Text style={s.manageBtnText}>Verwalten</Text>
          </PressFix>
          <PressFix onPress={() => router.push(`/trade/analysis/${id}`)} style={s.aiBtn}>
            <Feather name="cpu" size={14} color="#818cf8" />
            <Text style={s.aiBtnText}>KI</Text>
          </PressFix>
          <PressFix onPress={() => router.push(`/trade/edit/${id}`)} style={s.closeBtn}>
            <Feather name="edit-2" size={18} color="#aaa" />
          </PressFix>
          <PressFix onPress={handleDelete} style={s.closeBtn}>
            <Feather name="trash-2" size={18} color="#ef4444" />
          </PressFix>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {trade.status === 'closed' && rMultiple && (
          <View style={[s.banner, isWin ? s.winBanner : isBreakeven ? s.beBanner : s.lossBanner]}>
            <Text style={[s.bannerR, isWin ? s.green : isBreakeven ? s.orange : s.red]}>
              {parseFloat(rMultiple) > 0 ? '+' : ''}{rMultiple}R
            </Text>
            <Text style={[s.bannerLabel, isWin ? s.green : isBreakeven ? s.orange : s.red]}>{isWin ? 'WIN' : isBreakeven ? 'BE' : 'LOSS'}</Text>
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
            {trade.exit_price != null && <PriceBox label="Exit" value={trade.exit_price} positive={isWin} negative={!isWin && !isBreakeven} />}
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
                <Text style={s.tpPct}>{Math.round(tp.quantity_percent * 100)}%</Text>
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

        {trade.ki_notes && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>KI Review</Text>
            <View style={{ backgroundColor: '#111', borderRadius: 10, padding: 10 }}>
              {trade.ki_notes.split('\n').map((line, i) => {
                const isBold = line.startsWith('**') && line.includes('**', 2)
                if (isBold) return <Text key={i} style={{ color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 2 }}>{line.replace(/\*\*/g, '')}</Text>
                if (line.trim() === '') return <View key={i} style={{ height: 5 }} />
                return <Text key={i} style={s.noteText}>{line}</Text>
              })}
            </View>
          </View>
        )}

        <View style={s.section}>
          <PressFix
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a2d', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#818cf833' }}
            onPress={runKiReview}
            disabled={kiLoading}
          >
            {kiLoading ? <ActivityIndicator size="small" color="#818cf8" /> : <Feather name="cpu" size={15} color="#818cf8" />}
            <Text style={{ color: '#818cf8', fontSize: 13, fontWeight: '600', flex: 1 }}>
              {kiLoading ? 'KI analysiert...' : kiSaved ? 'KI Review aktualisieren' : 'KI Review & Auto-Tag'}
            </Text>
            {kiSaved && <Feather name="check" size={14} color="#22c55e" />}
          </PressFix>
          <PressFix
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 2 }}
            onPress={() => setKiFullCandles(v => !v)}
          >
            <Feather name={kiFullCandles ? 'toggle-right' : 'toggle-left'} size={22} color={kiFullCandles ? '#818cf8' : '#444'} />
            <Text style={{ color: kiFullCandles ? '#818cf8' : '#555', fontSize: 12 }}>
              {kiFullCandles ? 'Alle Kerzen (kann bei langen Trades fehlschlagen)' : 'Kompakt — max. 150 Kerzen'}
            </Text>
          </PressFix>
          {kiError ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{kiError}</Text> : null}
        </View>

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

        {trade.screenshot_path && screenshotUrl && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Screenshot</Text>
            <Image
              source={{ uri: screenshotUrl }}
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
  beBanner: { backgroundColor: '#2d1f0a', borderWidth: 1, borderColor: '#f59e0b33' },
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
  maePrice: { color: '#666', fontSize: 12, marginTop: 2 },
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

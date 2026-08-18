import { useEffect, useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../src/lib/supabase'
import { ANTHROPIC_KEY } from './settings'
import { calcWeightedR } from '../../src/lib/tradeCalc'
import { fetchCandles, normalizeSymbol, normalizeInterval } from '../../src/lib/binance'
import { PressFix } from '../../src/components/PressFix'
import type { Trade, TagDefinition, StrategyProfile, ManagementEvent } from '../../src/types'

type Period = '7d' | '30d' | '90d' | 'all'

interface TagAssignment { tag_id: string; trade_id: string }

const INTERVAL_MS: Record<string, number> = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000,
  '8h': 28800000, '12h': 43200000, '1d': 86400000,
}

async function buildCandleText(t: Trade, maxBody = 90, pre = 30, post = 30): Promise<string | null> {
  const interval = t.timeframe ? normalizeInterval(t.timeframe) : null
  if (!interval || !t.opened_at || !t.closed_at) return null
  try {
    const symbol = normalizeSymbol(t.symbol)
    const entryMs = new Date(t.opened_at).getTime()
    const exitMs = new Date(t.closed_at).getTime()
    const candleMs = INTERVAL_MS[interval] ?? 900000
    const candles = await fetchCandles(symbol, interval, entryMs - pre * candleMs, exitMs + post * candleMs)
    if (candles.length === 0) return null

    const entryIdx = candles.findIndex(c => c.openTime >= entryMs)
    const exitIdx = candles.findIndex(c => c.openTime >= exitMs)
    const preSlice = candles.slice(0, Math.max(entryIdx, 0)).slice(-pre)
    const body = exitIdx > entryIdx ? candles.slice(entryIdx, exitIdx + 1) : candles.slice(entryIdx, entryIdx + 1)
    const postSlice = candles.slice(Math.min(exitIdx + 1, candles.length)).slice(0, post)

    let sampledBody = body
    if (body.length > maxBody) {
      const step = body.length / maxBody
      sampledBody = Array.from({ length: maxBody }, (_, i) => body[Math.round(i * step)]).filter(Boolean)
    }

    const display = [...preSlice, ...sampledBody, ...postSlice]
    const entryIdxD = preSlice.length
    const exitIdxD = preSlice.length + sampledBody.length - 1

    const rows = display.map((c, i) => {
      const dt = new Date(c.openTime)
      const ts = `${dt.getUTCMonth() + 1}/${dt.getUTCDate()} ${String(dt.getUTCHours()).padStart(2, '0')}:${String(dt.getUTCMinutes()).padStart(2, '0')}`
      const mark = i === entryIdxD ? ' ← ENTRY' : i === exitIdxD ? ' ← EXIT' : ''
      return `${ts} O:${c.open} H:${c.high} L:${c.low} C:${c.close}${mark}`
    })
    if (body.length > maxBody) rows.splice(entryIdxD + 1, 0, `... (${body.length - maxBody} ausgedünnt)`)
    return rows.join('\n')
  } catch { return null }
}

export default function AnalyticsScreen() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>([])
  const [assignments, setAssignments] = useState<TagAssignment[]>([])
  const [period, setPeriod] = useState<Period>('30d')
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)
  const [managementEvents, setManagementEvents] = useState<ManagementEvent[]>([])
  const [kiAnalysis, setKiAnalysis] = useState<string | null>(null)
  const [kiLoading, setKiLoading] = useState(false)
  const [kiError, setKiError] = useState<string | null>(null)
  const [combinedAnalysis, setCombinedAnalysis] = useState<string | null>(null)
  const [combinedLoading, setCombinedLoading] = useState(false)
  const [combinedError, setCombinedError] = useState<string | null>(null)
  const [combinedSaved, setCombinedSaved] = useState(false)
  const [autoTagLoading, setAutoTagLoading] = useState(false)
  const [autoTagProgress, setAutoTagProgress] = useState('')
  const [autoTagError, setAutoTagError] = useState<string | null>(null)
  const [autoTagDone, setAutoTagDone] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tradeData }, { data: asgn }, { data: tags }, { data: strats }, { data: evData }] = await Promise.all([
        supabase.from('trades').select('*').eq('user_id', user.id).eq('status', 'closed').order('opened_at', { ascending: false }),
        supabase.from('trade_tag_assignments').select('tag_id, trade_id').eq('user_id', user.id),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id),
        supabase.from('strategy_profiles').select('*').eq('user_id', user.id).order('name'),
        supabase.from('trade_management_events').select('*').eq('user_id', user.id),
      ])
      setTrades(tradeData ?? [])
      setAssignments(asgn ?? [])
      setTagDefs(tags ?? [])
      setStrategies(strats ?? [])
      setManagementEvents(evData ?? [])
    }
    load()
  }, [])

  const eventsByTradeId = useMemo(() => {
    const map = new Map<string, ManagementEvent[]>()
    for (const ev of managementEvents) {
      if (!map.has(ev.trade_id)) map.set(ev.trade_id, [])
      map.get(ev.trade_id)!.push(ev)
    }
    return map
  }, [managementEvents])

  const filtered = useMemo(() => {
    let result = selectedStrategy === null
      ? trades
      : selectedStrategy === '__none__'
        ? trades.filter(t => !t.strategy_id)
        : trades.filter(t => t.strategy_id === selectedStrategy)

    if (period !== 'all') {
      const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      result = result.filter(t => new Date(t.opened_at) >= cutoff)
    }
    return result
  }, [trades, period, selectedStrategy])

  const tagStats = useMemo(() => {
    const filteredIds = new Set(filtered.map(t => t.id))
    const tradeMap = new Map(filtered.map(t => [t.id, t]))
    const stats: Record<string, { tag: TagDefinition; total: number; inWin: number; inLoss: number; rVals: number[] }> = {}

    for (const tag of tagDefs) {
      stats[tag.id] = { tag, total: 0, inWin: 0, inLoss: 0, rVals: [] }
    }
    for (const a of assignments) {
      if (!filteredIds.has(a.trade_id)) continue
      const trade = tradeMap.get(a.trade_id)
      if (!trade || !trade.exit_price || !stats[a.tag_id]) continue
      const r = calcWeightedR(trade, eventsByTradeId.get(trade.id) ?? []) ?? 0
      const isWin = r > 0
      stats[a.tag_id].total++
      if (isWin) stats[a.tag_id].inWin++; else stats[a.tag_id].inLoss++
      stats[a.tag_id].rVals.push(r)
    }
    return Object.values(stats)
      .filter(s => s.total > 0)
      .map(s => ({ ...s, avgR: s.rVals.reduce((a, b) => a + b, 0) / s.rVals.length }))
      .sort((a, b) => b.total - a.total)
  }, [filtered, tagDefs, assignments])

  const managementStats = useMemo(() => {
    const tradeIds = new Set(filtered.map(t => t.id))
    const relevantEvents = managementEvents.filter(ev => tradeIds.has(ev.trade_id))
    const eventsByTrade = new Map<string, ManagementEvent[]>()
    for (const ev of relevantEvents) {
      if (!eventsByTrade.has(ev.trade_id)) eventsByTrade.set(ev.trade_id, [])
      eventsByTrade.get(ev.trade_id)!.push(ev)
    }

    const managedTrades = filtered.filter(t => eventsByTrade.has(t.id))
    const beMovedTrades = filtered.filter(t =>
      (eventsByTrade.get(t.id) ?? []).some(ev => ev.event_type === 'sl_moved_to_be')
    )
    const beHitTrades = beMovedTrades.filter(t =>
      (eventsByTrade.get(t.id) ?? []).some(ev => ev.event_type === 'sl_hit')
    )
    const tp1Trades = filtered.filter(t =>
      (eventsByTrade.get(t.id) ?? []).some(ev => ev.event_type === 'tp_hit')
    )
    const partialTrades = filtered.filter(t =>
      (eventsByTrade.get(t.id) ?? []).some(ev => ev.event_type === 'partial_close')
    )

    const tp1RValues: number[] = []
    for (const trade of tp1Trades) {
      const ev = (eventsByTrade.get(trade.id) ?? []).find(e => e.event_type === 'tp_hit')
      if (ev?.price) {
        const risk = Math.abs(trade.entry_price - trade.stop_loss)
        const pnl = trade.side === 'long' ? ev.price - trade.entry_price : trade.entry_price - ev.price
        if (risk > 0) tp1RValues.push(pnl / risk)
      }
    }
    const avgTp1R = tp1RValues.length > 0 ? tp1RValues.reduce((a, b) => a + b, 0) / tp1RValues.length : null

    return {
      managedCount: managedTrades.length,
      beMovedCount: beMovedTrades.length,
      beHeldCount: beMovedTrades.length - beHitTrades.length,
      tp1Count: tp1Trades.length,
      partialCount: partialTrades.length,
      avgTp1R,
      hasData: managedTrades.length > 0,
    }
  }, [filtered, managementEvents])

  const stats = calcStats(filtered, eventsByTradeId)
  const sessions = [
    { label: 'Asian', start: 0, end: 7, color: '#818cf8' },
    { label: 'London', start: 7, end: 12, color: '#f59e0b' },
    { label: 'New York', start: 13, end: 20, color: '#22c55e' },
  ]

  const activeStrategy = selectedStrategy ? strategies.find(s => s.id === selectedStrategy) ?? null : null

  async function runStrategyKI() {
    if (!activeStrategy) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) { setKiError('Kein API Key in Einstellungen gesetzt.'); return }

    setKiLoading(true)
    setKiError(null)
    setKiAnalysis(null)

    const sessions = [
      { label: 'Asian', start: 0, end: 7 },
      { label: 'London', start: 7, end: 12 },
      { label: 'New York', start: 13, end: 20 },
    ]
    const sessionLines = sessions.map(sess => {
      const t = filtered.filter(t => { const h = new Date(t.opened_at).getUTCHours(); return h >= sess.start && h < sess.end })
      const st = calcStats(t, eventsByTradeId)
      return `  ${sess.label}: ${t.length} Trades, ${st.winRate.toFixed(0)}% WR, ${st.totalR > 0 ? '+' : ''}${st.totalR.toFixed(1)}R`
    }).join('\n')

    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    const dayLines = days.map((day, i) => {
      const t = filtered.filter(tr => new Date(tr.opened_at).getDay() === (i + 1) % 7)
      const st = calcStats(t, eventsByTradeId)
      return t.length > 0 ? `  ${day}: ${t.length} Trades, ${st.winRate.toFixed(0)}% WR, ${st.totalR > 0 ? '+' : ''}${st.totalR.toFixed(1)}R` : null
    }).filter(Boolean).join('\n')

    const mistakeTags = tagStats.filter(ts => ts.tag.tag_type === 'mistake' && ts.total > 0)
      .map(ts => `  ${ts.tag.name.replace(/_/g, ' ')}: ${ts.total}× (Ø ${ts.avgR.toFixed(1)}R, ${ts.inLoss}× in Loss)`).join('\n')

    const mgmtLines = managementStats.hasData
      ? `\nMANAGEMENT-AUSWERTUNG (${managementStats.managedCount} gemanagte Trades):
  SL → Break Even: ${managementStats.beMovedCount}× (${filtered.length > 0 ? ((managementStats.beMovedCount / filtered.length) * 100).toFixed(0) : 0}% der Trades)
  BE gehalten: ${managementStats.beHeldCount}/${managementStats.beMovedCount} (${managementStats.beMovedCount > 0 ? ((managementStats.beHeldCount / managementStats.beMovedCount) * 100).toFixed(0) : 0}% Halterate)
  TP1 getroffen: ${managementStats.tp1Count}×${managementStats.avgTp1R !== null ? ` (Ø ${managementStats.avgTp1R.toFixed(2)}R)` : ''}
  Partial Close: ${managementStats.partialCount}×`
      : ''

    const prompt = `Du bist ein erfahrener Trading-Coach. Bewerte diese Trading-Strategie objektiv auf Deutsch.

STRATEGIE: "${activeStrategy.name}"
${activeStrategy.description ? `\nREGELWERK:\n${activeStrategy.description}` : '(Kein Regelwerk hinterlegt)'}

PERFORMANCE-DATEN (${filtered.length} Trades, Zeitraum: ${period === 'all' ? 'Alle' : period}):
Win Rate: ${stats.winRate.toFixed(1)}%
Total R: ${stats.totalR > 0 ? '+' : ''}${stats.totalR.toFixed(2)}R
Ø R pro Trade: ${stats.avgR > 0 ? '+' : ''}${stats.avgR.toFixed(2)}R
Profit Factor: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}
Max Drawdown: ${stats.maxDD.toFixed(2)}R
Wins: ${stats.wins} | Losses: ${stats.losses}
${mgmtLines}
SESSIONS (UTC):
${sessionLines}

WOCHENTAGE:
${dayLines || '  Keine Daten'}

FEHLER-TAGS:
${mistakeTags || '  Keine Tags erfasst'}

Gib eine strukturierte Bewertung mit:
1. **Regelwerk-Bewertung** — Sind die Regeln klar und vollständig? Was fehlt?
2. **Performance-Einschätzung** — Ist die Strategie profitabel? Wo liegen Schwächen?
3. **Beste Bedingungen** — Wann funktioniert die Strategie am besten (Session, Wochentag)?
4. **Häufige Fehler** — Welche Fehler-Tags kosten am meisten R?
${managementStats.hasData ? '5. **Management-Bewertung** — Wird BE-Verschiebung sinnvoll genutzt? Ist die TP1-Halterate gut?\n6. **Verbesserungsvorschläge** — 3-5 konkrete, umsetzbare Empfehlungen' : '5. **Verbesserungsvorschläge** — 3-5 konkrete, umsetzbare Empfehlungen'}

Direkt und präzise. Kein Intro.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      setKiAnalysis(data.content?.[0]?.text ?? 'Keine Antwort.')
    } catch (e: any) {
      setKiError(e?.message ?? 'Fehler')
    } finally {
      setKiLoading(false)
    }
  }

  async function runAutoTag() {
    if (!activeStrategy) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) { setAutoTagError('Kein API Key gesetzt.'); return }

    setAutoTagLoading(true)
    setAutoTagError(null)
    setAutoTagDone(false)
    setAutoTagProgress('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setAutoTagLoading(false); return }

    const stratTrades = trades.filter(t => t.strategy_id === activeStrategy.id)
    if (stratTrades.length === 0) { setAutoTagError('Keine Trades.'); setAutoTagLoading(false); return }

    const tagList = tagDefs.map(t => `${t.tag_type}: ${t.name}`).join(', ') || 'Keine Tags vorhanden'
    const BATCH = 5
    let currentTagDefs = [...tagDefs]

    for (let i = 0; i < stratTrades.length; i += BATCH) {
      const batch = stratTrades.slice(i, i + BATCH)
      setAutoTagProgress(`${Math.min(i + BATCH, stratTrades.length)}/${stratTrades.length} Trades...`)

      const tradeBlocks = await Promise.all(batch.map(async (t, bi) => {
        const r = calcWeightedR(t, eventsByTradeId.get(t.id) ?? []) ?? 0
        const header = `Trade ${bi + 1} (ID:${t.id}): ${t.symbol} ${t.side.toUpperCase()} | Entry:${t.entry_price} SL:${t.stop_loss} Result:${r > 0 ? '+' : ''}${r.toFixed(2)}R | TF:${t.timeframe || '—'} | Notes:${t.notes || '—'}`
        const candleText = await buildCandleText(t)
        return header + (candleText ? `\nKERZEN:\n${candleText}` : '')
      }))

      const prompt = `Analysiere diese ${batch.length} Trades. Antworte NUR als JSON Array (kein Markdown).

VORHANDENE TAGS: ${tagList}

${tradeBlocks.join('\n\n---\n\n')}

[{"trade_id":"...","existing_tags":["tag"],"new_tags":[{"name":"tag","type":"context"}],"ki_note":"2-3 Sätze."}]`

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6', max_tokens: 1500,
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          }),
        })
        if (!res.ok) throw new Error(`API ${res.status}`)
        const data = await res.json()
        const text = data.content?.[0]?.text ?? ''
        const jsonMatch = text.match(/\[[\s\S]*\]/)
        const results: any[] = jsonMatch ? JSON.parse(jsonMatch[0]) : []

        for (const result of results) {
          // Create new tags
          if (result.new_tags?.length) {
            const existing = new Set(currentTagDefs.map((t: TagDefinition) => t.name.toLowerCase()))
            const toCreate = result.new_tags.filter((nt: any) => !existing.has(nt.name.toLowerCase()))
            if (toCreate.length) {
              const { data: created } = await supabase.from('trade_tag_definitions')
                .insert(toCreate.map((nt: any) => ({ user_id: user.id, name: nt.name, tag_type: nt.type ?? 'context' })))
                .select()
              if (created) currentTagDefs = [...currentTagDefs, ...created]
            }
          }

          // Assign tags
          const allNames = new Set([...(result.existing_tags ?? []), ...(result.new_tags?.map((t: any) => t.name) ?? [])])
          const toAssign = currentTagDefs.filter((td: TagDefinition) => allNames.has(td.name))
          if (toAssign.length) {
            await supabase.from('trade_tag_assignments').delete().eq('trade_id', result.trade_id)
            await supabase.from('trade_tag_assignments').insert(
              toAssign.map((td: TagDefinition) => ({ trade_id: result.trade_id, tag_id: td.id, user_id: user.id }))
            )
          }

          // Save ki_notes
          if (result.ki_note) {
            await supabase.from('trades').update({ ki_notes: result.ki_note }).eq('id', result.trade_id)
          }
        }
      } catch (e: any) {
        setAutoTagError(`Batch ${i / BATCH + 1}: ${e?.message}`)
        setAutoTagLoading(false)
        return
      }
    }

    setAutoTagDone(true)
    setAutoTagLoading(false)
    setAutoTagProgress('')
  }

  async function runCombinedKI() {
    if (!activeStrategy) return
    const key = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!key) { setCombinedError('Kein API Key in Einstellungen gesetzt.'); return }

    setCombinedLoading(true)
    setCombinedError(null)
    setCombinedAnalysis(null)
    setCombinedSaved(false)

    const stratTrades = trades.filter(t => t.strategy_id === activeStrategy.id)
    if (stratTrades.length === 0) {
      setCombinedError('Keine Trades für diese Strategie.')
      setCombinedLoading(false)
      return
    }

    // All trades with candle data
    const allTradeBlocks = await Promise.all(stratTrades.map(async (t, i) => {
      const r = calcWeightedR(t, eventsByTradeId.get(t.id) ?? []) ?? 0
      const header = `Trade ${i + 1}: ${t.symbol} ${t.side.toUpperCase()} | Entry:${t.entry_price} SL:${t.stop_loss} Result:${r > 0 ? '+' : ''}${r.toFixed(2)}R | TF:${t.timeframe || '—'} | Notes:${t.notes || '—'} | Setup:${t.setup || '—'}`
      const candleText = t.screenshot_path
        ? await buildCandleText(t, 40, 20, 20)  // shorter for vision trades — screenshot fills detail
        : await buildCandleText(t)
      return { t, r, header, candleText }
    }))

    // Best 4 + worst 4 with screenshots → vision sample
    const withScreenshot = allTradeBlocks.filter(d => d.t.screenshot_path)
    const sorted = [...withScreenshot].sort((a, b) => b.r - a.r)
    const visionSample = [...new Map([
      ...sorted.slice(0, 4),
      ...sorted.slice(-4),
    ].map(d => [d.t.id, d])).values()].slice(0, 8)

    // Fetch signed URLs for vision sample
    type VisionData = { tradeIdx: number; imageUrl: string }
    const visionData: VisionData[] = (await Promise.all(visionSample.map(async d => {
      let imageUrl: string | null = null
      try {
        const { data: compressed } = await supabase.storage.from('trade-screenshots')
          .createSignedUrl(d.t.screenshot_path!, 3600, { transform: { width: 800, quality: 70 } })
        imageUrl = compressed?.signedUrl ?? null
      } catch { /* ignore */ }
      if (!imageUrl) {
        const { data: orig } = await supabase.storage.from('trade-screenshots').createSignedUrl(d.t.screenshot_path!, 3600)
        imageUrl = orig?.signedUrl ?? null
      }
      const tradeIdx = stratTrades.findIndex(t => t.id === d.t.id)
      return imageUrl ? { tradeIdx: tradeIdx + 1, imageUrl } : null
    }))).filter(Boolean) as VisionData[]

    const hasImages = visionData.length > 0
    const visionTradeNums = new Set(visionData.map(v => v.tradeIdx))

    const textBlocks = allTradeBlocks.map(({ header, candleText, t }, i) => {
      const num = i + 1
      const screenshotNote = visionTradeNums.has(num) ? ' [Screenshot oben]' : ''
      return header + screenshotNote + (candleText ? `\nKERZEN (UTC):\n${candleText}` : '\n(Kein Timeframe)')
    }).join('\n\n---\n\n')

    const visionIntro = hasImages
      ? `Die ersten ${visionData.length} Bilder oben zeigen Trade-Screenshots (beste + schlechteste Trades nach R). Im Textblock sind die zugehörigen Trades mit "[Screenshot oben]" markiert.\n\n`
      : ''

    const prompt = `Du bist ein erfahrener Trading-Coach und Chart-Analyst.
Analysiere alle ${stratTrades.length} Trades der Strategie "${activeStrategy.name}".
${activeStrategy.description ? `\nBestehendes Regelwerk:\n${activeStrategy.description}\n` : ''}
${visionIntro}ALLE TRADES MIT KERZENDATEN (UTC — ENTRY/EXIT markiert):

${textBlocks}

Erstelle auf Basis aller Kerzendaten${hasImages ? ' und der Screenshots' : ''} ein präzises Regelwerk. Antworte auf Deutsch:

**SETUP-KRITERIEN:**
[Was muss vorliegen — Chart-Struktur, Kontext, Session]

**ENTRY-TRIGGER:**
[Exakter Einstieg — Kerzenmuster, Level, Zeitpunkt]

**STOP LOSS:**
[Platzierungsregel mit typischen Abständen]

**TAKE PROFIT:**
[TP-Ziele und RR-Erwartung]

**FILTER:**
[Was schließt ein Setup aus?]

**VORGESCHLAGENE TAGS:**
[Konkrete Tag-Namen, z.B. FVG_vorhanden, NYC_Open, Trend_klar]

**MUSTER AUS DEN DATEN:**
[Wiederkehrende Zahlen, Zeitpunkte, Kerzenmuster — was siehst du konsistent?]`

    try {
      const content: any[] = hasImages
        ? [
            ...visionData.map(v => ({ type: 'image' as const, source: { type: 'url' as const, url: v.imageUrl } })),
            { type: 'text' as const, text: prompt },
          ]
        : [{ type: 'text' as const, text: prompt }]

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2500,
          messages: [{ role: 'user', content }],
        }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      setCombinedAnalysis(data.content?.[0]?.text ?? 'Keine Antwort.')
    } catch (e: any) {
      setCombinedError(e?.message ?? 'Fehler')
    } finally {
      setCombinedLoading(false)
    }
  }

  async function saveAsRuleset(analysis: string, onSaved: () => void) {
    if (!activeStrategy || !analysis) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Archive current ruleset before overwriting
    if (activeStrategy.description) {
      await supabase.from('strategy_ruleset_history').insert({
        strategy_id: activeStrategy.id,
        user_id: user.id,
        description: activeStrategy.description,
      })
    }

    await supabase.from('strategy_profiles').update({ description: analysis }).eq('id', activeStrategy.id)

    // Parse VORGESCHLAGENE TAGS section
    const tagsMatch = analysis.match(/\*\*VORGESCHLAGENE TAGS[:\*]*\*?\*?([\s\S]*?)(?:\*\*[A-Z]|$)/)
    if (tagsMatch) {
      const rawLines = tagsMatch[1].split('\n').map(l => l.trim()).filter(Boolean)
      const tagNames: string[] = []
      for (const line of rawLines) {
        // Extract tag-like tokens: word_word or word patterns, skip headers/punctuation
        const tokens = line.replace(/^[-•*#]+/, '').trim().split(/[\s,;]+/)
        for (const token of tokens) {
          if (/^[A-Za-z][A-Za-z0-9_]{1,50}$/.test(token) && token.includes('_')) {
            tagNames.push(token)
          }
        }
      }

      if (tagNames.length > 0) {
        const existingNames = new Set(tagDefs.map(t => t.name.toLowerCase()))
        const toCreate = [...new Set(tagNames)].filter(n => !existingNames.has(n.toLowerCase()))

        if (toCreate.length > 0) {
          const inferType = (name: string): 'mistake' | 'execution' | 'context' => {
            const lower = name.toLowerCase()
            if (lower.includes('fehler') || lower.includes('skip') || lower.includes('regelvers')) return 'mistake'
            if (lower.includes('a_setup') || lower.includes('b_setup') || lower.includes('tp') || lower.includes('sl_')) return 'execution'
            return 'context'
          }
          await supabase.from('trade_tag_definitions').insert(
            toCreate.map(name => ({ user_id: user.id, name, tag_type: inferType(name) }))
          )
        }
      }
    }

    onSaved()
  }

  const activeStratName = selectedStrategy === null
    ? 'Alle'
    : selectedStrategy === '__none__'
      ? 'Ohne Strategie'
      : strategies.find(s => s.id === selectedStrategy)?.name ?? 'Alle'

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.title}>Analytics</Text>

        {/* Strategy picker */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.stratScroll} contentContainerStyle={s.stratRow}>
          <TouchableOpacity
            style={[s.stratChip, selectedStrategy === null && s.stratChipActive]}
            onPress={() => setSelectedStrategy(null)}
          >
            <Text style={[s.stratChipText, selectedStrategy === null && s.stratChipTextActive]}>Alle</Text>
          </TouchableOpacity>
          {strategies.map(st => (
            <TouchableOpacity
              key={st.id}
              style={[s.stratChip, selectedStrategy === st.id && s.stratChipActive]}
              onPress={() => setSelectedStrategy(st.id)}
            >
              <Text style={[s.stratChipText, selectedStrategy === st.id && s.stratChipTextActive]} numberOfLines={1}>
                {st.name}
              </Text>
            </TouchableOpacity>
          ))}
          {trades.some(t => !t.strategy_id) && (
            <TouchableOpacity
              style={[s.stratChip, selectedStrategy === '__none__' && s.stratChipActive]}
              onPress={() => setSelectedStrategy('__none__')}
            >
              <Text style={[s.stratChipText, selectedStrategy === '__none__' && s.stratChipTextActive]}>Ohne</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Period picker */}
        <View style={s.periodRow}>
          {(['7d', '30d', '90d', 'all'] as Period[]).map(p => (
            <TouchableOpacity key={p} style={[s.periodBtn, period === p && s.periodActive]} onPress={() => setPeriod(p)}>
              <Text style={[s.periodText, period === p && s.periodTextActive]}>
                {p === 'all' ? 'Alle' : p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {selectedStrategy !== null && (
          <Text style={s.filterLabel}>📊 {activeStratName} · {filtered.length} Trades</Text>
        )}

        {/* Main stats */}
        <View style={s.grid}>
          <BigStat label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} positive={stats.winRate >= 50} />
          <BigStat label="Total R" value={`${stats.totalR > 0 ? '+' : ''}${stats.totalR.toFixed(2)}R`} positive={stats.totalR > 0} />
          <BigStat label="Profit Factor" value={stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)} positive={stats.profitFactor > 1} />
          <BigStat label="Avg R" value={`${stats.avgR > 0 ? '+' : ''}${stats.avgR.toFixed(2)}R`} positive={stats.avgR > 0} />
          <BigStat label="Trades" value={String(filtered.length)} />
          <BigStat label="Max DD" value={`${stats.maxDD.toFixed(2)}R`} positive={false} />
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Aufteilung</Text>
          <View style={s.row}>
            <View style={[s.breakdown, { flex: Math.max(stats.wins, 0.1) }]}>
              <Text style={s.breakdownWin}>WIN {stats.wins}</Text>
            </View>
            <View style={[s.breakdown2, { flex: Math.max(stats.losses, 0.1) }]}>
              <Text style={s.breakdownLoss}>LOSS {stats.losses}</Text>
            </View>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Long / Short</Text>
          <View style={s.sideStats}>
            <SideStat label="Long" trades={filtered.filter(t => t.side === 'long')} eventsByTrade={eventsByTradeId} />
            <SideStat label="Short" trades={filtered.filter(t => t.side === 'short')} eventsByTrade={eventsByTradeId} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Session (UTC)</Text>
          {sessions.map(sess => {
            const sessTrades = filtered.filter(t => {
              const h = new Date(t.opened_at).getUTCHours()
              return h >= sess.start && h < sess.end
            })
            const st = calcStats(sessTrades, eventsByTradeId)
            if (sessTrades.length === 0) return (
              <View key={sess.label} style={s.sessRow}>
                <View style={[s.sessIndicator, { backgroundColor: sess.color }]} />
                <Text style={s.sessLabel}>{sess.label}</Text>
                <Text style={s.sessEmpty}>— keine Trades</Text>
              </View>
            )
            return (
              <View key={sess.label} style={s.sessRow}>
                <View style={[s.sessIndicator, { backgroundColor: sess.color }]} />
                <Text style={s.sessLabel}>{sess.label}</Text>
                <Text style={s.sessCount}>{sessTrades.length}×</Text>
                <Text style={[s.sessR, st.totalR >= 0 ? s.green : s.red]}>
                  {st.totalR > 0 ? '+' : ''}{st.totalR.toFixed(1)}R
                </Text>
                <Text style={s.sessWR}>{st.winRate.toFixed(0)}% WR</Text>
              </View>
            )
          })}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Nach Wochentag</Text>
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((day, i) => {
            const dayTrades = filtered.filter(t => new Date(t.opened_at).getDay() === (i + 1) % 7)
            const dayStats = calcStats(dayTrades, eventsByTradeId)
            return (
              <View key={day} style={s.dayRow}>
                <Text style={s.dayLabel}>{day}</Text>
                <Text style={s.dayCount}>{dayTrades.length} Trades</Text>
                <Text style={[s.dayR, dayStats.totalR >= 0 ? s.green : s.red]}>
                  {dayStats.totalR > 0 ? '+' : ''}{dayStats.totalR.toFixed(1)}R
                </Text>
                <Text style={s.dayWR}>{dayStats.winRate.toFixed(0)}% WR</Text>
              </View>
            )
          })}
        </View>

        <EquityCurve trades={filtered} eventsByTrade={eventsByTradeId} />
        <Heatmap trades={filtered} eventsByTrade={eventsByTradeId} />

        {tagStats.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Tag-Analyse</Text>
            {(['mistake', 'execution', 'context'] as const).map(type => {
              const list = tagStats.filter(ts => ts.tag.tag_type === type)
              if (list.length === 0) return null
              return (
                <View key={type} style={s.tagGroup}>
                  <Text style={s.tagGroupLabel}>
                    {type === 'mistake' ? '⚠️ Fehler' : type === 'execution' ? '✅ Ausführung' : '📍 Kontext'}
                  </Text>
                  {list.map(ts => (
                    <View key={ts.tag.id} style={s.tagStatRow}>
                      <Text style={s.tagStatName} numberOfLines={1}>{ts.tag.name.replace(/_/g, ' ')}</Text>
                      <Text style={s.tagStatCount}>{ts.total}×</Text>
                      <View style={s.tagBar}>
                        <View style={[s.tagBarWin, { flex: ts.inWin }]} />
                        <View style={[s.tagBarLoss, { flex: ts.inLoss }]} />
                      </View>
                      <Text style={[s.tagStatR, ts.avgR >= 0 ? s.green : s.red]}>
                        {ts.avgR > 0 ? '+' : ''}{ts.avgR.toFixed(1)}R
                      </Text>
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
        )}
        {managementStats.hasData && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Management-Auswertung</Text>
            <View style={s.mgmtGrid}>
              <MgmtStat
                label="Managed"
                value={`${managementStats.managedCount}`}
                sub={`von ${filtered.length} Trades`}
              />
              <MgmtStat
                label="SL → BE"
                value={`${managementStats.beMovedCount}`}
                sub={filtered.length > 0 ? `${((managementStats.beMovedCount / filtered.length) * 100).toFixed(0)}% der Trades` : '—'}
              />
              <MgmtStat
                label="BE gehalten"
                value={managementStats.beMovedCount > 0 ? `${managementStats.beHeldCount}/${managementStats.beMovedCount}` : '—'}
                sub={managementStats.beMovedCount > 0 ? `${((managementStats.beHeldCount / managementStats.beMovedCount) * 100).toFixed(0)}% Halterate` : ''}
                positive={managementStats.beMovedCount > 0 && managementStats.beHeldCount / managementStats.beMovedCount >= 0.6}
              />
              <MgmtStat
                label="TP1 getroffen"
                value={`${managementStats.tp1Count}`}
                sub={managementStats.avgTp1R !== null ? `Ø ${managementStats.avgTp1R.toFixed(2)}R` : `${filtered.length > 0 ? ((managementStats.tp1Count / filtered.length) * 100).toFixed(0) : 0}%`}
                positive={managementStats.tp1Count > 0}
              />
              <MgmtStat
                label="Partial Close"
                value={`${managementStats.partialCount}`}
                sub={filtered.length > 0 ? `${((managementStats.partialCount / filtered.length) * 100).toFixed(0)}% der Trades` : '—'}
              />
              {managementStats.avgTp1R !== null && (
                <MgmtStat
                  label="Ø TP1 in R"
                  value={`${managementStats.avgTp1R > 0 ? '+' : ''}${managementStats.avgTp1R.toFixed(2)}R`}
                  sub="bei TP-Hit"
                  positive={managementStats.avgTp1R > 0}
                />
              )}
            </View>
          </View>
        )}

        {activeStrategy && (
          <View style={s.section}>
            {/* Existing performance KI */}
            <PressFix style={s.kiBtn} onPress={runStrategyKI} disabled={kiLoading}>
              {kiLoading ? <ActivityIndicator size="small" color="#818cf8" /> : <Feather name="cpu" size={16} color="#818cf8" />}
              <Text style={s.kiBtnText}>{kiLoading ? 'Analysiert...' : `"${activeStrategy.name}" mit KI bewerten`}</Text>
            </PressFix>
            {kiError && <Text style={s.kiError}>{kiError}</Text>}
            {kiAnalysis && (
              <ScrollView style={s.kiResult} nestedScrollEnabled>
                {kiAnalysis.split('\n').map((line, i) => {
                  const isBold = line.startsWith('**') && line.includes('**', 2)
                  if (isBold) return <Text key={i} style={s.kiHeading}>{line.replace(/\*\*/g, '')}</Text>
                  if (line.trim() === '') return <View key={i} style={{ height: 6 }} />
                  return <Text key={i} style={s.kiText}>{line}</Text>
                })}
                <PressFix onPress={() => setKiAnalysis(null)} style={s.kiRerun}>
                  <Feather name="refresh-cw" size={12} color="#555" />
                  <Text style={s.kiRerunText}>Neu analysieren</Text>
                </PressFix>
              </ScrollView>
            )}

            {/* Auto-Tag & KI Review: alle Trades automatisch taggen */}
            <PressFix style={[s.kiBtn, { borderColor: '#a78bfa33', marginTop: 10 }]} onPress={runAutoTag} disabled={autoTagLoading}>
              {autoTagLoading ? <ActivityIndicator size="small" color="#a78bfa" /> : <Feather name="tag" size={16} color="#a78bfa" />}
              <Text style={[s.kiBtnText, { color: '#a78bfa' }]}>
                {autoTagLoading ? `Auto-Tag läuft... ${autoTagProgress}` : autoTagDone ? `Auto-Tag fertig ✓ (${trades.filter(t => t.strategy_id === activeStrategy!.id).length} Trades)` : `Auto-Tag & KI Review (${trades.filter(t => t.strategy_id === activeStrategy!.id).length} Trades)`}
              </Text>
            </PressFix>
            {autoTagError && <Text style={s.kiError}>{autoTagError}</Text>}

            {/* Kombinierte Analyse: alle Trades (Kerzen) + beste/schlechteste 8 (Screenshots) */}
            {(() => {
              const totalTrades = trades.filter(t => t.strategy_id === activeStrategy!.id).length
              const screenshotCount = trades.filter(t => t.strategy_id === activeStrategy!.id && t.screenshot_path).length
              const label = combinedLoading
                ? 'Analysiert...'
                : combinedSaved
                  ? `Analyse fertig ✓`
                  : screenshotCount > 0
                    ? `Regelwerk-Analyse (${totalTrades} Trades · ${Math.min(screenshotCount, 8)} Screenshots)`
                    : `Regelwerk-Analyse (${totalTrades} Trades · keine Screenshots)`
              return (
                <PressFix style={[s.kiBtn, { borderColor: '#38bdf833', marginTop: 10 }]} onPress={runCombinedKI} disabled={combinedLoading}>
                  {combinedLoading
                    ? <ActivityIndicator size="small" color="#38bdf8" />
                    : <Feather name="layers" size={16} color="#38bdf8" />}
                  <Text style={[s.kiBtnText, { color: '#38bdf8' }]}>{label}</Text>
                </PressFix>
              )
            })()}
            {combinedError && <Text style={s.kiError}>{combinedError}</Text>}
            {combinedAnalysis && (
              <ScrollView style={s.kiResult} nestedScrollEnabled>
                <Text style={[s.kiHeading, { color: '#38bdf8', marginBottom: 6 }]}>Regelwerk-Analyse</Text>
                {combinedAnalysis.split('\n').map((line, i) => {
                  const isBold = line.startsWith('**') && line.includes('**', 2)
                  if (isBold) return <Text key={i} style={s.kiHeading}>{line.replace(/\*\*/g, '')}</Text>
                  if (line.trim() === '') return <View key={i} style={{ height: 6 }} />
                  return <Text key={i} style={s.kiText}>{line}</Text>
                })}
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 12 }}>
                  <PressFix onPress={() => setCombinedAnalysis(null)} style={s.kiRerun}>
                    <Feather name="refresh-cw" size={12} color="#555" />
                    <Text style={s.kiRerunText}>Neu analysieren</Text>
                  </PressFix>
                  <PressFix onPress={() => saveAsRuleset(combinedAnalysis, () => setCombinedSaved(true))} style={s.kiRerun} disabled={combinedSaved}>
                    <Feather name="save" size={12} color={combinedSaved ? '#22c55e' : '#f59e0b'} />
                    <Text style={[s.kiRerunText, { color: combinedSaved ? '#22c55e' : '#f59e0b' }]}>
                      {combinedSaved ? 'Gespeichert ✓' : 'Regelwerk + Tags speichern'}
                    </Text>
                  </PressFix>
                </View>
              </ScrollView>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function EquityCurve({ trades, eventsByTrade }: { trades: Trade[]; eventsByTrade: Map<string, ManagementEvent[]> }) {
  const { width } = useWindowDimensions()
  const W = width - 56
  const H = 110

  const sorted = [...trades].sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime())
  if (sorted.length < 2) return null

  const rVals = sorted.map(t => calcWeightedR(t, eventsByTrade.get(t.id) ?? []) ?? 0)
  const cumR: number[] = []
  let running = 0
  for (const r of rVals) { running += r; cumR.push(running) }

  const points = [0, ...cumR]
  const minY = Math.min(0, ...points)
  const maxY = Math.max(0, ...points)
  const range = maxY - minY || 1
  const toX = (i: number) => (i / (points.length - 1)) * W
  const toY = (v: number) => H - ((v - minY) / range) * H
  const zeroY = toY(0)
  const finalR = cumR[cumR.length - 1]
  const lineColor = finalR >= 0 ? '#22c55e' : '#ef4444'

  const segments: { cx: number; cy: number; length: number; angle: number }[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const x1 = toX(i), y1 = toY(points[i])
    const x2 = toX(i + 1), y2 = toY(points[i + 1])
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    const angle = Math.atan2(dy, dx) * (180 / Math.PI)
    segments.push({ cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, length: len, angle })
  }

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Equity-Kurve</Text>
      <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12 }}>
        <View style={{ height: H, width: W, position: 'relative', overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: zeroY, height: 1, backgroundColor: '#2a2a2a' }} />
          {segments.map((seg, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: seg.cx - seg.length / 2,
                top: seg.cy - 1,
                width: seg.length,
                height: 2,
                backgroundColor: lineColor,
                transform: [{ rotate: `${seg.angle}deg` }],
              }}
            />
          ))}
        </View>
        <Text style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 6 }}>
          {sorted.length} Trades · {finalR > 0 ? '+' : ''}{finalR.toFixed(2)}R gesamt
        </Text>
      </View>
    </View>
  )
}

function Heatmap({ trades, eventsByTrade }: { trades: Trade[]; eventsByTrade: Map<string, ManagementEvent[]> }) {
  if (trades.length === 0) return null
  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
  const timeSlots = ['0-4', '4-8', '8-12', '12-16', '16-20', '20-24']
  const cells: { rVals: number[] }[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 6 }, () => ({ rVals: [] }))
  )
  for (const t of trades) {
    const d = new Date(t.opened_at)
    const localDay = d.getDay()
    const dayIdx = localDay === 0 ? 6 : localDay - 1
    const slotIdx = Math.min(Math.floor(d.getHours() / 4), 5)
    const r = calcWeightedR(t, eventsByTrade.get(t.id) ?? []) ?? 0
    cells[dayIdx][slotIdx].rVals.push(r)
  }
  const cellBg = (rVals: number[]) => {
    if (rVals.length === 0) return '#111'
    const avg = rVals.reduce((a, b) => a + b, 0) / rVals.length
    if (avg >= 1.5) return '#052e16'
    if (avg >= 0.5) return '#0a4a1a'
    if (avg > 0) return '#0d2d10'
    if (avg > -1.5) return '#2d0a0a'
    return '#4a0505'
  }
  const cellFg = (rVals: number[]) => {
    if (rVals.length === 0) return '#333'
    return (rVals.reduce((a, b) => a + b, 0) / rVals.length) >= 0 ? '#22c55e' : '#ef4444'
  }
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Heatmap (Ortszeit)</Text>
      <View style={{ backgroundColor: '#1a1a1a', borderRadius: 12, padding: 10 }}>
        <View style={{ flexDirection: 'row', marginBottom: 4, marginLeft: 26 }}>
          {timeSlots.map(slot => (
            <Text key={slot} style={{ flex: 1, color: '#555', fontSize: 9, textAlign: 'center' }}>{slot}</Text>
          ))}
        </View>
        {dayNames.map((day, di) => (
          <View key={day} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
            <Text style={{ color: '#666', fontSize: 11, width: 26 }}>{day}</Text>
            {cells[di].map((cell, si) => {
              const avg = cell.rVals.length > 0 ? cell.rVals.reduce((a, b) => a + b, 0) / cell.rVals.length : null
              return (
                <View key={si} style={{ flex: 1, height: 34, backgroundColor: cellBg(cell.rVals), borderRadius: 4, marginHorizontal: 1, alignItems: 'center', justifyContent: 'center' }}>
                  {avg !== null && (
                    <>
                      <Text style={{ color: cellFg(cell.rVals), fontSize: 9, fontWeight: '700' }}>
                        {avg > 0 ? '+' : ''}{avg.toFixed(1)}
                      </Text>
                      <Text style={{ color: '#555', fontSize: 8 }}>{cell.rVals.length}×</Text>
                    </>
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </View>
    </View>
  )
}

function calcStats(trades: Trade[], eventsByTrade: Map<string, ManagementEvent[]> = new Map()) {
  const rValues = trades.map(t => {
    if (!t.exit_price) return 0
    return calcWeightedR(t, eventsByTrade.get(t.id) ?? []) ?? 0
  })
  const wins = trades.filter((_, i) => rValues[i] > 0)
  const losses = trades.filter((t, i) => t.exit_price != null && rValues[i] <= 0)
  const totalR = rValues.reduce((a, b) => a + b, 0)
  const avgR = trades.length > 0 ? totalR / trades.length : 0
  const grossWin = rValues.filter(r => r > 0).reduce((a, b) => a + b, 0)
  const grossLoss = Math.abs(rValues.filter(r => r < 0).reduce((a, b) => a + b, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
  let maxDD = 0, peak = 0, equity = 0
  for (const r of rValues) {
    equity += r
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDD) maxDD = dd
  }
  return { wins: wins.length, losses: losses.length, winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0, totalR, avgR, profitFactor, maxDD }
}

function BigStat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <View style={s.bigStat}>
      <Text style={s.bigLabel}>{label}</Text>
      <Text style={[s.bigValue, positive === true && s.green, positive === false && s.red]}>{value}</Text>
    </View>
  )
}

function MgmtStat({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <View style={s.mgmtStat}>
      <Text style={s.mgmtLabel}>{label}</Text>
      <Text style={[s.mgmtValue, positive === true && s.green, positive === false && s.red]}>{value}</Text>
      {sub ? <Text style={s.mgmtSub}>{sub}</Text> : null}
    </View>
  )
}

function SideStat({ label, trades, eventsByTrade }: { label: string; trades: Trade[]; eventsByTrade: Map<string, ManagementEvent[]> }) {
  const st = calcStats(trades, eventsByTrade)
  return (
    <View style={s.sideStatBox}>
      <Text style={s.sideStatLabel}>{label}</Text>
      <Text style={s.sideStatCount}>{trades.length} Trades</Text>
      <Text style={[s.sideStatR, st.totalR >= 0 ? s.green : s.red]}>{st.totalR > 0 ? '+' : ''}{st.totalR.toFixed(2)}R</Text>
      <Text style={s.sideStatWR}>{st.winRate.toFixed(1)}% WR</Text>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  stratScroll: { marginBottom: 12 },
  stratRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  stratChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  stratChipActive: { backgroundColor: '#1e2a4a', borderColor: '#3b82f6' },
  stratChipText: { color: '#666', fontSize: 13, fontWeight: '600' },
  stratChipTextActive: { color: '#60a5fa' },
  filterLabel: { color: '#60a5fa', fontSize: 13, fontWeight: '600', marginBottom: 12 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a' },
  periodActive: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  periodText: { color: '#666', fontWeight: '600', fontSize: 13 },
  periodTextActive: { color: '#22c55e' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  bigStat: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 16, width: '31%', flex: 1 },
  bigLabel: { color: '#666', fontSize: 11, marginBottom: 6 },
  bigValue: { color: '#fff', fontSize: 20, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionTitle: { color: '#aaa', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  row: { flexDirection: 'row', height: 36, borderRadius: 8, overflow: 'hidden' },
  breakdown: { backgroundColor: '#052e16', alignItems: 'center', justifyContent: 'center' },
  breakdown2: { backgroundColor: '#2d0a0a', alignItems: 'center', justifyContent: 'center' },
  breakdownWin: { color: '#22c55e', fontSize: 12, fontWeight: '700' },
  breakdownLoss: { color: '#ef4444', fontSize: 12, fontWeight: '700' },
  sideStats: { flexDirection: 'row', gap: 8 },
  sideStatBox: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14 },
  sideStatLabel: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  sideStatCount: { color: '#666', fontSize: 12, marginBottom: 4 },
  sideStatR: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  sideStatWR: { color: '#888', fontSize: 12 },
  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 8 },
  sessIndicator: { width: 8, height: 8, borderRadius: 4 },
  sessLabel: { color: '#fff', fontSize: 14, fontWeight: '600', width: 70 },
  sessCount: { color: '#666', fontSize: 12, width: 28 },
  sessR: { fontSize: 14, fontWeight: '700', width: 60, textAlign: 'right' },
  sessWR: { color: '#888', fontSize: 12, width: 55, textAlign: 'right' },
  sessEmpty: { color: '#444', fontSize: 12, flex: 1 },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  dayLabel: { color: '#fff', fontSize: 14, fontWeight: '600', width: 30 },
  dayCount: { color: '#666', fontSize: 12, flex: 1 },
  dayR: { fontSize: 14, fontWeight: '700', width: 60, textAlign: 'right' },
  dayWR: { color: '#888', fontSize: 12, width: 55, textAlign: 'right' },
  tagGroup: { marginBottom: 16 },
  tagGroupLabel: { color: '#666', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  tagStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  tagStatName: { color: '#ccc', fontSize: 13, flex: 1 },
  tagStatCount: { color: '#555', fontSize: 12, width: 24 },
  tagBar: { flexDirection: 'row', width: 60, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  tagBarWin: { backgroundColor: '#22c55e' },
  tagBarLoss: { backgroundColor: '#ef4444' },
  tagStatR: { fontSize: 13, fontWeight: '700', width: 44, textAlign: 'right' },
  mgmtGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mgmtStat: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, minWidth: '30%', flex: 1 },
  mgmtLabel: { color: '#555', fontSize: 10, fontWeight: '600', textTransform: 'uppercase', marginBottom: 4 },
  mgmtValue: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  mgmtSub: { color: '#555', fontSize: 11 },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
  kiBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a2d', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#818cf833' },
  kiBtnText: { color: '#818cf8', fontSize: 14, fontWeight: '600', flex: 1 },
  kiError: { color: '#ef4444', fontSize: 13, marginTop: 8, fontStyle: 'italic' },
  kiResult: { backgroundColor: '#111', borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#1e1e1e', maxHeight: 500 },
  kiHeading: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 10, marginBottom: 2 },
  kiText: { color: '#bbb', fontSize: 13, lineHeight: 20 },
  kiRerun: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'center' },
  kiRerunText: { color: '#555', fontSize: 12 },
})

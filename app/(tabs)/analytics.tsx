import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import type { Trade, TagDefinition, StrategyProfile } from '../../src/types'

type Period = '7d' | '30d' | '90d' | 'all'

interface TagStat {
  tag: TagDefinition
  total: number
  inLoss: number
  inWin: number
  avgR: number
}

interface StrategyStat {
  strategy: StrategyProfile | null
  name: string
  trades: Trade[]
}

export default function AnalyticsScreen() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [tagStats, setTagStats] = useState<TagStat[]>([])
  const [strategyStats, setStrategyStats] = useState<StrategyStat[]>([])
  const [period, setPeriod] = useState<Period>('30d')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: tradeData }, { data: assignments }, { data: tagDefs }, { data: strategies }] = await Promise.all([
        supabase.from('trades').select('*').eq('user_id', user.id).eq('status', 'closed').order('opened_at', { ascending: false }),
        supabase.from('trade_tag_assignments').select('tag_id, trade_id').eq('user_id', user.id),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id),
        supabase.from('strategy_profiles').select('*').eq('user_id', user.id),
      ])

      const closedTrades = tradeData ?? []
      setTrades(closedTrades)

      // Strategy breakdown
      const stratMap = new Map((strategies ?? []).map((s: StrategyProfile) => [s.id, s]))
      const stratGroups = new Map<string | null, Trade[]>()
      for (const t of closedTrades) {
        const key = t.strategy_id ?? null
        if (!stratGroups.has(key)) stratGroups.set(key, [])
        stratGroups.get(key)!.push(t)
      }
      const stratList: StrategyStat[] = []
      for (const [id, tradeList] of stratGroups.entries()) {
        const strategy = id ? (stratMap.get(id) ?? null) : null
        stratList.push({ strategy, name: strategy?.name ?? 'Ohne Strategie', trades: tradeList })
      }
      stratList.sort((a, b) => b.trades.length - a.trades.length)
      setStrategyStats(stratList)

      if (!assignments || !tagDefs) return

      const tradeMap = new Map(closedTrades.map(t => [t.id, t]))
      const stats: Record<string, TagStat> = {}

      for (const tag of tagDefs) {
        stats[tag.id] = { tag, total: 0, inLoss: 0, inWin: 0, avgR: 0 }
      }

      const tagRValues: Record<string, number[]> = {}

      for (const a of assignments) {
        const trade = tradeMap.get(a.trade_id)
        if (!trade || !trade.exit_price) continue
        if (!stats[a.tag_id]) continue

        const risk = Math.abs(trade.entry_price - trade.stop_loss)
        const pnl = trade.side === 'long' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price
        const r = risk > 0 ? pnl / risk : 0
        const isWin = trade.side === 'long' ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price

        stats[a.tag_id].total++
        if (isWin) stats[a.tag_id].inWin++
        else stats[a.tag_id].inLoss++

        if (!tagRValues[a.tag_id]) tagRValues[a.tag_id] = []
        tagRValues[a.tag_id].push(r)
      }

      for (const [id, rArr] of Object.entries(tagRValues)) {
        if (rArr.length > 0) stats[id].avgR = rArr.reduce((a, b) => a + b, 0) / rArr.length
      }

      setTagStats(Object.values(stats).filter(s => s.total > 0).sort((a, b) => b.total - a.total))
    }
    load()
  }, [])

  const filtered = (() => {
    if (period === 'all') return trades
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return trades.filter(t => new Date(t.opened_at) >= cutoff)
  })()

  const stats = calcStats(filtered)

  const sessions = [
    { label: 'Asian', start: 0, end: 7, color: '#818cf8' },
    { label: 'London', start: 7, end: 12, color: '#f59e0b' },
    { label: 'New York', start: 13, end: 20, color: '#22c55e' },
  ]

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.title}>Analytics</Text>

        <View style={s.periodRow}>
          {(['7d', '30d', '90d', 'all'] as Period[]).map(p => (
            <TouchableOpacity key={p} style={[s.periodBtn, period === p && s.periodActive]} onPress={() => setPeriod(p)}>
              <Text style={[s.periodText, period === p && s.periodTextActive]}>
                {p === 'all' ? 'Alle' : p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

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
            <SideStat label="Long" trades={filtered.filter(t => t.side === 'long')} />
            <SideStat label="Short" trades={filtered.filter(t => t.side === 'short')} />
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Session (UTC)</Text>
          {sessions.map(sess => {
            const sessTrades = filtered.filter(t => {
              const h = new Date(t.opened_at).getUTCHours()
              return h >= sess.start && h < sess.end
            })
            const st = calcStats(sessTrades)
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
            const dayStats = calcStats(dayTrades)
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

        {strategyStats.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Nach Strategie</Text>
            {strategyStats.map(ss => {
              const st = calcStats(ss.trades)
              return (
                <View key={ss.name} style={s.stratRow}>
                  <View style={s.stratLeft}>
                    <Text style={s.stratName} numberOfLines={1}>{ss.name}</Text>
                    <Text style={s.stratCount}>{ss.trades.length} Trades · {st.winRate.toFixed(0)}% WR</Text>
                  </View>
                  <View style={s.stratRight}>
                    <Text style={[s.stratR, st.totalR >= 0 ? s.green : s.red]}>
                      {st.totalR > 0 ? '+' : ''}{st.totalR.toFixed(2)}R
                    </Text>
                    <Text style={[s.stratAvgR, st.avgR >= 0 ? s.green : s.red]}>
                      Ø {st.avgR > 0 ? '+' : ''}{st.avgR.toFixed(2)}R
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}

        {tagStats.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Tag-Analyse</Text>
            {['mistake', 'execution', 'context'].map(type => {
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
      </ScrollView>
    </SafeAreaView>
  )
}

function calcStats(trades: Trade[]) {
  const wins = trades.filter(t => t.exit_price != null && (
    t.side === 'long' ? t.exit_price > t.entry_price : t.exit_price < t.entry_price
  ))
  const losses = trades.filter(t => t.exit_price != null && (
    t.side === 'long' ? t.exit_price <= t.entry_price : t.exit_price >= t.entry_price
  ))

  const rValues = trades.map(t => {
    if (!t.exit_price) return 0
    const risk = Math.abs(t.entry_price - t.stop_loss)
    const pnl = t.side === 'long' ? t.exit_price - t.entry_price : t.entry_price - t.exit_price
    return risk > 0 ? pnl / risk : 0
  })

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

function SideStat({ label, trades }: { label: string; trades: Trade[] }) {
  const st = calcStats(trades)
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
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 16 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
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
  stratRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  stratLeft: { flex: 1, marginRight: 12 },
  stratName: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  stratCount: { color: '#666', fontSize: 12 },
  stratRight: { alignItems: 'flex-end' },
  stratR: { fontSize: 16, fontWeight: '700' },
  stratAvgR: { fontSize: 12, marginTop: 2 },
  tagGroup: { marginBottom: 16 },
  tagGroupLabel: { color: '#666', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  tagStatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  tagStatName: { color: '#ccc', fontSize: 13, flex: 1 },
  tagStatCount: { color: '#555', fontSize: 12, width: 24 },
  tagBar: { flexDirection: 'row', width: 60, height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#1a1a1a' },
  tagBarWin: { backgroundColor: '#22c55e' },
  tagBarLoss: { backgroundColor: '#ef4444' },
  tagStatR: { fontSize: 13, fontWeight: '700', width: 44, textAlign: 'right' },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

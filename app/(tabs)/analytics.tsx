import { useEffect, useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../src/lib/supabase'
import type { Trade, TagDefinition, StrategyProfile } from '../../src/types'

type Period = '7d' | '30d' | '90d' | 'all'

interface TagAssignment { tag_id: string; trade_id: string }

export default function AnalyticsScreen() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>([])
  const [assignments, setAssignments] = useState<TagAssignment[]>([])
  const [period, setPeriod] = useState<Period>('30d')
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tradeData }, { data: asgn }, { data: tags }, { data: strats }] = await Promise.all([
        supabase.from('trades').select('*').eq('user_id', user.id).eq('status', 'closed').order('opened_at', { ascending: false }),
        supabase.from('trade_tag_assignments').select('tag_id, trade_id').eq('user_id', user.id),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id),
        supabase.from('strategy_profiles').select('*').eq('user_id', user.id).order('name'),
      ])
      setTrades(tradeData ?? [])
      setAssignments(asgn ?? [])
      setTagDefs(tags ?? [])
      setStrategies(strats ?? [])
    }
    load()
  }, [])

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
      const risk = Math.abs(trade.entry_price - trade.stop_loss)
      const pnl = trade.side === 'long' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price
      const r = risk > 0 ? pnl / risk : 0
      const isWin = trade.side === 'long' ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price
      stats[a.tag_id].total++
      if (isWin) stats[a.tag_id].inWin++; else stats[a.tag_id].inLoss++
      stats[a.tag_id].rVals.push(r)
    }
    return Object.values(stats)
      .filter(s => s.total > 0)
      .map(s => ({ ...s, avgR: s.rVals.reduce((a, b) => a + b, 0) / s.rVals.length }))
      .sort((a, b) => b.total - a.total)
  }, [filtered, tagDefs, assignments])

  const stats = calcStats(filtered)
  const sessions = [
    { label: 'Asian', start: 0, end: 7, color: '#818cf8' },
    { label: 'London', start: 7, end: 12, color: '#f59e0b' },
    { label: 'New York', start: 13, end: 20, color: '#22c55e' },
  ]

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
      </ScrollView>
    </SafeAreaView>
  )
}

function calcStats(trades: Trade[]) {
  const wins = trades.filter(t => t.exit_price != null && (t.side === 'long' ? t.exit_price > t.entry_price : t.exit_price < t.entry_price))
  const losses = trades.filter(t => t.exit_price != null && (t.side === 'long' ? t.exit_price <= t.entry_price : t.exit_price >= t.entry_price))
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
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

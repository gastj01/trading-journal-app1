import { useEffect, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { tapDiag } from '../../src/lib/tapDiag'
import type { Trade, TradingAccount } from '../../src/types'

export default function DashboardScreen() {
  const router = useRouter()
  const [trades, setTrades] = useState<Trade[]>([])
  const [account, setAccount] = useState<TradingAccount | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const addBtnRef = useRef<TouchableOpacity>(null)

  function measureAddBtn() {
    addBtnRef.current?.measureInWindow((x, y, width, height) => {
      tapDiag.plusButtonRect = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
    })
  }

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: accs }, { data: trd }] = await Promise.all([
      supabase.from('trading_accounts').select('*').eq('user_id', user.id).eq('is_default', true).single(),
      supabase.from('trades').select('*').eq('user_id', user.id).order('opened_at', { ascending: false }).limit(100),
    ])

    setAccount(accs)
    setTrades(trd ?? [])
  }

  useEffect(() => { load() }, [])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const closed = trades.filter(t => t.status === 'closed')
  const open = trades.filter(t => t.status === 'open')
  const wins = closed.filter(t => t.exit_price != null && (
    t.side === 'long' ? t.exit_price > t.entry_price : t.exit_price < t.entry_price
  ))
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0

  const totalR = closed.reduce((sum, t) => {
    if (!t.exit_price) return sum
    const risk = Math.abs(t.entry_price - t.stop_loss)
    if (risk === 0) return sum
    const diff = t.side === 'long'
      ? t.exit_price - t.entry_price
      : t.entry_price - t.exit_price
    return sum + diff / risk
  }, 0)

  const recent = trades.slice(0, 5)

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        style={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22c55e" />}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.accountName}>{account?.name ?? 'Trading Journal'}</Text>
            <Text style={s.subtitle}>{account?.platform ?? ''}</Text>
          </View>
          <TouchableOpacity
            ref={addBtnRef}
            style={s.addBtn}
            onLayout={measureAddBtn}
            onTouchStart={() => { tapDiag.plusTouchStartCount++; measureAddBtn() }}
            onPress={() => {
              tapDiag.plusPressCount++
              tapDiag.lastPlusPressAt = Date.now()
              router.push('/trade/new')
            }}
          >
            <Feather name="plus" size={20} color="#000" />
          </TouchableOpacity>
        </View>

        {/* Stats Grid */}
        <View style={s.statsGrid}>
          <StatCard label="Trades" value={String(closed.length)} sub={`${open.length} offen`} />
          <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} sub={`${wins.length}W / ${closed.length - wins.length}L`} positive={winRate >= 50} />
          <StatCard label="Total R" value={totalR.toFixed(2) + 'R'} positive={totalR > 0} />
          <StatCard label="Konto" value={`$${account?.initial_balance?.toLocaleString() ?? '—'}`} sub={account?.currency ?? ''} />
        </View>

        {/* Open Trades */}
        {open.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Feather name="activity" size={16} color="#f59e0b" />
              <Text style={s.sectionTitle}>Offene Positionen</Text>
            </View>
            {open.map(t => <TradeRow key={t.id} trade={t} onPress={() => router.push(`/trade/${t.id}`)} />)}
          </View>
        )}

        {/* Recent Trades */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Letzte Trades</Text>
          {recent.filter(t => t.status === 'closed').map(t => (
            <TradeRow key={t.id} trade={t} onPress={() => router.push(`/trade/${t.id}`)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLabel}>{label}</Text>
      <Text style={[s.cardValue, positive === true && s.green, positive === false && s.red]}>{value}</Text>
      {sub && <Text style={s.cardSub}>{sub}</Text>}
    </View>
  )
}

function TradeRow({ trade, onPress }: { trade: Trade; onPress: () => void }) {
  const isLong = trade.side === 'long'
  const isWin = trade.exit_price != null && (
    isLong ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price
  )
  const date = new Date(trade.opened_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })

  return (
    <TouchableOpacity style={s.tradeRow} onPress={onPress}>
      <View style={[s.sideBadge, isLong ? s.longBg : s.shortBg]}>
        {isLong ? <Feather name="trending-up" size={14} color="#22c55e" /> : <Feather name="trending-down" size={14} color="#ef4444" />}
      </View>
      <View style={s.tradeInfo}>
        <Text style={s.tradeSymbol}>{trade.symbol}</Text>
        <Text style={s.tradeMeta}>{date} · {trade.timeframe} · {trade.risk_percent}%R</Text>
      </View>
      <View style={s.tradeRight}>
        <Text style={s.tradePrice}>{trade.entry_price.toLocaleString()}</Text>
        {trade.status === 'open'
          ? <Text style={s.openBadge}>OFFEN</Text>
          : <Text style={[s.result, isWin ? s.green : s.red]}>{isWin ? 'WIN' : 'LOSS'}</Text>
        }
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 12 },
  accountName: { color: '#fff', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#666', fontSize: 13, marginTop: 2 },
  addBtn: { backgroundColor: '#22c55e', borderRadius: 20, padding: 8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  card: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, width: '48%', flex: 1, minWidth: '45%' },
  cardLabel: { color: '#888', fontSize: 12, marginBottom: 4 },
  cardValue: { color: '#fff', fontSize: 22, fontWeight: '700' },
  cardSub: { color: '#666', fontSize: 11, marginTop: 2 },
  section: { paddingHorizontal: 16, marginTop: 16, marginBottom: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionTitle: { color: '#aaa', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  tradeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8 },
  sideBadge: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  longBg: { backgroundColor: '#052e16' },
  shortBg: { backgroundColor: '#2d0a0a' },
  tradeInfo: { flex: 1 },
  tradeSymbol: { color: '#fff', fontSize: 15, fontWeight: '600' },
  tradeMeta: { color: '#666', fontSize: 12, marginTop: 2 },
  tradeRight: { alignItems: 'flex-end' },
  tradePrice: { color: '#aaa', fontSize: 13 },
  result: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  openBadge: { color: '#f59e0b', fontSize: 12, fontWeight: '700', marginTop: 2 },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
})

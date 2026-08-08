import { useEffect, useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import type { Trade } from '../../src/types'

type FilterStatus = 'all' | 'open' | 'closed'
type FilterSide = 'all' | 'long' | 'short'

export default function JournalScreen() {
  const router = useRouter()
  const [trades, setTrades] = useState<Trade[]>([])
  const [filtered, setFiltered] = useState<Trade[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<FilterStatus>('all')
  const [side, setSide] = useState<FilterSide>('all')
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .order('opened_at', { ascending: false })
    setTrades(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    let result = trades
    if (status !== 'all') result = result.filter(t => t.status === status)
    if (side !== 'all') result = result.filter(t => t.side === side)
    if (search) result = result.filter(t =>
      t.symbol.toLowerCase().includes(search.toLowerCase()) ||
      t.setup?.toLowerCase().includes(search.toLowerCase()) ||
      t.notes?.toLowerCase().includes(search.toLowerCase())
    )
    setFiltered(result)
  }, [trades, search, status, side])

  const renderItem = useCallback(({ item }: { item: Trade }) => (
    <TradeItem trade={item} onPress={() => router.push(`/trade/${item.id}`)} />
  ), [])

  return (
    <SafeAreaView style={s.safe}>
      {/* Search */}
      <View style={s.searchBar}>
        <Feather name="search" size={16} color="#555" />
        <TextInput
          style={s.searchInput}
          placeholder="Symbol, Setup, Notiz..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filters */}
      <View style={s.filters}>
        <View style={s.filterGroup}>
          {(['all', 'open', 'closed'] as FilterStatus[]).map(f => (
            <TouchableOpacity key={f} style={[s.chip, status === f && s.chipActive]} onPress={() => setStatus(f)}>
              <Text style={[s.chipText, status === f && s.chipTextActive]}>
                {f === 'all' ? 'Alle' : f === 'open' ? 'Offen' : 'Geschlossen'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={s.filterGroup}>
          {(['all', 'long', 'short'] as FilterSide[]).map(f => (
            <TouchableOpacity key={f} style={[s.chip, side === f && s.chipActive]} onPress={() => setSide(f)}>
              <Text style={[s.chipText, side === f && s.chipTextActive]}>
                {f === 'all' ? 'Alle' : f === 'long' ? 'Long' : 'Short'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Trade count */}
      <Text style={s.count}>{filtered.length} Trades</Text>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        initialNumToRender={20}
      />

      <TouchableOpacity style={s.fab} onPress={() => router.push('/trade/new')}>
        <Feather name="plus" size={24} color="#000" />
      </TouchableOpacity>
    </SafeAreaView>
  )
}

function TradeItem({ trade, onPress }: { trade: Trade; onPress: () => void }) {
  const isLong = trade.side === 'long'
  const isWin = trade.exit_price != null && (
    isLong ? trade.exit_price > trade.entry_price : trade.exit_price < trade.entry_price
  )
  const rMultiple = trade.exit_price != null && trade.stop_loss != null ? (() => {
    const risk = Math.abs(trade.entry_price - trade.stop_loss)
    const pnl = isLong ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price
    return risk > 0 ? (pnl / risk).toFixed(2) : null
  })() : null

  return (
    <TouchableOpacity style={s.item} onPress={onPress}>
      <View style={[s.sideBar, isLong ? s.longBar : s.shortBar]} />
      <View style={s.itemContent}>
        <View style={s.itemTop}>
          <View style={s.itemLeft}>
            <Text style={s.symbol}>{trade.symbol}</Text>
            <Text style={s.meta}>
              {new Date(trade.opened_at).toLocaleDateString('de-DE')} · {trade.timeframe} · {trade.risk_percent}%R
            </Text>
          </View>
          <View style={s.itemRight}>
            {trade.status === 'open' ? (
              <View style={s.openTag}><Text style={s.openTagText}>OFFEN</Text></View>
            ) : rMultiple ? (
              <Text style={[s.rMultiple, parseFloat(rMultiple) > 0 ? s.green : s.red]}>
                {parseFloat(rMultiple) > 0 ? '+' : ''}{rMultiple}R
              </Text>
            ) : null}
            <View style={[s.sidePill, isLong ? s.longPill : s.shortPill]}>
              {isLong
                ? <Feather name="trending-up" size={12} color="#22c55e" />
                : <Feather name="trending-down" size={12} color="#ef4444" />}
              <Text style={[s.sideText, isLong ? s.green : s.red]}>{isLong ? 'LONG' : 'SHORT'}</Text>
            </View>
          </View>
        </View>
        <View style={s.prices}>
          <Text style={s.priceLabel}>Entry <Text style={s.priceVal}>{trade.entry_price.toLocaleString()}</Text></Text>
          <Text style={s.priceLabel}>SL <Text style={[s.priceVal, s.red]}>{trade.stop_loss.toLocaleString()}</Text></Text>
          {trade.exit_price && <Text style={s.priceLabel}>Exit <Text style={[s.priceVal, isWin ? s.green : s.red]}>{trade.exit_price.toLocaleString()}</Text></Text>}
        </View>
        {trade.setup ? <Text style={s.setup} numberOfLines={1}>{trade.setup}</Text> : null}
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', margin: 16, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 10 },
  filters: { paddingHorizontal: 16, gap: 6, marginBottom: 4 },
  filterGroup: { flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  chipActive: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  chipText: { color: '#666', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#22c55e' },
  count: { color: '#555', fontSize: 12, paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 80 },
  item: { flexDirection: 'row', backgroundColor: '#1a1a1a', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  sideBar: { width: 3 },
  longBar: { backgroundColor: '#22c55e' },
  shortBar: { backgroundColor: '#ef4444' },
  itemContent: { flex: 1, padding: 12 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  itemLeft: {},
  itemRight: { alignItems: 'flex-end', gap: 4 },
  symbol: { color: '#fff', fontSize: 16, fontWeight: '700' },
  meta: { color: '#666', fontSize: 12, marginTop: 2 },
  rMultiple: { fontSize: 18, fontWeight: '700' },
  sidePill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  longPill: { backgroundColor: '#052e16' },
  shortPill: { backgroundColor: '#2d0a0a' },
  sideText: { fontSize: 11, fontWeight: '700' },
  openTag: { backgroundColor: '#451a03', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  openTagText: { color: '#f59e0b', fontSize: 11, fontWeight: '700' },
  prices: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  priceLabel: { color: '#666', fontSize: 12 },
  priceVal: { color: '#aaa', fontWeight: '600' },
  setup: { color: '#888', fontSize: 12, fontStyle: 'italic' },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
  fab: { position: 'absolute', bottom: 24, right: 20, backgroundColor: '#22c55e', width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', elevation: 4 },
})

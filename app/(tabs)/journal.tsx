import { useState, useCallback, useEffect } from 'react'
import { View, Text, FlatList, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { calcWeightedR } from '../../src/lib/tradeCalc'
import type { Trade, StrategyProfile, TagDefinition, ManagementEvent } from '../../src/types'

type FilterStatus = 'all' | 'open' | 'closed'
type FilterSide = 'all' | 'long' | 'short'

export default function JournalScreen() {
  const router = useRouter()
  const [trades, setTrades] = useState<Trade[]>([])
  const [filtered, setFiltered] = useState<Trade[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [tagAssignments, setTagAssignments] = useState<{ trade_id: string; tag_id: string }[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<FilterStatus>('all')
  const [side, setSide] = useState<FilterSide>('all')
  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [loading, setLoading] = useState(true)
  const [eventsByTradeId, setEventsByTradeId] = useState<Map<string, ManagementEvent[]>>(new Map())

  // Re-apply filters whenever trades or filter state changes (React 18 batches state updates automatically)
  useEffect(() => {
    applyFilters(trades, tagAssignments, search, status, side, selectedStrategyId, selectedTagId)
  }, [trades, tagAssignments, search, status, side, selectedStrategyId, selectedTagId])

  useFocusEffect(useCallback(() => {
    loadData()
  }, []))

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: tradeData, error: tradeErr }, { data: strats }, { data: tagDefs }, { data: assigns }, { data: evData }] = await Promise.all([
      supabase.from('trades').select('*').eq('user_id', user.id).order('opened_at', { ascending: false }),
      supabase.from('strategy_profiles').select('*').eq('user_id', user.id).order('name'),
      supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
      supabase.from('trade_tag_assignments').select('trade_id, tag_id').eq('user_id', user.id),
      supabase.from('trade_management_events').select('*').eq('user_id', user.id),
    ])
    if (tradeErr || tradeData === null) {
      setLoading(false)
      return
    }
    const evMap = new Map<string, ManagementEvent[]>()
    for (const ev of (evData ?? [])) {
      if (!evMap.has(ev.trade_id)) evMap.set(ev.trade_id, [])
      evMap.get(ev.trade_id)!.push(ev)
    }
    setStrategies(strats ?? [])
    setTags(tagDefs ?? [])
    setTagAssignments(assigns ?? [])
    setEventsByTradeId(evMap)
    setTrades(tradeData)
    setLoading(false)
  }

  function applyFilters(
    allTrades: Trade[],
    assigns: { trade_id: string; tag_id: string }[],
    q: string,
    st: FilterStatus,
    si: FilterSide,
    stratId: string,
    tagId: string,
  ) {
    let result = allTrades
    if (st !== 'all') result = result.filter(t => t.status === st)
    if (si !== 'all') result = result.filter(t => t.side === si)
    if (stratId) result = result.filter(t => t.strategy_id === stratId)
    if (tagId) {
      const tradeIdsWithTag = new Set(assigns.filter(a => a.tag_id === tagId).map(a => a.trade_id))
      result = result.filter(t => tradeIdsWithTag.has(t.id))
    }
    if (q) {
      const lower = q.toLowerCase()
      result = result.filter(t =>
        t.symbol.toLowerCase().includes(lower) ||
        t.setup?.toLowerCase().includes(lower) ||
        t.notes?.toLowerCase().includes(lower)
      )
    }
    setFiltered(result)
  }

  function setFilter<T>(setter: (v: T) => void, key: 'status' | 'side' | 'strategy' | 'tag', value: T) {
    setter(value)
  }

  function onSearch(q: string) {
    setSearch(q)
  }

  const hasActiveFilter = status !== 'all' || side !== 'all' || !!selectedStrategyId || !!selectedTagId || !!search

  function resetAll() {
    setSearch('')
    setStatus('all')
    setSide('all')
    setSelectedStrategyId('')
    setSelectedTagId('')
    setFiltered(trades)
  }

  const renderItem = useCallback(({ item }: { item: Trade }) => (
    <TradeItem trade={item} events={eventsByTradeId.get(item.id) ?? []} onPress={() => router.push(`/trade/${item.id}`)} />
  ), [eventsByTradeId])

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
          onChangeText={onSearch}
        />
        {hasActiveFilter && (
          <TouchableOpacity onPress={resetAll} style={s.clearBtn}>
            <Feather name="x" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      {/* Status + Side filters */}
      <View style={s.filterRow}>
        {(['all', 'open', 'closed'] as FilterStatus[]).map(f => (
          <TouchableOpacity key={f} style={[s.chip, status === f && s.chipActive]} onPress={() => setFilter(setStatus, 'status', f)}>
            <Text style={[s.chipText, status === f && s.chipTextActive]}>
              {f === 'all' ? 'Alle' : f === 'open' ? 'Offen' : 'Geschlossen'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={s.sep} />
        {(['all', 'long', 'short'] as FilterSide[]).map(f => (
          <TouchableOpacity key={f} style={[s.chip, side === f && s.chipActive]} onPress={() => setFilter(setSide, 'side', f)}>
            <Text style={[s.chipText, side === f && s.chipTextActive]}>
              {f === 'all' ? 'L+S' : f === 'long' ? 'Long' : 'Short'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Strategy filter */}
      {strategies.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll} contentContainerStyle={s.hScrollContent}>
          <TouchableOpacity style={[s.stratChip, !selectedStrategyId && s.stratChipActive]} onPress={() => setFilter(setSelectedStrategyId, 'strategy', '')}>
            <Text style={[s.stratChipText, !selectedStrategyId && s.stratChipTextActive]}>Alle Strategien</Text>
          </TouchableOpacity>
          {strategies.map(st => (
            <TouchableOpacity key={st.id} style={[s.stratChip, selectedStrategyId === st.id && s.stratChipActive]} onPress={() => setFilter(setSelectedStrategyId, 'strategy', st.id)}>
              <Text style={[s.stratChipText, selectedStrategyId === st.id && s.stratChipTextActive]}>{st.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Tag filter */}
      {tags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll} contentContainerStyle={s.hScrollContent}>
          <TouchableOpacity style={[s.tagChip, !selectedTagId && s.tagChipAllActive]} onPress={() => setFilter(setSelectedTagId, 'tag', '')}>
            <Text style={[s.tagChipText, !selectedTagId && s.tagChipTextActive]}>Alle Tags</Text>
          </TouchableOpacity>
          {tags.map(tag => (
            <TouchableOpacity key={tag.id} style={[s.tagChip, selectedTagId === tag.id && s.tagChipActive]} onPress={() => setFilter(setSelectedTagId, 'tag', tag.id)}>
              <Text style={[s.tagChipText, selectedTagId === tag.id && s.tagChipTextActive]}>{tag.name.replace(/_/g, ' ')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <Text style={s.count}>{filtered.length} Trades{hasActiveFilter ? ' (gefiltert)' : ''}</Text>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        initialNumToRender={20}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>{loading ? 'Laden...' : 'Keine Trades gefunden'}</Text>
          </View>
        }
      />

      <TouchableOpacity style={s.fab} onPress={() => router.push('/trade/new')}>
        <Feather name="plus" size={24} color="#000" />
      </TouchableOpacity>
    </SafeAreaView>
  )
}

function TradeItem({ trade, events, onPress }: { trade: Trade; events: ManagementEvent[]; onPress: () => void }) {
  const isLong = trade.side === 'long'
  const rRaw = trade.exit_price != null ? calcWeightedR(trade, events) : null
  const rMultiple = rRaw != null ? rRaw.toFixed(2) : null

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
          {trade.exit_price && <Text style={s.priceLabel}>Exit <Text style={[s.priceVal, rMultiple && parseFloat(rMultiple) > 0 ? s.green : s.red]}>{trade.exit_price.toLocaleString()}</Text></Text>}
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
  clearBtn: { padding: 4 },
  filterRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  sep: { width: 1, height: 16, backgroundColor: '#2a2a2a', marginHorizontal: 2 },
  chip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  chipActive: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  chipText: { color: '#666', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#22c55e' },
  hScroll: { maxHeight: 36 },
  hScrollContent: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
  stratChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  stratChipActive: { backgroundColor: '#1e1a3a', borderColor: '#818cf8' },
  stratChipText: { color: '#666', fontSize: 12, fontWeight: '600' },
  stratChipTextActive: { color: '#818cf8' },
  tagChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  tagChipAll: {},
  tagChipAllActive: { backgroundColor: '#1a1a1a', borderColor: '#444' },
  tagChipActive: { backgroundColor: '#1a2a3a', borderColor: '#3b82f6' },
  tagChipText: { color: '#666', fontSize: 12, fontWeight: '600' },
  tagChipTextActive: { color: '#60a5fa' },
  count: { color: '#555', fontSize: 12, paddingHorizontal: 16, marginBottom: 8, marginTop: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', padding: 40 },
  emptyText: { color: '#555', fontSize: 14 },
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

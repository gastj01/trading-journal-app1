import { useState, useEffect } from 'react'
import {
  View, Text, Modal, ScrollView,
  ActivityIndicator, StyleSheet, TextInput, Alert,
} from 'react-native'
import { Feather } from '@expo/vector-icons'
import { nowDateStr } from '../lib/datetime'
import { findCandlesTouchingPrice, touchLabel, type TimeWindow, type TouchType, type CandleInterval } from '../lib/candlePicker'
import { getBinanceMarket, type Candle, type BinanceMarket } from '../lib/binance'
import { PressFix } from './PressFix'

interface Props {
  visible: boolean
  symbol: string
  price: number
  side: 'long' | 'short'
  initialDate?: string
  onSelect: (candle: Candle) => void
  onClose: () => void
}

const TIME_WINDOWS: { key: TimeWindow; label: string }[] = [
  { key: 'full', label: 'Ganzer Tag' },
  { key: 'morning', label: 'Vormittag' },
  { key: 'afternoon', label: 'Nachmittag' },
  { key: 'night', label: 'Abend/Nacht' },
]

const INTERVALS: { key: CandleInterval; label: string }[] = [
  { key: '1m', label: '1m' },
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '4h', label: '4h' },
]

const TOUCH_TYPES: { key: TouchType; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'bounce', label: 'Bounce / Limit' },
  { key: 'breakout', label: 'Breakout / Stop' },
]

const MARKETS: { key: BinanceMarket; label: string }[] = [
  { key: 'futures', label: 'Futures (USD-M)' },
  { key: 'spot', label: 'Spot' },
]

function fmtDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return d.slice(0, 2) + '.' + d.slice(2)
  return d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4)
}

export function CandleTimePicker({ visible, symbol, price, side, initialDate, onSelect, onClose }: Props) {
  const [date, setDate] = useState(initialDate ?? nowDateStr())
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('full')
  const [interval, setInterval] = useState<CandleInterval>('5m')
  const [touchType, setTouchType] = useState<TouchType>('all')
  const [market, setMarket] = useState<BinanceMarket>('futures')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Candle[]>([])
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    if (visible) {
      setDate(initialDate ?? nowDateStr())
      setResults([])
      setSearched(false)
      getBinanceMarket().then(setMarket)
    }
  }, [visible, initialDate])

  async function search() {
    if (!price || !symbol) return
    setLoading(true)
    setSearched(false)
    try {
      const candles = await findCandlesTouchingPrice(symbol, interval, price, side, touchType, date, timeWindow, market)
      setResults(candles)
      setSearched(true)
    } catch (e: any) {
      Alert.alert('Fehler', e.message)
    } finally {
      setLoading(false)
    }
  }

  function fmt(ms: number): string {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  function fmtP(n: number): string {
    const decimals = n < 10 ? 4 : n < 1000 ? 2 : 1
    return n.toFixed(decimals)
  }

  function pricePct(c: Candle): number {
    const range = c.high - c.low
    if (range === 0) return 50
    return Math.round(((price - c.low) / range) * 100)
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <PressFix onPress={onClose} style={s.closeBtn}>
            <Feather name="x" size={20} color="#aaa" />
          </PressFix>
          <Text style={s.title}>Zeitpunkt suchen</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.infoBox}>
            <Text style={s.infoText}>
              {symbol}  ·  {fmtP(price)}  ·  {side === 'long' ? '▲ Long' : '▼ Short'}
            </Text>
          </View>

          <Text style={s.label}>Datum</Text>
          <TextInput
            style={s.input}
            value={date}
            onChangeText={v => setDate(fmtDate(v))}
            placeholder="TT.MM.JJJJ"
            keyboardType="numeric"
            placeholderTextColor="#555"
          />

          <Text style={s.label}>Tageszeit</Text>
          <View style={s.chipRow}>
            {TIME_WINDOWS.map(w => (
              <PressFix key={w.key} style={[s.chip, timeWindow === w.key && s.chipOn]}
                onPress={() => setTimeWindow(w.key)}>
                <Text style={[s.chipTxt, timeWindow === w.key && s.chipTxtOn]}>{w.label}</Text>
              </PressFix>
            ))}
          </View>

          <Text style={s.label}>Zeitrahmen</Text>
          <View style={s.chipRow}>
            {INTERVALS.map(iv => (
              <PressFix key={iv.key} style={[s.chip, interval === iv.key && s.chipOn]}
                onPress={() => setInterval(iv.key)}>
                <Text style={[s.chipTxt, interval === iv.key && s.chipTxtOn]}>{iv.label}</Text>
              </PressFix>
            ))}
          </View>

          <Text style={s.label}>Berührungsart</Text>
          <View style={s.chipRow}>
            {TOUCH_TYPES.map(tt => (
              <PressFix key={tt.key} style={[s.chip, touchType === tt.key && s.chipOn]}
                onPress={() => setTouchType(tt.key)}>
                <Text style={[s.chipTxt, touchType === tt.key && s.chipTxtOn]}>{tt.label}</Text>
              </PressFix>
            ))}
          </View>

          <Text style={s.label}>Markt</Text>
          <View style={s.chipRow}>
            {MARKETS.map(m => (
              <PressFix key={m.key} style={[s.chip, market === m.key && s.chipOn]}
                onPress={() => setMarket(m.key)}>
                <Text style={[s.chipTxt, market === m.key && s.chipTxtOn]}>{m.label}</Text>
              </PressFix>
            ))}
          </View>

          <PressFix style={s.searchBtn} onPress={search} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={s.searchBtnTxt}>Kerzen suchen</Text>}
          </PressFix>

          {searched && results.length === 0 && (
            <View style={s.emptyBox}>
              <Feather name="search" size={20} color="#555" />
              <Text style={s.emptyTxt}>Keine Kerze gefunden, die {fmtP(price)} berührt hat.</Text>
            </View>
          )}

          {results.map((c, i) => {
            const isBull = c.close >= c.open
            const pp = pricePct(c)
            const label = touchLabel(c, price, side)
            return (
              <PressFix key={i} style={s.card} onPress={() => { onSelect(c); onClose() }}>
                <View style={s.cardLeft}>
                  <Text style={s.cardTime}>{fmt(c.openTime)}</Text>
                  <View style={s.bar}>
                    <View style={[s.barFill, { backgroundColor: isBull ? '#22c55e' : '#ef4444', height: `${Math.max(pp, 3)}%` }]} />
                    <View style={s.barPriceLine} />
                  </View>
                </View>
                <View style={s.cardMid}>
                  <Text style={s.ohlc}>H: {fmtP(c.high)}</Text>
                  <Text style={s.ohlc}>O: {fmtP(c.open)}  C: {fmtP(c.close)}</Text>
                  <Text style={s.ohlc}>L: {fmtP(c.low)}</Text>
                  <View style={[s.badge, label.includes('Bounce') || label.includes('Rejection') ? s.badgeBounce : label.includes('Breakout') ? s.badgeBreak : s.badgeNeutral]}>
                    <Text style={s.badgeTxt}>{label}</Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={18} color="#444" />
              </PressFix>
            )
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  closeBtn: { padding: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 8 },
  infoBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginBottom: 8 },
  infoText: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  label: { color: '#888', fontSize: 12, fontWeight: '600', marginTop: 8 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  chipOn: { backgroundColor: '#22c55e22', borderColor: '#22c55e' },
  chipTxt: { color: '#888', fontSize: 13 },
  chipTxtOn: { color: '#22c55e', fontWeight: '600' },
  searchBtn: { backgroundColor: '#22c55e', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  searchBtnTxt: { color: '#000', fontWeight: '700', fontSize: 15 },
  emptyBox: { alignItems: 'center', padding: 32, gap: 12 },
  emptyTxt: { color: '#555', fontSize: 14, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, gap: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  cardLeft: { alignItems: 'center', gap: 6 },
  cardTime: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bar: { width: 8, height: 60, backgroundColor: '#2a2a2a', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden', position: 'relative' },
  barFill: { width: '100%', borderRadius: 4 },
  barPriceLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#facc15' },
  cardMid: { flex: 1, gap: 3 },
  ohlc: { color: '#aaa', fontSize: 12 },
  badge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeBounce: { backgroundColor: '#22c55e22' },
  badgeBreak: { backgroundColor: '#3b82f622' },
  badgeNeutral: { backgroundColor: '#ffffff11' },
  badgeTxt: { color: '#ccc', fontSize: 11, fontWeight: '600' },
})

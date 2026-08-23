import AsyncStorage from '@react-native-async-storage/async-storage'

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  closeTime: number
}

export interface DetectedEvent {
  event_type: string
  event_time: string
  price: number
  size_percent: number | null
  note: string
}

export interface MFEMAEResult {
  mfe: number
  mae: number
  mfePrice: number
  maePrice: number
  candles: Candle[]
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w',
  'H1': '1h', 'H4': '4h', 'H8': '8h', 'H12': '12h',
  'D1': '1d', 'W1': '1w',
  'M1': '1m', 'M5': '5m', 'M15': '15m', 'M30': '30m',
}

export function normalizeSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s === 'BTC' || s === 'ETH' || s === 'BNB') return s + 'USDT'
  if (/USDT$|USDC$|BUSD$|BTC$|ETH$|BNB$/.test(s)) return s
  return s + 'USDT'
}

export function normalizeInterval(timeframe: string): string | null {
  return INTERVAL_MAP[timeframe] ?? INTERVAL_MAP[timeframe.toUpperCase()] ?? null
}

// Spot (api.binance.com) and USD-M Futures (fapi.binance.com) are different
// markets with measurably different minute-by-minute price paths - a level
// touched on one isn't necessarily touched at the same time (or at all) on
// the other. The user trades/charts on Binance Futures via MMT (confirmed
// against real candle data 2026-08-23: a logged entry price matched a
// futures candle but not the spot candle at the same minute), so futures
// is the default; spot stays selectable for anyone trading spot instead.
export type BinanceMarket = 'spot' | 'futures'

export const BINANCE_MARKET_KEY = 'binance_market'

export async function getBinanceMarket(): Promise<BinanceMarket> {
  const stored = await AsyncStorage.getItem(BINANCE_MARKET_KEY)
  return stored === 'spot' ? 'spot' : 'futures'
}

const KLINES_BASE_URL: Record<BinanceMarket, string> = {
  spot: 'https://api.binance.com/api/v3/klines',
  futures: 'https://fapi.binance.com/fapi/v1/klines',
}

async function fetchCandleBatch(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number,
  market: BinanceMarket,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    startTime: String(startMs),
    endTime: String(endMs),
    limit: '1000',
  })
  const res = await fetch(`${KLINES_BASE_URL[market]}?${params}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Binance ${res.status}: ${body}`)
  }
  const raw: any[][] = await res.json()
  return raw.map(c => ({
    openTime: Number(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    closeTime: Number(c[6]),
  }))
}

export async function fetchCandles(
  symbol: string,
  interval: string,
  startMs: number,
  endMs: number,
  market: BinanceMarket = 'futures',
): Promise<Candle[]> {
  const all: Candle[] = []
  let cursor = startMs
  while (cursor < endMs) {
    const batch = await fetchCandleBatch(symbol, interval, cursor, endMs, market)
    if (batch.length === 0) break
    all.push(...batch)
    if (batch.length < 1000) break
    // next batch starts after last candle's closeTime
    cursor = batch[batch.length - 1].closeTime + 1
  }
  return all
}

export function calcMFEMAE(
  candles: Candle[],
  entry: number,
  stopLoss: number,
  side: 'long' | 'short',
): MFEMAEResult {
  const risk = Math.abs(entry - stopLoss)
  let mfe = 0
  let mae = 0
  let mfePrice = entry
  let maePrice = entry

  for (const c of candles) {
    const favorablePrice = side === 'long' ? c.high : c.low
    const adversePrice = side === 'long' ? c.low : c.high

    const favorable = side === 'long' ? favorablePrice - entry : entry - favorablePrice
    const adverse = side === 'long' ? entry - adversePrice : adversePrice - entry

    if (risk > 0) {
      if (favorable / risk > mfe) {
        mfe = favorable / risk
        mfePrice = favorablePrice
      }
      if (adverse / risk > mae) {
        mae = adverse / risk
        maePrice = adversePrice
      }
    }
  }

  return { mfe, mae, mfePrice, maePrice, candles }
}

export function detectManagementEvents(
  candles: Candle[],
  entry: number,
  stopLoss: number,
  side: 'long' | 'short',
  tpLevels: Array<{ price: number; quantity_percent: number }> = [],
  beTriggerPrice?: number,
): DetectedEvent[] {
  const events: DetectedEvent[] = []
  const pendingTPs = [...tpLevels].sort((a, b) =>
    side === 'long' ? a.price - b.price : b.price - a.price
  )
  let slTriggered = false
  let beTriggered = false
  let currentSL = stopLoss

  for (const c of candles) {
    if (slTriggered) break
    const time = new Date(c.openTime).toISOString()

    for (let i = pendingTPs.length - 1; i >= 0; i--) {
      const tp = pendingTPs[i]
      const hit = side === 'long' ? c.high >= tp.price : c.low <= tp.price
      if (hit) {
        events.push({
          event_type: 'tp_hit',
          event_time: time,
          price: tp.price,
          size_percent: tp.quantity_percent,
          note: 'Automatisch aus Kerzen erkannt',
        })
        pendingTPs.splice(i, 1)
      }
    }

    if (!beTriggered && beTriggerPrice != null) {
      const beHit = side === 'long' ? c.high >= beTriggerPrice : c.low <= beTriggerPrice
      if (beHit) {
        events.push({
          event_type: 'sl_moved_to_be',
          event_time: time,
          price: entry,
          size_percent: null,
          note: 'Automatisch aus Kerzen erkannt',
        })
        beTriggered = true
        currentSL = entry
      }
    }

    const slHit = side === 'long' ? c.low <= currentSL : c.high >= currentSL
    if (slHit) {
      events.push({
        event_type: 'sl_hit',
        event_time: time,
        price: currentSL,
        size_percent: null,
        note: beTriggered ? 'Automatisch aus Kerzen erkannt (nach Break Even)' : 'Automatisch aus Kerzen erkannt',
      })
      slTriggered = true
    }
  }

  return events.sort((a, b) => a.event_time.localeCompare(b.event_time))
}

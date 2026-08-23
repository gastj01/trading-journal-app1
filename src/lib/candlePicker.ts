import { fetchCandles, normalizeSymbol, type Candle, type BinanceMarket } from './binance'

export type TimeWindow = 'full' | 'morning' | 'afternoon' | 'night'
export type TouchType = 'all' | 'bounce' | 'breakout'
export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h'

export function getWindowMs(dateStr: string, window: TimeWindow): [number, number] {
  const parts = dateStr.split('.')
  if (parts.length !== 3) return [0, 0]
  const [day, month, year] = parts
  const base = `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`

  if (window === 'night') {
    const start = new Date(`${base}T18:00:00`)
    const nextDay = new Date(`${base}T00:00:00`)
    nextDay.setDate(nextDay.getDate() + 1)
    nextDay.setHours(6, 0, 0, 0)
    return [start.getTime(), nextDay.getTime()]
  }

  const hours: Record<Exclude<TimeWindow, 'night'>, [number, number]> = {
    full: [0, 23],
    morning: [6, 12],
    afternoon: [12, 18],
  }
  const [sh, eh] = hours[window as Exclude<TimeWindow, 'night'>]
  const start = new Date(`${base}T${String(sh).padStart(2, '0')}:00:00`)
  const end = new Date(`${base}T${String(eh).padStart(2, '0')}:59:59`)
  return [start.getTime(), end.getTime()]
}

export function filterCandles(
  candles: Candle[],
  price: number,
  side: 'long' | 'short',
  touchType: TouchType,
): Candle[] {
  return candles.filter(c => {
    if (c.low > price || c.high < price) return false
    if (touchType === 'all') return true
    if (touchType === 'bounce') {
      return side === 'long' ? c.close > price : c.close < price
    }
    // breakout: candle crossed through the price level
    return side === 'long'
      ? c.open < price && c.close >= price
      : c.open > price && c.close <= price
  })
}

export async function findCandlesTouchingPrice(
  symbol: string,
  interval: CandleInterval,
  price: number,
  side: 'long' | 'short',
  touchType: TouchType,
  dateStr: string,
  window: TimeWindow,
  market: BinanceMarket = 'futures',
): Promise<Candle[]> {
  const sym = normalizeSymbol(symbol)
  const [startMs, endMs] = getWindowMs(dateStr, window)
  if (!startMs) throw new Error('Ungültiges Datum')
  const candles = await fetchCandles(sym, interval, startMs, endMs, market)
  return filterCandles(candles, price, side, touchType)
}

export function touchLabel(c: Candle, price: number, side: 'long' | 'short'): string {
  if (c.open < price && c.close >= price) return 'Breakout ↑'
  if (c.open > price && c.close <= price) return 'Breakout ↓'
  if (c.low <= price && c.close > price && side === 'long') return 'Wick Bounce ↑'
  if (c.high >= price && c.close < price && side === 'short') return 'Wick Rejection ↓'
  return 'Berührt'
}

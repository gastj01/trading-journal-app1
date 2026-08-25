import { fetchCandles, normalizeSymbol, type BinanceMarket } from './binance'

export type Regime = 'trend' | 'range' | 'transition'

const LOOKBACK_DAYS = 20
const TREND_THRESHOLD = 0.35
const RANGE_THRESHOLD = 0.2
const DAY_MS = 86400000

function dateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function classify(er: number): Regime {
  if (er >= TREND_THRESHOLD) return 'trend'
  if (er < RANGE_THRESHOLD) return 'range'
  return 'transition'
}

// Kaufman's Efficiency Ratio über LOOKBACK_DAYS Tageskerzen: Netto-Bewegung
// (Close heute vs. Close vor N Tagen) geteilt durch die Summe der
// Tagesbewegungen dazwischen. Nah 1 = geradliniger Trend, nah 0 =
// Rauschen/Range - deutlich einfacher robust zu berechnen als Wilder's ADX
// (keine rekursive Glättungs-Initialisierung nötig). Bewusst auf
// Tagesbasis, nicht auf den 1m-Kerzen der Trades selbst - gefragt ist die
// übergeordnete Marktphase, nicht das Minuten-Rauschen im Trade selbst.
export async function buildDailyRegimeMap(
  symbol: string,
  fromMs: number,
  toMs: number,
  market: BinanceMarket,
): Promise<Map<string, Regime>> {
  const sym = normalizeSymbol(symbol)
  const bufferedFrom = fromMs - (LOOKBACK_DAYS + 5) * DAY_MS
  const candles = await fetchCandles(sym, '1d', bufferedFrom, toMs + DAY_MS, market)
  const map = new Map<string, Regime>()

  for (let i = LOOKBACK_DAYS; i < candles.length; i++) {
    const window = candles.slice(i - LOOKBACK_DAYS, i + 1)
    const netMove = Math.abs(window[window.length - 1].close - window[0].close)
    let sumMoves = 0
    for (let j = 1; j < window.length; j++) {
      sumMoves += Math.abs(window[j].close - window[j - 1].close)
    }
    const er = sumMoves > 0 ? netMove / sumMoves : 0
    map.set(dateKey(candles[i].openTime), classify(er))
  }
  return map
}

export const REGIME_TAG_NAMES: Record<Regime, string> = {
  trend: 'Regime_Trend',
  range: 'Regime_Range',
  transition: 'Regime_Uebergang',
}

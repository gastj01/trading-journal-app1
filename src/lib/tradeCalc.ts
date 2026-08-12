import type { Trade, ManagementEvent } from '../types'

export function calcWeightedR(
  trade: Trade,
  events: ManagementEvent[],
): number | null {
  const risk = Math.abs(trade.entry_price - trade.stop_loss)
  if (risk === 0 || !trade.exit_price) return null
  const isLong = trade.side === 'long'

  const partials = [...events]
    .filter(ev =>
      (ev.event_type === 'tp_hit' || ev.event_type === 'partial_close') &&
      ev.size_percent != null && ev.price != null,
    )
    .sort((a, b) => a.event_time.localeCompare(b.event_time))

  if (partials.length === 0) {
    const pnl = isLong
      ? trade.exit_price - trade.entry_price
      : trade.entry_price - trade.exit_price
    return pnl / risk
  }

  let remaining = 1.0
  let totalR = 0

  for (const ev of partials) {
    const fraction = remaining * (ev.size_percent! / 100)
    const evR = isLong
      ? (ev.price! - trade.entry_price) / risk
      : (trade.entry_price - ev.price!) / risk
    totalR += evR * fraction
    remaining -= fraction
  }

  if (remaining > 0.001) {
    const finalR = isLong
      ? (trade.exit_price - trade.entry_price) / risk
      : (trade.entry_price - trade.exit_price) / risk
    totalR += finalR * remaining
  }

  return totalR
}

import type { Trade, TagDefinition, StrategyProfile, ManagementEvent } from '../types'
import type { MFEMAEResult } from './binance'
import { calcWeightedR } from './tradeCalc'

const EVENT_LABELS_DE: Record<string, string> = {
  sl_moved_to_be: 'SL → Break Even',
  sl_moved_manual: 'SL verschoben',
  partial_close: 'Teilverkauf',
  tp_hit: 'TP getroffen',
  manual_exit: 'Manueller Exit',
  sl_hit: 'SL getroffen',
  note: 'Notiz',
  limit_placed: 'Limit gesetzt',
  limit_filled: 'Limit gefüllt',
  tp_moved_manual: 'TP verschoben',
}

export function buildAnalysisPrompt(
  trade: Trade,
  tags: TagDefinition[],
  ohlcv: MFEMAEResult | null,
  strategy?: StrategyProfile | null,
  events?: ManagementEvent[],
): string {
  const risk = Math.abs(trade.entry_price - trade.stop_loss)
  // calcWeightedR accounts for partial closes/BE moves via events, matching
  // the R-multiple shown everywhere else in the app (trade detail banner,
  // Analytics) - a naive exit-vs-entry diff disagreed for trades with
  // partial fills.
  const rMultiple = trade.exit_price != null ? calcWeightedR(trade, events ?? []) : null

  const tagNames = tags.map(t => `${t.tag_type}: ${t.name.replace(/_/g, ' ')}`).join(', ')

  const mfeSection = ohlcv
    ? `MFE: ${ohlcv.mfe.toFixed(2)}R (Preis: ${ohlcv.mfePrice})\nMAE: ${ohlcv.mae.toFixed(2)}R (Preis: ${ohlcv.maePrice})\nAnzahl Kerzen: ${ohlcv.candles.length}`
    : 'Keine OHLCV-Daten verfügbar'

  const exitSection = rMultiple !== null
    ? `Exit: ${trade.exit_price} → ${rMultiple > 0 ? '+' : ''}${rMultiple.toFixed(2)}R`
    : 'Noch offen'

  const strategySection = strategy?.description
    ? `\nSTRATEGIE-PROFIL: "${strategy.name}"\n${strategy.description}\n`
    : ''

  const managementSection = events && events.length > 0
    ? `\nTRADE-MANAGEMENT (Verlauf):\n${events.map(ev => {
        const time = new Date(ev.event_time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        const label = EVENT_LABELS_DE[ev.event_type] ?? ev.event_type
        const price = ev.price ? ` @ ${ev.price}` : ''
        const size = ev.size_percent ? ` (${ev.size_percent}%)` : ''
        const note = ev.note ? ` — ${ev.note}` : ''
        return `- ${time}: ${label}${price}${size}${note}`
      }).join('\n')}\n`
    : ''

  const hasManagement = !!managementSection
  const hasStrategy = !!strategy?.description

  return `Du bist ein erfahrener Trading-Coach. Analysiere diesen Trade objektiv und präzise auf Deutsch.${hasStrategy ? ' Vergleiche den Trade mit den Strategie-Regeln und weise auf Abweichungen hin.' : ''}${hasManagement ? ' Bewerte auch das Trade-Management (SL-Verschiebungen, Teilverkäufe, Exits).' : ''}

${strategySection}TRADE-DATEN:
Symbol: ${trade.symbol} | Seite: ${trade.side.toUpperCase()} | Timeframe: ${trade.timeframe ?? '—'}
Entry: ${trade.entry_price} | Stop Loss: ${trade.stop_loss} | Risiko: ${risk.toFixed(4)} (${trade.risk_percent}%)
Positionsgrösse: ${trade.position_size ?? '—'}
${exitSection}
Status: ${trade.status}
Datenqualität: ${trade.trade_data_quality ?? 'nicht angegeben'}
${managementSection}
OHLCV-ANALYSE (Binance):
${mfeSection}

SETUP & NOTIZEN:
Setup: ${trade.setup || '—'}
Notizen: ${trade.notes || '—'}

TAGS: ${tagNames || '—'}

Gib eine strukturierte Analyse mit diesen Punkten:
1. **Entry-Qualität** — War der Entry gut gewählt? (MAE als Hinweis auf Timing)
2. **Stop Loss** — War der SL sinnvoll platziert?
3. **Exit-Timing** — Wurde das Potential ausgeschöpft? (MFE vs. tatsächlicher Exit)
${hasManagement ? '4. **Trade-Management** — War SL-Verschiebung/Teilverkauf sinnvoll und zum richtigen Zeitpunkt?\n' : ''}${hasStrategy ? `${hasManagement ? '5' : '4'}. **Strategie-Regelkonformität** — Welche Regeln wurden befolgt, welche verletzt?\n${hasManagement ? '6' : '5'}. **Fehler & Muster** — Was lief falsch, was gut?\n${hasManagement ? '7' : '6'}. **Verbesserung** — Eine konkrete Empfehlung für den nächsten Trade dieser Art` : `${hasManagement ? '5' : '4'}. **Fehler & Muster** — Was lief falsch, was gut?\n${hasManagement ? '6' : '5'}. **Verbesserung** — Eine konkrete Empfehlung für den nächsten Trade dieser Art`}

Halte dich kurz und direkt. Kein Intro, keine Zusammenfassung am Ende.`
}

export async function analyzeTradeWithClaude(
  apiKey: string,
  trade: Trade,
  tags: TagDefinition[],
  ohlcv: MFEMAEResult | null,
  strategy?: StrategyProfile | null,
  customPrompt?: string,
  events?: ManagementEvent[],
): Promise<string> {
  const prompt = customPrompt ?? buildAnalysisPrompt(trade, tags, ohlcv, strategy, events)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3072,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Claude API ${res.status}: ${body}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? 'Keine Antwort erhalten.'
}

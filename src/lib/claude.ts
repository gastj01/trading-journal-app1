import type { Trade, TagDefinition, StrategyProfile } from '../types'
import type { MFEMAEResult } from './binance'

export async function analyzeTradeWithClaude(
  apiKey: string,
  trade: Trade,
  tags: TagDefinition[],
  ohlcv: MFEMAEResult | null,
  strategy?: StrategyProfile | null,
): Promise<string> {
  const risk = Math.abs(trade.entry_price - trade.stop_loss)
  const rMultiple = trade.exit_price && risk > 0
    ? ((trade.side === 'long' ? trade.exit_price - trade.entry_price : trade.entry_price - trade.exit_price) / risk)
    : null

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

  const prompt = `Du bist ein erfahrener Trading-Coach. Analysiere diesen Trade objektiv und präzise auf Deutsch.${strategySection ? ' Vergleiche den Trade mit den Strategie-Regeln und weise auf Abweichungen hin.' : ''}

${strategySection}
TRADE-DATEN:
Symbol: ${trade.symbol} | Seite: ${trade.side.toUpperCase()} | Timeframe: ${trade.timeframe ?? '—'}
Entry: ${trade.entry_price} | Stop Loss: ${trade.stop_loss} | Risiko: ${risk.toFixed(4)} (${trade.risk_percent}%)
${exitSection}
Status: ${trade.status}
Datenqualität: ${trade.trade_data_quality ?? 'nicht angegeben'}

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
${strategy?.description ? '4. **Strategie-Regelkonformität** — Welche Regeln wurden befolgt, welche verletzt?\n5. **Fehler & Muster** — Was lief falsch, was gut?\n6. **Verbesserung** — Eine konkrete Empfehlung für den nächsten Trade dieser Art' : '4. **Fehler & Muster** — Was lief falsch, was gut?\n5. **Verbesserung** — Eine konkrete Empfehlung für den nächsten Trade dieser Art'}

Halte dich kurz und direkt. Kein Intro, keine Zusammenfassung am Ende.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
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

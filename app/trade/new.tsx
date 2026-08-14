import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import { nowDateStr, nowTimeStr, parseDateTimeToISO } from '../../src/lib/datetime'
import { DateTimeInputs } from '../../src/components/DateTimeInputs'
import { CandleTimePicker } from '../../src/components/CandleTimePicker'
import type { TradingAccount, StrategyProfile, TagDefinition, ChecklistItem } from '../../src/types'

export default function NewTradeScreen() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [stratTagLinks, setStratTagLinks] = useState<{ tag_id: string; strategy_id: string }[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showCandlePicker, setShowCandlePicker] = useState(false)
  const [tpLevels, setTpLevels] = useState<{ price: string; qty: string }[]>([])
  const [bePrice, setBePrice] = useState('')
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())

  const [form, setForm] = useState({
    account_id: '',
    strategy_id: '',
    symbol: 'BTCUSDT',
    exchange: 'binance_futures',
    timeframe: '5m',
    side: 'long' as 'long' | 'short',
    entry_price: '',
    stop_loss: '',
    risk_percent: '1',
    setup: '',
    notes: '',
    trade_data_quality: 'live' as string,
    position_size: '',
    trade_date: nowDateStr(),
    trade_time: nowTimeStr(),
  })

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: accs }, { data: strats }, { data: tagDefs }, { data: links }] = await Promise.all([
        supabase.from('trading_accounts').select('*').eq('user_id', user.id).eq('is_active', true),
        supabase.from('strategy_profiles').select('*').eq('user_id', user.id),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
        supabase.from('strategy_tag_links').select('tag_id, strategy_id').eq('user_id', user.id),
      ])
      const accList = accs ?? []
      setAccounts(accList)
      setStrategies(strats ?? [])
      setTags(tagDefs ?? [])
      setStratTagLinks(links ?? [])
      const def = accList.find(a => a.is_default)
      if (def) setForm(f => ({ ...f, account_id: def.id, risk_percent: String(def.default_risk_percent) }))
    }
    load()
  }, [])

  async function loadChecklistItems(strategyId: string) {
    if (!strategyId) {
      setChecklistItems([])
      setCheckedItems(new Set())
      return
    }
    const { data } = await supabase
      .from('strategy_checklist_items')
      .select('*')
      .eq('strategy_id', strategyId)
      .eq('is_active', true)
      .order('sort_order')
    setChecklistItems(data ?? [])
    setCheckedItems(new Set())
  }

  function update(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function updateCalc(key: 'entry_price' | 'stop_loss' | 'risk_percent' | 'position_size', value: string) {
    setForm(f => {
      const next = { ...f, [key]: value }
      if (!next.position_size) return next
      const acc = accounts.find(a => a.id === f.account_id)
      const balance = acc?.initial_balance ?? 0
      if (balance <= 0) return next
      const entry = parseFloat(next.entry_price) || 0
      const sl = parseFloat(next.stop_loss) || 0
      const riskPerUnit = Math.abs(entry - sl)
      const posSize = parseFloat(next.position_size) || 0
      if (posSize > 0 && riskPerUnit > 0 && key !== 'risk_percent') {
        next.risk_percent = ((posSize * riskPerUnit / balance) * 100).toFixed(2)
      }
      return next
    })
  }

  function selectStrategy(stratId: string) {
    const strat = strategies.find(s => s.id === stratId)
    setForm(f => ({
      ...f,
      strategy_id: stratId,
      ...(strat?.default_timeframe ? { timeframe: strat.default_timeframe } : {}),
    }))
    setRulesExpanded(!!(strat?.description))
    loadChecklistItems(stratId)
  }

  function toggleChecked(itemId: string) {
    setCheckedItems(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function toggleTag(id: string) {
    setSelectedTagIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  async function handleSave() {
    if (!form.entry_price || !form.stop_loss || !form.account_id) {
      Alert.alert('Fehler', 'Entry, SL und Konto sind Pflichtfelder.')
      return
    }

    // Validate TP percentages before touching the DB
    const validTps = tpLevels.filter(tp => {
      const p = parseFloat(tp.price); const q = parseFloat(tp.qty)
      return !isNaN(p) && p > 0 && !isNaN(q) && q > 0
    })
    if (validTps.length > 0) {
      const totalPct = validTps.reduce((sum, tp) => sum + parseFloat(tp.qty), 0)
      if (Math.abs(totalPct - 100) > 2) {
        Alert.alert('TP-Fehler', `TP-Anteile ergeben ${totalPct.toFixed(1)}% — müssen zusammen ~100% ergeben.`)
        return
      }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setSaving(false)
      Alert.alert('Fehler', 'Session abgelaufen. Bitte neu einloggen.')
      return
    }

    const entry = parseFloat(form.entry_price)
    const sl = parseFloat(form.stop_loss)
    const riskPct = parseFloat(form.risk_percent)
    const acc = accounts.find(a => a.id === form.account_id)
    const riskAmount = acc ? (acc.initial_balance * riskPct) / 100 : 0
    const riskPerUnit = Math.abs(entry - sl)
    const posSize = form.position_size
      ? parseFloat(form.position_size)
      : riskPerUnit > 0 ? riskAmount / riskPerUnit : 0

    const openedAt = parseDateTimeToISO(form.trade_date, form.trade_time)

    setSaving(true)
    const { data: tradeData, error } = await supabase.from('trades').insert({
      user_id: user.id,
      account_id: form.account_id,
      strategy_id: form.strategy_id || null,
      symbol: form.symbol.toUpperCase(),
      market: 'crypto',
      exchange: form.exchange,
      timeframe: form.timeframe,
      side: form.side,
      status: 'open',
      entry_price: entry,
      stop_loss: sl,
      exit_price: null,
      break_even: false,
      position_size: posSize,
      risk_amount: riskAmount,
      risk_percent: riskPct,
      leverage: acc?.default_leverage ?? 1,
      setup: form.setup,
      notes: form.notes,
      trade_data_quality: form.trade_data_quality,
      opened_at: openedAt,
    }).select().single()

    if (error) {
      setSaving(false)
      Alert.alert('Fehler', error.message)
      return
    }

    if (selectedTagIds.length > 0 && tradeData) {
      await supabase.from('trade_tag_assignments').insert(
        selectedTagIds.map(tag_id => ({ tag_id, trade_id: tradeData.id, user_id: user.id }))
      )
    }

    if (checklistItems.length > 0 && tradeData) {
      await supabase.from('trade_checklist_responses').insert(
        checklistItems.map(item => ({
          user_id: user.id,
          trade_id: tradeData.id,
          checklist_item_id: item.id,
          status: checkedItems.has(item.id) ? 'checked' : 'unchecked',
        }))
      )
    }

    // TPs + BE trigger
    if (tradeData) {
      const ppRows: any[] = []
      tpLevels.forEach((tp, i) => {
        const p = parseFloat(tp.price)
        const q = parseFloat(tp.qty)
        if (!isNaN(p) && p > 0 && !isNaN(q) && q > 0) {
          ppRows.push({ trade_id: tradeData.id, user_id: user.id, label: `TP${i + 1}`, target_price: p, quantity_percent: q / 100, filled: false })
        }
      })
      const beParsed = parseFloat(bePrice)
      if (bePrice && !isNaN(beParsed) && beParsed > 0) {
        ppRows.push({ trade_id: tradeData.id, user_id: user.id, label: 'BE', target_price: beParsed, quantity_percent: 0, filled: false })
      }
      if (ppRows.length > 0) {
        const { error: ppError } = await supabase.from('trade_partial_profits').insert(ppRows)
        if (ppError) {
          // Rollback: delete the trade so no orphan data remains
          await supabase.from('trades').delete().eq('id', tradeData.id)
          setSaving(false)
          Alert.alert('TP/BE Fehler', ppError.message + '\n\nTrade wurde nicht gespeichert.')
          return
        }
      }
    }

    setSaving(false)
    router.back()
  }

  const selectedStrategy = strategies.find(s => s.id === form.strategy_id)

  // Live calculation
  const selectedAcc = accounts.find(a => a.id === form.account_id)
  const calcBalance = selectedAcc?.initial_balance ?? 0
  const calcEntry = parseFloat(form.entry_price) || 0
  const calcSL = parseFloat(form.stop_loss) || 0
  const calcRiskPct = parseFloat(form.risk_percent) || 0
  const calcRiskPerUnit = Math.abs(calcEntry - calcSL)
  const calcRiskAmount = calcBalance > 0 ? (calcBalance * calcRiskPct) / 100 : 0
  const calcAutoPos = calcRiskPerUnit > 0 && calcRiskAmount > 0 ? calcRiskAmount / calcRiskPerUnit : 0
  const isManualPos = !!form.position_size

  // Compute filtered tags based on selected strategy
  const linkedTagIds = stratTagLinks
    .filter(l => l.strategy_id === form.strategy_id)
    .map(l => l.tag_id)
  const anyLinkedTagIds = new Set(stratTagLinks.map(l => l.tag_id))
  const filteredTags = tags.filter(
    t => !form.strategy_id || linkedTagIds.includes(t.id) || !anyLinkedTagIds.has(t.id)
  )

  const tagsByType = {
    mistake: filteredTags.filter(t => t.tag_type === 'mistake'),
    execution: filteredTags.filter(t => t.tag_type === 'execution'),
    context: filteredTags.filter(t => t.tag_type === 'context'),
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </TouchableOpacity>
        <Text style={s.title}>Neuer Trade</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Label text="Konto" />
        <View style={s.optionRow}>
          {accounts.map(acc => (
            <TouchableOpacity
              key={acc.id}
              style={[s.option, form.account_id === acc.id && s.optionActive]}
              onPress={() => update('account_id', acc.id)}
            >
              <Text style={[s.optionText, form.account_id === acc.id && s.optionTextActive]}>{acc.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Label text="Richtung" />
        <View style={s.optionRow}>
          <TouchableOpacity style={[s.option, s.optionLong, form.side === 'long' && s.optionLongActive]} onPress={() => update('side', 'long')}>
            <Text style={[s.optionText, form.side === 'long' && s.green]}>▲ LONG</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.option, s.optionShort, form.side === 'short' && s.optionShortActive]} onPress={() => update('side', 'short')}>
            <Text style={[s.optionText, form.side === 'short' && s.red]}>▼ SHORT</Text>
          </TouchableOpacity>
        </View>

        <View style={s.row2}>
          <View style={{ flex: 2 }}>
            <Label text="Symbol" />
            <Input value={form.symbol} onChangeText={v => update('symbol', v)} autoCapitalize="characters" />
          </View>
          <View style={{ flex: 1 }}>
            <Label text="Timeframe" />
            <Input value={form.timeframe} onChangeText={v => update('timeframe', v)} />
          </View>
        </View>

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Label text="Entry" />
            <Input value={form.entry_price} onChangeText={v => updateCalc('entry_price', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Label text="Stop Loss" />
            <Input value={form.stop_loss} onChangeText={v => updateCalc('stop_loss', v)} keyboardType="decimal-pad" />
          </View>
        </View>

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Label text="Risiko %" />
            <Input value={form.risk_percent} onChangeText={v => updateCalc('risk_percent', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Label text="Positionsgrösse (opt.)" />
            <Input value={form.position_size} onChangeText={v => updateCalc('position_size', v)} keyboardType="decimal-pad" placeholder={calcAutoPos > 0 ? calcAutoPos.toFixed(4) : 'auto'} />
          </View>
        </View>
        {(calcRiskAmount > 0 || calcAutoPos > 0) && (
          <View style={s.calcRow}>
            <Text style={s.calcText}>Risiko $: {calcRiskAmount.toFixed(2)}</Text>
            {!isManualPos && calcAutoPos > 0 && (
              <Text style={s.calcTextMuted}>Pos (auto): {calcAutoPos.toFixed(4)}</Text>
            )}
          </View>
        )}

        <Label text="Take-Profit Levels" />
        {tpLevels.map((tp, i) => (
          <View key={i} style={s.tpRow}>
            <View style={{ flex: 2 }}>
              <Input value={tp.price} onChangeText={v => setTpLevels(prev => prev.map((t, j) => j === i ? { ...t, price: v } : t))} keyboardType="decimal-pad" placeholder={`TP${i + 1} Preis`} />
            </View>
            <View style={{ flex: 1 }}>
              <Input value={tp.qty} onChangeText={v => setTpLevels(prev => prev.map((t, j) => j === i ? { ...t, qty: v } : t))} keyboardType="decimal-pad" placeholder="%" />
            </View>
            <TouchableOpacity onPress={() => setTpLevels(prev => prev.filter((_, j) => j !== i))} style={s.tpRemove}>
              <Feather name="x" size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={s.addTpBtn} onPress={() => setTpLevels(prev => [...prev, { price: '', qty: '' }])}>
          <Feather name="plus" size={14} color="#22c55e" />
          <Text style={s.addTpText}>TP hinzufügen</Text>
        </TouchableOpacity>

        <Label text="Break Even bei Preis (optional)" />
        <Input value={bePrice} onChangeText={setBePrice} keyboardType="decimal-pad" placeholder="Preis bei dem SL auf BE gesetzt wird" />

        {strategies.length > 0 && (
          <>
            <Label text="Strategie" />
            <View style={s.optionRow}>
              <TouchableOpacity
                style={[s.option, !form.strategy_id && s.optionActive]}
                onPress={() => { update('strategy_id', ''); setRulesExpanded(false); loadChecklistItems('') }}
              >
                <Text style={[s.optionText, !form.strategy_id && s.optionTextActive]}>Keine</Text>
              </TouchableOpacity>
              {strategies.map(st => (
                <TouchableOpacity
                  key={st.id}
                  style={[s.option, form.strategy_id === st.id && s.optionActive]}
                  onPress={() => selectStrategy(st.id)}
                >
                  <Text style={[s.optionText, form.strategy_id === st.id && s.optionTextActive]}>{st.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {selectedStrategy?.description ? (
              <TouchableOpacity style={s.rulesBox} onPress={() => setRulesExpanded(v => !v)} activeOpacity={0.8}>
                <View style={s.rulesHeader}>
                  <Text style={s.rulesTitle}>Strategie-Regeln</Text>
                  <Feather name={rulesExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#555" />
                </View>
                {rulesExpanded && (
                  <Text style={s.rulesText}>{selectedStrategy.description}</Text>
                )}
              </TouchableOpacity>
            ) : null}

            {checklistItems.length > 0 && (
              <View style={s.checklistSection}>
                <Text style={s.checklistSectionTitle}>Checkliste</Text>
                {checklistItems.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={s.checklistRow}
                    onPress={() => toggleChecked(item.id)}
                    activeOpacity={0.7}
                  >
                    <Feather
                      name={checkedItems.has(item.id) ? 'check-square' : 'square'}
                      size={20}
                      color={checkedItems.has(item.id) ? '#22c55e' : '#555'}
                    />
                    <Text style={[s.checklistItemTitle, checkedItems.has(item.id) && s.checklistItemChecked]}>
                      {item.title}
                    </Text>
                    {item.category ? (
                      <View style={s.catBadge}>
                        <Text style={s.catBadgeText}>{item.category}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <Label text="Datenqualität" />
        <View style={s.optionRow}>
          {([
            { value: 'live', label: 'Live (exakt)' },
            { value: 'approx', label: 'Live (ca.)' },
            { value: 'visual_backtest', label: 'Backtest' },
            { value: 'managed_live', label: 'Live (managed)' },
          ] as const).map(q => (
            <TouchableOpacity
              key={q.value}
              style={[s.option, form.trade_data_quality === q.value && s.optionActive]}
              onPress={() => update('trade_data_quality', q.value)}
            >
              <Text style={[s.optionText, form.trade_data_quality === q.value && s.optionTextActive]}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Label text="Handelszeitpunkt" />
        <DateTimeInputs
          date={form.trade_date} time={form.trade_time}
          onDateChange={v => update('trade_date', v)}
          onTimeChange={v => update('trade_time', v)}
        />
        {!!form.entry_price && !!form.symbol && (
          <TouchableOpacity style={s.candleBtn} onPress={() => setShowCandlePicker(true)}>
            <Feather name="clock" size={14} color="#3b82f6" />
            <Text style={s.candleBtnTxt}>Genauen Zeitpunkt aus Kerzen suchen</Text>
          </TouchableOpacity>
        )}

        <Label text="Setup" />
        <Input value={form.setup} onChangeText={v => update('setup', v)} placeholder="z.B. HTF Zone + M5 Reaction" />

        <Label text="Notizen" />
        <Input value={form.notes} onChangeText={v => update('notes', v)} multiline numberOfLines={3} />

        {filteredTags.length > 0 && (
          <>
            <Label text="Tags" />
            {Object.entries(tagsByType).map(([type, list]) =>
              list.length > 0 ? (
                <View key={type} style={s.tagSection}>
                  <Text style={s.tagTypeLabel}>
                    {type === 'mistake' ? '⚠️ Fehler' : type === 'execution' ? '✅ Ausführung' : '📍 Kontext'}
                  </Text>
                  <View style={s.optionRow}>
                    {list.map(tag => (
                      <TouchableOpacity
                        key={tag.id}
                        style={[s.tagChip, selectedTagIds.includes(tag.id) && s.tagChipActive]}
                        onPress={() => toggleTag(tag.id)}
                      >
                        <Text style={[s.tagChipText, selectedTagIds.includes(tag.id) && s.tagChipTextActive]}>
                          {tag.name.replace(/_/g, ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null
            )}
          </>
        )}
      </ScrollView>

      <CandleTimePicker
        visible={showCandlePicker}
        symbol={form.symbol}
        price={parseFloat(form.entry_price) || 0}
        side={form.side}
        initialDate={form.trade_date}
        onSelect={candle => {
          const d = new Date(candle.openTime)
          const pad = (n: number) => String(n).padStart(2, '0')
          const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
          const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`
          update('trade_date', dateStr)
          update('trade_time', timeStr)
        }}
        onClose={() => setShowCandlePicker(false)}
      />
    </SafeAreaView>
  )
}

function Label({ text }: { text: string }) {
  return <Text style={s.label}>{text}</Text>
}

function Input({ multiline, numberOfLines, ...props }: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      style={[s.input, multiline && { height: 80, textAlignVertical: 'top' }]}
      placeholderTextColor="#555"
      {...props}
      multiline={multiline}
      numberOfLines={numberOfLines}
    />
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  closeBtn: { padding: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  saveBtn: { backgroundColor: '#22c55e', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 160, gap: 4 },
  label: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  row2: { flexDirection: 'row', gap: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  optionActive: { backgroundColor: '#1e3a2f', borderColor: '#22c55e' },
  optionLong: {},
  optionLongActive: { backgroundColor: '#052e16', borderColor: '#22c55e' },
  optionShort: {},
  optionShortActive: { backgroundColor: '#2d0a0a', borderColor: '#ef4444' },
  optionText: { color: '#888', fontSize: 13, fontWeight: '600' },
  optionTextActive: { color: '#22c55e' },
  green: { color: '#22c55e' },
  red: { color: '#ef4444' },
  rulesBox: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  rulesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rulesTitle: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  rulesText: { color: '#777', fontSize: 13, lineHeight: 20, marginTop: 8 },
  tagSection: { marginTop: 8 },
  tagTypeLabel: { color: '#666', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  tagChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  tagChipActive: { backgroundColor: '#1a2a3a', borderColor: '#3b82f6' },
  tagChipText: { color: '#888', fontSize: 13 },
  tagChipTextActive: { color: '#60a5fa' },
  tpRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  tpRemove: { padding: 8 },
  addTpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addTpText: { color: '#22c55e', fontSize: 13, fontWeight: '600' },
  calcRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 2, marginTop: 4 },
  calcText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  calcTextMuted: { color: '#555', fontSize: 12 },
  // Checklist
  checklistSection: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  checklistSectionTitle: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#252525' },
  checklistItemTitle: { color: '#ccc', fontSize: 14, flex: 1 },
  checklistItemChecked: { color: '#22c55e' },
  catBadge: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  catBadgeText: { color: '#888', fontSize: 11 },
  candleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 2 },
  candleBtnTxt: { color: '#3b82f6', fontSize: 13, fontWeight: '600' },
})

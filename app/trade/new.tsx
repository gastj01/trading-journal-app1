import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'
import type { TradingAccount, StrategyProfile, TagDefinition } from '../../src/types'

export default function NewTradeScreen() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [stratTagLinks, setStratTagLinks] = useState<{ tag_id: string; strategy_id: string }[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [saving, setSaving] = useState(false)

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

  function update(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function selectStrategy(stratId: string) {
    setForm(f => ({ ...f, strategy_id: stratId }))
    const strat = strategies.find(s => s.id === stratId)
    setRulesExpanded(!!(strat?.description))
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const entry = parseFloat(form.entry_price)
    const sl = parseFloat(form.stop_loss)
    const riskPct = parseFloat(form.risk_percent)
    const acc = accounts.find(a => a.id === form.account_id)
    const riskAmount = acc ? (acc.initial_balance * riskPct) / 100 : 0
    const riskPerUnit = Math.abs(entry - sl)
    const posSize = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0

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
      opened_at: new Date().toISOString(),
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

    setSaving(false)
    router.back()
  }

  const selectedStrategy = strategies.find(s => s.id === form.strategy_id)

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
            <Input value={form.entry_price} onChangeText={v => update('entry_price', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Label text="Stop Loss" />
            <Input value={form.stop_loss} onChangeText={v => update('stop_loss', v)} keyboardType="decimal-pad" />
          </View>
        </View>

        <Label text="Risiko %" />
        <Input value={form.risk_percent} onChangeText={v => update('risk_percent', v)} keyboardType="decimal-pad" />

        {strategies.length > 0 && (
          <>
            <Label text="Strategie" />
            <View style={s.optionRow}>
              <TouchableOpacity
                style={[s.option, !form.strategy_id && s.optionActive]}
                onPress={() => { update('strategy_id', ''); setRulesExpanded(false) }}
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
          </>
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
  content: { padding: 16, paddingBottom: 60, gap: 4 },
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
})

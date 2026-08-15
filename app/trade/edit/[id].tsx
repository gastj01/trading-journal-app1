import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import { supabase } from '../../../src/lib/supabase'
import { isoToDateStr, isoToTimeStr, parseDateTimeToISO } from '../../../src/lib/datetime'
import { DateTimeInputs } from '../../../src/components/DateTimeInputs'
import { CandleTimePicker } from '../../../src/components/CandleTimePicker'
import { normalizeSymbol } from '../../../src/lib/binance'
import type { Trade, TagDefinition, StrategyProfile, ChecklistItem } from '../../../src/types'

export default function EditTradeScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [accountBalance, setAccountBalance] = useState(0)
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [stratTagLinks, setStratTagLinks] = useState<{ tag_id: string; strategy_id: string }[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [rulesExpanded, setRulesExpanded] = useState(false)
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set())
  const [showEntryPicker, setShowEntryPicker] = useState(false)
  const [tpLevels, setTpLevels] = useState<{ price: string; qty: string }[]>([])
  const [form, setForm] = useState({
    symbol: '',
    side: 'long' as 'long' | 'short',
    timeframe: '',
    entry_price: '',
    stop_loss: '',
    exit_price: '',
    status: 'open' as 'open' | 'closed',
    risk_percent: '',
    setup: '',
    notes: '',
    screenshot_path: '',
    strategy_id: '',
    trade_data_quality: 'live' as string,
    position_size: '',
    opened_at_date: '',
    opened_at_time: '',
  })

  useEffect(() => {
    async function load() {
      if (!id) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data }, { data: tagDefs }, { data: assignments }, { data: strats }, { data: links }, { data: responses }, { data: ppData }] = await Promise.all([
        supabase.from('trades').select('*').eq('id', id).single(),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
        supabase.from('trade_tag_assignments').select('tag_id').eq('trade_id', id),
        supabase.from('strategy_profiles').select('*').eq('user_id', user.id),
        supabase.from('strategy_tag_links').select('tag_id, strategy_id').eq('user_id', user.id),
        supabase.from('trade_checklist_responses').select('checklist_item_id, status').eq('trade_id', id),
        supabase.from('trade_partial_profits').select('*').eq('trade_id', id).order('target_price'),
      ])
      setTpLevels(
        (ppData ?? [])
          .filter((pp: any) => pp.quantity_percent > 0)
          .map((pp: any) => ({ price: String(pp.target_price), qty: String(Math.round(pp.quantity_percent * 100)) }))
      )
      if (!data) return
      setTrade(data)
      // Load account balance for live risk calculation
      if (data.account_id) {
        const { data: acc } = await supabase.from('trading_accounts').select('initial_balance').eq('id', data.account_id).single()
        if (acc) setAccountBalance(acc.initial_balance)
      }
      setTags(tagDefs ?? [])
      setStrategies(strats ?? [])
      setStratTagLinks(links ?? [])
      setSelectedTagIds((assignments ?? []).map((a: any) => a.tag_id))
      const stratId = data.strategy_id ?? ''
      setForm({
        symbol: data.symbol ?? '',
        side: data.side ?? 'long',
        timeframe: data.timeframe ?? '',
        entry_price: String(data.entry_price ?? ''),
        stop_loss: String(data.stop_loss ?? ''),
        exit_price: data.exit_price != null ? String(data.exit_price) : '',
        status: data.status ?? 'open',
        risk_percent: String(data.risk_percent ?? ''),
        setup: data.setup ?? '',
        notes: data.notes ?? '',
        screenshot_path: data.screenshot_path ?? '',
        strategy_id: stratId,
        trade_data_quality: data.trade_data_quality ?? 'live',
        position_size: data.position_size != null ? String(data.position_size) : '',
        opened_at_date: data.opened_at ? isoToDateStr(data.opened_at) : '',
        opened_at_time: data.opened_at ? isoToTimeStr(data.opened_at) : '',
      })
      if (stratId) {
        const strat = (strats ?? []).find((s: StrategyProfile) => s.id === stratId)
        setRulesExpanded(!!(strat?.description))
        // Load checklist items for this strategy
        const { data: items } = await supabase
          .from('strategy_checklist_items')
          .select('*')
          .eq('strategy_id', stratId)
          .eq('is_active', true)
          .order('sort_order')
        setChecklistItems(items ?? [])
        // Pre-populate checked state from existing responses
        const checkedSet = new Set<string>(
          (responses ?? [])
            .filter((r: any) => r.status === 'checked')
            .map((r: any) => r.checklist_item_id)
        )
        setCheckedItems(checkedSet)
      }
    }
    load()
  }, [id])

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
      if (!next.position_size || accountBalance <= 0) return next
      const entry = parseFloat(next.entry_price) || 0
      const sl = parseFloat(next.stop_loss) || 0
      const riskPerUnit = Math.abs(entry - sl)
      const posSize = parseFloat(next.position_size) || 0
      if (posSize > 0 && riskPerUnit > 0 && key !== 'risk_percent') {
        next.risk_percent = ((posSize * riskPerUnit / accountBalance) * 100).toFixed(2)
      }
      return next
    })
  }

  function selectStrategy(stratId: string) {
    setForm(f => ({ ...f, strategy_id: stratId }))
    const strat = strategies.find(s => s.id === stratId)
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

  function toggleTag(tagId: string) {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    )
  }

  async function handlePickScreenshot() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'image/*',
      copyToCacheDirectory: true,
    })
    if (result.canceled) return
    const file = result.assets[0]
    if (!file) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setUploading(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${user.id}/${id}_${Date.now()}.${ext}`

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) throw new Error('Nicht eingeloggt')

      const uploadUrl = `https://rujvwpddxxfbyibvwkgt.supabase.co/storage/v1/object/trade-screenshots/${path}`
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, file.uri, {
        httpMethod: 'POST',
        uploadType: 1, /* MULTIPART */
        fieldName: 'file',
        mimeType: file.mimeType ?? 'image/jpeg',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': 'sb_publishable_vL5irZwQawERH65Q6pxXrA_GfDCrEr2',
          'x-upsert': 'true',
        },
      })
      const upErr = uploadResult.status >= 300 ? { message: `HTTP ${uploadResult.status}: ${uploadResult.body}` } : null

      if (upErr) {
        Alert.alert('Upload-Fehler', upErr.message)
      } else {
        update('screenshot_path', path)
      }
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Unbekannter Fehler')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!form.entry_price || !form.stop_loss) {
      Alert.alert('Fehler', 'Entry und Stop Loss sind Pflichtfelder.')
      return
    }
    if (form.status === 'closed' && !form.exit_price) {
      Alert.alert('Fehler', 'Bei Status "Geschlossen" muss ein Exit-Preis angegeben werden.')
      return
    }
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
    if (!user) return

    setSaving(true)
    const { error } = await supabase.from('trades').update({
      symbol: form.symbol.toUpperCase(),
      side: form.side,
      timeframe: form.timeframe,
      entry_price: parseFloat(form.entry_price),
      stop_loss: parseFloat(form.stop_loss),
      exit_price: form.exit_price ? parseFloat(form.exit_price) : null,
      status: form.status,
      risk_percent: parseFloat(form.risk_percent),
      setup: form.setup,
      notes: form.notes,
      screenshot_path: form.screenshot_path || null,
      trade_data_quality: form.trade_data_quality,
      position_size: form.position_size ? parseFloat(form.position_size) : undefined,
      strategy_id: form.strategy_id || null,
      opened_at: form.opened_at_date ? parseDateTimeToISO(form.opened_at_date, form.opened_at_time) : trade?.opened_at,
      closed_at: form.status === 'closed' ? (trade?.closed_at ?? new Date().toISOString()) : null,
    }).eq('id', id)

    if (error) {
      setSaving(false)
      Alert.alert('Fehler', error.message)
      return
    }

    await supabase.from('trade_tag_assignments').delete().eq('trade_id', id)
    if (selectedTagIds.length > 0) {
      await supabase.from('trade_tag_assignments').insert(
        selectedTagIds.map(tag_id => ({ tag_id, trade_id: id, user_id: user.id }))
      )
    }

    // Save checklist responses
    await supabase.from('trade_checklist_responses').delete().eq('trade_id', id)
    if (checklistItems.length > 0) {
      await supabase.from('trade_checklist_responses').insert(
        checklistItems.map(item => ({
          user_id: user.id,
          trade_id: id,
          checklist_item_id: item.id,
          status: checkedItems.has(item.id) ? 'checked' : 'unchecked',
        }))
      )
    }

    // Save TP levels (delete non-BE entries, reinsert)
    await supabase.from('trade_partial_profits').delete().eq('trade_id', id).gt('quantity_percent', 0)
    const ppRows = tpLevels
      .filter(tp => {
        const p = parseFloat(tp.price); const q = parseFloat(tp.qty)
        return !isNaN(p) && p > 0 && !isNaN(q) && q > 0
      })
      .map((tp, i) => ({
        trade_id: id,
        user_id: user.id,
        label: `TP${i + 1}`,
        target_price: parseFloat(tp.price),
        quantity_percent: parseFloat(tp.qty) / 100,
        filled: false,
      }))
    if (ppRows.length > 0) {
      const { error: ppError } = await supabase.from('trade_partial_profits').insert(ppRows)
      if (ppError) {
        setSaving(false)
        Alert.alert('TP Fehler', ppError.message)
        return
      }
    }

    setSaving(false)
    router.back()
  }

  if (!trade) {
    return (
      <View style={s.loading}>
        <Text style={s.loadingText}>Laden...</Text>
      </View>
    )
  }

  const selectedStrategy = strategies.find(st => st.id === form.strategy_id)

  // Filter tags based on selected strategy
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
        <Text style={s.title}>Trade bearbeiten</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Richtung</Text>
        <View style={s.optionRow}>
          <TouchableOpacity style={[s.option, s.optionLong, form.side === 'long' && s.optionLongActive]} onPress={() => update('side', 'long')}>
            <Text style={[s.optionText, form.side === 'long' && s.green]}>▲ LONG</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.option, s.optionShort, form.side === 'short' && s.optionShortActive]} onPress={() => update('side', 'short')}>
            <Text style={[s.optionText, form.side === 'short' && s.red]}>▼ SHORT</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.label}>Status</Text>
        <View style={s.optionRow}>
          <TouchableOpacity style={[s.option, form.status === 'open' && s.optionActive]} onPress={() => update('status', 'open')}>
            <Text style={[s.optionText, form.status === 'open' && s.optionTextActive]}>Offen</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.option, form.status === 'closed' && s.optionActive]} onPress={() => update('status', 'closed')}>
            <Text style={[s.optionText, form.status === 'closed' && s.optionTextActive]}>Geschlossen</Text>
          </TouchableOpacity>
        </View>

        <View style={s.row2}>
          <View style={{ flex: 2 }}>
            <Text style={s.label}>Symbol</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.symbol} onChangeText={v => update('symbol', v)} autoCapitalize="characters" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Timeframe</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.timeframe} onChangeText={v => update('timeframe', v)} />
          </View>
        </View>

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Entry</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.entry_price} onChangeText={v => updateCalc('entry_price', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Stop Loss</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.stop_loss} onChangeText={v => updateCalc('stop_loss', v)} keyboardType="decimal-pad" />
          </View>
        </View>

        <Text style={s.label}>Exit (optional)</Text>
        <TextInput style={s.input} placeholderTextColor="#555" value={form.exit_price} onChangeText={v => {
          update('exit_price', v)
          if (v) setForm(f => ({ ...f, status: 'closed' }))
        }} keyboardType="decimal-pad" />

        <Text style={s.label}>Take-Profit Levels</Text>
        {tpLevels.map((tp, i) => (
          <View key={i} style={s.tpRow}>
            <View style={{ flex: 2 }}>
              <TextInput style={s.input} placeholderTextColor="#555" value={tp.price} onChangeText={v => setTpLevels(prev => prev.map((t, j) => j === i ? { ...t, price: v } : t))} keyboardType="decimal-pad" placeholder={`TP${i + 1} Preis`} />
            </View>
            <View style={{ flex: 1 }}>
              <TextInput style={s.input} placeholderTextColor="#555" value={tp.qty} onChangeText={v => setTpLevels(prev => prev.map((t, j) => j === i ? { ...t, qty: v } : t))} keyboardType="decimal-pad" placeholder="%" />
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

        {(() => {
          const calcEntry = parseFloat(form.entry_price) || 0
          const calcSL = parseFloat(form.stop_loss) || 0
          const calcRiskPct = parseFloat(form.risk_percent) || 0
          const calcRiskPerUnit = Math.abs(calcEntry - calcSL)
          const calcRiskAmount = accountBalance > 0 ? (accountBalance * calcRiskPct) / 100 : 0
          const calcAutoPos = calcRiskPerUnit > 0 && calcRiskAmount > 0 ? calcRiskAmount / calcRiskPerUnit : 0
          const isManualPos = !!form.position_size
          return (
            <>
              <View style={s.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Risiko %</Text>
                  <TextInput style={s.input} placeholderTextColor="#555" value={form.risk_percent} onChangeText={v => updateCalc('risk_percent', v)} keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Positionsgrösse</Text>
                  <TextInput style={s.input} placeholderTextColor="#555" value={form.position_size} onChangeText={v => updateCalc('position_size', v)} keyboardType="decimal-pad" placeholder={calcAutoPos > 0 ? calcAutoPos.toFixed(4) : 'auto'} />
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
            </>
          )
        })()}

        {strategies.length > 0 && (
          <>
            <Text style={s.label}>Strategie</Text>
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

        <Text style={s.label}>Datenqualität</Text>
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

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={s.label}>Handelszeitpunkt</Text>
          <TouchableOpacity onPress={() => setShowEntryPicker(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Feather name="search" size={14} color="#f59e0b" />
            <Text style={{ color: '#f59e0b', fontSize: 12 }}>Kerze wählen</Text>
          </TouchableOpacity>
        </View>
        <DateTimeInputs
          date={form.opened_at_date} time={form.opened_at_time}
          onDateChange={v => update('opened_at_date', v)}
          onTimeChange={v => update('opened_at_time', v)}
        />

        <Text style={s.label}>Setup</Text>
        <TextInput style={s.input} placeholderTextColor="#555" placeholder="z.B. HTF Zone + M5 Reaction" value={form.setup} onChangeText={v => update('setup', v)} />

        <Text style={s.label}>Notizen</Text>
        <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]} placeholderTextColor="#555" value={form.notes} onChangeText={v => update('notes', v)} multiline numberOfLines={3} />

        {filteredTags.length > 0 && (
          <>
            <Text style={s.label}>Tags</Text>
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

        <Text style={s.label}>Screenshot</Text>
        <TouchableOpacity style={s.screenshotBtn} onPress={handlePickScreenshot} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color="#22c55e" />
          ) : (
            <>
              <Feather name={form.screenshot_path ? 'check-circle' : 'upload'} size={16} color={form.screenshot_path ? '#22c55e' : '#666'} />
              <Text style={[s.screenshotText, form.screenshot_path && s.screenshotTextDone]}>
                {form.screenshot_path ? 'Screenshot gespeichert' : 'Screenshot hochladen'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        {!!form.screenshot_path && (
          <TouchableOpacity onPress={() => update('screenshot_path', '')} style={s.removeScreenshot}>
            <Text style={s.removeScreenshotText}>Screenshot entfernen</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      <CandleTimePicker
        visible={showEntryPicker}
        symbol={normalizeSymbol(form.symbol || trade?.symbol || '')}
        price={parseFloat(form.entry_price) || 0}
        side={form.side || trade?.side || 'long'}
        initialDate={form.opened_at_date}
        onSelect={c => {
          const d = new Date(c.openTime)
          const pad = (n: number) => String(n).padStart(2, '0')
          update('opened_at_date', `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`)
          update('opened_at_time', `${pad(d.getHours())}:${pad(d.getMinutes())}`)
        }}
        onClose={() => setShowEntryPicker(false)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  loading: { flex: 1, backgroundColor: '#0f0f0f', alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: '#666' },
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
  screenshotBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#2a2a2a', marginTop: 4 },
  screenshotText: { color: '#666', fontSize: 14 },
  screenshotTextDone: { color: '#22c55e' },
  removeScreenshot: { marginTop: 6, alignSelf: 'flex-start' },
  removeScreenshotText: { color: '#ef4444', fontSize: 12 },
  calcRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 2, marginTop: 4 },
  calcText: { color: '#22c55e', fontSize: 12, fontWeight: '600' },
  calcTextMuted: { color: '#555', fontSize: 12 },
  tpRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  tpRemove: { padding: 8 },
  addTpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addTpText: { color: '#22c55e', fontSize: 13, fontWeight: '600' },
  // Checklist
  checklistSection: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  checklistSectionTitle: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  checklistRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#252525' },
  checklistItemTitle: { color: '#ccc', fontSize: 14, flex: 1 },
  checklistItemChecked: { color: '#22c55e' },
  catBadge: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  catBadgeText: { color: '#888', fontSize: 11 },
})

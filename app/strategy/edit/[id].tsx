import { useState, useEffect } from 'react'
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, Switch } from 'react-native'
import { PressFix } from '../../../src/components/PressFix'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../../src/lib/supabase'
import type { TagDefinition, TagType, ChecklistItem } from '../../../src/types'

export default function EditStrategyScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [saving, setSaving] = useState(false)
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [linkedTagIds, setLinkedTagIds] = useState<string[]>([])
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([])
  const [showAddItem, setShowAddItem] = useState(false)
  const [newItem, setNewItem] = useState({ title: '', category: '', kind: '', description: '' })
  const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', 'D1']

  const [form, setForm] = useState({
    name: '',
    description: '',
    tp1_close_percent: '50',
    default_tp1_r_multiple: '2',
    move_remaining_to_be_after_tp1: false,
    default_timeframe: '5m',
  })

  useEffect(() => {
    async function load() {
      if (!id) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: strat }, { data: tagDefs }, { data: links }, { data: items }] = await Promise.all([
        supabase.from('strategy_profiles').select('*').eq('id', id).single(),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
        supabase.from('strategy_tag_links').select('tag_id').eq('strategy_id', id),
        supabase.from('strategy_checklist_items').select('*').eq('strategy_id', id).order('sort_order'),
      ])
      if (!strat) return
      setForm({
        name: strat.name ?? '',
        description: strat.description ?? '',
        tp1_close_percent: String(strat.tp1_close_percent ?? 50),
        default_tp1_r_multiple: String(strat.default_tp1_r_multiple ?? 2),
        move_remaining_to_be_after_tp1: strat.move_remaining_to_be_after_tp1 ?? false,
        default_timeframe: strat.default_timeframe ?? '5m',
      })
      setTags(tagDefs ?? [])
      setLinkedTagIds((links ?? []).map((l: any) => l.tag_id))
      setChecklistItems(items ?? [])
    }
    load()
  }, [id])

  function update(key: keyof typeof form, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function toggleTagLink(tagId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const isLinked = linkedTagIds.includes(tagId)
    if (isLinked) {
      await supabase.from('strategy_tag_links').delete()
        .eq('strategy_id', id).eq('tag_id', tagId)
      setLinkedTagIds(prev => prev.filter(t => t !== tagId))
    } else {
      await supabase.from('strategy_tag_links').insert({
        strategy_id: id,
        tag_id: tagId,
        user_id: user.id,
      })
      setLinkedTagIds(prev => [...prev, tagId])
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      Alert.alert('Fehler', 'Name ist ein Pflichtfeld.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('strategy_profiles').update({
      name: form.name.trim(),
      description: form.description.trim(),
      tp1_close_percent: parseFloat(form.tp1_close_percent) || 50,
      default_tp1_r_multiple: parseFloat(form.default_tp1_r_multiple) || 2,
      move_remaining_to_be_after_tp1: form.move_remaining_to_be_after_tp1,
      default_timeframe: form.default_timeframe,
    }).eq('id', id)
    setSaving(false)
    if (error) Alert.alert('Fehler', error.message)
    else router.back()
  }

  async function handleAddItem() {
    if (!newItem.title.trim()) {
      Alert.alert('Fehler', 'Titel ist ein Pflichtfeld.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('strategy_checklist_items').insert({
      user_id: user.id,
      strategy_id: id,
      title: newItem.title.trim(),
      category: newItem.category.trim() || 'Allgemein',
      kind: newItem.kind.trim() || 'pre_trade',
      description: newItem.description.trim() || null,
      sort_order: checklistItems.length + 1,
      is_active: true,
    }).select().single()
    if (error) {
      Alert.alert('Fehler', error.message)
      return
    }
    setChecklistItems(prev => [...prev, data])
    setNewItem({ title: '', category: '', kind: '', description: '' })
    setShowAddItem(false)
  }

  async function handleDeleteItem(itemId: string) {
    Alert.alert('Item löschen', 'Wirklich löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen', style: 'destructive', onPress: async () => {
          await supabase.from('strategy_checklist_items').delete().eq('id', itemId)
          setChecklistItems(prev => prev.filter(i => i.id !== itemId))
        }
      },
    ])
  }

  async function toggleItemActive(item: ChecklistItem) {
    const newVal = !item.is_active
    await supabase.from('strategy_checklist_items').update({ is_active: newVal }).eq('id', item.id)
    setChecklistItems(prev => prev.map(i => i.id === item.id ? { ...i, is_active: newVal } : i))
  }

  const tagGroups: Record<TagType, TagDefinition[]> = {
    mistake: tags.filter(t => t.tag_type === 'mistake'),
    execution: tags.filter(t => t.tag_type === 'execution'),
    context: tags.filter(t => t.tag_type === 'context'),
  }

  const tagTypeLabel = (type: string) =>
    type === 'mistake' ? '⚠️ Fehler' : type === 'execution' ? '✅ Ausführung' : '📍 Kontext'

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <PressFix onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </PressFix>
        <Text style={s.title}>Strategie bearbeiten</Text>
        <PressFix onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
        </PressFix>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Name *</Text>
        <TextInput style={s.input} placeholderTextColor="#555" value={form.name} onChangeText={v => update('name', v)} />

        <Text style={s.label}>Beschreibung / Strategie-Regeln</Text>
        <TextInput
          style={[s.input, { height: 160, textAlignVertical: 'top' }]}
          placeholderTextColor="#555"
          value={form.description}
          onChangeText={v => update('description', v)}
          multiline
        />

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>TP1 Schliessen %</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.tp1_close_percent} onChangeText={v => update('tp1_close_percent', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>TP1 R-Multiple</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.default_tp1_r_multiple} onChangeText={v => update('default_tp1_r_multiple', v)} keyboardType="decimal-pad" />
          </View>
        </View>

        <Text style={s.label}>Standard-Timeframe</Text>
        <View style={s.chipRow}>
          {TIMEFRAMES.map(tf => (
            <PressFix
              key={tf}
              style={[s.chip, form.default_timeframe === tf && s.chipActive]}
              onPress={() => update('default_timeframe', tf)}
            >
              <Text style={[s.chipText, form.default_timeframe === tf && s.chipTextActive]}>{tf}</Text>
            </PressFix>
          ))}
        </View>

        <View style={s.switchRow}>
          <View style={s.switchLabel}>
            <Text style={s.switchTitle}>BE nach TP1</Text>
            <Text style={s.switchSub}>Stop Loss auf Break Even nach TP1</Text>
          </View>
          <Switch
            value={form.move_remaining_to_be_after_tp1}
            onValueChange={v => update('move_remaining_to_be_after_tp1', v)}
            trackColor={{ false: '#2a2a2a', true: '#22c55e' }}
            thumbColor="#fff"
          />
        </View>

        {tags.length > 0 && (
          <>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Tags für diese Strategie</Text>
              <Text style={s.sectionSub}>Aktive Tags werden beim Trade-Eintrag angezeigt</Text>
            </View>

            {(Object.entries(tagGroups) as [TagType, TagDefinition[]][]).map(([type, list]) =>
              list.length > 0 ? (
                <View key={type} style={s.tagGroup}>
                  <Text style={s.tagGroupLabel}>{tagTypeLabel(type)}</Text>
                  <View style={s.tagChipRow}>
                    {list.map(tag => {
                      const active = linkedTagIds.includes(tag.id)
                      return (
                        <PressFix
                          key={tag.id}
                          style={[s.tagChip, active && s.tagChipActive]}
                          onPress={() => toggleTagLink(tag.id)}
                        >
                          <Text style={[s.tagChipText, active && s.tagChipTextActive]}>
                            {tag.name.replace(/_/g, ' ')}
                          </Text>
                        </PressFix>
                      )
                    })}
                  </View>
                </View>
              ) : null
            )}
          </>
        )}

        {/* Checklist Section */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Checkliste</Text>
          <Text style={s.sectionSub}>Items die beim Trade-Eintrag abgehakt werden</Text>
        </View>

        {checklistItems.map(item => (
          <View key={item.id} style={s.checklistItem}>
            <View style={s.checklistLeft}>
              <View style={s.checklistTitleRow}>
                <Text style={[s.checklistTitle, !item.is_active && s.checklistTitleInactive]}>{item.title}</Text>
                {item.category ? (
                  <View style={s.catBadge}>
                    <Text style={s.catBadgeText}>{item.category}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={s.checklistRight}>
              <Switch
                value={item.is_active}
                onValueChange={() => toggleItemActive(item)}
                trackColor={{ false: '#2a2a2a', true: '#22c55e' }}
                thumbColor="#fff"
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
              <PressFix onPress={() => handleDeleteItem(item.id)} style={s.deleteBtn}>
                <Feather name="trash-2" size={16} color="#ef4444" />
              </PressFix>
            </View>
          </View>
        ))}

        {showAddItem ? (
          <View style={s.addItemForm}>
            <Text style={s.label}>Titel *</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              placeholder="z.B. HTF Trend bestätigt"
              value={newItem.title}
              onChangeText={v => setNewItem(p => ({ ...p, title: v }))}
            />
            <Text style={s.label}>Kategorie</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              placeholder="z.B. Entry, Risiko, Markt"
              value={newItem.category}
              onChangeText={v => setNewItem(p => ({ ...p, category: v }))}
            />
            <Text style={s.label}>Art</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              placeholder="z.B. pre_trade"
              value={newItem.kind}
              onChangeText={v => setNewItem(p => ({ ...p, kind: v }))}
            />
            <Text style={s.label}>Beschreibung (optional)</Text>
            <TextInput
              style={[s.input, { height: 80, textAlignVertical: 'top' }]}
              placeholderTextColor="#555"
              value={newItem.description}
              onChangeText={v => setNewItem(p => ({ ...p, description: v }))}
              multiline
            />
            <View style={s.addItemBtns}>
              <PressFix style={s.cancelBtn} onPress={() => { setShowAddItem(false); setNewItem({ title: '', category: '', kind: '', description: '' }) }}>
                <Text style={s.cancelBtnText}>Abbrechen</Text>
              </PressFix>
              <PressFix style={s.saveItemBtn} onPress={handleAddItem}>
                <Text style={s.saveItemBtnText}>Speichern</Text>
              </PressFix>
            </View>
          </View>
        ) : (
          <PressFix style={s.addItemBtn} onPress={() => setShowAddItem(true)}>
            <Feather name="plus" size={16} color="#22c55e" />
            <Text style={s.addItemBtnText}>Item hinzufügen</Text>
          </PressFix>
        )}
      </ScrollView>
    </SafeAreaView>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  chipActive: { backgroundColor: '#22c55e22', borderColor: '#22c55e' },
  chipText: { color: '#888', fontSize: 13 },
  chipTextActive: { color: '#22c55e', fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  switchLabel: { flex: 1 },
  switchTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  switchSub: { color: '#666', fontSize: 12, marginTop: 2 },
  sectionHeader: { marginTop: 28, marginBottom: 4 },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sectionSub: { color: '#555', fontSize: 12, marginTop: 2 },
  tagGroup: { marginTop: 14 },
  tagGroupLabel: { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  tagChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  tagChipActive: { backgroundColor: '#1a2a3a', borderColor: '#3b82f6' },
  tagChipText: { color: '#888', fontSize: 13 },
  tagChipTextActive: { color: '#60a5fa' },
  // Checklist styles
  checklistItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: '#2a2a2a' },
  checklistLeft: { flex: 1, marginRight: 8 },
  checklistTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  checklistTitle: { color: '#fff', fontSize: 14, fontWeight: '500' },
  checklistTitleInactive: { color: '#555' },
  checklistRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  catBadge: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  catBadgeText: { color: '#888', fontSize: 11 },
  deleteBtn: { padding: 6 },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#2a2a2a', borderStyle: 'dashed' },
  addItemBtnText: { color: '#22c55e', fontSize: 14, fontWeight: '600' },
  addItemForm: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginTop: 10, borderWidth: 1, borderColor: '#2a2a2a' },
  addItemBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  cancelBtn: { flex: 1, backgroundColor: '#252525', borderRadius: 8, padding: 12, alignItems: 'center' },
  cancelBtnText: { color: '#888', fontWeight: '600' },
  saveItemBtn: { flex: 1, backgroundColor: '#22c55e', borderRadius: 8, padding: 12, alignItems: 'center' },
  saveItemBtnText: { color: '#000', fontWeight: '700' },
})

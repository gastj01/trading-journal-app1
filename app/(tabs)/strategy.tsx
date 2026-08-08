import { useState, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, TextInput } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useFocusEffect } from 'expo-router'
import { supabase } from '../../src/lib/supabase'
import type { StrategyProfile, TagDefinition, TagType } from '../../src/types'

type Tab = 'strategies' | 'tags'

export default function StrategyScreen() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('strategies')
  const [strategies, setStrategies] = useState<StrategyProfile[]>([])
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [showTagForm, setShowTagForm] = useState(false)
  const [tagName, setTagName] = useState('')
  const [tagType, setTagType] = useState<TagType>('execution')
  const [savingTag, setSavingTag] = useState(false)
  const [editingTag, setEditingTag] = useState<TagDefinition | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<TagType>('execution')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: strats }, { data: tagDefs }] = await Promise.all([
      supabase.from('strategy_profiles').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
    ])
    setStrategies(strats ?? [])
    setTags(tagDefs ?? [])
  }

  useFocusEffect(useCallback(() => { load() }, []))

  const tagGroups: Record<string, TagDefinition[]> = {
    mistake: tags.filter(t => t.tag_type === 'mistake'),
    execution: tags.filter(t => t.tag_type === 'execution'),
    context: tags.filter(t => t.tag_type === 'context'),
  }

  async function handleSaveTag() {
    if (!tagName.trim()) {
      Alert.alert('Fehler', 'Name ist ein Pflichtfeld.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSavingTag(true)
    const { error } = await supabase.from('trade_tag_definitions').insert({
      user_id: user.id,
      name: tagName.trim(),
      tag_type: tagType,
    })
    setSavingTag(false)
    if (error) {
      Alert.alert('Fehler', error.message)
    } else {
      setTagName('')
      setTagType('execution')
      setShowTagForm(false)
      load()
    }
  }

  function handleDeleteStrategy(strat: StrategyProfile) {
    Alert.alert('Strategie löschen', `"${strat.name}" wirklich löschen?`, [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Löschen', style: 'destructive', onPress: async () => {
        await supabase.from('strategy_profiles').delete().eq('id', strat.id)
        load()
      }},
    ])
  }

  function startEdit(tag: TagDefinition) {
    setEditingTag(tag)
    setEditName(tag.name)
    setEditType(tag.tag_type)
    setShowTagForm(false)
  }

  async function handleUpdateTag() {
    if (!editingTag || !editName.trim()) return
    setSavingTag(true)
    const { error } = await supabase.from('trade_tag_definitions')
      .update({ name: editName.trim(), tag_type: editType })
      .eq('id', editingTag.id)
    setSavingTag(false)
    if (error) {
      Alert.alert('Fehler', error.message)
    } else {
      setEditingTag(null)
      load()
    }
  }

  function handleDeleteTag(tag: TagDefinition) {
    Alert.alert(
      'Tag löschen',
      `"${tag.name}" wirklich löschen? Er wird von allen Trades entfernt.`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen', style: 'destructive', onPress: async () => {
            await supabase.from('trade_tag_definitions').delete().eq('id', tag.id)
            load()
          }
        },
      ]
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === 'strategies' && s.tabActive]} onPress={() => setTab('strategies')}>
          <Text style={[s.tabText, tab === 'strategies' && s.tabTextActive]}>Strategien</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'tags' && s.tabActive]} onPress={() => setTab('tags')}>
          <Text style={[s.tabText, tab === 'tags' && s.tabTextActive]}>Tags</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {tab === 'strategies' ? (
          <>
            <TouchableOpacity style={s.addRow} onPress={() => router.push('/strategy/new')}>
              <Feather name="plus" size={16} color="#22c55e" />
              <Text style={s.addText}>Neue Strategie</Text>
            </TouchableOpacity>

            {strategies.map(strat => (
              <View key={strat.id} style={s.card}>
                <View style={s.cardContent}>
                  <Text style={s.cardTitle}>{strat.name}</Text>
                  {strat.description ? <Text style={s.cardDesc} numberOfLines={2}>{strat.description}</Text> : null}
                  <View style={s.pills}>
                    <Pill label={`TP1 ${strat.tp1_close_percent}%`} />
                    <Pill label={`${strat.default_tp1_r_multiple}R`} />
                    {strat.move_remaining_to_be_after_tp1 && <Pill label="BE nach TP1" />}
                  </View>
                </View>
                <View style={s.cardActions}>
                  <TouchableOpacity style={s.cardAction} onPress={() => router.push(`/strategy/edit/${strat.id}`)}>
                    <Feather name="edit-2" size={15} color="#666" />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.cardAction} onPress={() => handleDeleteStrategy(strat)}>
                    <Feather name="trash-2" size={15} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {strategies.length === 0 && (
              <Text style={s.empty}>Noch keine Strategien angelegt.</Text>
            )}
          </>
        ) : (
          <>
            <TouchableOpacity style={s.addRow} onPress={() => { setShowTagForm(v => !v); setEditingTag(null) }}>
              <Feather name="plus" size={16} color="#22c55e" />
              <Text style={s.addText}>Neuer Tag</Text>
            </TouchableOpacity>

            {showTagForm && (
              <View style={s.tagForm}>
                <TextInput
                  style={s.tagInput}
                  placeholderTextColor="#555"
                  placeholder="Tag-Name..."
                  value={tagName}
                  onChangeText={setTagName}
                />
                <View style={s.tagTypeRow}>
                  {(['mistake', 'execution', 'context'] as TagType[]).map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[s.tagTypeBtn, tagType === t && s.tagTypeBtnActive]}
                      onPress={() => setTagType(t)}
                    >
                      <Text style={[s.tagTypeBtnText, tagType === t && s.tagTypeBtnTextActive]}>
                        {t === 'mistake' ? 'Fehler' : t === 'execution' ? 'Ausführung' : 'Kontext'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.tagFormBtns}>
                  <TouchableOpacity style={s.tagCancelBtn} onPress={() => { setShowTagForm(false); setTagName('') }}>
                    <Text style={s.tagCancelBtnText}>Abbrechen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.tagSaveBtn} onPress={handleSaveTag} disabled={savingTag}>
                    <Text style={s.tagSaveBtnText}>{savingTag ? '...' : 'Speichern'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {editingTag && (
              <View style={s.tagForm}>
                <Text style={s.editFormTitle}>Tag bearbeiten</Text>
                <TextInput
                  style={s.tagInput}
                  placeholderTextColor="#555"
                  value={editName}
                  onChangeText={setEditName}
                />
                <View style={s.tagTypeRow}>
                  {(['mistake', 'execution', 'context'] as TagType[]).map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[s.tagTypeBtn, editType === t && s.tagTypeBtnActive]}
                      onPress={() => setEditType(t)}
                    >
                      <Text style={[s.tagTypeBtnText, editType === t && s.tagTypeBtnTextActive]}>
                        {t === 'mistake' ? 'Fehler' : t === 'execution' ? 'Ausführung' : 'Kontext'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={s.tagFormBtns}>
                  <TouchableOpacity style={s.tagCancelBtn} onPress={() => setEditingTag(null)}>
                    <Text style={s.tagCancelBtnText}>Abbrechen</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.tagSaveBtn} onPress={handleUpdateTag} disabled={savingTag}>
                    <Text style={s.tagSaveBtnText}>{savingTag ? '...' : 'Speichern'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {Object.entries(tagGroups).map(([type, list]) => (
              list.length > 0 && (
                <View key={type} style={s.tagGroup}>
                  <Text style={s.tagGroupLabel}>
                    {type === 'mistake' ? '⚠️ Fehler' : type === 'execution' ? '✅ Ausführung' : '📍 Kontext'}
                  </Text>
                  <View style={s.tagList}>
                    {list.map(tag => (
                      <View key={tag.id} style={s.tagChipRow}>
                        <View style={s.tagChip}>
                          <Text style={s.tagChipText}>{tag.name.replace(/_/g, ' ')}</Text>
                        </View>
                        <TouchableOpacity style={s.tagAction} onPress={() => startEdit(tag)}>
                          <Feather name="edit-2" size={13} color="#666" />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.tagAction} onPress={() => handleDeleteTag(tag)}>
                          <Feather name="trash-2" size={13} color="#ef4444" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )
            ))}

            {tags.length === 0 && (
              <Text style={s.empty}>Noch keine Tags angelegt.</Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Pill({ label }: { label: string }) {
  return (
    <View style={s.pill}>
      <Text style={s.pillText}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  tabs: { flexDirection: 'row', margin: 16, marginBottom: 4, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 3 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#2a2a2a' },
  tabText: { color: '#666', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingTop: 12, paddingBottom: 40 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, marginBottom: 12, borderWidth: 1, borderColor: '#22c55e33', borderRadius: 10, borderStyle: 'dashed', justifyContent: 'center' },
  addText: { color: '#22c55e', fontSize: 14, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 8 },
  cardContent: { flex: 1 },
  cardActions: { flexDirection: 'row', gap: 4 },
  cardAction: { padding: 8 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardDesc: { color: '#888', fontSize: 13, marginBottom: 8, lineHeight: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { backgroundColor: '#252525', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: '#aaa', fontSize: 12 },
  empty: { color: '#555', textAlign: 'center', marginTop: 40, fontSize: 14 },
  tagForm: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a2a' },
  editFormTitle: { color: '#aaa', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  tagInput: { backgroundColor: '#0f0f0f', borderRadius: 8, padding: 10, color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 10 },
  tagTypeRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  tagTypeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center' },
  tagTypeBtnActive: { backgroundColor: '#1e3a2f', borderColor: '#22c55e' },
  tagTypeBtnText: { color: '#666', fontSize: 12, fontWeight: '600' },
  tagTypeBtnTextActive: { color: '#22c55e' },
  tagFormBtns: { flexDirection: 'row', gap: 8 },
  tagCancelBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#0f0f0f', borderWidth: 1, borderColor: '#2a2a2a', alignItems: 'center' },
  tagCancelBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
  tagSaveBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: '#22c55e', alignItems: 'center' },
  tagSaveBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },
  tagGroup: { marginBottom: 20 },
  tagGroupLabel: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  tagList: { gap: 6 },
  tagChipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagChip: { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: '#2a2a2a', flex: 1 },
  tagChipText: { color: '#ccc', fontSize: 13 },
  tagAction: { padding: 8 },
})

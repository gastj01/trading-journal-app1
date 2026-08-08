import { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { supabase } from '../../../src/lib/supabase'
import type { Trade, TagDefinition } from '../../../src/types'

export default function EditTradeScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [trade, setTrade] = useState<Trade | null>(null)
  const [tags, setTags] = useState<TagDefinition[]>([])
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
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
  })

  useEffect(() => {
    async function load() {
      if (!id) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data }, { data: tagDefs }, { data: assignments }] = await Promise.all([
        supabase.from('trades').select('*').eq('id', id).single(),
        supabase.from('trade_tag_definitions').select('*').eq('user_id', user.id).order('tag_type'),
        supabase.from('trade_tag_assignments').select('tag_id').eq('trade_id', id),
      ])
      if (!data) return
      setTrade(data)
      setTags(tagDefs ?? [])
      setSelectedTagIds((assignments ?? []).map((a: any) => a.tag_id))
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
      })
    }
    load()
  }, [id])

  function update(key: keyof typeof form, value: string) {
    setForm(f => ({ ...f, [key]: value }))
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

  const tagsByType = {
    mistake: tags.filter(t => t.tag_type === 'mistake'),
    execution: tags.filter(t => t.tag_type === 'execution'),
    context: tags.filter(t => t.tag_type === 'context'),
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
            <TextInput style={s.input} placeholderTextColor="#555" value={form.entry_price} onChangeText={v => update('entry_price', v)} keyboardType="decimal-pad" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Stop Loss</Text>
            <TextInput style={s.input} placeholderTextColor="#555" value={form.stop_loss} onChangeText={v => update('stop_loss', v)} keyboardType="decimal-pad" />
          </View>
        </View>

        <Text style={s.label}>Exit (optional)</Text>
        <TextInput style={s.input} placeholderTextColor="#555" value={form.exit_price} onChangeText={v => update('exit_price', v)} keyboardType="decimal-pad" />

        <Text style={s.label}>Risiko %</Text>
        <TextInput style={s.input} placeholderTextColor="#555" value={form.risk_percent} onChangeText={v => update('risk_percent', v)} keyboardType="decimal-pad" />

        <Text style={s.label}>Setup</Text>
        <TextInput style={s.input} placeholderTextColor="#555" placeholder="z.B. HTF Zone + M5 Reaction" value={form.setup} onChangeText={v => update('setup', v)} />

        <Text style={s.label}>Notizen</Text>
        <TextInput style={[s.input, { height: 80, textAlignVertical: 'top' }]} placeholderTextColor="#555" value={form.notes} onChangeText={v => update('notes', v)} multiline numberOfLines={3} />

        {tags.length > 0 && (
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
})

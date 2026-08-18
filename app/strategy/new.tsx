import { useState } from 'react'
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, Switch } from 'react-native'
import { PressFix } from '../../src/components/PressFix'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'


export default function NewStrategyScreen() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    tp1_close_percent: '50',
    default_tp1_r_multiple: '2',
    move_remaining_to_be_after_tp1: false,
  })

  function update(key: keyof typeof form, value: string | boolean) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      Alert.alert('Fehler', 'Name ist ein Pflichtfeld.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSaving(true)
    const { error } = await supabase.from('strategy_profiles').insert({
      user_id: user.id,
      name: form.name.trim(),
      description: form.description.trim(),
      tp1_close_percent: parseFloat(form.tp1_close_percent) || 50,
      default_tp1_r_multiple: parseFloat(form.default_tp1_r_multiple) || 2,
      move_remaining_to_be_after_tp1: form.move_remaining_to_be_after_tp1,
    })
    setSaving(false)
    if (error) Alert.alert('Fehler', error.message)
    else router.back()
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <PressFix onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </PressFix>
        <Text style={s.title}>Neue Strategie</Text>
        <PressFix onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
        </PressFix>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <PressFix style={s.kiBtn} onPress={() => router.push('/strategy/ki-setup')}>
          <Feather name="cpu" size={16} color="#818cf8" />
          <View style={s.kiBtnText}>
            <Text style={s.kiBtnTitle}>Mit KI erstellen</Text>
            <Text style={s.kiBtnSub}>KI führt durch 6 Fragen und generiert die Strategie</Text>
          </View>
          <Feather name="chevron-right" size={16} color="#555" />
        </PressFix>

        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>oder manuell</Text>
          <View style={s.dividerLine} />
        </View>

        <Text style={s.label}>Name *</Text>
        <TextInput
          style={s.input}
          placeholderTextColor="#555"
          placeholder="z.B. ICT Reversal"
          value={form.name}
          onChangeText={v => update('name', v)}
        />

        <Text style={s.label}>Beschreibung</Text>
        <TextInput
          style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
          placeholderTextColor="#555"
          placeholder="Optionale Beschreibung..."
          value={form.description}
          onChangeText={v => update('description', v)}
          multiline
          numberOfLines={3}
        />

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>TP1 Schliessen %</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              value={form.tp1_close_percent}
              onChangeText={v => update('tp1_close_percent', v)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>TP1 R-Multiple</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              value={form.default_tp1_r_multiple}
              onChangeText={v => update('default_tp1_r_multiple', v)}
              keyboardType="decimal-pad"
            />
          </View>
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  switchLabel: { flex: 1 },
  switchTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  switchSub: { color: '#666', fontSize: 12, marginTop: 2 },
  kiBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a1a2d', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#818cf833', marginTop: 8 },
  kiBtnText: { flex: 1 },
  kiBtnTitle: { color: '#c7d2fe', fontSize: 15, fontWeight: '700' },
  kiBtnSub: { color: '#555', fontSize: 12, marginTop: 2 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  dividerText: { color: '#444', fontSize: 12 },
})

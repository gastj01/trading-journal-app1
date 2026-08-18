import { useState } from 'react'
import { View, Text, TextInput, ScrollView, StyleSheet, Alert, Switch } from 'react-native'
import { PressFix } from '../../src/components/PressFix'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { supabase } from '../../src/lib/supabase'

type AccountType = 'real' | 'demo' | 'funded'

export default function NewAccountScreen() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    account_type: 'real' as AccountType,
    platform: 'Bybit',
    initial_balance: '',
    default_risk_percent: '1',
    default_leverage: '1',
    is_default: false,
  })

  function update(key: keyof typeof form, value: string | boolean | AccountType) {
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
    const { error } = await supabase.from('trading_accounts').insert({
      user_id: user.id,
      name: form.name.trim(),
      account_type: form.account_type,
      platform: form.platform.trim(),
      initial_balance: parseFloat(form.initial_balance) || 0,
      default_risk_percent: parseFloat(form.default_risk_percent) || 1,
      default_leverage: parseFloat(form.default_leverage) || 1,
      is_default: form.is_default,
      is_active: true,
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
        <Text style={s.title}>Neues Konto</Text>
        <PressFix onPress={handleSave} disabled={saving} style={s.saveBtn}>
          <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
        </PressFix>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Name *</Text>
        <TextInput
          style={s.input}
          placeholderTextColor="#555"
          placeholder="z.B. Bybit Haupt"
          value={form.name}
          onChangeText={v => update('name', v)}
        />

        <Text style={s.label}>Kontotyp</Text>
        <View style={s.optionRow}>
          {(['real', 'demo', 'funded'] as AccountType[]).map(t => (
            <PressFix
              key={t}
              style={[s.option, form.account_type === t && s.optionActive]}
              onPress={() => update('account_type', t)}
            >
              <Text style={[s.optionText, form.account_type === t && s.optionTextActive]}>
                {t === 'real' ? 'Real' : t === 'demo' ? 'Demo' : 'Funded'}
              </Text>
            </PressFix>
          ))}
        </View>

        <Text style={s.label}>Plattform</Text>
        <TextInput
          style={s.input}
          placeholderTextColor="#555"
          value={form.platform}
          onChangeText={v => update('platform', v)}
        />

        <Text style={s.label}>Startkapital</Text>
        <TextInput
          style={s.input}
          placeholderTextColor="#555"
          placeholder="z.B. 10000"
          value={form.initial_balance}
          onChangeText={v => update('initial_balance', v)}
          keyboardType="decimal-pad"
        />

        <View style={s.row2}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Risiko %</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              value={form.default_risk_percent}
              onChangeText={v => update('default_risk_percent', v)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Leverage</Text>
            <TextInput
              style={s.input}
              placeholderTextColor="#555"
              value={form.default_leverage}
              onChangeText={v => update('default_leverage', v)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View style={s.switchRow}>
          <View style={s.switchLabel}>
            <Text style={s.switchTitle}>Standardkonto</Text>
            <Text style={s.switchSub}>Als Standard beim neuen Trade</Text>
          </View>
          <Switch
            value={form.is_default}
            onValueChange={v => update('is_default', v)}
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
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  option: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  optionActive: { backgroundColor: '#1e3a2f', borderColor: '#22c55e' },
  optionText: { color: '#888', fontSize: 13, fontWeight: '600' },
  optionTextActive: { color: '#22c55e' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  switchLabel: { flex: 1 },
  switchTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  switchSub: { color: '#666', fontSize: 12, marginTop: 2 },
})

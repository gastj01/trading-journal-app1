import { useEffect, useState } from 'react'
import { View, Text, ScrollView, StyleSheet, Alert, TextInput, Switch } from 'react-native'
import { PressFix } from '../../src/components/PressFix'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../src/lib/supabase'
import { DIAG_OVERLAY_KEY } from '../../src/lib/tapDiag'
import type { TradingAccount } from '../../src/types'

export const ANTHROPIC_KEY = 'anthropic_api_key'

export default function SettingsScreen() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [diagEnabled, setDiagEnabled] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setEmail(user.email ?? '')
      const { data } = await supabase.from('trading_accounts').select('*').eq('user_id', user.id)
      setAccounts(data ?? [])
      const stored = await AsyncStorage.getItem(ANTHROPIC_KEY)
      if (stored) { setApiKey(stored); setApiKeySaved(true) }
      const diagStored = await AsyncStorage.getItem(DIAG_OVERLAY_KEY)
      setDiagEnabled(diagStored === 'true')
    }
    load()
  }, [])

  async function toggleDiag(value: boolean) {
    setDiagEnabled(value)
    await AsyncStorage.setItem(DIAG_OVERLAY_KEY, value ? 'true' : 'false')
    Alert.alert('Diagnose-Overlay', value ? 'Aktiviert — wird nach App-Neustart angezeigt.' : 'Deaktiviert — wird nach App-Neustart ausgeblendet.')
  }

  async function saveApiKey() {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      await AsyncStorage.removeItem(ANTHROPIC_KEY)
      setApiKeySaved(false)
      Alert.alert('Gelöscht', 'API Key entfernt.')
      return
    }
    await AsyncStorage.setItem(ANTHROPIC_KEY, trimmed)
    setApiKeySaved(true)
    Alert.alert('Gespeichert', 'Anthropic API Key gespeichert.')
  }

  async function handleLogout() {
    Alert.alert('Abmelden', 'Wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Abmelden', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ])
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        <Text style={s.title}>Einstellungen</Text>

        {/* User */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Account</Text>
          <View style={s.card}>
            <Feather name="user" size={18} color="#888" />
            <Text style={s.email}>{email}</Text>
          </View>
        </View>

        {/* Trading Accounts */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Trading-Konten</Text>
          {accounts.map(acc => (
            <PressFix key={acc.id} style={s.row} onPress={() => router.push(`/account/edit/${acc.id}`)}>
              <View style={s.rowLeft}>
                <Text style={s.rowTitle}>{acc.name}</Text>
                <Text style={s.rowSub}>{acc.account_type} · {acc.platform} · ${acc.initial_balance.toLocaleString()}</Text>
              </View>
              <View style={s.rowRight}>
                {acc.is_default && <Text style={s.defaultBadge}>Standard</Text>}
                <Feather name="chevron-right" size={16} color="#555" />
              </View>
            </PressFix>
          ))}
          <PressFix style={s.addBtn} onPress={() => router.push('/account/new')}>
            <Text style={s.addBtnText}>+ Konto hinzufügen</Text>
          </PressFix>
        </View>

        {/* Anthropic API Key */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>KI-Analyse (Anthropic)</Text>
          <View style={s.apiKeyRow}>
            <TextInput
              style={s.apiKeyInput}
              placeholderTextColor="#444"
              placeholder="sk-ant-..."
              value={apiKey}
              onChangeText={v => { setApiKey(v); setApiKeySaved(false) }}
              secureTextEntry={!showKey}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <PressFix onPress={() => setShowKey(v => !v)} style={s.eyeBtn}>
              <Feather name={showKey ? 'eye-off' : 'eye'} size={16} color="#555" />
            </PressFix>
          </View>
          <PressFix style={[s.saveKeyBtn, apiKeySaved && s.saveKeyBtnSaved]} onPress={saveApiKey}>
            <Feather name={apiKeySaved ? 'check' : 'save'} size={14} color={apiKeySaved ? '#22c55e' : '#fff'} />
            <Text style={[s.saveKeyText, apiKeySaved && s.saveKeyTextSaved]}>
              {apiKeySaved ? 'Gespeichert' : 'Speichern'}
            </Text>
          </PressFix>
          <Text style={s.apiKeyHint}>Key wird nur lokal auf dem Gerät gespeichert.</Text>
        </View>

        {/* Info */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Info</Text>
          <View style={s.row}>
            <Feather name="database" size={16} color="#888" />
            <Text style={s.infoText}>Supabase · rujvwpddxxfbyibvwkgt</Text>
          </View>
          <View style={s.row}>
            <Feather name="shield" size={16} color="#888" />
            <Text style={s.infoText}>Version 1.0.0</Text>
          </View>
          <View style={s.row}>
            <Feather name="activity" size={16} color="#888" />
            <View style={s.rowLeft}>
              <Text style={s.rowTitle}>Diagnose-Overlay</Text>
              <Text style={s.rowSub}>Split-Screen-Touch-Debug (Entwickler)</Text>
            </View>
            <Switch value={diagEnabled} onValueChange={toggleDiag} trackColor={{ false: '#2a2a2a', true: '#22c55e' }} />
          </View>
        </View>

        {/* Logout */}
        <PressFix style={s.logoutBtn} onPress={handleLogout}>
          <Feather name="log-out" size={18} color="#ef4444" />
          <Text style={s.logoutText}>Abmelden</Text>
        </PressFix>
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionLabel: { color: '#555', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14 },
  email: { color: '#ccc', fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14, marginBottom: 4 },
  rowLeft: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub: { color: '#666', fontSize: 12, marginTop: 2 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  defaultBadge: { color: '#22c55e', fontSize: 11, backgroundColor: '#052e16', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  addBtn: { marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 10, alignItems: 'center', borderStyle: 'dashed' },
  addBtnText: { color: '#666', fontSize: 14 },
  infoText: { color: '#666', fontSize: 13 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ef444433', marginTop: 8 },
  logoutText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
  apiKeyRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 8 },
  apiKeyInput: { flex: 1, color: '#fff', fontSize: 13, padding: 12, fontFamily: 'monospace' },
  eyeBtn: { padding: 12 },
  saveKeyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1e3a2f', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#2a2a2a', marginBottom: 6 },
  saveKeyBtnSaved: { backgroundColor: '#052e16', borderColor: '#22c55e33' },
  saveKeyText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  saveKeyTextSaved: { color: '#22c55e' },
  apiKeyHint: { color: '#444', fontSize: 11 },
})

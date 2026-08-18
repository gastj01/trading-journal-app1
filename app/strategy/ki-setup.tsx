import { useState, useRef } from 'react'
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { PressFix } from '../../src/components/PressFix'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../../src/lib/supabase'
import { ANTHROPIC_KEY } from '../(tabs)/settings'

const QUESTIONS = [
  'Wie heißt deine Strategie und was ist das grundlegende Konzept?',
  'Was ist dein genaues Entry-Signal? Wann öffnest du eine Position?',
  'Wie platzierst du deinen Stop Loss — und warum genau dort?',
  'Was ist dein Take Profit Ansatz? (Festes R-Ziel, Struktur-Level, Trailing...)',
  'Welche Marktbedingungen brauchst du? (Trend, Range, HTF-Kontext, Session)',
  'Was sind die häufigsten Fehler bei dieser Strategie, die du vermeiden willst?',
]

interface Message {
  role: 'ai' | 'user'
  text: string
}

export default function KiSetupScreen() {
  const router = useRouter()
  const scrollRef = useRef<ScrollView>(null)
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: QUESTIONS[0] },
  ])
  const [answers, setAnswers] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'interview' | 'generating' | 'preview'>('interview')
  const [generatedDesc, setGeneratedDesc] = useState('')
  const [stratName, setStratName] = useState('')
  const [saving, setSaving] = useState(false)

  const currentQ = answers.length

  function sendAnswer() {
    const trimmed = input.trim()
    if (!trimmed) return

    const newAnswers = [...answers, trimmed]
    const newMessages: Message[] = [...messages, { role: 'user', text: trimmed }]

    if (newAnswers.length < QUESTIONS.length) {
      newMessages.push({ role: 'ai', text: QUESTIONS[newAnswers.length] })
      setMessages(newMessages)
      setAnswers(newAnswers)
      setInput('')
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100)
    } else {
      setMessages([...newMessages, { role: 'ai', text: 'Danke! Ich generiere jetzt deine Strategie-Beschreibung...' }])
      setAnswers(newAnswers)
      setInput('')
      setPhase('generating')
      generateStrategy(newAnswers)
    }
  }

  async function generateStrategy(ans: string[]) {
    const apiKey = await AsyncStorage.getItem(ANTHROPIC_KEY)
    if (!apiKey) {
      Alert.alert('Kein API Key', 'Bitte zuerst in Einstellungen → KI-Analyse einen Anthropic API Key eintragen.')
      setPhase('interview')
      return
    }

    const prompt = `Du bist ein Trading-Coach. Ein Trader beschreibt seine Strategie. Erstelle daraus eine strukturierte, präzise Strategie-Beschreibung auf Deutsch.

Antworten des Traders:
1. Konzept: ${ans[0]}
2. Entry-Signal: ${ans[1]}
3. Stop Loss: ${ans[2]}
4. Take Profit: ${ans[3]}
5. Marktbedingungen: ${ans[4]}
6. Häufige Fehler: ${ans[5]}

Erstelle eine strukturierte Beschreibung mit diesen Abschnitten (nutze diese exakten Überschriften):
KONZEPT: (1-2 Sätze)
ENTRY-REGELN: (Bullet-Points mit •)
STOP LOSS: (Regel + Begründung)
TAKE PROFIT: (Ansatz)
MARKTBEDINGUNGEN: (wann handelbar, wann nicht)
FEHLER VERMEIDEN: (Bullet-Points mit •)

Halte es kompakt und präzise. Keine Einleitung, keine Zusammenfassung.`

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json()
      const desc = data.content?.[0]?.text ?? ''
      setGeneratedDesc(desc)

      // extract name from first answer
      const firstWord = ans[0].split(/[\s,\.]/)[0]
      setStratName(firstWord.length > 2 ? firstWord : '')
      setPhase('preview')
    } catch (e: any) {
      Alert.alert('Fehler', e?.message ?? 'Generierung fehlgeschlagen')
      setPhase('interview')
    }
  }

  async function handleSave() {
    if (!stratName.trim()) {
      Alert.alert('Fehler', 'Bitte einen Namen eingeben.')
      return
    }
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setSaving(true)
    const { error } = await supabase.from('strategy_profiles').insert({
      user_id: user.id,
      name: stratName.trim(),
      description: generatedDesc,
      tp1_close_percent: 50,
      default_tp1_r_multiple: 2,
      move_remaining_to_be_after_tp1: false,
    })
    setSaving(false)
    if (error) Alert.alert('Fehler', error.message)
    else router.back()
  }

  if (phase === 'preview') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <PressFix onPress={() => setPhase('interview')} style={s.closeBtn}>
            <Feather name="arrow-left" size={20} color="#aaa" />
          </PressFix>
          <Text style={s.title}>Strategie speichern</Text>
          <PressFix onPress={handleSave} disabled={saving} style={s.saveBtn}>
            <Text style={s.saveBtnText}>{saving ? '...' : 'Speichern'}</Text>
          </PressFix>
        </View>
        <ScrollView style={s.scroll} contentContainerStyle={s.content}>
          <Text style={s.label}>Name</Text>
          <TextInput
            style={s.input}
            placeholderTextColor="#555"
            placeholder="Strategie-Name"
            value={stratName}
            onChangeText={setStratName}
          />
          <Text style={s.label}>Generierte Beschreibung</Text>
          <TextInput
            style={[s.input, s.descInput]}
            placeholderTextColor="#555"
            value={generatedDesc}
            onChangeText={setGeneratedDesc}
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <PressFix onPress={() => router.back()} style={s.closeBtn}>
          <Feather name="x" size={20} color="#aaa" />
        </PressFix>
        <Text style={s.title}>Strategie mit KI erstellen</Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.progress}>
        {QUESTIONS.map((_, i) => (
          <View key={i} style={[s.progressDot, i < answers.length && s.progressDotDone, i === answers.length && s.progressDotActive]} />
        ))}
      </View>

      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.chatContent}>
        {messages.map((m, i) => (
          <View key={i} style={m.role === 'ai' ? s.aiBubble : s.userBubble}>
            {m.role === 'ai' && <Feather name="cpu" size={14} color="#818cf8" style={s.aiIcon} />}
            <Text style={m.role === 'ai' ? s.aiText : s.userText}>{m.text}</Text>
          </View>
        ))}
        {phase === 'generating' && (
          <View style={s.aiBubble}>
            <ActivityIndicator size="small" color="#818cf8" />
          </View>
        )}
      </ScrollView>

      {phase === 'interview' && currentQ < QUESTIONS.length && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.inputRow}>
            <TextInput
              style={s.chatInput}
              placeholderTextColor="#444"
              placeholder="Antwort eingeben..."
              value={input}
              onChangeText={setInput}
              multiline
              returnKeyType="send"
              onSubmitEditing={sendAnswer}
            />
            <PressFix onPress={sendAnswer} style={s.sendBtn} disabled={!input.trim()}>
              <Feather name="send" size={18} color={input.trim() ? '#818cf8' : '#333'} />
            </PressFix>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingBottom: 8 },
  closeBtn: { padding: 8 },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  saveBtn: { backgroundColor: '#22c55e', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#2a2a2a' },
  progressDotDone: { backgroundColor: '#818cf8' },
  progressDotActive: { backgroundColor: '#818cf8', width: 20 },
  scroll: { flex: 1 },
  chatContent: { padding: 16, paddingBottom: 20, gap: 12 },
  aiBubble: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#1a1a2d', borderRadius: 12, borderBottomLeftRadius: 4, padding: 12, alignSelf: 'flex-start', maxWidth: '85%' },
  userBubble: { backgroundColor: '#1a1a1a', borderRadius: 12, borderBottomRightRadius: 4, padding: 12, alignSelf: 'flex-end', maxWidth: '85%' },
  aiIcon: { marginTop: 2 },
  aiText: { color: '#c7d2fe', fontSize: 14, lineHeight: 20, flex: 1 },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  chatInput: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, color: '#fff', fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: '#2a2a2a' },
  sendBtn: { padding: 12, backgroundColor: '#1a1a2d', borderRadius: 12, borderWidth: 1, borderColor: '#818cf833' },
  content: { padding: 16, paddingBottom: 40, gap: 4 },
  label: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 4, marginTop: 12 },
  input: { backgroundColor: '#1a1a1a', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#2a2a2a' },
  descInput: { minHeight: 400, textAlignVertical: 'top', fontSize: 13, lineHeight: 20 },
})

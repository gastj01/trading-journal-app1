import { useEffect, useState, Component } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { supabase } from '../src/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { useRouter, useSegments } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { View, Text, ScrollView, Alert, Pressable } from 'react-native'

declare const global: typeof globalThis & { ErrorUtils?: { getGlobalHandler: () => ((error: Error, isFatal?: boolean) => void); setGlobalHandler: (handler: (error: Error, isFatal?: boolean) => void) => void } }

if (global.ErrorUtils) {
  const prev = global.ErrorUtils.getGlobalHandler()
  global.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    Alert.alert('Fatal Error', error?.message + '\n\n' + error?.stack?.slice(0, 500))
    prev?.(error, isFatal)
  })
}

class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <View style={{ flex: 1, backgroundColor: '#0f0f0f', padding: 20, paddingTop: 60 }}>
          <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700', marginBottom: 8 }}>Fehler</Text>
          <ScrollView>
            <Text style={{ color: '#fff', fontSize: 12 }}>{err.message}</Text>
            <Text style={{ color: '#888', fontSize: 10, marginTop: 8 }}>{err.stack}</Text>
          </ScrollView>
        </View>
      )
    }
    return this.props.children
  }
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const segments = useSegments()
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (loading) return
    const inAuth = segments[0] === '(auth)'
    if (!session && !inAuth) {
      router.replace('/(auth)/login')
    } else if (session && inAuth) {
      router.replace('/(tabs)')
    }
  }, [session, loading, segments])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Pressable
        onPress={() => Alert.alert('TEST OK', 'Bare Pressable funktioniert!')}
        style={{ position: 'absolute', top: 40, right: 10, zIndex: 9999, backgroundColor: '#ef4444', padding: 8, borderRadius: 6 }}
      >
        <Text style={{ color: '#fff', fontSize: 10 }}>TEST</Text>
      </Pressable>
      <SafeAreaProvider>
        <ErrorBoundary>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="trade/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="trade/new" options={{ presentation: 'card' }} />
            <Stack.Screen name="strategy/new" options={{ presentation: 'card' }} />
            <Stack.Screen name="trade/edit/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="trade/manage/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="account/new" options={{ presentation: 'card' }} />
          </Stack>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

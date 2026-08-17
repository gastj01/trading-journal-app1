import { useEffect, useState, Component } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { supabase } from '../src/lib/supabase'
import type { Session } from '@supabase/supabase-js'
import { useRouter, useSegments } from 'expo-router'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { View, Text, ScrollView, Alert, Dimensions, PixelRatio } from 'react-native'
import { tapDiag } from '../src/lib/tapDiag'

// TEMP split-screen diagnostic — remove once the touch bug is understood.
// No longer claims the responder (that was ruled out as the cause: removing it
// didn't fix the bug). cap/ts/press separate three points in the touch path:
// onStartShouldSetResponderCapture (native responder negotiation reaches the
// button), onTouchStart (raw touch delivered), onPress (Pressability actually
// fires) — narrows down where a failed tap gets lost.
// age(): "Xs" since a tapDiag timestamp, or "-" if it never fired. Lets a
// single screenshot taken right after a deliberate tap show whether a given
// counter just moved, without needing a force-quit for a clean baseline
// (these counters are cumulative for the whole JS session, not per-tap).
function age(ts: number, now: number) {
  return ts === 0 ? '-' : ((now - ts) / 1000).toFixed(1) + 's'
}

function SplitScreenDiag({ children }: { children: React.ReactNode }) {
  const [dims, setDims] = useState(() => ({ window: Dimensions.get('window'), screen: Dimensions.get('screen') }))
  const [diag, setDiag] = useState(() => ({ ...tapDiag, now: Date.now() }))

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      setDims({ window: Dimensions.get('window'), screen: Dimensions.get('screen') })
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setDiag({ ...tapDiag, now: Date.now() })
    }, 200)
    return () => clearInterval(id)
  }, [])

  const r = diag.plusButtonRect
  // Short, single-value-per-line strings only, most important first — a
  // combined line (e.g. dp+win+scr) previously wrapped inside the narrow
  // split-screen column and clipped whatever came after it (confirmed
  // 2026-08-17, twice). Explicit width/height on the box removes the
  // dependency on content-driven sizing, since Android's default
  // clipChildren is the suspected culprit, not z-order (elevation alone
  // didn't fix it before). cap/ts/press first so a clip eats dp/win/scr/rect
  // (already-understood values) instead of the counters we actually need.
  const lines = [
    `cap${diag.plusResponderCaptureCount} ${age(diag.lastPlusResponderCaptureAt, diag.now)}`,
    `ts${diag.plusTouchStartCount} ${age(diag.lastPlusTouchStartAt, diag.now)}`,
    `press${diag.plusPressCount} ${age(diag.lastPlusPressAt, diag.now)}`,
    `rect${r.x},${r.y} ${r.width}x${r.height}`,
    `dp${PixelRatio.get().toFixed(2)}`,
    `win${Math.round(dims.window.width)}x${Math.round(dims.window.height)}`,
    `scr${Math.round(dims.screen.width)}x${Math.round(dims.screen.height)}`,
  ]
  return (
    <View style={{ flex: 1 }}>
      {children}
      <View style={{ position: 'absolute', top: 4, left: 4, zIndex: 9999, elevation: 999 }} pointerEvents="none">
        <View style={{ backgroundColor: '#000', padding: 4, width: 150, height: 130 }}>
          {lines.map((line, i) => (
            <Text key={i} style={{ color: '#0f0', fontSize: 10, includeFontPadding: false }} numberOfLines={1}>
              {line}
            </Text>
          ))}
        </View>
      </View>
    </View>
  )
}

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

  // GestureHandlerRootView restored - swapping it for a plain View (previous
  // diag round) didn't fix the bug, and testing further diag builds without it
  // means testing a tree two mutations away from the real app.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SplitScreenDiag>
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
      </SplitScreenDiag>
    </GestureHandlerRootView>
  )
}

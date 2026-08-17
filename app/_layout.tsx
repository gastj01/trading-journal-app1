import { useEffect, useState, useRef, Component } from 'react'
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
// didn't fix the bug). Current hypothesis under test: a px->dp density mismatch
// between the native decor size and Dimensions.get('screen') in split-screen -
// PixelRatio.get() plus the measured "+" button rect (dp) let that be checked
// against the native overlay's px DOWN coordinate (added by
// plugins/withSplitScreenFix.js) in the same screenshot. plusTouchStartCount
// (fires on touch delivery, independent of the responder/Pressability chain)
// separates "button never gets the touch" from "button gets it, onPress doesn't
// fire anyway".
function SplitScreenDiag({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<View>(null)
  const [dims, setDims] = useState(() => ({ window: Dimensions.get('window'), screen: Dimensions.get('screen') }))
  const [layout, setLayout] = useState({ w: 0, h: 0 })
  const [measY, setMeasY] = useState(0)
  const [diag, setDiag] = useState({ pressCount: 0, touchStartCount: 0, rect: tapDiag.plusButtonRect })

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', () => {
      setDims({ window: Dimensions.get('window'), screen: Dimensions.get('screen') })
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setDiag({ pressCount: tapDiag.plusPressCount, touchStartCount: tapDiag.plusTouchStartCount, rect: tapDiag.plusButtonRect })
    }, 200)
    return () => clearInterval(id)
  }, [])

  function remeasure() {
    rootRef.current?.measureInWindow((_x, y) => setMeasY(Math.round(y)))
  }

  const r = diag.rect
  return (
    <View
      ref={rootRef}
      style={{ flex: 1 }}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout
        setLayout({ w: Math.round(width), h: Math.round(height) })
        remeasure()
      }}
    >
      {children}
      <View style={{ position: 'absolute', top: 4, left: 0, right: 0, zIndex: 9999, alignItems: 'center' }} pointerEvents="none">
        <View style={{ backgroundColor: '#000000cc', padding: 4, maxWidth: '92%' }}>
          <Text style={{ color: '#0f0', fontSize: 9, textAlign: 'center' }}>
            {`px/dp ${PixelRatio.get()} win ${Math.round(dims.window.width)}x${Math.round(dims.window.height)} scr ${Math.round(dims.screen.width)}x${Math.round(dims.screen.height)}\nlayout ${layout.w}x${layout.h} measY ${measY}\nplusRect x${r.x} y${r.y} w${r.width} h${r.height}\ntouchStart ${diag.touchStartCount} pressCount ${diag.pressCount}`}
          </Text>
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

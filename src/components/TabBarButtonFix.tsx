import { View } from 'react-native'
import type { StyleProp, ViewStyle, GestureResponderEvent } from 'react-native'

// Split-screen touch bug workaround for the bottom tab bar. React
// Navigation's default tab bar button (rendered internally by Expo
// Router's <Tabs>) uses Pressability, the same mechanism proven to lose
// taps in split-screen everywhere else in the app (see PressFix.tsx).
// tabBarButton fully replaces the default button; `children` is already
// the rendered icon+label, so this just needs to claim the responder and
// forward the release to React Navigation's onPress.
type TabBarButtonFixProps = {
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: (e: GestureResponderEvent) => void
  testID?: string
  accessibilityLabel?: string
  accessibilityState?: { selected?: boolean }
}

export function TabBarButtonFix({ children, style, onPress, testID, accessibilityLabel, accessibilityState }: TabBarButtonFixProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      style={style}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderRelease={(e) => onPress?.(e)}
    >
      {children}
    </View>
  )
}

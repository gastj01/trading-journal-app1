import { useState } from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

// Split-screen touch bug workaround, as a drop-in TouchableOpacity
// replacement. Same onResponderRelease pattern already proven for the "+"
// button, Journal TradeItem, and Dashboard TradeRow (see app/(tabs)/index.tsx
// and app/(tabs)/journal.tsx): claiming the responder directly on a plain
// View and acting on onResponderRelease bypasses Pressability entirely,
// which is where split-screen taps were silently getting lost.
export function PressFix({ style, onPress, disabled, children }: {
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <View
      style={[style, pressed && { opacity: 0.6 }]}
      onStartShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={() => setPressed(true)}
      onResponderRelease={() => {
        setPressed(false)
        if (!disabled) onPress?.()
      }}
      onResponderTerminate={() => setPressed(false)}
    >
      {children}
    </View>
  )
}

// TEMP split-screen touch-bug diagnostic — remove once the bug is understood.
// Shared counter so we can see whether a TouchableOpacity's onPress actually
// fires, independent of what the native dispatchTouchEvent overlay shows.
export const tapDiag = {
  plusPressCount: 0,
  lastPlusPressAt: 0,
}

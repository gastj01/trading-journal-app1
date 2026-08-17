// TEMP split-screen touch-bug diagnostic — remove once the bug is understood.
// Shared counter so we can see whether a TouchableOpacity's onPress actually
// fires, independent of what the native dispatchTouchEvent overlay shows.
export const tapDiag = {
  plusPressCount: 0,
  lastPlusPressAt: 0,
  plusTouchStartCount: 0,
  // dp rect from measureInWindow() on the "+" TouchableOpacity, so the overlay
  // can be compared against the native px DOWN coordinate (converted via
  // PixelRatio) to tell a coordinate/density mismatch apart from a responder
  // path failure.
  plusButtonRect: { x: 0, y: 0, width: 0, height: 0 },
}

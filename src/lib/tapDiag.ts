// TEMP split-screen touch-bug diagnostic — remove once the bug is understood.
// Shared counter so we can see whether a TouchableOpacity's onPress actually
// fires, independent of what the native dispatchTouchEvent overlay shows.
export const tapDiag = {
  plusPressCount: 0,
  lastPlusPressAt: 0,
  plusTouchStartCount: 0,
  lastPlusTouchStartAt: 0,
  // Fires during the native responder negotiation's capture phase — added
  // because onTouchStart's reliability as a probe is unconfirmed (its count
  // couldn't be tied to a specific tap in testing, since these counters are
  // cumulative for the JS session, not per-tap).
  plusResponderCaptureCount: 0,
  lastPlusResponderCaptureAt: 0,
  // dp rect from measureInWindow() on the "+" TouchableOpacity, so the overlay
  // can be compared against the native px DOWN coordinate (converted via
  // PixelRatio) to tell a coordinate/density mismatch apart from a responder
  // path failure.
  plusButtonRect: { x: 0, y: 0, width: 0, height: 0 },
  // Same cap/ts probe as the "+" button, but wired to a wrapper around the
  // Journal TradeItem row instead — the "+" fix (onResponderRelease bypassing
  // Pressability) was only ever proven for the "+" button itself. This tells
  // us whether a dead row tap reaches JS at all via the classic responder
  // path, before spending effort converting rows to the same workaround.
  rowResponderCaptureCount: 0,
  lastRowResponderCaptureAt: 0,
  rowTouchStartCount: 0,
  lastRowTouchStartAt: 0,
}

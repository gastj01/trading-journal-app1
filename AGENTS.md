# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Buttons: use PressFix, not TouchableOpacity

Every new pressable element (button, icon button, chip, row, card, etc.) MUST use
`src/components/PressFix.tsx` instead of React Native's `TouchableOpacity` or `Pressable`.
For anything rendered via a `tabBarButton` render prop (bottom tab bar), use
`src/components/TabBarButtonFix.tsx` instead.

Why: on physical Android devices in split-screen/multi-window mode, RN's Pressability
(what `TouchableOpacity`/`Pressable` use internally) silently drops `onPress` for real
finger touches — the touch reaches JS (`onTouchStart`/responder capture fire fine), but
Pressability itself never turns it into a press, depending on touch input tool-type. The
classic `onResponderRelease` path (what `PressFix`/`TabBarButtonFix` use) is unaffected
and was confirmed fixed on-device. Full diagnosis history: root cause, ruled-out theories,
and the breakthrough that isolated it lives in this Codespace's Claude memory
(`project_splitscreen_bug_trading_journal.md`), not in this repo.

Most of the app has already been migrated. A handful of `TouchableOpacity` usages remain
deliberately (filter chips, a few pre-existing buttons never reported as broken) — leave
those alone unless asked to convert them; the point is that *new* pressables use PressFix
from the start.

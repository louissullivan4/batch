/**
 * Tap / long-press gesture handling shared by anything on the till that distinguishes a short tap
 * from a 500ms long-press (menu tiles: SPEC "Menu tile" — long-press adds default modifiers,
 * skipping the sheet). Includes an 80ms tap debounce per target: SPEC notes wet/gloved fingers
 * double-fire touch events, so a second `pointerup` within 80ms of the last accepted tap is dropped
 * rather than registering a second add.
 *
 * Pointer Events (not click) so the same handlers work for touch and, in dev, mouse — there is no
 * hover state to worry about (root CLAUDE.md: no hover carries meaning).
 */

import { useCallback, useRef } from 'react'

const LONG_PRESS_MS = 500
const TAP_DEBOUNCE_MS = 80

export interface TileGestureHandlers {
  readonly onPointerDown: () => void
  readonly onPointerUp: () => void
  readonly onPointerLeave: () => void
  readonly onPointerCancel: () => void
}

export function useTileGesture(onTap: () => void, onLongPress: () => void): TileGestureHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedLongPressRef = useRef(false)
  const lastTapAtRef = useRef(0)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(() => {
    firedLongPressRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      firedLongPressRef.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }, [clearTimer, onLongPress])

  const onPointerUp = useCallback(() => {
    clearTimer()
    if (firedLongPressRef.current) return
    const now = performance.now()
    if (now - lastTapAtRef.current < TAP_DEBOUNCE_MS) return
    lastTapAtRef.current = now
    onTap()
  }, [clearTimer, onTap])

  return { onPointerDown, onPointerUp, onPointerLeave: clearTimer, onPointerCancel: clearTimer }
}

/** Same 500ms long-press, no short-tap action — used by the wordmark to reach diagnostics. */
export function useLongPressOnly(onLongPress: () => void): {
  onPointerDown: () => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
} {
  return useTileGesture(() => undefined, onLongPress)
}

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

const REPEAT_START_MS = 500
const REPEAT_INTERVAL_MS = 200 // 5/s (SPEC "long-press repeats at 5/s" — Screen 1/3 denomination steppers)

export interface RepeatPressHandlers {
  readonly onPointerDown: () => void
  readonly onPointerUp: () => void
  readonly onPointerLeave: () => void
  readonly onPointerCancel: () => void
}

/**
 * A stepper button that fires once on tap and, if held past 500ms, repeats at 5/s until released
 * (SPEC denomination counter). Distinct from `useTileGesture`: a stepper's long-press *repeats the
 * same action*, it doesn't switch to a different one.
 */
export function useRepeatPress(onStep: () => void): RepeatPressHandlers {
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const firedOnceRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (startTimerRef.current !== null) {
      clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
    if (repeatTimerRef.current !== null) {
      clearInterval(repeatTimerRef.current)
      repeatTimerRef.current = null
    }
  }, [])

  const onPointerDown = useCallback(() => {
    firedOnceRef.current = true
    onStep() // immediate first step on tap-down, same as a plain button
    startTimerRef.current = setTimeout(() => {
      repeatTimerRef.current = setInterval(onStep, REPEAT_INTERVAL_MS)
    }, REPEAT_START_MS)
  }, [onStep])

  const onPointerUp = useCallback(() => {
    clearTimers()
    firedOnceRef.current = false
  }, [clearTimers])

  return { onPointerDown, onPointerUp, onPointerLeave: onPointerUp, onPointerCancel: onPointerUp }
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

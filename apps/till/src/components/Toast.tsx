/**
 * A single non-blocking toast (SPEC: 86'd tile, full-storage write failure, shift-pill stub). Never a
 * modal — no scrim, no focus trap, auto-dismisses, and never sits on the primary action a barista's
 * thumb is about to hit.
 */

import { useEffect } from 'react'
import './Toast.css'

export interface ToastState {
  readonly id: number
  readonly message: string
}

export interface ToastProps {
  readonly toast: ToastState | null
  readonly onDismiss: () => void
  readonly durationMs?: number
}

export function Toast({ toast, onDismiss, durationMs = 3000 }: ToastProps): JSX.Element | null {
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(t)
  }, [toast, onDismiss, durationMs])

  if (!toast) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      {toast.message}
    </div>
  )
}

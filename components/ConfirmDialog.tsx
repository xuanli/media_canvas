'use client'

// Task 17B: in-app replacement for native `window.confirm()` on the two
// delete-canvas call sites (TopNav's switcher row, the landing page's canvas
// cards) — a plain browser confirm() dialog can't be styled and looks
// jarring against the app's own chrome. Controlled component: the caller
// owns `open` (which canvas id, if any, is pending deletion) and both
// outcomes (`onConfirm`/`onCancel`) — this component has no delete logic of
// its own.
//
// Stacking: rendered at the call sites' own component roots (no portal
// needed) — `position: fixed` escapes any ancestor's normal-flow layout
// regardless of DOM nesting depth as long as no ancestor sets a
// transform/filter/will-change (none do here), and `zIndex: 1000` matches
// the app's one other full-screen gate (PasscodeGate) as the highest layer
// in use — above TopNav's own dropdowns (401) and the floating command bar
// (300).

import { useEffect, useId, useRef, useState } from 'react'
import { color, metric, type as typeTok, buttonSecondary } from '@/lib/design'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red-toned confirm button for destructive actions (e.g. delete). */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  // Lazy initializer runs once at mount (this component stays mounted for
  // its whole lifetime — the call sites always render it, `open` just
  // toggles whether it returns a dialog or null — so one read per session
  // is enough; it doesn't need to track live changes to the OS setting).
  // Guarded for SSR: `typeof window` is safe even where `window` doesn't
  // exist, and this only ever matters once `open` is true, which never
  // happens during the initial (server) render.
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  // Gates the 120ms fade/scale-in — starts false every time the dialog
  // opens, flips true a frame later so the transition actually runs (going
  // straight to the end state on mount would skip it). Under reduced
  // motion the transition itself is set to 'none' (see render below), so
  // this same flip just snaps instantly instead of animating.
  const [entered, setEntered] = useState(false)

  // Open/close lifecycle: on open, remember what had focus (so it can be
  // restored) and move focus to Cancel — the safe default for a destructive
  // confirm, so a stray Enter doesn't delete anything. On close (prop flips
  // to false, OR unmount), restore focus to the invoking element if it's
  // still around, and reset `entered` so the next open re-animates.
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()

    const raf = requestAnimationFrame(() => setEntered(true))
    return () => {
      cancelAnimationFrame(raf)
      setEntered(false)
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  // Escape cancels. Registered on `document` with `{ capture: true }` (not
  // just this panel's own onKeyDown) so it's guaranteed to see the keypress
  // even when focus/the event path never comes near this subtree, matching
  // TopNav's own dropdown-dismiss listeners' rationale. `stopPropagation()`
  // keeps this keypress from ALSO reaching whatever Esc handling sits below
  // this dialog (CanvasApp's tool-deselect, etc.) once it's been consumed
  // here — the confirm dialog is the topmost layer and should swallow it.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [open, onCancel])

  if (!open) return null

  const confirmBtnStyle = {
    height: metric.controlH,
    padding: `0 ${metric.paddingX}px`,
    background: danger ? color.danger : color.accent,
    // Dark text on the light fill, same "dark-on-light-accent" pairing as
    // buttonPrimary's accent/accentText — color.danger has no dedicated
    // "on-danger" text token, so navBg (the app's near-black surface) is
    // reused here for the same high-contrast effect.
    color: danger ? color.navBg : color.accentText,
    border: '1px solid transparent',
    borderRadius: metric.radius,
    fontFamily: typeTok.fontUi,
    fontSize: typeTok.base,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box' as const,
  }

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360,
          maxWidth: '100%',
          background: color.overlayBg,
          border: `1px solid ${color.border}`,
          borderRadius: metric.radiusLg,
          padding: 20,
          boxSizing: 'border-box',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          fontFamily: typeTok.fontUi,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          opacity: entered ? 1 : 0,
          transform: entered ? 'scale(1)' : 'scale(0.96)',
          transition: reduceMotion ? 'none' : 'opacity 120ms ease-out, transform 120ms ease-out',
        }}
      >
        <div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: color.text }}>
          {title}
        </div>
        <div style={{ fontSize: typeTok.base, color: color.textSecondary, lineHeight: 1.4 }}>{body}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: metric.gapSm, marginTop: 4 }}>
          <button ref={cancelRef} type="button" className="gm-btn" style={buttonSecondary()} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="gm-btn" style={confirmBtnStyle} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

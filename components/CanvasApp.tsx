'use client'

import { Tldraw, loadSnapshot, useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { TopNav } from '@/components/TopNav'
import { CommandBar } from '@/components/CommandBar'
import { PasscodeGate } from '@/components/PasscodeGate'
import { retryShape } from '@/lib/run-op'
import { startSaveSync } from '@/lib/save-sync'
import { useUiStore } from '@/lib/ui-store'
import { sweepInterruptedNodes } from '@/lib/sweep-interrupted'

export function CanvasApp({ canvasId }: { canvasId: string }) {
  const editorRef = useRef<Editor | null>(null)

  // Loads the stored snapshot (if any — a fresh/never-saved id, e.g. the
  // permanent `/c/local` demo id, 404s and just starts empty) then hands off
  // to startSaveSync for debounced autosave. Returning the stop function lets
  // tldraw's TLOnMountHandler run it as unmount cleanup (confirmed present in
  // the installed 5.2.5 types: `onMount?(editor): (() => void) | void`).
  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      // Force dark mode (human-reported: canvas was rendering tldraw's light
      // theme, clashing with the rest of the app's dark chrome).
      // `editor.user.updateUserPreferences` is the documented source of
      // truth for the color-mode preference (5.2.5 TLUserPreferences.
      // colorScheme: 'dark'|'light'|'system' — verified in the installed
      // @tldraw/editor types); setting it here always wins over the OS
      // theme, unlike a `system`-following prop. Set synchronously so the
      // first paint is already dark, not just after the snapshot fetch.
      editor.user.updateUserPreferences({ colorScheme: 'dark' })
      let stopSaveSync: (() => void) | null = null
      let cancelled = false
      void (async () => {
        try {
          const res = await fetch(`/api/canvas/${canvasId}`, { cache: 'no-store' })
          if (res.ok) {
            const snapshot = await res.json()
            loadSnapshot(editor.store, snapshot)
            sweepInterruptedNodes(editor)
          }
        } catch {
          // Network error: fall through and start empty, same as a 404.
        }
        if (!cancelled) stopSaveSync = startSaveSync(editor, canvasId)
      })()
      return () => {
        cancelled = true
        stopSaveSync?.()
      }
    },
    [canvasId]
  )

  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ shapeId?: TLShapeId }>).detail?.shapeId
      if (editorRef.current && id) {
        retryShape(editorRef.current, id)
      }
    }
    window.addEventListener('gm:retry', h)
    return () => window.removeEventListener('gm:retry', h)
  }, [])

  // Global Esc layering (Task 12 polish): one level backs out per press.
  // `useUiStore.getState()` (not the `useUiStore()` hook) deliberately reads
  // fresh state at *keypress* time instead of subscribing — this listener is
  // attached once (empty deps) rather than re-attached on every armedTool /
  // pickingRef change. It runs alongside use-drag-rect.ts's own Escape
  // listener (scoped to the mounted Crop/RegionOverlay, which also clears
  // the in-progress rect); both may fire on the same keypress and both end
  // up disarming — redundant but idempotent, not a double-disarm.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const { pickingRef, setPickingRef, armedTool, setArmedTool } = useUiStore.getState()
      if (pickingRef) {
        setPickingRef(false)
        return
      }
      if (armedTool) {
        setArmedTool(null)
        return
      }
      editorRef.current?.selectNone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }} data-canvas-id={canvasId}>
      <PasscodeGate>
        {/* hideUi removes tldraw's default toolbar/menus (installed prop,
            verified in node_modules @tldraw/editor TldrawBaseProps) — our own
            chrome (TopNav + CommandBar, v2 chrome Task 14) replaces it. */}
        <Tldraw
          shapeUtils={[ImageNodeUtil]}
          onMount={onMount}
          hideUi
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        >
          <TopNav canvasId={canvasId} />
          <CommandBar />
          <EmptyHint />
        </Tldraw>
      </PasscodeGate>
    </div>
  )
}

// Empty-canvas hint (polish): reactive over the store so it disappears the
// instant a first node is created (pending or done — the point is "you've
// started", not "generation finished").
function EmptyHint() {
  const editor = useEditor()
  const empty = useValue(
    'canvas-empty',
    () => editor.getCurrentPageShapes().every((s) => s.type !== 'image-node'),
    [editor]
  )
  if (!empty) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: '42%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 100,
        color: '#5b6472',
        fontSize: 14,
        pointerEvents: 'none',
        textAlign: 'center',
      }}
    >
      Type a prompt below to generate your first image
    </div>
  )
}

'use client'

import { Tldraw, loadSnapshot, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { PromptBar } from '@/components/PromptBar'
import { ActionMenu } from '@/components/ActionMenu'
import { Inspector } from '@/components/Inspector'
import { PasscodeGate } from '@/components/PasscodeGate'
import { retryShape } from '@/lib/run-op'
import { startSaveSync } from '@/lib/save-sync'

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
      let stopSaveSync: (() => void) | null = null
      let cancelled = false
      void (async () => {
        try {
          const res = await fetch(`/api/canvas/${canvasId}`, { cache: 'no-store' })
          if (res.ok) {
            const snapshot = await res.json()
            loadSnapshot(editor.store, snapshot)
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

  return (
    <div style={{ position: 'fixed', inset: 0 }} data-canvas-id={canvasId}>
      <PasscodeGate>
        {/* hideUi removes tldraw's default toolbar/menus (installed prop,
            verified in node_modules @tldraw/editor TldrawBaseProps) — our own
            verb UI (PromptBar now, node action menu in later tasks) replaces
            it. */}
        <Tldraw shapeUtils={[ImageNodeUtil]} onMount={onMount} hideUi>
          <PromptBar />
          <ActionMenu />
          <Inspector />
        </Tldraw>
      </PasscodeGate>
    </div>
  )
}

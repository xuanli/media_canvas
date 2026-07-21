'use client'

import { Tldraw, getSnapshot, loadSnapshot, useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef, type ChangeEvent, type CSSProperties } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { PromptBar } from '@/components/PromptBar'
import { ActionMenu } from '@/components/ActionMenu'
import { Inspector } from '@/components/Inspector'
import { PasscodeGate } from '@/components/PasscodeGate'
import { retryShape } from '@/lib/run-op'
import { startSaveSync } from '@/lib/save-sync'
import { useUiStore } from '@/lib/ui-store'

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
            verb UI (PromptBar now, node action menu in later tasks) replaces
            it. */}
        <Tldraw shapeUtils={[ImageNodeUtil]} onMount={onMount} hideUi>
          <PromptBar />
          <ActionMenu />
          <Inspector />
          <TopBar />
          <EmptyHint />
        </Tldraw>
      </PasscodeGate>
    </div>
  )
}

const topBarBtn: CSSProperties = {
  background: '#181c22',
  color: '#dfe5ec',
  border: '1px solid #2d3540',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 11,
  cursor: 'pointer',
}

// Export/Import (polish, top-right): export downloads the full store
// snapshot (`getSnapshot`) as JSON; import reads a file back through
// `loadSnapshot` on the same store, so it replaces the current canvas'
// content in place (no new canvasId, no server round-trip). Anchored at
// top:12/right:12 — Inspector.tsx sits at top:48 specifically to leave this
// row clear rather than overlap it (see that file's `panel` comment).
function TopBar() {
  const editor = useEditor()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onExport = () => {
    const snapshot = getSnapshot(editor.store)
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gen-media-canvas.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same filename twice in a row
    if (!file) return
    try {
      const snapshot = JSON.parse(await file.text())
      loadSnapshot(editor.store, snapshot)
    } catch {
      // Best-effort polish item: a malformed/non-canvas JSON file is a
      // silent no-op rather than a crash.
    }
  }

  return (
    <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 300, display: 'flex', gap: 6 }}>
      <button onClick={onExport} style={topBarBtn}>
        Export JSON
      </button>
      <button onClick={() => fileInputRef.current?.click()} style={topBarBtn}>
        Import JSON
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        onChange={(e) => void onImportChange(e)}
        style={{ display: 'none' }}
      />
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

'use client'

import { useEffect, useState } from 'react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { createArrow } from '@/lib/run-op'
import { color } from '@/lib/design'

// Connect flow (2026-07-21, replaces the short-lived "⤳ Connect" verb
// button): mounted as a Tldraw child in CanvasApp; renders nothing until a
// node's port dot sets ui-store.connectFrom. Then a full-canvas overlay
// tracks the cursor, draws a dashed teal line from the source node's right
// edge, and the next click either completes (clicked an image-node that
// isn't the source → bound arrow via run-op's createArrow, same styling and
// cascade-delete behavior as the auto-created provenance arrows) or cancels
// (empty canvas / the source itself). Esc cancel lives in CanvasApp's global
// Esc handler as its own top tier — not here — matching how pickingRef is
// owned there.
//
// Coordinates: everything is drawn in container-local px. pageToScreen gives
// client px; subtracting editor.getViewportScreenBounds() (the tldraw
// container's own client rect, read reactively via useValue — no render-time
// ref access) converts to container space, which is exactly this overlay's
// coordinate space since it's absolutely positioned at inset 0.
export function ConnectOverlay() {
  const editor = useEditor()
  const connectFrom = useUiStore((s) => s.connectFrom)
  const setConnectFrom = useUiStore((s) => s.setConnectFrom)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // Re-render on camera moves so the source anchor tracks the node while
  // panning/zooming mid-connect.
  useValue('connect-camera', () => editor.getCamera(), [editor])
  const sourceExists = useValue(
    'connect-source-exists',
    () => !!(connectFrom && editor.getShape(connectFrom as TLShapeId)),
    [editor, connectFrom]
  )

  // Source deleted mid-connect (or a stale id from a loaded snapshot) —
  // clear the flow in an effect, never during render.
  useEffect(() => {
    if (connectFrom && !sourceExists) setConnectFrom(null)
  }, [connectFrom, sourceExists, setConnectFrom])

  if (!connectFrom || !sourceExists) return null

  const bounds = editor.getShapePageBounds(connectFrom as TLShapeId)
  if (!bounds) return null
  const viewport = editor.getViewportScreenBounds()
  const anchorScreen = editor.pageToScreen({ x: bounds.maxX, y: bounds.midY })
  const anchor = { x: anchorScreen.x - viewport.x, y: anchorScreen.y - viewport.y }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    setCursor({ x: e.clientX - viewport.x, y: e.clientY - viewport.y })
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const page = editor.screenToPage({ x: e.clientX, y: e.clientY })
    // Topmost image-node under the click (sorted list is back-to-front).
    const target = editor
      .getCurrentPageShapesSorted()
      .filter((s) => s.type === 'image-node' && s.id !== connectFrom)
      .reverse()
      .find((s) => {
        const b = editor.getShapePageBounds(s.id)
        return b && page.x >= b.minX && page.x <= b.maxX && page.y >= b.minY && page.y <= b.maxY
      })
    if (target) createArrow(editor, connectFrom as TLShapeId, target.id, '')
    setConnectFrom(null)
    setCursor(null)
  }

  return (
    <div
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'all',
        zIndex: 300,
      }}
    >
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {cursor && (
          <line
            x1={anchor.x}
            y1={anchor.y}
            x2={cursor.x}
            y2={cursor.y}
            stroke={color.accent}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: color.barBg,
          border: `1px solid ${color.border}`,
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          color: color.textSecondary,
        }}
      >
        click a node to connect — Esc to cancel
      </div>
    </div>
  )
}

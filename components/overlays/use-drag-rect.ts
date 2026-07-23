'use client'

import { useEffect, useRef, type PointerEvent, type RefObject } from 'react'
import type { RectFrac } from '@/lib/types'

// Shared by CropOverlay and RegionOverlay (Task 11 extraction — the two
// overlays' pointer/fraction math was verbatim-identical, which the review
// pipeline flags). Coordinates are tracked as FRACTIONS (0..1) of the
// container's own measured on-screen box (containerRef.getBoundingClientRect()),
// not a synthetic display-unit rect — see CropOverlay's leading comment /
// task-10-report.md "Fix round 1" for the full rationale on why fractions of
// the real measured box are what get stored.
function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): RectFrac {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export interface DragRectHandlers {
  containerRef: RefObject<HTMLDivElement | null>
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void
}

// `onEscape` is called (in addition to clearing the rect) when the user hits
// Escape — both overlays use it to disarm the tool, so it lives here instead
// of being copy-pasted into each overlay's own keydown effect.
//
// Two drag modes (user-reported: "the crop box can't be moved"): pointerdown
// INSIDE the existing rect grabs and translates it (size preserved, clamped
// to the 0..1 box); pointerdown anywhere else draws a fresh rect, as before.
// `rectFrac` is passed in for the hit-test — both overlays already subscribe
// to it for rendering, so this adds no new store coupling.
// Round 3 (user 2026-07-22: "are the box resizable?" — they weren't):
// pointerdown near a CORNER of the existing rect grabs that corner and
// resizes against the opposite (anchor) corner; the overlays render small
// corner handles for discoverability. Corner hit wins over inside-move.
type DragState =
  | { mode: 'draw'; start: { x: number; y: number } }
  | { mode: 'move'; grab: { dx: number; dy: number }; size: { w: number; h: number } }
  | { mode: 'resize'; anchor: { x: number; y: number } }

export function useDragRect(
  rectFrac: RectFrac | null,
  setRectFrac: (r: RectFrac | null) => void,
  onEscape?: () => void
): DragRectHandlers {
  const containerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)

  const toFrac = (e: PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const r = containerRef.current!.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    return { x: fx, y: fy }
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toFrac(e)
    const r = rectFrac
    if (r && r.w > 0 && r.h > 0) {
      // Corner hit-test first (12px screen tolerance, converted to
      // fractions of the measured box so it's zoom-consistent on screen).
      const cr = containerRef.current!.getBoundingClientRect()
      const tolX = 12 / cr.width
      const tolY = 12 / cr.height
      const corners = [
        { c: { x: r.x, y: r.y }, anchor: { x: r.x + r.w, y: r.y + r.h } },
        { c: { x: r.x + r.w, y: r.y }, anchor: { x: r.x, y: r.y + r.h } },
        { c: { x: r.x, y: r.y + r.h }, anchor: { x: r.x + r.w, y: r.y } },
        { c: { x: r.x + r.w, y: r.y + r.h }, anchor: { x: r.x, y: r.y } },
      ]
      const hit = corners.find(({ c }) => Math.abs(p.x - c.x) <= tolX && Math.abs(p.y - c.y) <= tolY)
      if (hit) {
        drag.current = { mode: 'resize', anchor: hit.anchor }
        return
      }
      const insideRect = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
      if (insideRect) {
        drag.current = { mode: 'move', grab: { dx: p.x - r.x, dy: p.y - r.y }, size: { w: r.w, h: r.h } }
        return
      }
    }
    drag.current = { mode: 'draw', start: p }
    setRectFrac({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const d = drag.current
    if (!d) return
    const p = toFrac(e)
    if (d.mode === 'draw') {
      setRectFrac(rectFrom(d.start, p))
    } else if (d.mode === 'resize') {
      setRectFrac(rectFrom(d.anchor, p))
    } else {
      // Clamp so the whole rect stays inside the image; toFrac already
      // clamps the pointer itself, this clamps the far edge too.
      const x = Math.min(Math.max(0, p.x - d.grab.dx), 1 - d.size.w)
      const y = Math.min(Math.max(0, p.y - d.grab.dy), 1 - d.size.h)
      setRectFrac({ x, y, w: d.size.w, h: d.size.h })
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    drag.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setRectFrac(null)
      onEscape?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setRectFrac, onEscape])

  return { containerRef, onPointerDown, onPointerMove, onPointerUp }
}

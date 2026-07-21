'use client'

import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
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
export function useDragRect(
  setRectFrac: (r: RectFrac | null) => void,
  onEscape?: () => void
): DragRectHandlers {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)

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
    dragStart.current = p
    setDragging(true)
    setRectFrac({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!dragging || !dragStart.current) return
    setRectFrac(rectFrom(dragStart.current, toFrac(e)))
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    setDragging(false)
    dragStart.current = null
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

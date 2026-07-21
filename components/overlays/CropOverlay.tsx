'use client'

import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/lib/ui-store'
import type { Rect } from '@/lib/types'

// Draws over the AssetView inside a selected, crop-armed ImageNodeShape.
// Coordinates are tracked as FRACTIONS (0..1) of the overlay's own rendered
// box, then converted to "display units" (CSS px at the shape's natural
// display width `w`) before being written to ui-store. Fractions are
// zoom-invariant (numerator and denominator both scale with the tldraw
// camera), so no camera/zoom lookup is needed here — see task-10-report.md.
function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export function CropOverlay({
  w,
  naturalW,
  naturalH,
}: {
  w: number // display width = shape.props.w - 8 (padding), matches Inspector's displayRectToNatural call
  naturalW: number
  naturalH: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const cropRect = useUiStore((s) => s.cropRect)
  const setCropRect = useUiStore((s) => s.setCropRect)
  const setArmedTool = useUiStore((s) => s.setArmedTool)

  // Container's aspect matches the natural image's (shape height is derived
  // from naturalH/naturalW when the node was created), so we can derive the
  // display-unit height from the display-unit width without measuring the
  // DOM — keeps x/y on the same scale that displayRectToNatural expects.
  const dH = naturalW > 0 ? w * (naturalH / naturalW) : w

  const toDisplay = (e: React.PointerEvent): { x: number; y: number } => {
    const r = containerRef.current!.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    return { x: fx * w, y: fy * dH }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toDisplay(e)
    dragStart.current = p
    setDragging(true)
    setCropRect({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!dragging || !dragStart.current) return
    setCropRect(rectFrom(dragStart.current, toDisplay(e)))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    setDragging(false)
    dragStart.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setCropRect(null)
      setArmedTool(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCropRect, setArmedTool])

  const box =
    cropRect && w > 0 && dH > 0
      ? {
          left: `${(cropRect.x / w) * 100}%`,
          top: `${(cropRect.y / dH) * 100}%`,
          width: `${(cropRect.w / w) * 100}%`,
          height: `${(cropRect.h / dH) * 100}%`,
        }
      : null

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'all',
        zIndex: 10,
      }}
    >
      {box && (
        <div
          style={{
            position: 'absolute',
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,.55)',
            border: '1px solid #2dd4bf',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}

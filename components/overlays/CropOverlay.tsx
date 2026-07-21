'use client'

import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/lib/ui-store'
import type { RectFrac } from '@/lib/types'

// Draws over the AssetView inside a selected, crop-armed ImageNodeShape.
// Coordinates are tracked as FRACTIONS (0..1) of the overlay's own rendered
// box (measured via containerRef.getBoundingClientRect(), so it's exactly
// the real on-screen box — no assumption about its aspect ratio) and stored
// as-is in ui-store. Fractions are zoom-invariant (numerator and denominator
// both scale with the tldraw camera), so no camera/zoom lookup is needed
// here — see task-10-report.md.
//
// Fix round 1: this used to also derive a synthetic display height
// `dH = w * naturalH/naturalW` and convert fractions into that "display
// unit" space before handing them to Inspector's displayRectToNatural. That
// assumed the rendered box's aspect ratio equals naturalW:naturalH, which
// wasn't quite true (IMAGE_NODE_W=240 unpadded vs. 232 padded content width
// plus a font-dependent label row), causing a systematic ~1% crop/mask
// offset. Storing raw fractions of the REAL measured box — with AssetView
// now using objectFit: 'fill' — sidesteps the synthetic ratio entirely:
// Inspector converts fx/fy/fw/fh directly to natural px with no intermediate
// display-space representation.
function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): RectFrac {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

export function CropOverlay() {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const cropFrac = useUiStore((s) => s.cropFrac)
  const setCropFrac = useUiStore((s) => s.setCropFrac)
  const setArmedTool = useUiStore((s) => s.setArmedTool)

  const toFrac = (e: React.PointerEvent): { x: number; y: number } => {
    const r = containerRef.current!.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    return { x: fx, y: fy }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = toFrac(e)
    dragStart.current = p
    setDragging(true)
    setCropFrac({ x: p.x, y: p.y, w: 0, h: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!dragging || !dragStart.current) return
    setCropFrac(rectFrom(dragStart.current, toFrac(e)))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    setDragging(false)
    dragStart.current = null
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setCropFrac(null)
      setArmedTool(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setCropFrac, setArmedTool])

  const box = cropFrac
    ? {
        left: `${cropFrac.x * 100}%`,
        top: `${cropFrac.y * 100}%`,
        width: `${cropFrac.w * 100}%`,
        height: `${cropFrac.h * 100}%`,
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

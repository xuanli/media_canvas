'use client'

import { useUiStore } from '@/lib/ui-store'
import { useDragRect } from '@/components/overlays/use-drag-rect'

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
//
// Task 11: the pointer-drag/fraction math is shared with RegionOverlay
// (inpaint) — extracted into `use-drag-rect.ts` rather than duplicated.
export function CropOverlay() {
  const cropFrac = useUiStore((s) => s.cropFrac)
  const setCropFrac = useUiStore((s) => s.setCropFrac)
  const setArmedTool = useUiStore((s) => s.setArmedTool)
  const { containerRef, onPointerDown, onPointerMove, onPointerUp } = useDragRect(
    cropFrac,
    setCropFrac,
    () => setArmedTool(null)
  )

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
            cursor: 'move',
          }}
        />
      )}
    </div>
  )
}

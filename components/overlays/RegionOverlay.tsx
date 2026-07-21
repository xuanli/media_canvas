'use client'

import { useUiStore } from '@/lib/ui-store'
import { useDragRect } from '@/components/overlays/use-drag-rect'

// Draws over the AssetView inside a selected, inpaint-armed ImageNodeShape.
// Same pointer/fraction-of-measured-box pattern as CropOverlay (see its
// leading comment + task-10-report.md "Fix round 1") via the shared
// `useDragRect` hook — only the marquee's visual style differs: a dashed
// teal outline (vs. crop's solid) to read as "region to replace", not "crop
// to these bounds".
//
// Storage: reuses ui-store's `cropFrac` field rather than adding a parallel
// `regionFrac`. Only one region-drawing tool (crop XOR inpaint) is ever
// armed at a time (ActionMenu's verbs are mutually exclusive and Inspector
// clears the rect on every armedTool change — see Inspector.tsx), so the
// field is never read by two consumers simultaneously; a second field would
// just be a rename with no behavioral difference. See ui-store.ts for the
// field's updated doc comment.
export function RegionOverlay() {
  const cropFrac = useUiStore((s) => s.cropFrac)
  const setCropFrac = useUiStore((s) => s.setCropFrac)
  const setArmedTool = useUiStore((s) => s.setArmedTool)
  const { containerRef, onPointerDown, onPointerMove, onPointerUp } = useDragRect(
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
            border: '1px dashed #2dd4bf',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  )
}

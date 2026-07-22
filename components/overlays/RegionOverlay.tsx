'use client'

import { useUiStore } from '@/lib/ui-store'
import { useDragRect } from '@/components/overlays/use-drag-rect'

// Draws over the AssetView inside a selected ImageNodeShape while Edit is
// armed AND its "Select region" toggle is on (Task 18: absorbed the old
// standalone Inpaint verb — see ImageNodeShape.tsx's `showRegionOverlay`
// render gate, now `armedTool === 'edit' && regionMode` instead of
// `armedTool === 'inpaint'`). Same pointer/fraction-of-measured-box pattern
// as CropOverlay (see its leading comment + task-10-report.md "Fix round
// 1") via the shared `useDragRect` hook — only the marquee's visual style
// differs: a dashed teal outline (vs. crop's solid) to read as "region to
// replace", not "crop to these bounds".
//
// Storage: reuses ui-store's `cropFrac` field rather than adding a parallel
// `regionFrac`. Only one region-drawing tool (crop XOR edit-with-region) is
// ever armed at a time (CommandBar's verbs are mutually exclusive and
// clears the rect on every armedTool change — see CommandBar.tsx), so the
// field is never read by two consumers simultaneously; a second field would
// just be a rename with no behavioral difference. See ui-store.ts for the
// field's updated doc comment.
//
// Esc handling (Task 18): on Escape this only turns `regionMode` off (NOT
// `setArmedTool(null)`) — CanvasApp.tsx's global Esc listener owns the
// "clear region first, then disarm the tray on a second press" layering by
// checking `armedTool === 'edit' && regionMode` as its own intermediate
// tier before the generic armedTool-disarm tier. This listener firing too
// (idempotently clearing the same regionMode/cropFrac) on the same keypress
// is the same "redundant but idempotent, not a double-disarm" pattern
// CanvasApp.tsx's comment already documents for CropOverlay.
export function RegionOverlay() {
  const cropFrac = useUiStore((s) => s.cropFrac)
  const setCropFrac = useUiStore((s) => s.setCropFrac)
  const setRegionMode = useUiStore((s) => s.setRegionMode)
  const { containerRef, onPointerDown, onPointerMove, onPointerUp } = useDragRect(
    setCropFrac,
    () => setRegionMode(false)
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

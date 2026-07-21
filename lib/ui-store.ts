import { create } from 'zustand'
import type { RectFrac } from '@/lib/types'

type Tool = null | 'edit' | 'inpaint' | 'crop' | 'resize' | 'vary'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  // Ephemeral: the in-progress region rect drawn by CropOverlay OR
  // RegionOverlay (inpaint), as FRACTIONS (0..1) of the overlay's own
  // measured box — not a synthetic display-unit rect. Not persisted —
  // cleared on apply/cancel/deselect, never written to a shape. See
  // task-10-report.md "Fix round 1" for why this replaced the old
  // display-px Rect representation. Named `cropFrac` from when crop was the
  // only region tool (Task 10); Task 11 added inpaint reusing the same
  // field — deliberately not renamed to `regionFrac` since only one region
  // tool is ever armed at a time (see RegionOverlay.tsx's comment) and the
  // rename would be pure churn.
  cropFrac: RectFrac | null
  setArmedTool: (t: Tool) => void
  setPickingRef: (v: boolean) => void
  setCropFrac: (r: RectFrac | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  armedTool: null,
  pickingRef: false,
  cropFrac: null,
  setArmedTool: (armedTool) => set({ armedTool }),
  setPickingRef: (pickingRef) => set({ pickingRef }),
  setCropFrac: (cropFrac) => set({ cropFrac }),
}))

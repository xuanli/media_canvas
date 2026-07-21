import { create } from 'zustand'
import type { RectFrac } from '@/lib/types'

type Tool = null | 'edit' | 'inpaint' | 'crop' | 'resize' | 'vary'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  // Ephemeral: the in-progress crop rect drawn by CropOverlay, as FRACTIONS
  // (0..1) of the overlay's own measured box — not a synthetic display-unit
  // rect. Not persisted — cleared on apply/cancel/deselect, never written to
  // a shape. See task-10-report.md "Fix round 1" for why this replaced the
  // old display-px Rect representation.
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

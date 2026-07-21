import { create } from 'zustand'
import type { Rect } from '@/lib/types'

type Tool = null | 'edit' | 'inpaint' | 'crop' | 'resize' | 'vary'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  // Ephemeral: the in-progress crop rect drawn by CropOverlay, in "display"
  // units (the image area's CSS px at shape.props.w - 8 padding). Not
  // persisted — cleared on apply/cancel/deselect, never written to a shape.
  cropRect: Rect | null
  setArmedTool: (t: Tool) => void
  setPickingRef: (v: boolean) => void
  setCropRect: (r: Rect | null) => void
}

export const useUiStore = create<UiState>((set) => ({
  armedTool: null,
  pickingRef: false,
  cropRect: null,
  setArmedTool: (armedTool) => set({ armedTool }),
  setPickingRef: (pickingRef) => set({ pickingRef }),
  setCropRect: (cropRect) => set({ cropRect }),
}))

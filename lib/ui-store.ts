import { create } from 'zustand'

type Tool = null | 'edit' | 'inpaint' | 'crop' | 'resize' | 'vary'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  setArmedTool: (t: Tool) => void
  setPickingRef: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  armedTool: null,
  pickingRef: false,
  setArmedTool: (armedTool) => set({ armedTool }),
  setPickingRef: (pickingRef) => set({ pickingRef }),
}))

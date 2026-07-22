import { create } from 'zustand'
import type { RectFrac } from '@/lib/types'

// Task 15D (user decision 2026-07-21): 'vary' removed — the verb fired an
// immediate no-form edit op and the user asked for it gone outright, not
// hidden. Existing canvas nodes previously created via Vary are just plain
// 'edit' ops in their stored recipe (lib/run-op.ts's Vary call site always
// dispatched `{ type: 'edit', ... }` — there was never a distinct 'vary' op
// type on the node's own props), so no persisted data references this
// union member and nothing needs a migration.
type Tool = null | 'edit' | 'inpaint' | 'crop' | 'resize'

// v2 chrome (Task 14): mirrors save-sync.ts's title-bar dirty/error signal
// as ui-store state so TopNav's save dot can render it reactively instead of
// polling document.title. save-sync.ts sets this IN ADDITION to (not instead
// of) the title updates — the title stays as a secondary, tab-visible signal.
type SaveState = 'saved' | 'saving' | 'error'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  saveState: SaveState
  setSaveState: (s: SaveState) => void
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
  saveState: 'saved',
  cropFrac: null,
  setArmedTool: (armedTool) => set({ armedTool }),
  setPickingRef: (pickingRef) => set({ pickingRef }),
  setSaveState: (saveState) => set({ saveState }),
  setCropFrac: (cropFrac) => set({ cropFrac }),
}))

import { create } from 'zustand'
import type { RectFrac } from '@/lib/types'

// Task 15D (user decision 2026-07-21): 'vary' removed — the verb fired an
// immediate no-form edit op and the user asked for it gone outright, not
// hidden. Existing canvas nodes previously created via Vary are just plain
// 'edit' ops in their stored recipe (lib/run-op.ts's Vary call site always
// dispatched `{ type: 'edit', ... }` — there was never a distinct 'vary' op
// type on the node's own props), so no persisted data references this
// union member and nothing needs a migration.
//
// Task 18 (user decision 2026-07-21, supersedes CLAUDE.md's earlier
// same-day "Edit and Inpaint stay SEPARATE" note): 'inpaint' removed from
// this union the same way 'vary' was — it's now a region-optional mode of
// 'edit' (see the new `regionMode` field below), not its own armed tool.
// Every node previously created via the Inpaint verb still stores a plain
// `{ type: 'inpaint', ... }` op (run-op.ts's dispatch/schema are UNCHANGED
// by this task — only the CommandBar UI that arms the region-fill path
// moved), so no persisted data references this union member either.
type Tool = null | 'edit' | 'crop' | 'resize'

// v2 chrome (Task 14): mirrors save-sync.ts's title-bar dirty/error signal
// as ui-store state so TopNav's save dot can render it reactively instead of
// polling document.title. save-sync.ts sets this IN ADDITION to (not instead
// of) the title updates — the title stays as a secondary, tab-visible signal.
type SaveState = 'saved' | 'saving' | 'error'

// Assets drawer (user 2026-07-21, replaces the small popover): 'add' = pick
// drops onto canvas as a root node; 'attach' = same, plus auto-attaches the
// new node as the Edit reference (consumed via pendingRefAttach below).
type AssetsDrawerMode = null | 'add' | 'attach'

interface UiState {
  armedTool: Tool
  pickingRef: boolean
  saveState: SaveState
  setSaveState: (s: SaveState) => void
  assetsDrawer: AssetsDrawerMode
  setAssetsDrawer: (m: AssetsDrawerMode) => void
  // Set by the drawer after an 'attach'-mode pick (the created node's id);
  // CommandBar consumes it into refId and clears it. String to keep the
  // store free of tldraw type imports.
  pendingRefAttach: string | null
  setPendingRefAttach: (id: string | null) => void
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
  // Task 18: whether the armed Edit tool's "Select region" toggle is on.
  // Off (default) → whole-image edit (refs allowed, model picker enabled).
  // On → arms RegionOverlay for drawing into `cropFrac`; a real drawn rect
  // routes Run to the {type:'inpaint', model:'flux-fill', rect} op instead
  // of {type:'edit', ...} — see CommandBar.tsx's runEdit. Lives in the
  // store (not CommandBar-local state) because ImageNodeShape.tsx's render
  // gate for RegionOverlay needs it too.
  regionMode: boolean
  setArmedTool: (t: Tool) => void
  setPickingRef: (v: boolean) => void
  setCropFrac: (r: RectFrac | null) => void
  setRegionMode: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  armedTool: null,
  pickingRef: false,
  saveState: 'saved',
  // Open by default (user 2026-07-21): the drawer is a persistent panel;
  // only an EXPLICIT collapse (handle/✕/Esc in add mode) closes it, and that
  // choice is remembered per browser.
  assetsDrawer:
    typeof localStorage !== 'undefined' && localStorage.getItem('gm-drawer-collapsed') === '1' ? null : 'add',
  pendingRefAttach: null,
  cropFrac: null,
  regionMode: false,
  setArmedTool: (armedTool) => set({ armedTool }),
  setPickingRef: (pickingRef) => set({ pickingRef }),
  setSaveState: (saveState) => set({ saveState }),
  setAssetsDrawer: (assetsDrawer) => set({ assetsDrawer }),
  setPendingRefAttach: (pendingRefAttach) => set({ pendingRefAttach }),
  setCropFrac: (cropFrac) => set({ cropFrac }),
  setRegionMode: (regionMode) => set({ regionMode }),
}))

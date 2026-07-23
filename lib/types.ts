export type Rect = { x: number; y: number; w: number; h: number } // natural px

// Fractions (0..1) of a measured on-screen box, e.g. CropOverlay's rendered
// container. Zoom-invariant by construction (numerator and denominator both
// scale with the tldraw camera) and, with AssetView's objectFit: 'fill',
// maps directly onto natural pixels per axis: no synthetic display-size
// ratio involved. See task-10-report.md "Fix round 1".
export type RectFrac = { x: number; y: number; w: number; h: number }

export type Operation =
  | { type: 'generate'; prompt: string; model: string }
  | { type: 'edit'; prompt: string; model: string; referenceNodeId?: string; referenceNodeIds?: string[] }
  | { type: 'inpaint'; prompt: string; model: string; rect: Rect; referenceNodeId?: string; referenceNodeIds?: string[] }
  | { type: 'upload'; filename: string }
  | { type: 'crop'; rect: Rect }
  | { type: 'resize'; width: number; height: number }
  // 2026-07-21 deterministic-tools batch — all client-side canvas ops like
  // crop/resize (lib/instant-ops.ts), no model call:
  | { type: 'rotate'; deg: 90 | -90 | 180 }
  | { type: 'flip'; axis: 'h' | 'v' }
  // UX round 2 (user 2026-07-21: "slow to rotate 180", "don't need 2 flip
  // buttons"): rotation + flips composed into ONE op applied once from the
  // Rotate/Flip tray. 'rotate'/'flip' above stay registered — nodes created
  // by the short-lived one-click buttons store them — but nothing creates
  // them anymore.
  | { type: 'transform'; deg: 0 | 90 | 180 | 270; flipH: boolean; flipV: boolean }
  // 100 = neutral for all three (CSS-filter percentage semantics).
  | { type: 'adjust'; brightness: number; contrast: number; saturation: number }
  // amount: blur radius px, or pixel block size, in NATURAL px.
  | { type: 'redact'; rect: Rect; mode: 'blur' | 'pixelate'; amount: number }

// Display name for an op type. 'inpaint' still exists as a distinct internal
// op (edit + mask rect) but the UI absorbed it into Edit (Task 18) — showing
// "inpaint" on arrows/badges confused users (reported 2026-07-21), so every
// user-facing surface renders it as "edit". Internal type strings are
// unchanged: saved canvases and retry logic never see this mapping.
export function opLabel(type: Operation['type']): string {
  if (type === 'inpaint') return 'edit'
  if (type === 'transform') return 'rotate/flip'
  return type
}

export interface VersionNodeProps {
  w: number; h: number                  // on-canvas display size
  seq: number
  // Task 15A: user-facing node name, editable from CommandBar's SELECTED
  // recipe line. Optional at the shape-prop-validator level (T.string.optional()
  // in ImageNodeShape.tsx) so snapshots saved before this field existed still
  // load — tldraw's validators reject a record missing a NON-optional prop,
  // but happily accept a genuinely-absent optional one. Treated as '' at
  // every read site (falls back to the old v{seq}·{op.type} label in the
  // node chip and to "unnamed" in the recipe line).
  name?: string
  status: 'pending' | 'done' | 'error'
  kind: 'image' | 'video'
  assetUrl: string                      // '' → dataURL → CDN URL
  naturalW: number; naturalH: number
  durationMs?: number
  sourceId: string | null               // parent VERSION (never tldraw parentId)
  op: Operation
  // Resumable generation (2026-07-22): fal queue request id, set the moment
  // /api/ops returns from submit and cleared when the result/failure lands.
  // A pending node with this set survives reloads — sweep-interrupted skips
  // it and run-op's resumePendingOps re-attaches polling.
  falRequestId?: string
  errorCode?: string; errorMessage?: string
  createdAt: number
  // Mark-as-final (user 2026-07-22): user flags a node as THE deliverable —
  // renders an accent ring + "★ Final" badge. Optional so old snapshots load.
  final?: boolean
}

export interface OpsResponse { imageUrl: string; width: number; height: number }
export interface ApiError { error: { code: string; message: string } }

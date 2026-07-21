export type Rect = { x: number; y: number; w: number; h: number } // natural px

// Fractions (0..1) of a measured on-screen box, e.g. CropOverlay's rendered
// container. Zoom-invariant by construction (numerator and denominator both
// scale with the tldraw camera) and, with AssetView's objectFit: 'fill',
// maps directly onto natural pixels per axis: no synthetic display-size
// ratio involved. See task-10-report.md "Fix round 1".
export type RectFrac = { x: number; y: number; w: number; h: number }

export type Operation =
  | { type: 'generate'; prompt: string; model: string }
  | { type: 'edit'; prompt: string; model: string; referenceNodeId?: string }
  | { type: 'inpaint'; prompt: string; model: string; rect: Rect }
  | { type: 'upload'; filename: string }
  | { type: 'crop'; rect: Rect }
  | { type: 'resize'; width: number; height: number }

export interface VersionNodeProps {
  w: number; h: number                  // on-canvas display size
  seq: number
  status: 'pending' | 'done' | 'error'
  kind: 'image' | 'video'
  assetUrl: string                      // '' → dataURL → CDN URL
  naturalW: number; naturalH: number
  durationMs?: number
  sourceId: string | null               // parent VERSION (never tldraw parentId)
  op: Operation
  errorCode?: string; errorMessage?: string
  createdAt: number
}

export interface OpsResponse { imageUrl: string; width: number; height: number }
export interface ApiError { error: { code: string; message: string } }

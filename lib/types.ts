export type Rect = { x: number; y: number; w: number; h: number } // natural px

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

'use client'

import { useEffect, useState } from 'react'
import {
  HTMLContainer,
  Rectangle2d,
  resizeBox,
  ShapeUtil,
  T,
  useEditor,
  useValue,
  type Geometry2d,
  type TLBaseShape,
  type TLIndicatorPath,
  type TLResizeInfo,
} from 'tldraw'
import type { VersionNodeProps } from '@/lib/types'
import { useUiStore } from '@/lib/ui-store'
import { CropOverlay } from '@/components/overlays/CropOverlay'
import { RegionOverlay } from '@/components/overlays/RegionOverlay'
import { color, metric, type as typeTok } from '@/lib/design'
import { IconSpinner, IconWarning } from '@/components/icons'

/**
 * tldraw 5.2.5 corrections vs the v3-shaped brief (see CLAUDE.md "Spike PASSED"
 * bullet + .superpowers/sdd/task-2-report.md for the full evidence trail):
 *  - Custom shape TYPES must be registered by augmenting `TLGlobalShapePropsMap`
 *    below, or `TLShape` stays a closed union and `ShapeUtil<ImageNodeShape>` /
 *    `editor.createShape<ImageNodeShape>` fail to typecheck.
 *  - CORRECTED (final review, see docs/superpowers/progress-ledger.md Task 7 note):
 *    the original claim here — that `BaseBoxShapeUtil<S>`'s `S extends
 *    TLBaseBoxShape` constraint rejects a custom shape even after the
 *    `TLGlobalShapePropsMap` augmentation above — is false. It DOES compile
 *    once `getIndicatorPath()` replaces the deprecated `indicator()` stub.
 *    We still extend plain `ShapeUtil` here and implement `getGeometry` (a
 *    `Rectangle2d`) + `getIndicatorPath` (a `Path2D`) ourselves — mirroring
 *    what `BaseBoxShapeUtil` does internally, plus `onResize` via the
 *    exported `resizeBox` helper — but that's a style choice (explicit over
 *    inherited), not a typechecking requirement.
 *  - The old JSX `indicator()` method is a deprecated legacy stub; the real hook
 *    is `getIndicatorPath()`.
 *  - `T.literalEnum(...)`, `T.number.optional()`, `T.string.nullable()` are
 *    confirmed present on the installed `@tldraw/validate` re-export — no change
 *    from the brief's validator names.
 */
declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'image-node': VersionNodeProps
  }
}

export type ImageNodeShape = TLBaseShape<'image-node', VersionNodeProps>
export const IMAGE_NODE_W = 240

// Task 18 pending-node ticker: client-safe id -> label map, mirroring
// CommandBar.tsx's EDIT_MODELS/GENERATE_MODELS (which mirror
// lib/fal-registry.ts's VISIBLE model entries — that registry file is
// `server-only` and can't be imported here) plus the hardcoded 'flux-fill'
// id lib/run-op.ts's runEdit always dispatches for a region-fill op. Keep
// in sync with the registry the same way those two lists already are.
const MODEL_LABELS: Record<string, string> = {
  'nano-banana': 'Nano Banana 2',
  'gpt-image-2': 'GPT Image 2',
  'seedream-5-lite': 'Seedream 5 Lite',
  'flux-1.1-pro': 'FLUX 1.1',
  'flux-fill': 'FLUX Fill',
}

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// PENDING-NODE PATIENCE UX (Task 18, folded from a 16b follow-up): with
// models now up to ~4min (gpt-image-2), a bare spinner reads as broken.
// Local-state-only ticker (no store write — never triggers save-sync.ts's
// autosave) that (re)starts a 1s setInterval whenever `pending` flips to
// true and tears it down on unmount or the next status change (effect
// cleanup runs on every dep change, including pending->false). Anchored to
// Date.now() at the moment `pending` becomes true rather than to the node's
// createdAt, so a retry (run-op.ts's retryShape resets status but NOT
// createdAt) restarts the count from 0 instead of showing an inflated
// carry-over from the earlier failed attempt.
function usePendingElapsedSeconds(pending: boolean): number {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!pending) return
    const start = Date.now()
    // Matches CommandBar.tsx's existing convention for an intentional
    // setState-in-effect (its resize-form-seed and pick-flow effects): this
    // resets the ticker to 0 at the start of each new pending episode
    // (initial mount while pending, or a status flip back to pending via
    // retryShape), not on every render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [pending])
  return elapsed
}

function AssetView({ props }: { props: VersionNodeProps }) {
  // seam for video: branch on props.kind here later
  // Must stay a raw <img> with crossOrigin="anonymous" for canvas-side
  // toDataURL() export (crop/resize) to work uncontaminated per the CORS
  // spike; next/image would rewrite the src through its optimizer and break
  // that.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={props.assetUrl}
      crossOrigin="anonymous"
      draggable={false}
      alt=""
      style={{
        width: '100%',
        height: '100%',
        // Fix round 1 (task-10-report.md): was 'cover'. CropOverlay now
        // stores the crop rect as fractions of its measured box and
        // Inspector maps those fractions straight onto natural px
        // (fx*naturalW, fy*naturalH) with no aspect-ratio correction in
        // between. That mapping is only exact if the rendered image itself
        // is stretched to fill the box on both axes — 'cover' instead
        // uniform-scales-and-clips, which would silently offset the crop by
        // the box/natural aspect mismatch (the ~1% this fix targets) even
        // with fraction-based coordinates. 'fill' trades a bounded ~1%
        // visual stretch (the box is very close to, but not exactly,
        // naturalW:naturalH already) for exact coordinate correctness.
        objectFit: 'fill',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    />
  )
}

export class ImageNodeUtil extends ShapeUtil<ImageNodeShape> {
  static override type = 'image-node' as const
  static override props = {
    w: T.number,
    h: T.number,
    seq: T.number,
    status: T.literalEnum('pending', 'done', 'error'),
    kind: T.literalEnum('image', 'video'),
    assetUrl: T.string,
    naturalW: T.number,
    naturalH: T.number,
    // Task 15A: optional, not T.string — see lib/types.ts's VersionNodeProps.name
    // comment. Snapshots saved before this task lack the key entirely;
    // T.string.optional() accepts that (undefined), whereas a plain T.string
    // would reject the whole record on load since tldraw's validators check
    // required props are present. Verified against the installed
    // @tldraw/validate ObjectValidator: `.optional()` wraps the check so a
    // missing key passes and an undefined value passes, but a present
    // non-string value still fails — safety over elegance, per the brief.
    name: T.string.optional(),
    durationMs: T.number.optional(),
    sourceId: T.string.nullable(),
    // zod validates ops at the API boundary; shape-level prop validation stays
    // shallow. This is the one documented any-adjacent exception (see brief).
    op: T.any,
    errorCode: T.string.optional(),
    errorMessage: T.string.optional(),
    createdAt: T.number,
  }

  override getDefaultProps(): VersionNodeProps {
    return {
      w: IMAGE_NODE_W,
      h: 150,
      seq: 0,
      status: 'pending',
      kind: 'image',
      assetUrl: '',
      naturalW: 0,
      naturalH: 0,
      sourceId: null,
      op: { type: 'generate', prompt: '', model: '' },
      createdAt: 0,
      name: '',
    }
  }

  override getGeometry(shape: ImageNodeShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  override getIndicatorPath(shape: ImageNodeShape): TLIndicatorPath {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }

  override onResize(shape: ImageNodeShape, info: TLResizeInfo<ImageNodeShape>) {
    return resizeBox(shape, info)
  }

  override component(shape: ImageNodeShape) {
    // Delegates to a real function component: eslint's rules-of-hooks
    // statically forbids hook calls inside a class method even though tldraw
    // invokes `component()` from inside its own function-component wrapper
    // at render time (confirmed by the Task 2 spike). Wrapping in an actual
    // function component keeps the hooks (needed for the crop overlay's
    // selection + armedTool checks) both lint-clean and semantically correct.
    return <ImageNodeComponent shape={shape} />
  }
}

function ImageNodeComponent({ shape }: { shape: ImageNodeShape }) {
  const p = shape.props
  const editor = useEditor()
  const armedTool = useUiStore((s) => s.armedTool)
  const isSelected = useValue(
    'image-node-selected',
    () => editor.getSelectedShapeIds().includes(shape.id),
    [editor, shape.id]
  )
  const regionMode = useUiStore((s) => s.regionMode)
  const showCropOverlay = isSelected && armedTool === 'crop' && p.status === 'done'
  // Task 18: was `armedTool === 'inpaint'` (the old standalone verb) — now
  // Edit's own "Select region" toggle (ui-store's `regionMode`) gates it,
  // since Inpaint no longer exists as a separate armed tool.
  const showRegionOverlay = isSelected && armedTool === 'edit' && regionMode && p.status === 'done'
  const pickingRef = useUiStore((s) => s.pickingRef)
  const pendingElapsed = usePendingElapsedSeconds(p.status === 'pending')
  // Reference pick mode (Task 12): a node is a valid pick target while
  // Inspector's "+ Reference" flow is armed if it's done and isn't the node
  // currently selected (that's always the edit target itself — see
  // Inspector.tsx's selId-reset/pick-detection effect for why only one
  // shape is ever selected during a pick).
  const pickable = pickingRef && p.status === 'done' && !isSelected
  return (
    <HTMLContainer
      className="gm-node-card"
      style={{
        width: p.w,
        height: p.h,
        background: color.cardBg,
        border: pickable ? `1px dashed ${color.accent}` : `1px solid ${color.border}`,
        borderRadius: metric.radiusLg,
        padding: 5,
        display: 'flex',
        flexDirection: 'column',
        cursor: pickable ? 'crosshair' : undefined,
      }}
    >
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {p.status === 'done' && <AssetView props={p} />}
        {p.status === 'done' && p.errorCode === 'unsynced' && (
          // Minor (spec-promised, YAGNI-scoped): badge only, no retry
          // wiring — the node is already usable (the local dataURL keeps
          // rendering fine), this just flags that its assetUrl isn't a
          // durable CDN URL yet, e.g. if the background /api/upload in
          // runInstantOp failed.
          <div
            title="CDN sync failed — image is local to this browser"
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              background: '#3a2a14',
              color: '#e0a95c',
              border: '1px solid #6a4a20',
              borderRadius: 4,
              fontSize: 9,
              padding: '1px 5px',
              pointerEvents: 'all',
              cursor: 'default',
            }}
          >
            not synced
          </div>
        )}
        {p.status === 'pending' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: color.accent,
              gap: 6,
            }}
          >
            <IconSpinner size={18} />
            {/* Task 18 patience UX: model + live "M:SS" ticker so a
                slow model (gpt-image-2, up to ~4min) doesn't read as a
                hung/broken spinner. */}
            <span style={{ fontFamily: typeTok.fontMono, fontSize: typeTok.micro, color: color.textSecondary }}>
              {('model' in p.op && MODEL_LABELS[p.op.model]) || 'model'} · {formatElapsed(pendingElapsed)}
            </span>
          </div>
        )}
        {p.status === 'error' && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              color: color.danger,
              fontSize: typeTok.micro,
              textAlign: 'center',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <IconWarning size={16} />
              <span>{p.errorMessage ?? 'failed'}</span>
              <button
                className="gm-btn"
                style={{
                  pointerEvents: 'all',
                  height: 22,
                  padding: '0 8px',
                  background: 'transparent',
                  color: color.text,
                  border: `1px solid ${color.border}`,
                  borderRadius: metric.radiusSm,
                  fontFamily: typeTok.fontUi,
                  fontSize: typeTok.nano,
                  cursor: 'pointer',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  window.dispatchEvent(new CustomEvent('gm:retry', { detail: { shapeId: shape.id } }))
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {showCropOverlay && <CropOverlay />}
        {showRegionOverlay && <RegionOverlay />}
      </div>
      <div style={{ padding: '4px 3px 1px' }}>
        {/* Task 15A: primary line is the user-facing name; secondary is the
            provenance recipe (was the whole label pre-15A). Falls back to
            the old full label when name is '' or undefined (old snapshots,
            or — shouldn't happen given run-op.ts's creation-site defaults —
            an explicitly blanked name), so nothing goes visually empty.
            Task 15B: sizes per the brief (name 11px primary, recipe 9px
            muted) — name stays system-ui (it's a user-facing label, not
            metadata); the recipe line stays monospace (metadata). */}
        <div
          style={{
            fontFamily: typeTok.fontUi,
            fontSize: typeTok.micro,
            color: color.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {p.name && p.name.trim()
            ? p.name
            : `v${p.seq} · ${p.op.type}${'prompt' in p.op && p.op.prompt ? ` "${p.op.prompt.slice(0, 28)}"` : ''}`}
        </div>
        <div
          // Design-critique item 11: 9px mono at textMuted (#666f7a on
          // #1a1d22) measured ~3.4:1 contrast — below WCAG at the smallest
          // text on screen. Bumped to 10px / color.textSecondary (~6.9:1);
          // textMuted stays reserved for hover-revealed/tertiary chrome only.
          style={{
            fontFamily: typeTok.fontMono,
            fontSize: 10,
            color: color.textSecondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          v{p.seq} · {p.op.type}
        </div>
      </div>
    </HTMLContainer>
  )
}

'use client'

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

/**
 * tldraw 5.2.5 corrections vs the v3-shaped brief (see CLAUDE.md "Spike PASSED"
 * bullet + .superpowers/sdd/task-2-report.md for the full evidence trail):
 *  - Custom shape TYPES must be registered by augmenting `TLGlobalShapePropsMap`
 *    below, or `TLShape` stays a closed union and `ShapeUtil<ImageNodeShape>` /
 *    `editor.createShape<ImageNodeShape>` fail to typecheck.
 *  - `BaseBoxShapeUtil<S>` constrains `S extends TLBaseBoxShape`, an
 *    `Extract`-based union of the *built-in* box shapes; a custom shape does not
 *    satisfy it even after the augmentation above. We extend plain `ShapeUtil`
 *    instead and implement `getGeometry` (a `Rectangle2d`) + `getIndicatorPath`
 *    (a `Path2D`) ourselves — mirroring exactly what `BaseBoxShapeUtil` does
 *    internally — plus `onResize` via the exported `resizeBox` helper to keep
 *    box-resize UX working.
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
  const showCropOverlay = isSelected && armedTool === 'crop' && p.status === 'done'
  return (
    <HTMLContainer
      style={{
        width: p.w,
        height: p.h,
        background: '#1e232b',
        border: '1px solid #2d3540',
        borderRadius: 7,
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {p.status === 'done' && <AssetView props={p} />}
        {p.status === 'pending' && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              color: '#2dd4bf',
            }}
          >
            ⏳
          </div>
        )}
        {p.status === 'error' && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              color: '#d98d80',
              fontSize: 11,
              textAlign: 'center',
            }}
          >
            <div>
              ⚠ {p.errorMessage ?? 'failed'}
              <br />
              <button
                style={{ pointerEvents: 'all' }}
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
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 9,
          color: '#8a95a3',
          padding: '3px 2px 0',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        v{p.seq} · {p.op.type}
        {'prompt' in p.op && p.op.prompt ? ` "${p.op.prompt.slice(0, 28)}"` : ''}
      </div>
    </HTMLContainer>
  )
}

import { createShapeId, toRichText, type Editor, type TLShapeId } from 'tldraw'
import type { Operation, OpsResponse } from '@/lib/types'
import { nextSeq, placeChildren, GAP_X } from '@/lib/tree'
import { apiPost } from '@/lib/api-client'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import { IMAGE_NODE_W } from '@/components/ImageNodeShape'

// tldraw 5.2.5 corrections vs the brief's pseudo-code (see CLAUDE.md "Spike
// PASSED" bullet + .superpowers/sdd/task-8-report.md for the evidence trail):
//  - Arrow labels are `props.richText` (a TLRichText produced by `toRichText`),
//    never `props.text` — the installed TLArrowShapeProps has no `text` key.
//  - `editor.createBinding({ props: {...} })` only needs `terminal`: the
//    editor merges `ArrowBindingUtil.getDefaultProps()` (isPrecise: false,
//    isExact: false, normalizedAnchor: {x:.5,y:.5}, snap: 'none') under
//    whatever partial props are passed (verified in
//    @tldraw/editor Editor.ts `createBindings`), and `arrowDidUpdate` runs in
//    the binding's `onAfterCreate` to position the arrow from its bound
//    shapes — no manual start/end math needed.
const nodes = (editor: Editor) =>
  editor.getCurrentPageShapes().filter((s): s is ImageNodeShape => s.type === 'image-node')

export function createArrow(
  editor: Editor,
  from: TLShapeId,
  to: TLShapeId,
  label: string,
  dashed = false
): TLShapeId {
  const arrowId = createShapeId()
  editor.createShape({
    id: arrowId,
    type: 'arrow',
    props: { richText: toRichText(label), dash: dashed ? 'dashed' : 'draw' },
  })
  editor.createBinding({ type: 'arrow', fromId: arrowId, toId: from, props: { terminal: 'start' } })
  editor.createBinding({ type: 'arrow', fromId: arrowId, toId: to, props: { terminal: 'end' } })
  return arrowId
}

export function runOp(
  editor: Editor,
  sourceId: TLShapeId | null,
  op: Operation,
  variants = 1,
  resolveRef: (id: string) => string | undefined = () => undefined,
  // Task 12: when set, every child created by this call gets a second,
  // DASHED 'ref' arrow from this node (the picked reference) in addition to
  // the normal solid parent->child arrow. Optional and defaulted so every
  // pre-Task-12 call site (PromptBar's generate, ActionMenu's vary, the
  // non-reference edit path) keeps compiling unchanged.
  refFromId?: TLShapeId
): void {
  const all = nodes(editor)
  const parent = sourceId ? all.find((s) => s.id === sourceId) : undefined
  const parentBox = parent
    ? { x: parent.x, y: parent.y, w: parent.props.w, h: parent.props.h }
    : { x: 100, y: 100 + all.length * 40, w: IMAGE_NODE_W, h: 150 }
  const occupiedBoxes = all.map((s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h }))
  const spots = parent
    ? placeChildren(parentBox, variants, occupiedBoxes)
    : placeChildren(
        { x: parentBox.x - IMAGE_NODE_W - GAP_X, y: parentBox.y, w: IMAGE_NODE_W, h: parentBox.h },
        variants,
        occupiedBoxes
      )
  let seq = nextSeq(all.map((s) => s.props.seq))
  for (let i = 0; i < variants; i++) {
    const id = createShapeId()
    editor.createShape<ImageNodeShape>({
      id,
      type: 'image-node',
      x: spots[i]?.x ?? parentBox.x,
      y: spots[i]?.y ?? parentBox.y,
      props: {
        w: IMAGE_NODE_W,
        h: parent ? parent.props.h : 150,
        seq: seq++,
        status: 'pending',
        kind: 'image',
        assetUrl: '',
        naturalW: 0,
        naturalH: 0,
        sourceId: sourceId,
        op,
        createdAt: Date.now(),
      },
    })
    if (parent) createArrow(editor, parent.id, id, op.type)
    if (refFromId) createArrow(editor, refFromId, id, 'ref', /* dashed */ true)
    void dispatch(editor, id, op, parent?.props.assetUrl, resolveRef)
  }
}

// Instant ops (crop/resize) run entirely client-side and synchronously: the
// output is known immediately (a canvas draw), so — unlike runOp's
// pending→done async flow — we create the child already in 'done' state with
// the local dataURL, then swap `assetUrl` to the fal-hosted CDN URL in the
// background once /api/upload finishes. If that background upload fails, the
// node stays usable (the dataURL keeps rendering) but is flagged 'unsynced'
// so a future session knows the URL is only a local blob, not shareable.
export async function runInstantOp(
  editor: Editor,
  sourceId: TLShapeId,
  op: Extract<Operation, { type: 'crop' } | { type: 'resize' }>
): Promise<void> {
  const parent = nodes(editor).find((s) => s.id === sourceId)
  if (!parent) return
  const { cropImage, resizeImage } = await import('@/lib/instant-ops')
  const out =
    op.type === 'crop'
      ? await cropImage(parent.props.assetUrl, op.rect)
      : await resizeImage(parent.props.assetUrl, op.width, op.height)
  const all = nodes(editor)
  const [spot] = placeChildren(
    { x: parent.x, y: parent.y, w: parent.props.w, h: parent.props.h },
    1,
    all.map((s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h }))
  )
  const id = createShapeId()
  editor.createShape<ImageNodeShape>({
    id,
    type: 'image-node',
    x: spot?.x ?? parent.x,
    y: spot?.y ?? parent.y,
    props: {
      w: IMAGE_NODE_W,
      h: Math.round(IMAGE_NODE_W * (out.height / out.width)) + 18,
      seq: nextSeq(all.map((s) => s.props.seq)),
      status: 'done',
      kind: 'image',
      assetUrl: out.dataUrl,
      naturalW: out.width,
      naturalH: out.height,
      sourceId,
      op,
      createdAt: Date.now(),
    },
  })
  createArrow(editor, parent.id, id, op.type)
  try {
    const { url } = await apiPost<{ url: string }>('/api/upload', { dataUrl: out.dataUrl }, false)
    editor.updateShape<ImageNodeShape>({ id, type: 'image-node', props: { assetUrl: url } })
  } catch {
    editor.updateShape<ImageNodeShape>({ id, type: 'image-node', props: { errorCode: 'unsynced' } })
  }
}

export function retryShape(
  editor: Editor,
  shapeId: TLShapeId,
  resolveRef: (id: string) => string | undefined = () => undefined
): void {
  const s = nodes(editor).find((n) => n.id === shapeId)
  if (!s) return
  const parent = s.props.sourceId
    ? nodes(editor).find((n) => n.id === s.props.sourceId)
    : undefined
  editor.updateShape<ImageNodeShape>({
    id: shapeId,
    type: 'image-node',
    props: { status: 'pending', errorMessage: undefined, errorCode: undefined },
  })
  void dispatch(editor, shapeId, s.props.op, parent?.props.assetUrl, resolveRef)
}

async function dispatch(
  editor: Editor,
  shapeId: TLShapeId,
  op: Operation,
  parentUrl: string | undefined,
  resolveRef: (id: string) => string | undefined
): Promise<void> {
  const done = (r: OpsResponse) =>
    editor.updateShape<ImageNodeShape>({
      id: shapeId,
      type: 'image-node',
      props: {
        status: 'done',
        assetUrl: r.imageUrl,
        naturalW: r.width,
        naturalH: r.height,
        h: r.width ? Math.round(IMAGE_NODE_W * (r.height / r.width)) + 18 : 150,
      },
    })
  const fail = (e: unknown) =>
    editor.updateShape<ImageNodeShape>({
      id: shapeId,
      type: 'image-node',
      props: {
        status: 'error',
        errorCode: (e as { code?: string })?.code ?? 'error',
        errorMessage: e instanceof Error ? e.message : 'Something went wrong.',
      },
    })
  try {
    switch (op.type) {
      case 'generate': {
        done(
          await apiPost<OpsResponse>('/api/ops', {
            capability: 'generate',
            model: op.model,
            prompt: op.prompt,
          })
        )
        break
      }
      case 'edit': {
        if (!parentUrl) throw new Error('edit requires a source image')
        const refUrl = op.referenceNodeId ? resolveRef(op.referenceNodeId) : undefined
        done(
          await apiPost<OpsResponse>('/api/ops', {
            capability: 'edit',
            model: op.model,
            prompt: op.prompt,
            imageUrl: parentUrl,
            referenceUrls: refUrl ? [refUrl] : undefined,
          })
        )
        break
      }
      case 'inpaint': {
        if (!parentUrl) throw new Error('inpaint requires a source image')
        // The mask canvas must match the SOURCE (parent) image's natural
        // size — the child being dispatched here doesn't have one yet.
        // `shapeId`'s own `sourceId` points at that parent node.
        const child = nodes(editor).find((s) => s.id === shapeId)
        const parent = child?.props.sourceId
          ? nodes(editor).find((s) => s.id === child.props.sourceId)
          : undefined
        if (!parent) throw new Error('inpaint could not locate the source node for mask sizing')
        const { renderRectMask } = await import('@/lib/instant-ops')
        const maskDataUrl = await renderRectMask(op.rect, parent.props.naturalW, parent.props.naturalH)
        const { url: maskUrl } = await apiPost<{ url: string }>(
          '/api/upload',
          { dataUrl: maskDataUrl },
          false
        )
        done(
          await apiPost<OpsResponse>('/api/ops', {
            capability: 'inpaint',
            model: op.model,
            prompt: op.prompt,
            imageUrl: parentUrl,
            maskUrl,
          })
        )
        break
      }
      case 'upload':
      case 'crop':
      case 'resize':
        // Deterministic ops run client-side and update their own node
        // synchronously in their panels (Task 10) — they never reach runOp's
        // async dispatch.
        throw new Error(`${op.type} is applied synchronously by its panel, not via runOp dispatch`)
      default: {
        const exhaustive: never = op
        throw new Error(`Unhandled operation: ${JSON.stringify(exhaustive)}`)
      }
    }
  } catch (e) {
    fail(e)
  }
}

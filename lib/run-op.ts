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
  resolveRef: (id: string) => string | undefined = () => undefined
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
    void dispatch(editor, id, op, parent?.props.assetUrl, resolveRef)
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
      case 'inpaint':
        // lib/instant-ops (renderRectMask) is a later task's deliverable
        // (Task 10). Keep this dispatch exhaustive and compiling until then.
        throw new Error('inpaint requires instant-ops — arrives in a later task')
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

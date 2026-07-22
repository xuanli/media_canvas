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

// Task 15A name defaults (brief: "generate → first ≤4 words of prompt
// (trimmed, no trailing punctuation); upload → filename sans extension;
// edit/vary/inpaint/crop/resize children → parent's name"). Children copy at
// creation time (a plain string snapshot, not a live reference) — a later
// rename of the parent does not retroactively rename existing children,
// matching how every other node field is a point-in-time recipe capture.
function nameFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  return words.join(' ').replace(/[.,!?;:]+$/, '')
}

function nameFromFilename(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

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
    props: {
      richText: toRichText(label),
      dash: dashed ? 'dashed' : 'draw',
      // Design-critique item 3: tldraw's arrow label defaults to
      // TLDefaultFontStyle's 'draw' value (a handwritten/comic-style
      // typeface) — off-brand in a "professional photo editing tool"'s
      // version graph. 'sans' is a confirmed member of the installed
      // @tldraw/tlschema TLArrowShapeProps.font enum
      // (['draw','sans','serif','mono'], see TLFontStyle.ts), so setting it
      // at creation time (rather than fighting tldraw's --tl-font-draw CSS
      // var, which the critique offered only as a fallback) is the direct
      // fix. labelPosition (also a confirmed TLArrowShapeProps key, default
      // 0.5 = arrow midpoint) is nudged toward the start terminal so the
      // label no longer sits on top of the arrowhead at the end terminal.
      font: 'sans',
      labelPosition: 0.3,
    },
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
  // non-reference call site (generate, vary, plain edit) keeps compiling
  // unchanged.
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
        // Design-critique item 9: new roots (no parent) were landing ~5-10px
        // apart vertically — placeChildren's own NUDGE(40)-stepping overlap
        // loop stops the instant a candidate y clears the LAST occupied
        // box's exact bottom edge, which can be anywhere from ~1px to
        // NUDGE-1px depending on where the initial guess (100 + all.length*40)
        // happened to land relative to it. All roots share one x column (this
        // call's virtual-parent trick always resolves real x back to
        // parentBox.x), so padding each occupied box's height by GAP_X here
        // — same constant as the parent->child horizontal gutter, comfortably
        // over the critique's ">=48px" floor — forces that same loop to keep
        // stepping until the new root is at least GAP_X clear of the nearest
        // existing one. placeChildren itself is untouched (its own inputs are
        // just padded here for this one call), so lib/__tests__/tree.test.ts
        // stays exactly as tested.
        occupiedBoxes.map((b) => ({ ...b, h: b.h + GAP_X }))
      )
  let seq = nextSeq(all.map((s) => s.props.seq))
  // Root-only (no parent): only `generate` ever creates a root through this
  // function (sourceId=null) — CommandBar's IDLE go(). edit/inpaint/vary
  // always pass a selected node's id as sourceId, so the `op.type ===
  // 'generate'` narrowing below is exhaustive in practice, not just a guess.
  const rootName = op.type === 'generate' ? nameFromPrompt(op.prompt) : ''
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
        name: parent ? (parent.props.name ?? '') : rootName,
      },
    })
    if (parent) createArrow(editor, parent.id, id, op.type)
    // Fix round 1 (task-12-report.md, Finding 3): refFromId is captured at
    // pick time and this loop can run some time later (async dispatch below
    // hasn't even started yet, but variants>1 already stretches this out) —
    // guard against the picked node having been deleted in between, which
    // would otherwise create an arrow bound to nothing (an unbound, dangling
    // 'ref' arrow rather than a real error).
    if (refFromId && editor.getShape(refFromId)) createArrow(editor, refFromId, id, 'ref', /* dashed */ true)
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
      name: parent.props.name ?? '',
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

// Un-cuts the `upload` op (CLAUDE.md "Ops" line, Task 14 v2 chrome): places a
// root node — like runOp's sourceId=null branch — for an image the user
// already has a URL for (already uploaded via /api/upload by the caller;
// this helper doesn't do the network upload itself, mirroring how
// runInstantOp is handed an already-computed result rather than fetching
// one). Natural dims come from actually loading the image (same technique as
// dispatch()'s done() backfill in this file) since /api/upload doesn't
// report them. Status is 'done' immediately — unlike runOp's pending->done
// flow, there's no async model call in flight once the dims are known.
export function createUploadedRoot(editor: Editor, url: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const naturalW = img.naturalWidth
      const naturalH = img.naturalHeight
      const all = nodes(editor)
      const parentBox = { x: 100, y: 100 + all.length * 40, w: IMAGE_NODE_W, h: 150 }
      const [spot] = placeChildren(
        { x: parentBox.x - IMAGE_NODE_W - GAP_X, y: parentBox.y, w: IMAGE_NODE_W, h: parentBox.h },
        1,
        // Design-critique item 9 — same root-stacking-gap padding as runOp's
        // root branch above (an uploaded image is also a root, no parent).
        all.map((s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h + GAP_X }))
      )
      const id = createShapeId()
      editor.createShape<ImageNodeShape>({
        id,
        type: 'image-node',
        x: spot?.x ?? parentBox.x,
        y: spot?.y ?? parentBox.y,
        props: {
          w: IMAGE_NODE_W,
          h: naturalW ? Math.round(IMAGE_NODE_W * (naturalH / naturalW)) + 18 : 150,
          seq: nextSeq(all.map((s) => s.props.seq)),
          status: 'done',
          kind: 'image',
          assetUrl: url,
          naturalW,
          naturalH,
          sourceId: null,
          op: { type: 'upload', filename },
          createdAt: Date.now(),
          name: nameFromFilename(filename),
        },
      })
      resolve()
    }
    img.onerror = () => reject(new Error('could not read the uploaded image'))
    img.src = url
  })
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
  // history: 'ignore' (verified against the installed tldraw 5.2.5 types —
  // Editor.run(fn, opts: TLEditorRunOptions extends TLHistoryBatchOptions,
  // history?: 'ignore'|'record-preserveRedoStack'|'record') — keeps this
  // status reset off the undo stack. Fix round 2 (human-reported): without
  // this, Cmd-Z right after a result lands would revert 'done'/'error' back
  // to 'pending', reviving a spinner for a request that already finished —
  // undoing should remove the node outright (tldraw's default create-undo),
  // not resurrect a dead one.
  editor.run(
    () => {
      editor.updateShape<ImageNodeShape>({
        id: shapeId,
        type: 'image-node',
        props: { status: 'pending', errorMessage: undefined, errorCode: undefined },
      })
    },
    { history: 'ignore' }
  )
  void dispatch(editor, shapeId, s.props.op, parent?.props.assetUrl, resolveRef)
}

async function dispatch(
  editor: Editor,
  shapeId: TLShapeId,
  op: Operation,
  parentUrl: string | undefined,
  resolveRef: (id: string) => string | undefined
): Promise<void> {
  // Fix round 2 (human-reported, applies to done/fail/the dims backfill
  // below): all three are pending->settled status transitions on a node
  // that already exists (created, with its own undo entry, back in runOp).
  // Wrapped in `editor.run(fn, { history: 'ignore' })` so they don't ALSO
  // push undo entries — otherwise Cmd-Z right after a result lands reverts
  // 'done'/'error' back to 'pending' (a dead spinner) instead of undoing the
  // node's creation outright.
  const done = (r: OpsResponse) => {
    editor.run(
      () => {
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
      },
      { history: 'ignore' }
    )
    // Fix round 1 (task-12-report.md, Finding 5 — pre-existing,
    // controller-mandated): some capabilities (observed: nano-banana edit)
    // return width/height=0 in the ops response even though the image
    // itself is fine, which left naturalW/H at 0 and h pinned at the 150
    // fallback forever — breaking the fraction->natural-px math that later
    // crop/inpaint on this node depends on. The optimistic update above
    // already shows the image immediately with status:'done', so this is a
    // non-blocking backfill: measure the real dimensions client-side and
    // patch them in once the image loads. run-op.ts is client-only
    // (imported only by 'use client' components — CommandBar.tsx,
    // CanvasApp.tsx), so the `Image` DOM constructor is always available
    // here; no SSR guard needed.
    if (!r.width || !r.height) {
      const img = new Image()
      // Same crossOrigin as AssetView's <img> (ImageNodeShape.tsx) — fal's
      // CDN allows it, and it keeps this consistent with the canvas-safe
      // loading pattern used elsewhere, though it's not load-bearing here
      // since we only read naturalWidth/Height, not pixel data.
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        // The node may have been deleted while the image was loading.
        if (!editor.getShape(shapeId)) return
        const w = img.naturalWidth
        const h = img.naturalHeight
        if (!w || !h) return
        editor.run(
          () => {
            editor.updateShape<ImageNodeShape>({
              id: shapeId,
              type: 'image-node',
              props: {
                naturalW: w,
                naturalH: h,
                h: Math.round(IMAGE_NODE_W * (h / w)) + 18,
              },
            })
          },
          { history: 'ignore' }
        )
      }
      // On error, leave the fallback values (naturalW/H=0, display h=150)
      // in place — there's no better dimension source, and the image
      // itself already renders fine via assetUrl above.
      img.src = r.imageUrl
    }
  }
  const fail = (e: unknown) =>
    editor.run(
      () => {
        editor.updateShape<ImageNodeShape>({
          id: shapeId,
          type: 'image-node',
          props: {
            status: 'error',
            errorCode: (e as { code?: string })?.code ?? 'error',
            errorMessage: e instanceof Error ? e.message : 'Something went wrong.',
          },
        })
      },
      { history: 'ignore' }
    )
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

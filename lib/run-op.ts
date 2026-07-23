import { createShapeId, toRichText, type Editor, type TLShapeId } from 'tldraw'
import { opLabel, type Operation, type OpsResponse } from '@/lib/types'
import { nextSeq, placeChildren, GAP_X, GAP_Y } from '@/lib/tree'
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
  refFromId?: TLShapeId,
  // Multi-select compose (2026-07-21): dashed 'ref' arrows from EACH of these.
  refFromIds?: TLShapeId[]
): void {
  const all = nodes(editor)
  const parent = sourceId ? all.find((s) => s.id === sourceId) : undefined
  const parentBox = parent
    ? { x: parent.x, y: parent.y, w: parent.props.w, h: parent.props.h }
    : { x: 100, y: 100 + all.length * 40, w: IMAGE_NODE_W, h: 150 }
  const occupiedBoxes = all.map((s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h }))
  const spots = parent
    ? // Variant-placement fix (user 2026-07-22: new variants overlapped
      // existing nodes): occupied boxes are padded by a gap in both axes
      // during the search. The vertical padding matters most — a pending
      // child is placed at the PARENT's height, but grows when the result's
      // real aspect lands (done()'s h recompute), so unpadded placement let
      // nodes end up touching/overlapping after results arrived.
      placeChildren(
        parentBox,
        variants,
        occupiedBoxes.map((b) => ({ ...b, w: b.w + GAP_X / 2, h: b.h + GAP_Y }))
      )
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
    if (parent) createArrow(editor, parent.id, id, opLabel(op.type))
    // Fix round 1 (task-12-report.md, Finding 3): refFromId is captured at
    // pick time and this loop can run some time later (async dispatch below
    // hasn't even started yet, but variants>1 already stretches this out) —
    // guard against the picked node having been deleted in between, which
    // would otherwise create an arrow bound to nothing (an unbound, dangling
    // 'ref' arrow rather than a real error).
    for (const rid of [...(refFromIds ?? []), ...(refFromId ? [refFromId] : [])]) {
      if (editor.getShape(rid)) createArrow(editor, rid, id, 'ref', /* dashed */ true)
    }
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
  op: Extract<Operation, { type: 'crop' | 'resize' | 'rotate' | 'flip' | 'transform' | 'adjust' | 'redact' }>
): Promise<void> {
  const parent = nodes(editor).find((s) => s.id === sourceId)
  if (!parent) return
  const { cropImage, resizeImage, rotateImage, flipImage, transformImage, adjustImage, redactRegion } = await import(
    '@/lib/instant-ops'
  )
  const src = parent.props.assetUrl
  const out =
    op.type === 'crop'
      ? await cropImage(src, op.rect)
      : op.type === 'resize'
        ? await resizeImage(src, op.width, op.height)
        : op.type === 'rotate'
          ? await rotateImage(src, op.deg)
          : op.type === 'flip'
            ? await flipImage(src, op.axis)
            : op.type === 'transform'
              ? await transformImage(src, op.deg, op.flipH, op.flipV)
              : op.type === 'adjust'
                ? await adjustImage(src, op.brightness, op.contrast, op.saturation)
                : await redactRegion(src, op.rect, op.mode, op.amount)
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
  createArrow(editor, parent.id, id, opLabel(op.type))
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
export function createUploadedRoot(
  editor: Editor,
  url: string,
  filename: string,
  // Drag-drop (2026-07-21): `at` = page-space drop point; the node centers
  // on it instead of taking a placeChildren auto-spot.
  opts: { at?: { x: number; y: number } } = {}
): Promise<TLShapeId> {
  // Perceived-speed rework (user 2026-07-21: "click asset → node shows up
  // feels slow"): the shape is created IMMEDIATELY as a pending placeholder
  // (default box, shimmer/"loading image…" from ImageNodeShape's pending
  // branch) and the image loads in the background — was: wait for the full
  // image download to measure it before creating anything. onload patches
  // dims/size/status; onerror flips the node to its error state instead of
  // rejecting (the placeholder already exists, so the failure has a visible
  // home). The returned promise resolves with the id right away.
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
    x: opts.at ? opts.at.x - IMAGE_NODE_W / 2 : (spot?.x ?? parentBox.x),
    y: opts.at ? opts.at.y - 75 : (spot?.y ?? parentBox.y),
    props: {
      w: IMAGE_NODE_W,
      h: 150,
      seq: nextSeq(all.map((s) => s.props.seq)),
      status: 'pending',
      kind: 'image',
      assetUrl: url,
      naturalW: 0,
      naturalH: 0,
      sourceId: null,
      op: { type: 'upload', filename },
      createdAt: Date.now(),
      name: nameFromFilename(filename),
    },
  })
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (!editor.getShape(id)) return // deleted while loading
    const naturalW = img.naturalWidth
    const naturalH = img.naturalHeight
    // User-reported 2026-07-21 ("why is an added asset so small?"): scale
    // display width with natural width (quarter-size), floored at the old
    // 240 default and capped so a 4K drop doesn't swallow the canvas.
    const dispW = naturalW ? Math.max(IMAGE_NODE_W, Math.min(480, Math.round(naturalW / 4))) : IMAGE_NODE_W
    const dispH = naturalW ? Math.round(dispW * (naturalH / naturalW)) + 18 : 150
    editor.updateShape<ImageNodeShape>({
      id,
      type: 'image-node',
      // Re-center on the drop point now that the real size is known.
      ...(opts.at ? { x: opts.at.x - dispW / 2, y: opts.at.y - dispH / 2 } : {}),
      props: { w: dispW, h: dispH, naturalW, naturalH, status: 'done' },
    })
  }
  img.onerror = () => {
    if (!editor.getShape(id)) return
    editor.updateShape<ImageNodeShape>({
      id,
      type: 'image-node',
      props: { status: 'error', errorMessage: 'could not load image' },
    })
  }
  img.src = url
  return Promise.resolve(id)
}

// Same as createUploadedRoot but for an image that only exists locally as a
// dataURL (asset-tile placement, direct uploads, OS-file drops): the node
// renders INSTANTLY from the dataURL — no network before first paint — and
// the CDN upload happens in the background, swapping assetUrl on success or
// flagging 'unsynced' on failure (same badge contract as runInstantOp's
// background upload above).
export async function createLocalImageRoot(
  editor: Editor,
  dataUrl: string,
  filename: string,
  opts: { at?: { x: number; y: number } } = {}
): Promise<TLShapeId> {
  const id = await createUploadedRoot(editor, dataUrl, filename, opts)
  void (async () => {
    try {
      const { url } = await apiPost<{ url: string }>('/api/upload', { dataUrl }, false)
      if (editor.getShape(id)) {
        editor.updateShape<ImageNodeShape>({ id, type: 'image-node', props: { assetUrl: url } })
      }
    } catch {
      if (editor.getShape(id)) {
        editor.updateShape<ImageNodeShape>({ id, type: 'image-node', props: { errorCode: 'unsynced' } })
      }
    }
  })()
  return id
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

// ── Resumable generation plumbing (user 2026-07-22) ──────────────────────
// /api/ops now SUBMITS to fal's queue and returns { requestId }; the actual
// result comes from polling /api/ops/status. The request id is stored on the
// pending node so any later session (after refresh / canvas switch) can
// resume polling via resumePendingOps below — the old fal.subscribe flow
// died with the tab that opened it.

type Capability = 'generate' | 'edit' | 'inpaint'

function capabilityForOp(op: Operation): Capability {
  if (op.type === 'generate') return 'generate'
  // Guided region edits (non-gpt-image-2) ride the 'edit' capability — same
  // routing the soft-region dispatch branch uses at submit time.
  if (op.type === 'inpaint') return op.model === 'gpt-image-2' ? 'inpaint' : 'edit'
  return 'edit'
}

const POLL_INTERVAL_MS = 2500
// Generous ceiling over the slowest measured model (gpt-image-2 ~4min).
const POLL_BUDGET_MS = 8 * 60_000

async function pollOpsResult(capability: Capability, model: string, requestId: string): Promise<OpsResponse> {
  const deadline = Date.now() + POLL_BUDGET_MS
  while (Date.now() < deadline) {
    const r = await apiPost<Partial<OpsResponse> & { status?: string }>('/api/ops/status', {
      capability,
      model,
      requestId,
    })
    if (r.imageUrl) return r as OpsResponse
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
  }
  throw new Error('timed out waiting for the model')
}

async function runModel(
  editor: Editor,
  shapeId: TLShapeId,
  capability: Capability,
  payload: { model: string; prompt: string; imageUrl?: string; maskUrl?: string; referenceUrls?: string[] }
): Promise<OpsResponse> {
  const first = await apiPost<OpsResponse | { requestId: string }>('/api/ops', { capability, ...payload })
  // FAL_MOCK short-circuits with the full result — no queue to poll.
  if ('imageUrl' in first) return first
  if (editor.getShape(shapeId)) {
    editor.run(
      () =>
        editor.updateShape<ImageNodeShape>({
          id: shapeId,
          type: 'image-node',
          props: { falRequestId: first.requestId },
        }),
      { history: 'ignore' }
    )
  }
  return pollOpsResult(capability, payload.model, first.requestId)
}

// Re-attach polling for every pending node that carries a falRequestId —
// called by CanvasApp right after snapshot load + sweep (which now leaves
// such nodes pending instead of erroring them). Guided region edits redo
// their client-side composite step, same as the live dispatch path.
export function resumePendingOps(editor: Editor): void {
  for (const s of nodes(editor)) {
    const requestId = s.props.falRequestId
    if (s.props.status !== 'pending' || !requestId) continue
    const op = s.props.op
    if (!('model' in op) || !op.model) continue
    const { done, fail } = makeSettlers(editor, s.id)
    void (async () => {
      try {
        const resp = await pollOpsResult(capabilityForOp(op), op.model, requestId)
        if (op.type === 'inpaint' && op.model !== 'gpt-image-2') {
          const parent = s.props.sourceId ? nodes(editor).find((n) => n.id === s.props.sourceId) : undefined
          if (parent?.props.assetUrl) {
            const { compositeRegion } = await import('@/lib/instant-ops')
            const out = await compositeRegion(parent.props.assetUrl, resp.imageUrl, op.rect)
            const { url } = await apiPost<{ url: string }>('/api/upload', { dataUrl: out.dataUrl }, false)
            done({ imageUrl: url, width: out.width, height: out.height })
            return
          }
        }
        done(resp)
      } catch (e) {
        fail(e)
      }
    })()
  }
}

// Fix round 2 (human-reported, applies to done/fail/the dims backfill
// below): all three are pending->settled status transitions on a node
// that already exists (created, with its own undo entry, back in runOp).
// Wrapped in `editor.run(fn, { history: 'ignore' })` so they don't ALSO
// push undo entries — otherwise Cmd-Z right after a result lands reverts
// 'done'/'error' back to 'pending' (a dead spinner) instead of undoing the
// node's creation outright. Extracted from dispatch() into a factory
// (2026-07-22) so resumePendingOps shares the exact settle behavior; both
// settlers also clear falRequestId — the queue request is finished either
// way.
function makeSettlers(editor: Editor, shapeId: TLShapeId) {
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
            falRequestId: undefined,
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
            falRequestId: undefined,
          },
        })
      },
      { history: 'ignore' }
    )
  return { done, fail }
}

async function dispatch(
  editor: Editor,
  shapeId: TLShapeId,
  op: Operation,
  parentUrl: string | undefined,
  resolveRef: (id: string) => string | undefined
): Promise<void> {
  const { done, fail } = makeSettlers(editor, shapeId)
  try {
    switch (op.type) {
      case 'generate': {
        done(await runModel(editor, shapeId, 'generate', { model: op.model, prompt: op.prompt }))
        break
      }
      case 'edit': {
        if (!parentUrl) throw new Error('edit requires a source image')
        // Multi-reference (user 2026-07-21): referenceNodeIds (multi-select
        // compose) merges with the older single referenceNodeId; both resolve
        // to live urls at dispatch time, missing/deleted nodes drop out.
        const refIds = [...(op.referenceNodeIds ?? []), ...(op.referenceNodeId ? [op.referenceNodeId] : [])]
        const refUrls = refIds.map((id) => resolveRef(id)).filter((u): u is string => !!u)
        done(
          await runModel(editor, shapeId, 'edit', {
            model: op.model,
            prompt: op.prompt,
            imageUrl: parentUrl,
            referenceUrls: refUrls.length ? refUrls : undefined,
          })
        )
        break
      }
      case 'inpaint': {
        if (!parentUrl) throw new Error('inpaint requires a source image')
        const inpaintRefIds = [...(op.referenceNodeIds ?? []), ...(op.referenceNodeId ? [op.referenceNodeId] : [])]
        const inpaintRefUrls = inpaintRefIds.map((id) => resolveRef(id)).filter((u): u is string => !!u)
        // Two region strategies by model capability (user 2026-07-21):
        //   gpt-image-2 — EXACT: the only registered model with a mask_url
        //     param; pixel mask, capability 'inpaint' (Task 21 path,
        //     unchanged).
        //   anything else (nano-banana, seedream) — GUIDED: no mask param
        //     exists, so the rect is drawn ONTO the image as a red outline
        //     (instant-ops.annotateRegion) and the prompt instructs the
        //     model to edit only inside it and erase the box. Routed through
        //     capability 'edit' — no registry change needed. Verified live
        //     against nano-banana-pro/edit before wiring (see
        //     annotateRegion's comment).
        if (op.model === 'gpt-image-2') {
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
          // Task 21: gpt-image-2's toParams (lib/fal-registry.ts's shared
          // GPT_IMAGE_2_EDIT) composes `image_urls: [imageUrl,
          // ...referenceUrls]` itself; this just hands refs through.
          done(
            await runModel(editor, shapeId, 'inpaint', {
              model: op.model,
              prompt: op.prompt,
              imageUrl: parentUrl,
              maskUrl,
              referenceUrls: inpaintRefUrls.length ? inpaintRefUrls : undefined,
            })
          )
        } else {
          const { annotateRegion, compositeRegion } = await import('@/lib/instant-ops')
          const annotatedDataUrl = await annotateRegion(parentUrl, op.rect)
          const { url: annotatedUrl } = await apiPost<{ url: string }>(
            '/api/upload',
            { dataUrl: annotatedDataUrl },
            false
          )
          const resp = await runModel(editor, shapeId, 'edit', {
            model: op.model,
            prompt: `Apply the following change ONLY inside the red rectangle outline drawn on the image. Keep everything outside the rectangle exactly the same, and remove the red rectangle from the final output. Change: ${op.prompt}`,
            imageUrl: annotatedUrl,
            referenceUrls: inpaintRefUrls.length ? inpaintRefUrls : undefined,
          })
          // Deterministic composite (user-reported 2026-07-22: the model kept
          // the red box in real runs): model pixels survive only INSIDE the
          // rect, the original everywhere else — hard guarantee that the
          // annotation stroke (drawn outside the rect) is gone and outside
          // pixels are untouched. The composited image is re-uploaded so the
          // node's assetUrl is durable like every other result.
          const out = await compositeRegion(parentUrl, resp.imageUrl, op.rect)
          const { url: compositedUrl } = await apiPost<{ url: string }>(
            '/api/upload',
            { dataUrl: out.dataUrl },
            false
          )
          done({ imageUrl: compositedUrl, width: out.width, height: out.height })
        }
        break
      }
      case 'upload':
      case 'crop':
      case 'resize':
      case 'rotate':
      case 'flip':
      case 'transform':
      case 'adjust':
      case 'redact':
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

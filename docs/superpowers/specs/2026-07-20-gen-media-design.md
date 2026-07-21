# gen_media — Design Spec

Date: 2026-07-20 · Status: awaiting approval · Companion mockups:
`docs/design/ux-directions.html` (published: https://claude.ai/code/artifact/404a9f32-4620-45fa-ae73-7dcef5b21dd7)

## 1. Problem & product

AI image tools fail their users in three ways:

1. **Whack-a-mole editing** — you ask for one change, the model changes five
   other things. No precision, no guarantees.
2. **Chat is the wrong UI for visual work** — no spatial view of what you've
   tried; going back to version 3 and branching differently is painful.
3. **Deterministic edits require leaving the tool** — a crop or text overlay
   shouldn't need a diffusion model, but chat tools have no toolbelt.

**gen_media** is a canvas where every AI image generation and edit is a node in
a branching version tree, so users iterate, compare, and branch precisely
instead of fighting a chat window.

The scope filter for everything below: **a 3-minute demo, built in a weekend.**

## 2. UX (decided — see mockup page for visuals)

**Canvas-First.** One continuous zoomable canvas (tldraw) holds the whole
exploration tree. No modals, no modes, no second screen.

**Gesture model** (complete input vocabulary):

| Gesture | Result |
|---|---|
| click node | select — action menu on node + inspector panel |
| drag node | reposition (persists; never auto-reshuffled) |
| drag background / scroll | pan / zoom |
| double-click node | camera zooms to fit that node |
| drag on selected image (region op armed) | draw inpaint/crop rect (text placement when stretch tool lands) |
| Esc | disarm op, else deselect |
| bottom prompt bar | generate a new root; Upload button beside it |

**Toolset — one flat menu, two families, one grammar.** Verbs on the selected
node: `✦ Edit · ✦ Inpaint · ✦ Vary · Crop · Resize` (+ `Text` as stretch #1).
The ✦ badge marks
model calls (~seconds, N variants, costs API credit); unmarked verbs are
instant, free, live-previewed. Every tool follows the same three-beat loop:

1. **Arm** — pick the verb.
2. **Configure on the image** — AI: prompt + region + optional reference.
   Instant: drag handles / place text with live preview.
3. **Commit → child node(s)** — ✦ Run spawns N pending children that fill in
   as results land; Apply creates one finished child instantly.

**Precision (pain point 1):** rect-region inpainting via FLUX Fill — pixels
outside the region are guaranteed untouched — plus cheap side-by-side variant
branching. Freehand brush is out of scope; the pipeline is brush-ready (a brush
only changes how the mask PNG is painted).

**References:** the Edit panel's "+ Reference" arms pick mode; clicking any
other canvas node attaches it (e.g. "match the style of v2"). Chat UIs cannot
point at history; the canvas can.

**Zoom-to-edit:** precision gestures happen by zooming into the node — the
map's zoom is the magnifier. A pointer-capturing overlay on the armed shape
routes events: drag on armed image = draw; drag background = pan.

## 3. Data model

The entire persisted product state is one array of immutable version nodes.

```ts
interface VersionNode {                // realized as tldraw custom-shape props
  id: string;
  sourceId: string | null;        // parent VERSION; null → root. (Named sourceId
                                  // because tldraw shapes own `parentId`.)
  op: Operation;                  // the operation that PRODUCED this node
  status: 'pending' | 'done' | 'error';
  kind: 'image' | 'video';        // 'image' only in prototype; named for the
  assetUrl?: string;              // video extension (not imageUrl), CDN or data URL
  naturalW?: number; naturalH?: number;
  durationMs?: number;            // video-only, unused in prototype
  error?: { code: string; message: string };
  createdAt: number;
}

type Rect = { x: number; y: number; w: number; h: number };  // natural pixels

type Operation =
  | { type: 'generate'; prompt: string; model: string }
  | { type: 'edit';     prompt: string; model: string; referenceNodeId?: string }
  | { type: 'inpaint';  prompt: string; model: string; rect: Rect }
  | { type: 'upload';   filename: string }
  | { type: 'crop';     rect: Rect }
  | { type: 'resize';   width: number; height: number }
  | { type: 'text';     text: string; x: number; y: number;
      font: string; size: number; color: string };
```

Decisions:

- **Immutable nodes; ops always create children.** v3 stays v3 no matter what
  you try from it. Only `x/y`, `status`, and the data-URL→CDN-URL swap mutate.
- **Op lives on the child; edges are derived** from `parentId` (edge label =
  `child.op.type`). One array is the whole persisted state.
- **Pending and error nodes are real nodes.** Variants appear instantly as
  pending siblings; failures keep their recipe, so Retry = re-dispatch `node.op`.
- **Op = provenance = recipe.** The inspector shows any node's full lineage;
  retry and cross-model comparison fall out for free.
- **`✦ Vary` is not a new op type:** it dispatches `edit` with a preset
  variation prompt ("subtle variation, keep composition and subject") for N
  children. One less concept in the schema.
- **Persistence (user decision: canvas-as-URL in core):** a canvas is
  `/c/:id`. The tldraw snapshot JSON is stored server-side in Vercel Blob via
  `GET/PUT /api/canvas/:id` — debounced autosave (~2s idle) + flush on tab
  close, last-write-wins. The server copy is the single durable source of
  truth; the editor runs in memory (no IndexedDB `persistenceKey`, avoiding a
  second authority). Anyone with the link can view and branch (README states
  this). Export/import JSON + per-node PNG download are the escape hatches.
  Conceptually `VersionNode` ≙ custom shape + validated props (see §6).

## 4. Architecture

```
Browser: Next.js client
  Canvas (tldraw, in-memory editor) · Inspector/op panels
  Instant ops run here in offscreen <canvas>
        │  POST /api/ops (model ops) · POST /api/upload (PNG → CDN URL)
        │  GET/PUT /api/canvas/:id (snapshot autosave, debounced)
Server: Next.js API routes (holds FAL_KEY + PASSCODE, stateless compute)
  zod-validate op → registry lookup → fal.subscribe → { imageUrl, w, h }
        │                                    │
fal.ai models + fal.media CDN (images)   Vercel Blob (canvas snapshots)
```

- **API protection:** shared passcode (env var) entered once in the UI, sent
  as a header on all mutating routes; plus a hard spend cap in fal's
  dashboard. No accounts.

- **Deployable to Vercel** because no server disk/DB: images are CDN URLs,
  tree state is client-side. Deployed demo is per-browser; README says so.
- **Model registry** (server): capability → default model + optional
  alternates + a params-mapper per model. `generate → FLUX 1.1 [pro]`
  (alt: Seedream 4.0), `edit → nano-banana` (alt: FLUX.1 Kontext),
  `inpaint → FLUX Fill`. Swapping/adding a model = one registry entry. ✦
  panels render a model picker only where >1 model is registered — comparing
  models across sibling variants is an intentional iteration axis.
- **Direct primitives, no agent loop.** Ops are structured recipes through one
  `runOp(parentId, op, variantCount)` dispatch. The theme is *control*; an LLM
  between user intent and operations re-introduces the indirection this tool
  exists to remove. A future agent is just another producer of ops (visible,
  editable op nodes) — architecturally open, deliberately unbuilt.

## 5. Operation pipeline

`runOp` creates N pending child nodes immediately (optimistic, auto-placed),
then forks by family:

- **Model ops:** one `POST /api/ops` per pending node, in parallel, so each
  node fails/retries independently; a client queue caps in-flight calls at 4
  (rate-limit hygiene). 90s timeout. Server normalizes errors to
  `rate_limited | content_policy | timeout | model_error`.
- **Instant ops:** rendered synchronously in an offscreen canvas → child is
  `done` immediately with a local data URL → background `/api/upload` swaps in
  the durable CDN URL ("not synced" badge + retry if upload fails).
- **Inpaint masks:** client renders the rect as a black/white PNG at natural
  resolution, uploads it, sends `maskUrl`. Server never does geometry.
- **References:** client resolves `referenceNodeId → imageUrl` at dispatch;
  server stays tree-ignorant. The node ID stays in the op for provenance.
- **Cancel** = delete the pending node (in-flight result discarded — accepted
  prototype tradeoff, noted in README).

## 6. Canvas engine & layout

**Engine: tldraw** (user decision, revising the original React Flow plan —
chosen for best-in-class canvas feel, built-in undo/redo + localStorage
persistence, and a near-free freehand mask brush later; accepted costs:
hand-built tree arrows, no minimap, license watermark, learning curve).

- **Single source of truth = tldraw store.** Versions are custom
  `ImageNodeShape`s carrying the §3 `VersionNode` fields as validated props;
  tree helpers (childrenOf/recipeOf) read the editor store.
  Persistence via `persistenceKey` snapshot. [superseded by §3 canvas-as-URL
  storage decision] Undo/redo covers node ops for free. Zustand holds only
  ephemeral UI state (armed tool, pick mode).
- **Edges = bound arrow shapes** created programmatically on child spawn,
  labeled with the op type; bindings make them follow dragged nodes.
  Reference links are dashed arrows.
- **Region gestures** = pointer-capturing overlay inside the selected shape's
  component (fallback: idiomatic custom tldraw tool if events fight us).
- **Auto-placement, not auto-layout:** children spawn right of parent, fanned
  by sibling index, collision-nudged. **No global re-layout ever** — spatial
  memory is a core value.
- **Zoom-to-node:** `editor.zoomToBounds()` on double-click. Minimap cut;
  zoom-to-fit covers navigation at demo scale.
- **Coordinate utility:** one module owns screen↔natural-pixel conversion for
  marquee/crop/text. All geometry math is quarantined there and unit-tested.
- **Spike gate (Saturday, timeboxed 2 hrs):** custom image shape + bound
  labeled arrow + interactive overlay + one real fal call + canvas
  `toDataURL()` CORS test. If the spike fails, revert to React Flow per the
  original design (this section's history in git).

## 7. Error handling

- Model/API failures → error nodes with human-readable message + Retry
  (recipe-preserving). Rate limits surface as "queued/rate-limited", not crashes.
- Upload failures → node keeps working from data URL, badge + retry.
- Snapshot save failures (network/blob) → non-blocking "not saved" indicator
  with retry; editing continues in memory; export JSON always available.
- Wrong/missing passcode → 401 with a friendly re-prompt in the UI.
- Missing FAL_KEY → `/api/ops` returns a setup hint surfaced in the UI.

## 8. Testing & verification

Weekend-honest strategy:

- **Unit tests** only where logic is pure and fragile: coordinate mapping,
  child auto-placement/collision nudge, op→fal params mappers, store reducers
  (runOp optimistic states, retry).
- **Manual verification script** (docs/): the 3-minute demo path itself —
  generate → 3 edit variants → zoom → rect inpaint → crop → text → reference
  edit → reload page (persistence) → export JSON. Run before calling anything
  done.
- No E2E harness for a weekend prototype; the demo script is the E2E.

## 9. Build order (de-risked)

1. Spike gate (§6): tldraw image shape + bound arrow + overlay + one fal call
   + CORS test. Then scaffold for real; fake nodes render, pan/zoom works.
2. `generate` end-to-end (prompt bar → /api/ops → real image node). **First
   demoable moment.**
3. `edit` + variants + pending/error/retry nodes.
4. Instant ops (crop → resize) + upload sync.
5. `inpaint` (rect overlay → mask PNG → FLUX Fill).
6. Canvas-as-URL: `/c/:id` + Vercel Blob save/load + passcode gate.
7. References (pick mode).
8. Polish: zoom-to-edit feel, empty state, export/import, README.
9. Deploy to Vercel; record demo path.
   Stretch, in order: text overlay tool → compare view → intent compiler.

Each step leaves a working app; if the weekend ends early, we ship the last
completed step.

## 10. Extension map (designed-for, deliberately unbuilt)

Seams paid for now (near-zero cost) so future work is additive, not migratory:

- **Multiplayer** (`@tldraw/sync`): the store-is-source-of-truth rule makes the
  canvas replication-ready; the invariant to preserve is *shared state lives in
  shape props, Zustand only holds per-user ephemera*. Blocker is infra, not
  design: sync needs a websocket host (e.g. Cloudflare DO), not Vercel lambdas.
- **Video**: `kind`/`assetUrl`/`durationMs` in props (vs a later shape
  migration); rendering behind an `AssetView` component (img today, video
  branch later); video ops are new `Operation` union members + registry
  capabilities (fal hosts Kling/Veo); instant tools will declare which kinds
  they accept.
- **More models**: one registry entry each; picker auto-appears; per-model
  param schemas that auto-render controls are the named future seam.

## 11. Out of scope (parked in CLAUDE.md "Later")

Text overlay (stretch #1, displaced by shareable canvases) · freehand mask
brush · Claude op-routing/agent layer · video · auth/accounts (canvases are
unlisted URLs) · compare view · minimap · single-shot intent compiler.

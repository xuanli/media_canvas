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

**Canvas-First.** One continuous zoomable canvas (React Flow) holds the whole
exploration tree. No modals, no modes, no second screen.

**Gesture model** (complete input vocabulary):

| Gesture | Result |
|---|---|
| click node | select — action menu on node + inspector panel |
| drag node | reposition (persists; never auto-reshuffled) |
| drag background / scroll | pan / zoom |
| double-click node | camera zooms to fit that node |
| drag on selected image (region op armed) | draw inpaint/crop rect; drag text to place |
| Esc | disarm op, else deselect |
| bottom prompt bar | generate a new root; Upload button beside it |

**Toolset — one flat menu, two families, one grammar.** Verbs on the selected
node: `✦ Edit · ✦ Inpaint · ✦ Vary · Crop · Resize · Text`. The ✦ badge marks
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
map's zoom is the magnifier. React Flow's `nodrag` class routes pointer events:
drag on armed image = draw; drag background = pan.

## 3. Data model

The entire persisted product state is one array of immutable version nodes.

```ts
interface VersionNode {
  id: string;
  parentId: string | null;        // null → root (generated or uploaded)
  op: Operation;                  // the operation that PRODUCED this node
  status: 'pending' | 'done' | 'error';
  imageUrl?: string;              // fal.media CDN URL (or data URL awaiting sync)
  width?: number; height?: number;
  error?: { code: string; message: string };
  x: number; y: number;           // canvas position
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
- **Persistence:** Zustand + persist middleware → localStorage (tree JSON only;
  images are URLs). Export/import of the same JSON is the sharing escape hatch.

## 4. Architecture

```
Browser: Next.js client
  Canvas (React Flow) · Inspector/op panels · Zustand store → localStorage
  Instant ops run here in offscreen <canvas>
        │  POST /api/ops (model ops) · POST /api/upload (PNG → CDN URL)
Server: Next.js API routes (holds FAL_KEY, stateless)
  zod-validate op → registry lookup → fal.subscribe → { imageUrl, w, h }
        │
fal.ai models · all images live on fal.media CDN as stable URLs
```

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

## 6. Canvas layout

- **Auto-placement, not auto-layout:** children spawn right of parent
  (`x + NODE_W + GAP`), fanned vertically by sibling index, collision-nudged
  down until free. **No global re-layout ever** — user-dragged positions are
  permanent because spatial memory is a core value. (This is why not dagre.)
- **Zoom-to-node:** React Flow `setCenter` animation on double-click.
- **Coordinate utility:** one module owns screen↔natural-pixel conversion for
  marquee/crop/text. All geometry math is quarantined there and unit-tested.
- Perf: fine at demo scale; `onlyRenderVisibleElements` available if needed.

## 7. Error handling

- Model/API failures → error nodes with human-readable message + Retry
  (recipe-preserving). Rate limits surface as "queued/rate-limited", not crashes.
- Upload failures → node keeps working from data URL, badge + retry.
- localStorage quota: data URLs are transient by design; if a write fails, warn
  and offer JSON export.
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

1. Scaffold: Next.js + React Flow + Zustand; fake nodes render, pan/zoom works.
2. `generate` end-to-end (prompt bar → /api/ops → real image node). **First
   demoable moment.**
3. `edit` + variants + pending/error/retry nodes.
4. Instant ops (crop → resize → text) + upload sync.
5. `inpaint` (rect overlay → mask PNG → FLUX Fill).
6. References (pick mode).
7. Polish: zoom-to-edit feel, minimap, empty state, export/import, README.
8. Deploy to Vercel; record demo path.

Each step leaves a working app; if the weekend ends early, we ship the last
completed step.

## 10. Out of scope (parked in CLAUDE.md "Later")

Freehand mask brush · Claude op-routing/agent layer · video · auth/DB/multi-user
· compare view (stretch) · single-shot intent compiler (stretch candidate).

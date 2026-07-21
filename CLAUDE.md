# gen_media — North Star

Prototype for an Anthropic take-home. Theme: creative tools that give users real
control over iteration, variation, and refinement — not just "generate" buttons.

## The one-sentence product

A canvas where every AI image generation and edit is a node in a branching
version tree, so users can iterate, compare, and branch precisely instead of
fighting a chat window.

## The three pain points it answers (in priority order)

1. **Whack-a-mole editing** — model edits change things you didn't ask to change.
   Answer: rect-region inpainting (pixels outside the region are guaranteed
   untouched) + cheap side-by-side variant branching.
2. **Chat is the wrong UI for visual work** — no spatial history, hard to go back
   and branch. Answer: the Canvas-First branching tree (the hero feature).
3. **Deterministic edits shouldn't need a model** — crop/resize/text forced users
   into another app. Answer: deterministic ops run client-side, instantly, as
   first-class nodes.

## Demo test (the scope filter)

Every feature must earn its place in a **3-minute demo** built in a **weekend**.
Before adding anything, ask: does this make the 3-minute story stronger than
polishing what exists? If no — cut it or park it in "Later".

## Locked decisions

- **UX**: Canvas-First. One continuous zoomable canvas (React Flow). Selection
  shows an action menu + inspector. Region gestures happen by zooming into the
  node (zoom-to-edit) — no modals, no modes. See `docs/design/ux-directions.html`.
- **Ops (weekend scope)**: generate, edit (instruction, optional reference),
  inpaint (rect region), upload, crop, resize, text overlay. Multi-variant runs
  create pending sibling nodes; errors are retryable nodes.
- **Toolset UX**: one flat action menu on the selected node; AI ops carry a ✦
  spark badge (model call, ~seconds, N variants), instant ops don't (free, live
  preview). Every tool uses the same three-beat loop: arm → configure on the
  image → commit creates child node(s).
- **References**: Edit accepts a reference image chosen by clicking another
  canvas node ('+ Reference' → pick mode → click node). Stored as
  `referenceNodeId` on the op.
- **Data model**: immutable version nodes; the op that produced a node lives ON
  the node (provenance = recipe = retry); edges derived from `parentId`;
  tree JSON persisted to localStorage; images are fal.media CDN URLs only.
- **Stack**: Next.js (deployable to Vercel), React Flow canvas, Zustand state,
  thin `/api/ops` + `/api/upload` routes proxying fal (key stays server-side).
- **Models via fal**, behind a small capability registry with one default per
  capability (generate → FLUX 1.1 pro, edit → nano-banana, inpaint → FLUX
  Fill) plus optional alternates (edit → FLUX Kontext, generate → Seedream).
  Swapping/adding a model = editing a registry entry. ✦ panels show a model
  picker only where >1 model is registered — comparing models across sibling
  nodes is an intentional iteration axis.
- **Op dispatch**: direct primitives, no LLM in the operation loop. Ops are
  serializable recipes through one `runOp` entry point; a future agent is just
  another producer of ops (that's what "smart routing → Later" means).

## Explicitly OUT of weekend scope (parked in "Later")

- Freehand mask brush (rect only; pipeline is brush-ready)
- Claude-powered smart op routing
- Video generation (the startup use case includes it; prototype is images only)
- Auth, multi-user, server-side DB, cross-device sync
- Side-by-side compare view (stretch goal only if ahead of schedule)

## Working agreements

- The submission is judged on **judgment**: direction of AI tools, evaluating
  outputs, tradeoffs, maintaining vision. Keep decision rationale in docs/.
- When a new idea appears mid-build, add it to "Later" in this file instead of
  building it — unless it passes the demo test above.

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

- **UX**: Canvas-First. One continuous zoomable canvas (tldraw). Selection
  drives the bottom command bar (v2 chrome, see below — superseded the old
  on-node action menu + right-side inspector). Region gestures happen by
  zooming into the node (zoom-to-edit) — no modals, no modes. See
  `docs/design/ux-directions.html`.
- **Ops (weekend scope)**: generate, edit (instruction, optional reference),
  inpaint (rect region), upload (restored in v2 chrome via command bar), crop, resize.
  Multi-variant runs create pending sibling nodes; errors are retryable
  nodes. (Text overlay → stretch; displaced by shareable canvases
  2026-07-20.)
- **V2 chrome (user decision 2026-07-21, post-v0.1)**: slim top nav (recent-canvas
  switcher client-side, new/share-link/export, save dot) + ONE centered bottom
  command bar replacing PromptBar/Inspector/ActionMenu — "Bar B": idle =
  upload+generate; selected = recipe + verb row; armed = tray slides up with
  the verb's controls. Upload-as-root-node is back in scope via the bar.
  Mockups: docs/design/ux-directions.html §v2-chrome.
- **Toolset UX**: one flat action menu on the selected node (v1; verbs move
  into the command bar in v2 chrome); AI ops carry a ✦
  spark badge (model call, ~seconds, N variants), instant ops don't (free, live
  preview). Every tool uses the same three-beat loop: arm → configure on the
  image → commit creates child node(s).
- **References**: Edit accepts a reference image chosen by clicking another
  canvas node ('+ Reference' → pick mode → click node). Stored as
  `referenceNodeId` on the op.
- **Data model**: immutable version nodes; the op that produced a node lives ON
  the node (provenance = recipe = retry); versions are tldraw custom shapes
  (tree relation prop is `sourceId` — never reuse tldraw's own `parentId`);
  edges are bound labeled arrows; images are fal.media CDN URLs only.
- **Storage (user decision 2026-07-20: canvas-as-URL in CORE scope)**: a canvas
  is `/c/:id`; snapshot JSON stored in Vercel Blob via `GET/PUT
  /api/canvas/:id`, debounced autosave, last-write-wins, server is the single
  durable source of truth (no IndexedDB persistenceKey). Export/import JSON +
  per-node PNG download are the escape hatches.
- **API protection**: shared passcode (env var, entered once, sent as header)
  + hard spend cap in fal dashboard. No auth/user accounts. Hardening baked
  into v1: passcode fails CLOSED in production, timing-safe compare,
  `server-only` imports guard FAL_KEY, 12-char crypto-random canvas ids,
  magic-byte upload validation.
- **Testing**: unit tests on pure logic; `FAL_MOCK`/`STORAGE_MOCK` env flags
  give a free offline dev mode; Playwright E2E runs the demo path fully mocked
  (`pnpm test:e2e`) with zero-console-error assertions; `docs/verify.md` is
  the human pass for UX feel. Declined consciously: live smoke test, CSP
  headers, rate limiting (spend cap is the money backstop).
- **Stack**: Next.js (deployable to Vercel), **tldraw** canvas (user decision
  2026-07-20; chosen for canvas feel + free undo/redo/persistence + freehand
  brush path later). tldraw store is the single source of truth — versions are
  custom shapes with op meta, edges are bound labeled arrows, storage per
  the canvas-as-URL decision above (no persistenceKey). Zustand only for
  ephemeral UI state. Thin `/api/ops` +
  `/api/upload` routes proxying fal (key stays server-side). Minimap cut.
  Fallback if the Saturday 2-hr tldraw spike fails: React Flow as originally
  designed (see spec §4 history).
- **Models via fal**, behind a small capability registry with one default per
  capability (generate → FLUX 1.1 pro, edit → nano-banana, inpaint → FLUX
  Fill) plus optional alternates (edit → FLUX Kontext, generate → Seedream).
  Swapping/adding a model = editing a registry entry. ✦ panels show a model
  picker only where >1 model is registered — comparing models across sibling
  nodes is an intentional iteration axis.
- **Op dispatch**: direct primitives, no LLM in the operation loop. Ops are
  serializable recipes through one `runOp` entry point; a future agent is just
  another producer of ops (that's what "smart routing → Later" means).
- **Spike PASSED 2026-07-20; tldraw confirmed; CORS: ok (no proxy needed for
  client-side canvas ops)**. Task 2 spike verified against installed tldraw
  5.2.5 + fal live API. fal.media CDN (`v3.fal.media`) returns
  `access-control-allow-origin: *`, so `crossOrigin='anonymous'` + `toDataURL()`
  will not taint the canvas — instant client-side ops (crop/resize/PNG export)
  need NO fal proxy; the proxy is only for hiding FAL_KEY on model calls.
  tldraw API corrections for later tasks: custom shapes MUST register their
  type via `declare module 'tldraw' { interface TLGlobalShapePropsMap {...} }`
  (else `TLShape` is a closed union and every `ShapeUtil`/`editor.createShape`
  generic fails to typecheck); shape utils implement `getGeometry` +
  `getIndicatorPath` (NOT the old JSX `indicator()`); arrow labels use
  `props.richText` via `toRichText()` (NOT `props.text`); arrow bindings use
  `editor.createBinding({ type:'arrow', fromId, toId, props:{ terminal:'start'|'end' } })`
  and arrows track shape moves automatically (ArrowBindingUtil is in
  `defaultBindingUtils`); CORRECTION (Task 10): `stopEventPropagation` is NOT
  re-exported from the `tldraw` package (only `@tldraw/editor`, not a direct
  dep) — use plain `e.stopPropagation()` on an overlay's `onPointerDown` to
  block canvas pan (equivalent; it's what the helper does internally). NOTE on verification tiers: the two
  interactive checks (overlay-pan-suppression, arrow-follows-drag) AND the
  CORS `toDataURL()` behavior were verified by API-contract/headers only —
  NOT exercised in a live browser (no browser/Playwright at spike time; CORS
  claim rests on the ACAO header, a strong but indirect signal). Task 8
  manual verify + Task 12b Playwright exercise them for real.
- **Live API verification 2026-07-20 (post-credits)**: `generate`
  (flux-pro/v1.1) and `edit` (nano-banana/edit) confirmed with real 200
  responses end-to-end (generate → edit chain on a real image). `inpaint`
  (flux-pro/v1/fill) live-verified 2026-07-21 during Task 11: real mask,
  edit confined to masked region, visually confirmed.

## Explicitly OUT of weekend scope (parked in "Later")

- Text overlay tool (stretch #1 — displaced by shareable canvases)
- Multiplayer via @tldraw/sync (design-ready: shared state must live in shape
  props, Zustand per-user only; needs a websocket host, not Vercel lambdas)
- Video ops (schema pre-seamed: kind/assetUrl/durationMs, AssetView component)
- Freehand mask brush (rect only; pipeline is brush-ready; cheap on tldraw)
- Claude-powered smart op routing / agent layer (ops schema is agent-ready)
- Video generation (the startup use case includes it; prototype is images only)
- Auth / user accounts / per-user galleries (canvases are unlisted URLs)
- Side-by-side compare view
- Minimap (cut with the tldraw switch; zoom-to-fit covers navigation)

## Working agreements

- The submission is judged on **judgment**: direction of AI tools, evaluating
  outputs, tradeoffs, maintaining vision. Keep decision rationale in docs/.
- When a new idea appears mid-build, add it to "Later" in this file instead of
  building it — unless it passes the demo test above.

## Framework notes

@AGENTS.md

# Media Lab (repo: gen_media)

A canvas where every AI image generation and edit is a node in a branching
version tree, so you can iterate, compare, and branch precisely instead of
fighting a chat window.

Built for an Anthropic take-home. Full design rationale, decisions, and
build history live in `docs/` and this repo's git log (see
[AI-collaboration](#ai-collaboration) below).

## The three problems it answers

1. **Whack-a-mole editing** — ask a model to change one thing, it changes
   five. Media Lab answers this with instruction-based rect-region editing
   (draw a region, describe the *change* to it — "make it blue" — via
   GPT Image 2's masked edit, which edits the existing content in place
   rather than regenerating it from a prompt) plus cheap side-by-side
   variant branching, so you can compare instead of gambling on one shot.
2. **Chat is the wrong UI for visual work** — no spatial history, no easy
   way to go back and try something different from version 3. Media Lab
   answers this with a Canvas-First branching tree: every generation and
   edit is a node, every retry is a sibling, and you can zoom into any
   point in the history and branch from there.
3. **Deterministic edits shouldn't need a model** — crop and resize don't
   need a diffusion call, but chat tools give you no toolbelt. Media Lab
   answers this with instant, client-side deterministic ops that create
   nodes immediately, no model round-trip. (Text overlay was scoped in here
   too but is parked — see "Explicitly OUT of weekend scope" in `CLAUDE.md`.)

## Quickstart

```bash
pnpm i
cp .env.example .env.local   # see below for the free offline mode
pnpm dev
```

### Free, fully offline mode (no API keys, no spend)

```bash
FAL_MOCK=1 STORAGE_MOCK=1 pnpm dev
```

`FAL_MOCK=1` swaps real fal.ai calls for a fast in-memory mock (returns a
generated SVG data URL after a simulated ~1.5s delay); `STORAGE_MOCK=1`
swaps Vercel Blob for an in-memory canvas store (single-process, resets on
restart). No `FAL_KEY`, no `BLOB_READ_WRITE_TOKEN`, no `APP_PASSCODE`
needed in this mode — the passcode gate fails open when `APP_PASSCODE` is
unset outside production. This is also how `pnpm test:e2e` runs (see
`playwright.config.ts`).

### Real mode

Fill in `.env.local` from `.env.example`:

- `FAL_KEY` — from https://fal.ai/dashboard/keys. **Set a spend cap in the
  fal dashboard before using a real key** — there is no server-side rate
  limiting in this prototype, the spend cap is the money backstop.
- `APP_PASSCODE` — any string; required to mutate (`/api/ops`,
  `/api/canvas`). Sent as the `x-gm-passcode` header, entered once in the UI
  and cached in `localStorage`.
- `BLOB_READ_WRITE_TOKEN` — only needed if you want real Vercel Blob
  persistence locally instead of `STORAGE_MOCK=1`.

### Tests

```bash
pnpm test        # unit tests — pure logic (tree, schemas, errors)
pnpm test:e2e     # Playwright, fully mocked, zero-console-error assertions
```

`docs/verify.md` is the human demo-path checklist — the judgment calls
(does an edit actually look right, does the UX feel right) that automated
tests can't make for you. Walk it before every deploy.

## Architecture sketch

```
Browser: Next.js client
  Canvas (tldraw editor, in-memory) — SINGLE SOURCE OF TRUTH
    versions = custom tldraw shapes (op metadata as validated shape props)
    edges = bound, labeled tldraw arrows (derived from each node's op)
    instant ops (crop/resize) run here, in an offscreen <canvas>
        │  POST /api/ops      (model ops: generate/edit/inpaint)
        │  POST /api/upload   (instant-op PNG → durable CDN URL)
        │  GET/PUT /api/canvas/:id  (snapshot autosave, ~2s debounce)
Server: Next.js API routes (stateless; holds FAL_KEY + APP_PASSCODE)
  passcode check → zod validate → capability registry lookup → fal.subscribe
        │                                              │
fal.ai models + fal.media CDN (images)          Vercel Blob (canvas JSON)
```

- **Canvas as source of truth.** The tldraw store — not React state, not a
  server DB — is authoritative in the browser. Persistence is
  canvas-as-URL: a canvas lives at `/c/:id`, its full snapshot JSON is
  autosaved to Vercel Blob (`GET/PUT /api/canvas/:id`), last-write-wins.
  There is no `IndexedDB`/`persistenceKey` local persistence layer — the
  server copy is the single durable authority, so two tabs on the same
  `/c/:id` don't fight two different sources of truth.
- **Ops as recipes, one dispatch point.** Every mutation — model call or
  instant transform — is a serializable op object that flows through one
  `runOp(parentId, op, variantCount)` entry point (`lib/run-op.ts`). The op
  that produced a node lives ON that node: provenance = recipe = retry
  target. No LLM sits in the operation loop; a future agent would just be
  another producer of these same op objects.
- **Capability registry, not hardcoded model calls.** `lib/fal-registry.ts`
  maps `capability → { default model, alternates, param mapper }`
  (`generate → nano-banana` (alts: gpt-image-2, seedream-5-lite,
  flux-1.1-pro), `edit → nano-banana` (alts: gpt-image-2, seedream-5-lite),
  `inpaint → gpt-image-2` only — a masked *instruction* edit, "make it
  blue", not a generative-fill model describing "what appears"; FLUX Fill
  was removed 2026-07-21 for exactly that gap, see `CLAUDE.md`). Swapping
  or adding a model is one registry entry; the ✦ panel only shows a model
  picker where more than one model is registered for a capability.
- **Canvas-as-URL blob storage.** No accounts, no database. Anyone with a
  canvas's URL can view and branch it (see tradeoffs below).

## Decisions & tradeoffs

Full rationale: `docs/superpowers/specs/2026-07-20-gen-media-design.md`
(design spec) and `CLAUDE.md` (locked decisions + the "Later" list of
consciously deferred scope — multiplayer sync, video ops, freehand mask
brush, Claude-powered op routing, auth/accounts, compare view, text
overlay).

- **tldraw watermark.** tldraw's free tier renders a "Made with tldraw"
  watermark without a business license — accepted as a prototype cost for
  best-in-class canvas feel, free undo/redo, and built-in snapshot
  persistence primitives.
- **Unlisted-URL canvas access model.** There are no accounts; anyone who
  has (or guesses) a canvas's 12-char crypto-random URL can view and branch
  it, gated only by the shared passcode on mutations. This is a conscious
  scope cut, not an oversight — real multi-tenant auth was never in the
  weekend's demo-test scope.
- **Cancel discards the in-flight result.** There's no way to cancel a
  pending model call and keep its result if it lands late — cancel just
  deletes the pending node. Accepted prototype tradeoff.
- **fal CDN URL retention caveat.** Generated images live at `fal.media`
  CDN URLs that fal.ai hosts, not URLs this app controls; there's no
  guarantee about how long fal retains them. Export/download-PNG exist as
  the escape hatch for anything you want to keep permanently.
- **Last-write-wins autosave.** Two tabs editing the same `/c/:id`
  concurrently will silently clobber each other's last save — no
  operational-transform or merge logic. Fine for the single-user demo case
  this was scoped for.
- **Passcode, not accounts.** A single shared passcode (env var,
  timing-safe compare, header-based) plus a fal dashboard spend cap is the
  entire security model. It fails CLOSED in production if unset
  (`lib/server-auth.ts`) and fails open in local dev, matching the offline
  mock-mode quickstart above.

## Testing story

- **Unit** (`pnpm test`, Vitest): pure logic — tree traversal, zod schema
  validation, fal error normalization. `lib/__tests__/*.test.ts`.
- **Mocked E2E** (`pnpm test:e2e`, Playwright): the demo path exercised in a
  real browser against `FAL_MOCK=1 STORAGE_MOCK=1` — generate, edit-spawns-
  variants-with-arrows, reload persistence, a real pointer-drag crop, and
  the reference-pick flow. Zero-console-error assertions on every spec.
  `e2e/demo.spec.ts`.
- **Human verification** (`docs/verify.md`): the demo-path checklist for
  what automation can't judge — real-model output quality, UX feel, and the
  production fail-closed check (`POST /api/ops` without the passcode header
  → `401`). Marks which steps duplicate E2E coverage vs. are human-only.

## AI-collaboration

Built with Claude Code end-to-end (spec → plan → task-by-task
implementation → this README). The full decision trail lives in
`docs/superpowers/`: the [design spec](docs/superpowers/specs/2026-07-20-gen-media-design.md)
(problem framing, locked decisions), the [implementation plan](docs/superpowers/plans/2026-07-20-gen-media.md)
(task breakdown), and the [execution ledger](docs/superpowers/progress-ledger.md)
(task-by-task record of the subagent build, reviews, and adjudications) —
plus the git history itself (per-task commits, review/fix-round commits),
per the assignment's request to show how AI tools were directed and
evaluated rather than just the final diff.

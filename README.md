# Media Canvas

Generate, refine, and compare AI image variations on one branching canvas — instead of fighting a chat window that overwrites your last result.

**Live demo:** https://genmedia-theta.vercel.app · **Design rationale:** [`docs/DESIGN_RATIONALE.md`](docs/DESIGN_RATIONALE.md)

Built for an Anthropic take-home (Theme 2: Creative & Generative Tools).

## The problem

I run a company (Komos) and constantly need to produce media assets. Today's AI image models are amazing at *generating* rich, realistic images — but frustrating to actually *work* with:

- **You can't edit precisely.** Ask a model to change one thing and it changes five. And simple deterministic edits — crop, resize, adjust lighting — it can't do accurately at all, so you end up exporting to a separate editor and switching back and forth.
- **Chat is the wrong shape for visual work.** A linear thread is a bad way to hold several variations side by side and compare them. Each new message overwrites the last visual, and there's no easy way to go back to version 3 and try a different direction.
- **No first-class references.** Feeding an earlier version back in as a reference means copy-pasting screenshots.

## How Media Canvas solves it

**One branching canvas.** Every generation and every edit becomes a node connected to its parent, laid out on an infinite canvas — a global, visual view of how an asset evolved. Branch from any point, generate several variations at once, and compare them side by side. Nothing is overwritten.

**Precision tools and AI editing in one place.** Two kinds of operations, on the same node:

- **Instant, deterministic edits** — crop, resize, rotate/flip, brightness/contrast/saturation, redact — run client-side in the browser. No model call, no cost, no round-trip.
- **AI edits** — generate, edit, region edit (draw a box, describe the change), all with optional reference images — call a model through fal.ai.

No more switching between an AI tool and a traditional editor.

## Quickstart

Run it free and fully offline — no API keys, no spend:

```bash
pnpm i
FAL_MOCK=1 STORAGE_MOCK=1 pnpm dev
```

Mock mode returns placeholder images and keeps canvases in memory, so you can explore the whole experience with zero setup.

For real models, copy `.env.example` to `.env.local` and set `FAL_KEY` (from https://fal.ai/dashboard/keys — **set a spend cap first**), then `pnpm dev`.

## How it works

```
Browser (Next.js + tldraw)  ──  the canvas is the source of truth
  • every node is a tldraw shape carrying the op that produced it
  • deterministic ops (crop/resize/…) run in an offscreen <canvas>
        │  POST /api/ops             — model ops (queued on fal, resumable)
        │  GET/PUT /api/canvas/:id    — snapshot autosave (~1s debounce)
Server (Next.js API routes, stateless)
        │
   fal.ai models              Vercel Blob (one JSON snapshot per canvas)
```

A few decisions worth calling out:

- **Ops as recipes, one dispatch point.** Every edit — model or deterministic — is a serializable op that flows through a single `runOp()` entry point, and the op that produced a node is stored *on* that node. Provenance, retry target, and recipe are the same thing. This abstraction is also what makes a future "agent mode" (composing ops from a high-level instruction) a small step rather than a rewrite.
- **Capability registry, not hardcoded models.** `lib/fal-registry.ts` maps each capability to its model(s) and parameter mapping; swapping or adding a model is one entry.
- **Region editing on any model.** Draw a box and describe the change. Models with a real mask API use it directly; for the rest, the region is annotated onto the image and the model's result is composited back *only inside the box* — so pixels outside are guaranteed untouched, whatever the model.
- **Resumable generations.** Model calls go through fal's queue with the request id stored on the node, so a refresh or canvas-switch mid-generation doesn't lose the result.
- **Canvas-as-URL storage.** No accounts, no database — each canvas is one JSON snapshot in Vercel Blob at `/c/:id`, shareable by link and gated by a shared passcode on writes. A deliberate prototype scope cut, not a product-grade auth model.

## Built with Claude Code

This was built end-to-end with Claude Code — spec, plan, implementation, and iteration. The design rationale is in [`docs/DESIGN_RATIONALE.md`](docs/DESIGN_RATIONALE.md); the fuller decision trail lives in `docs/` and the git history (per-feature commits with the rationale in each body), per the assignment's ask to show how the AI was directed and evaluated rather than just the final diff.

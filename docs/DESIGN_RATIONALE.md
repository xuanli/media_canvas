# Media Canvas — Design Rationale

**Theme 2: Creative & Generative Tools** · Live: https://genmedia-theta.vercel.app · Repo: https://github.com/xuanli/media_canvas

A canvas where every AI image generation and edit becomes a node you can branch, refine with precision tools, and compare — instead of a chat thread that overwrites your last result.

## Why this theme and this approach

This isn't hypothetical for me — it's a pain point from running my own company (Komos), where I constantly need to produce media assets. Today's models generate genuinely rich, realistic images, but *working* with them is frustrating in three specific ways:

- **No precise editing.** Ask a model to change one thing and it changes five. And simple deterministic edits — crop, resize, adjust lighting — it can't do accurately at all, so I export to a separate editor and switch back and forth.
- **Chat is the wrong shape for visual work.** A linear thread is a bad way to hold several variations side by side and compare them; each message overwrites the last, and there's no way to go back to version 3 and try a different direction.
- **No first-class references.** Feeding an earlier version back in as a reference means copy-pasting screenshots.

I'd been mulling a "media canvas" as the answer for a while; the take-home was the excuse to build it. I looked for something like it on the market and didn't find one.

## What's non-obvious about it

Two bets, each addressing the frustrations above:

1. **A branching canvas as the primary surface.** Every generation and edit is a node connected to its parent on an infinite canvas — a global, visual view of how an asset evolved. Branch from any point, generate several variations at once, compare directly. For images (inherently visual), a design-board layout beats a scroll-back chat.

2. **Precision tools and AI editing unified on one node.** Every tool other than the model itself keeps these separate; here, deterministic manipulation (crop, resize, rotate/flip, brightness, redact) and model editing (generate, edit, region edit, references) are the same operation set on the same node. No more switching between an AI tool and a traditional editor.

## Key design decisions & tradeoffs

**Keep the system as simple as possible.** It's a functioning prototype to prove the idea, so: one Next.js app on Vercel (frontend + API routes, stateless), and one JSON snapshot per canvas in Vercel Blob under a unique id. Navigating to `/c/:id` loads the snapshot; there's no database and no accounts. Canvases are shared by link.

**An operation abstraction built for extension.** Every edit is a serializable op of one of two kinds — a client-side deterministic transform (instant, free) or an AI model call via fal.ai — flowing through a single dispatch point, with the op that produced a node stored *on* that node (provenance = retry target = recipe). Adding a tool is one more op; this is also what makes a future agent mode (below) a small step, not a rewrite.

**Region editing on any model — a tradeoff I'm happy with.** Most models can't take a pixel mask. Rather than restricting region edits to the one that can, I annotate the region onto the image, let any model edit it, then composite the result back *only inside the box* — so pixels outside are guaranteed untouched, whatever the model. A deterministic guarantee layered over a non-deterministic model.

**tldraw over React Flow.** Both work; I chose tldraw for solid out-of-the-box undo/redo and canvas primitives (didn't rebuild them) and its strong support for real-time collaboration, a direction I'd want later. It costs a watermark on the free tier — an accepted prototype cost.

**Cost-consciousness.** fal makes swapping models trivial, but good media models aren't cheap. That's the real constraint on agent mode: an agent loop is powerful because it iterates on results, but each iteration is a paid call.

**Deliberately light security.** A single shared passcode gates writes; it fails closed in production, open in local dev. Fine for a prototype to demonstrate the idea; real multi-tenant auth would be the first thing to add for actual users.

## How I'd extend it with more time

- **Agent mode — the biggest one.** Because every operation is a clean, one-shot capability, the natural next step is an agent that composes them from a high-level instruction — "resize this, add my logo as a reference, and make it fit the tone of my latest marketing post" — generating, inspecting the result, and iterating. The op abstraction is specifically what makes this incremental. Cost guardrails on the loop would be essential.
- **Video nodes** — the reason it's "Media" Canvas, not "Image" Canvas.
- **Real-time collaboration** — a major reason I picked tldraw.
- **Multi-tenancy and real auth** — to move from prototype to product.

## Time spent

~5–6 hours of active hands-on time across three evenings — an hour of design and tradeoffs before kicking off the build, the bulk of the build and product iteration next, and a final evening of polish, bug fixes, the demo example canvas, and deploy. Claude Code handled most of the execution during longer unattended stretches, so the wall-clock span is longer than the engaged time. I knowingly went past the 2-hour target because I was building a tool I actually need and wanted to build it properly.

## On AI usage

Built end-to-end with Claude Code, but directed throughout: I chose the architecture and the operation abstraction, rejected outputs that didn't fit (several rounds on the demo scene and the region-edit approach), root-caused real bugs it missed or introduced (an aspect-ratio drift when a reference had a different shape; edges not cascading on node delete; the region annotation surviving into results), and made the scoping calls. The transcripts show that direction-and-judgment loop.

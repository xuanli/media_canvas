# Media Canvas — Design Rationale

**Theme 2: Creative & Generative Tools**
Live: https://genmedia-theta.vercel.app · Repo: https://github.com/xuanli/media_canvas · Video: _(link)_

*One line:* a canvas where every AI generation and edit becomes a node you can branch, refine with precision tools, and compare — instead of a chat thread that overwrites the last result.

---

## Why this problem

This isn't a hypothetical for me — it's a pain point from running my own company (Komos). I constantly need to produce media assets, and the current AI tools are simultaneously amazing and frustrating.

The models can generate genuinely rich, realistic media. But *using* them lacks precision control, and that shows up in a few specific ways:

- **No accurate deterministic editing.** When I just want to crop, adjust lighting, or resize, the models can't do it precisely — so I end up exporting to a separate editor and switching back and forth between tools. That context-switch is constant and expensive.
- **Chat is the wrong shape for comparison.** A linear chat thread is a bad way to hold several *variations* side by side and decide between them. Each new message effectively overwrites the last visual.
- **No first-class way to reference prior versions.** When I want to feed an earlier asset back in as a reference, I'm reduced to copy-pasting screenshots.

I've been mulling a "media canvas" idea for a while as the answer to this. The take-home was a good excuse to actually build and pressure-test it. When I looked at the market, I didn't find anything that combines these pieces the way I wanted.

## The idea (and what's non-obvious about it)

The core bet is twofold:

1. **A branching canvas as the primary surface.** Every generation and edit lands as a node on an infinite canvas, connected to its parent — so you get a *global, visual view* of how an asset evolved. For images specifically (which are inherently visual), laying every artifact out like a design board is far more natural than scrolling a chat. Branches let you explore several directions from any point and compare them directly.

2. **Precision tools and AI editing in one place.** The non-obvious part is unifying two things every existing tool keeps separate: deterministic manipulation (crop, resize, rotate/flip, brightness/contrast, redact) *and* model-based editing (edit, region edit, reference images). Most tools are either pure-AI or pure-traditional-editor, forcing the tool-switching that frustrated me. Here they're the same set of operations on the same node.

## System design & key decisions

I treated this as a **functioning prototype**, and the guiding principle throughout was *keep the system as simple as possible* and prove the canvas idea works.

**Lightweight, all-in-one backend (Vercel).** Frontend, API routes, and serverless functions all live in one Next.js app on Vercel. No separate services to stand up.

**Storage = one JSON blob per canvas.** Each canvas is serialized to a single JSON snapshot and stored in Vercel Blob under a unique id. Navigating to that id loads the snapshot. That's the entire persistence model — simple, and it makes canvases shareable by link.

**An operation abstraction, deliberately built for extension.** Everything you can do to an image is modeled as one of two operation types:
- **Deterministic ops** run entirely client-side via the browser's canvas API (crop, resize, rotate/flip, adjust, redact) — instant and free, no model call.
- **AI ops** call a media model through fal (generate, edit, region edit), and can return multiple variations.

Adding a new tool is just extending that operation list. This abstraction also sets up the most important future direction (below): because every op is a clean, one-shot capability, an agent can later compose them.

A couple of decisions I'm happy with under this model:
- **Region editing without a mask model.** Most models can't take a pixel mask. Rather than restricting region edits to the one model that can, I draw the selected region onto the image as an annotation, let any edit model work on it, then *composite the model's output back only inside the region* — so pixels outside the box are guaranteed untouched. Deterministic guarantee, any model.
- **Resumable generations.** Model calls go through fal's queue and the request id is stored on the pending node, so a refresh or canvas-switch mid-generation doesn't orphan the result — any later session resumes polling.

**Frontend SDK: tldraw over React Flow.** Both would work and are similar for the basics. I chose tldraw mainly because (a) undo/redo and the canvas primitives are solid out of the box, so I didn't rebuild them, and (b) it has good support for real-time multi-person collaboration, which is a direction I'd want later. React Flow would have meant rebuilding more myself — easy enough with Claude Code, but not worth it for a prototype.

**Image first, "Media Canvas" on purpose.** I scoped to images/photos to ship something real, but named it Media Canvas because the same model extends cleanly to video later.

**Cost-consciousness.** fal makes it easy to swap models, but the good media models aren't cheap. That's a real constraint on the agent direction below — an agent loop is powerful precisely because it can look at a result and iterate, but each iteration is a paid media call.

**Security is deliberately light.** This is a prototype to prove the idea, not a multi-tenant product. The whole app sits behind a single shared passcode; canvases are shared by passing their id. Everything is "one password away." That's fine for demonstrating the concept and would be the first thing I'd harden for real users.

## How I'd extend it with more time

- **Agent mode — the biggest one.** Because every operation is abstracted as a clean one-shot capability, the natural next step is an agent that composes them from a high-level instruction — e.g. "resize this, add my logo as a reference, and make it fit the tone of my latest marketing post." The agent can generate, look at the result, and iterate. The abstraction I built is specifically what makes this a small step rather than a rewrite. (Cost is the thing to watch — I'd add budgets/guardrails on the loop.)
- **Video nodes** — the reason it's "Media" Canvas.
- **Real-time collaboration** — a big reason I picked tldraw.
- **Multi-tenancy & real auth** — to move from prototype to product.

## Time spent

~5–6 hours of active hands-on time across three evenings: roughly an hour of brainstorming, product/system design, and tradeoffs before kicking off the build the first evening; the bulk of the build and product iteration the second; and a third evening of polish, bug fixes, the demo example canvas, and deploy. Claude Code handled most of the execution during longer unattended stretches, so the wall-clock span is longer than the engaged time. I knowingly went past the 2-hour target because I was building a tool I actually need for my own company and wanted to build it properly.

## On AI usage

I built this heavily with Claude Code, but directed it throughout — choosing the architecture and the operation abstraction, rejecting outputs that didn't fit (e.g. iterating several times on the demo scene composition and the region-edit approach), catching and root-causing real bugs (an aspect-ratio drift when a reference image had a different shape; edges not cascading on node delete; the region annotation surviving into results), and making the scoping calls. The transcripts show that direction-and-judgment loop.

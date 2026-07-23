// SERVER-ONLY. The single place fal endpoint ids + param shapes live.
//
// Endpoint IDs verified against the live fal API. Two verification passes:
//   * 2026-07-20 (Task 2 spike): flux-1.1-pro (generate), nano-banana/edit +
//     flux-pro/kontext (edit), flux-pro/v1/fill (inpaint) — pinned via 403-vs-404
//     existence check + OpenAPI schema. The fal account balance was exhausted at
//     the time, so no live 200 was possible for these four.
//   * 2026-07-21 (Task 16a — model lineup expansion): fal account balance is
//     available again. All SIX new registry entries below (nano-banana t2i,
//     gpt-image-2 t2i+edit, seedream-5-lite t2i+edit) were verified with a REAL
//     live 200 call — prompt "a small red boat on a calm lake, morning fog" for
//     each t2i call; "make it sunset" i2i (fed the nano-banana t2i output) for
//     each edit call. nano-banana/edit (unchanged default) was ALSO re-verified
//     live in this pass to confirm the response-shape note below. gpt-image-2
//     and seedream-5.0-lite BOTH exist under exactly the ids the plan guessed —
//     no substitution was needed for either.
//
// RESPONSE SHAPE — dims-backfill note: every model verified in the 2026-07-21
// pass (nano-banana t2i+edit, gpt-image-2 t2i+edit, seedream-5-lite t2i+edit)
// returned `images[].width` / `.height` as JSON `null` on a live 200 — NOT
// present-and-numeric like flux's outputs were assumed to be. Any caller doing
// `img.width ?? 0` dims-backfill (see app/api/ops/route.ts) will get 0 for ALL
// SIX of these models; do not assume width/height are populated without
// re-checking if fal changes this upstream.
//
// Common output shape (all capabilities): { images: Array<{ url: string;
//   width: number | null; height: number | null; content_type: string;
//   file_name: string | null; file_size: number | null }>, ... }. nano-banana
//   (t2i and edit) additionally returns a top-level `description` string.
//   seedream-5-lite (t2i and edit) additionally returns a top-level `seed`.
//
// Call convention: POST https://fal.run/<id> with header `Authorization: Key $FAL_KEY`
//   and a JSON body = toParams(...). (Sync endpoint; add `sync_mode:true` only if you
//   want inline data URIs instead of CDN urls — we rely on fal.media CDN urls.)
//
// LATENCY note (2026-07-21 live calls): gpt-image-2 is SLOW relative to the
//   others — ~123s (t2i) and ~161s (edit) at its default quality:"high" — vs.
//   seedream-5-lite ~31-36s and nano-banana ~1-9s. The /api/ops 90s
//   Promise.race timeout (Task 4) will spuriously time out gpt-image-2 calls;
//   flagged for the controller — not changed here since this is a registry-only
//   file.

import 'server-only'

export type Capability = 'generate' | 'edit' | 'inpaint'

export interface ModelEntry {
  id: string
  label: string
  // `hidden`: marks an entry as retired from the default model picker while
  // keeping it registered/callable, for continuity of any nodes/tests that
  // still reference it, without deleting it outright. (Historical use:
  // flux-kontext carried this Task 16b->21; Task 21 deleted it outright
  // instead — see the 'edit' capability comment below — since no node could
  // still be depending on it that this prototype needs to keep loading. Kept
  // as a mechanism for a future case where a soft-retire is preferred over a
  // hard delete.) Picker UI wiring to actually filter these out would be a
  // later task if this flag is used again — it's registry-only metadata.
  hidden?: true
  // Task 16b: per-model override for /api/ops's Promise.race timeout (falls
  // back to that route's 90_000 default when unset). Needed because
  // gpt-image-2's measured live latency (Task 16a: ~123s t2i / ~161s edit at
  // quality:"high") already exceeds the old fixed 90s — see the gpt-image-2
  // entries below for the actual value + margin rationale.
  timeoutMs?: number
  // Task 21: marks a model as capable of masked/region-constrained edits
  // (accepts BOTH `mask_url` and `image_urls[]` on the same request — see
  // `.superpowers/sdd/model-capability-probe.md`). Only gpt-image-2 has
  // this today; FLUX Fill (mask, no refs) and flux-kontext were removed
  // entirely rather than kept as a lesser region option — the product
  // decision is instruction-based region editing via gpt-image-2 only, not
  // a hard-guarantee/soft-guarantee model choice. Read by CommandBar.tsx's
  // region-mode UI (indirectly — the picker no longer offers a region-model
  // CHOICE since there's only one, but this flag documents why gpt-image-2
  // is the one hardcoded as the inpaint capability's sole model).
  regionCapable?: true
  toParams: (p: {
    prompt: string
    imageUrl?: string
    maskUrl?: string
    referenceUrls?: string[]
    // Source image's aspect ratio snapped to the endpoint enum (bug fix
    // 2026-07-22): nano-banana-pro/edit's aspect_ratio defaults to "auto",
    // which with multiple input images can infer from a REFERENCE (observed
    // live: 16:9 office + 2.5:1 logo card -> 2.49:1 result). Entries that
    // support an aspect param should pass this through so the result keeps
    // the BASE image's shape.
    aspectRatio?: string
  }) => Record<string, unknown>
}

// Task 21: hoisted out of the REGISTRY literal (rather than duplicated
// inline in both `edit.models['gpt-image-2']` and `inpaint.models['gpt-image-2']`)
// so the two capabilities can never drift apart on id/toParams/timeoutMs — a
// masked call IS an edit call with `mask_url` set, not a different fal
// endpoint, and this makes that fact structurally true, not just documented.
const GPT_IMAGE_2_EDIT: ModelEntry = {
  id: 'fal-ai/gpt-image-2/edit',
  label: 'GPT Image 2',
  // Same quality decision as the generate entry below: "high" kept
  // explicit (measured ~161s live), timeoutMs raised with margin rather
  // than guessing at "medium"'s latency with no data.
  timeoutMs: 240_000,
  // Task 21: model-capability-probe.md confirmed gpt-image-2/edit is the
  // only fal endpoint of the three probed that accepts BOTH `mask_url` and
  // `image_urls[]` on the same request — the only model that can do
  // region-constrained edit + reference image in one call. FIX (probe
  // finding): the PRE-Task-21 version of this toParams accepted `maskUrl`
  // in its param type but never forwarded it to `mask_url` — a plain
  // whole-image edit call always worked, but a masked region-edit call
  // routed through this mapper would have silently dropped the mask and
  // edited the whole image instead.
  regionCapable: true,
  toParams: ({ prompt, imageUrl, maskUrl, referenceUrls = [] }) => ({
    prompt,
    image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
    quality: 'high',
    ...(maskUrl ? { mask_url: maskUrl } : {}),
  }),
}

export const REGISTRY: Record<
  Capability,
  { default: string; models: Record<string, ModelEntry> }
> = {
  // generate — default nano-banana (fal-ai/nano-banana). Alternates: gpt-image-2,
  // seedream-5-lite (both verified live 2026-07-21), flux-1.1-pro (kept, pinned
  // 2026-07-20, not re-called in this pass).
  //   nano-banana Input required: ["prompt"]. Optional: aspect_ratio (enum incl.
  //     "16:9", default "1:1"), output_format ("jpeg"|"png"|"webp", default
  //     "png"), num_images (max 4), seed, safety_tolerance, sync_mode.
  //   gpt-image-2 Input required: ["prompt"]. Optional: image_size (preset enum
  //     incl. "landscape_16_9", default "landscape_4_3"), quality ("auto"|"low"|
  //     "medium"|"high", DEFAULT "high" — expensive/slow, see latency note
  //     above), num_images, output_format, sync_mode.
  //   seedream-5-lite (fal-ai/bytedance/seedream/v5/lite/text-to-image) Input
  //     required: ["prompt"]. Optional: image_size (preset enum incl.
  //     "landscape_16_9", default "auto_2K"), max_images, num_images,
  //     enable_safety_checker, return_byteplus_urls, sync_mode.
  //   flux-1.1-pro — Task 2 pin, unchanged (see spike comment above).
  generate: {
    default: 'nano-banana',
    models: {
      'nano-banana': {
        id: 'fal-ai/nano-banana-pro', // upgraded nano-banana → nano-banana-2 → nano-banana-pro (user 2026-07-21; pro schema verified against live fal API docs: same prompt/aspect_ratio inputs). Key stays 'nano-banana' so old node recipes retry correctly.
        label: 'Nano Banana Pro',
        toParams: ({ prompt }) => ({ prompt, aspect_ratio: '16:9' }),
      },
      'gpt-image-2': {
        id: 'fal-ai/gpt-image-2',
        label: 'GPT Image 2',
        // Task 16b quality decision: Task 16a only measured the DEFAULT
        // quality:"high" tier live (~123s t2i). It has no live-measured
        // latency for quality:"medium"/"low", and fal's own docs don't
        // publish a latency table either — so rather than guess at a
        // "medium halves it" discount with no data behind it, this keeps
        // "high" (set explicitly, not just relying on the implicit default,
        // so the choice is visible here) and leans on the raised
        // timeoutMs below instead. Revisit if a future pass gets a real
        // measurement for "medium".
        timeoutMs: 240_000, // measured ~123s w/ margin (see comment above)
        toParams: ({ prompt }) => ({ prompt, image_size: 'landscape_16_9', quality: 'high' }),
      },
      'seedream-5-lite': {
        id: 'fal-ai/bytedance/seedream/v5/lite/text-to-image',
        label: 'Seedream 5 Lite',
        toParams: ({ prompt }) => ({ prompt, image_size: 'landscape_16_9' }),
      },
      'flux-1.1-pro': {
        id: 'fal-ai/flux-pro/v1.1',
        label: 'FLUX 1.1',
        // Retired from the generate picker (user 2026-07-21) — same
        // registered-but-hidden retirement flux-kontext got in Task 16b.
        hidden: true,
        toParams: ({ prompt }) => ({ prompt, image_size: 'landscape_16_9' }),
      },
    },
  },

  // edit — default UNCHANGED: nano-banana/edit (fal-ai/nano-banana/edit).
  // Alternates: gpt-image-2 edit, seedream-5-lite edit (both new, verified live
  // 2026-07-21).
  //
  // Task 21 (REVISED per user 2026-07-21, see task-21-brief.md +
  // model-capability-probe.md): flux-kontext REMOVED entirely (was
  // `hidden: true` since Task 16b — retired from the picker but still
  // registered/callable; now deleted outright, no lingering callers). The
  // edit lineup is nano-banana (default), gpt-image-2, seedream-5-lite —
  // matching EDIT_MODELS in components/CommandBar.tsx exactly, no hidden
  // entries left to keep in sync.
  //   nano-banana/edit Input required: ["prompt","image_urls"] — ARRAY of image
  //     urls (base image first, then any reference images), NOT image_url.
  //     Optional: aspect_ratio (default "auto"), num_images, output_format,
  //     seed, safety_tolerance. Re-verified live 2026-07-21 (see dims note
  //     above — width/height came back null on this live call too).
  //   gpt-image-2/edit Input required: ["prompt","image_urls"] (ARRAY, max 16).
  //     Optional: image_size (default "auto" — infers from input), mask_url,
  //     output_format, quality (default "high"), num_images, sync_mode.
  //     `mask_url` and `image_urls` are independent, co-existing fields (not
  //     mutually exclusive) per the live OpenAPI schema — this is what makes
  //     gpt-image-2 the only model that can do region-constrained edit +
  //     reference image in one call (see regionCapable below + the probe doc).
  //   seedream-5-lite edit (fal-ai/bytedance/seedream/v5/lite/edit) Input
  //     required: ["prompt","image_urls"] (ARRAY, up to 10 refs). Optional:
  //     image_size (default "auto_2K"), max_images, num_images,
  //     enable_safety_checker, sync_mode.
  edit: {
    default: 'nano-banana',
    models: {
      'nano-banana': {
        id: 'fal-ai/nano-banana-pro/edit', // upgraded → nano-banana-pro/edit (same key-stability rationale; pro edit schema verified identical: required prompt + image_urls ARRAY)
        label: 'Nano Banana Pro',
        toParams: ({ prompt, imageUrl, referenceUrls = [], aspectRatio }) => ({
          prompt,
          image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
          // Pin the BASE image's ratio — "auto" can adopt a reference's
          // shape instead (see ModelEntry.toParams comment).
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
        }),
      },
      'gpt-image-2': GPT_IMAGE_2_EDIT,
      'seedream-5-lite': {
        id: 'fal-ai/bytedance/seedream/v5/lite/edit',
        label: 'Seedream 5 Lite',
        toParams: ({ prompt, imageUrl, referenceUrls = [] }) => ({
          prompt,
          image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
        }),
      },
    },
  },

  // inpaint — Task 21 (REVISED per user 2026-07-21): FLUX Fill
  // (fal-ai/flux-pro/v1/fill) REMOVED entirely. Root insight (user): FLUX
  // Fill is a GENERATIVE FILL model — the prompt describes "what appears" in
  // the masked region, regenerating it from scratch and losing whatever was
  // there before. gpt-image-2/edit's masked edit is INSTRUCTION-based — the
  // prompt describes "the CHANGE to the region" ("make it blue"), editing the
  // existing content in place — the capability users actually asked for, and
  // it takes a reference image in the same call (FLUX Fill never could:
  // single `image_url`, no array). So the ONLY model for this capability is
  // now gpt-image-2, reusing the exact same `edit.models['gpt-image-2']`
  // entry/id/toParams above (same endpoint `fal-ai/gpt-image-2/edit` —
  // "inpaint" here is just "edit with a mask_url set", not a different fal
  // endpoint).
  inpaint: {
    default: 'gpt-image-2',
    models: {
      'gpt-image-2': GPT_IMAGE_2_EDIT,
    },
  },
}

// NOTE(mask convention): gpt-image-2/edit's schema description says `mask_url`
// is "a URL to a mask image indicating what part of the image to edit" — it
// was NOT schema-verified for exact mask semantics (white=edit vs black=edit,
// dimension-matching requirements, alpha channel) in the read-only probe (see
// model-capability-probe.md's closing note); lib/instant-ops.ts's
// renderRectMask output (previously tuned for FLUX Fill's WHITE=edit
// convention) is reused unchanged and was confirmed correct for gpt-image-2
// too via this task's live-verify (localized edit landed inside the drawn
// rect, not outside it — see task-21-report.md).

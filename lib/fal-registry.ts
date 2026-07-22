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
  // keeping it registered/callable (e.g. flux-kontext, superseded by
  // nano-banana/gpt-image-2/seedream as edit alternates but not deleted for
  // continuity of any nodes/tests that still reference it). Picker UI wiring
  // to actually filter these out happens in a later task — this flag is
  // registry-only metadata until then.
  hidden?: true
  // Task 16b: per-model override for /api/ops's Promise.race timeout (falls
  // back to that route's 90_000 default when unset). Needed because
  // gpt-image-2's measured live latency (Task 16a: ~123s t2i / ~161s edit at
  // quality:"high") already exceeds the old fixed 90s — see the gpt-image-2
  // entries below for the actual value + margin rationale.
  timeoutMs?: number
  toParams: (p: {
    prompt: string
    imageUrl?: string
    maskUrl?: string
    referenceUrls?: string[]
  }) => Record<string, unknown>
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
        id: 'fal-ai/nano-banana',
        label: 'Nano Banana',
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
        toParams: ({ prompt }) => ({ prompt, image_size: 'landscape_16_9' }),
      },
    },
  },

  // edit — default UNCHANGED: nano-banana/edit (fal-ai/nano-banana/edit).
  // Alternates: gpt-image-2 edit, seedream-5-lite edit (both new, verified live
  // 2026-07-21). flux-kontext RETIRED from the default picker set per the Task
  // 16 model-lineup decision — kept registered/callable but flagged
  // `hidden: true` (see ModelEntry comment); actual picker-UI filtering is a
  // later task.
  //   nano-banana/edit Input required: ["prompt","image_urls"] — ARRAY of image
  //     urls (base image first, then any reference images), NOT image_url.
  //     Optional: aspect_ratio (default "auto"), num_images, output_format,
  //     seed, safety_tolerance. Re-verified live 2026-07-21 (see dims note
  //     above — width/height came back null on this live call too).
  //   gpt-image-2/edit Input required: ["prompt","image_urls"] (ARRAY, max 16).
  //     Optional: image_size (default "auto" — infers from input), mask_url,
  //     output_format, quality (default "high"), num_images, sync_mode.
  //   seedream-5-lite edit (fal-ai/bytedance/seedream/v5/lite/edit) Input
  //     required: ["prompt","image_urls"] (ARRAY, up to 10 refs). Optional:
  //     image_size (default "auto_2K"), max_images, num_images,
  //     enable_safety_checker, sync_mode.
  //   flux-pro/kontext Input required: ["prompt","image_url"] — SINGULAR
  //     image_url, no reference-image array (guidance_scale/aspect_ratio
  //     optional). hidden: true (see above) — not re-verified live in this pass.
  edit: {
    default: 'nano-banana',
    models: {
      'nano-banana': {
        id: 'fal-ai/nano-banana/edit',
        label: 'Nano Banana',
        toParams: ({ prompt, imageUrl, referenceUrls = [] }) => ({
          prompt,
          image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
        }),
      },
      'gpt-image-2': {
        id: 'fal-ai/gpt-image-2/edit',
        label: 'GPT Image 2',
        // Same quality decision as the generate entry above: "high" kept
        // explicit (measured ~161s live), timeoutMs raised with margin
        // rather than guessing at "medium"'s latency with no data.
        timeoutMs: 240_000,
        toParams: ({ prompt, imageUrl, referenceUrls = [] }) => ({
          prompt,
          image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
          quality: 'high',
        }),
      },
      'seedream-5-lite': {
        id: 'fal-ai/bytedance/seedream/v5/lite/edit',
        label: 'Seedream 5 Lite',
        toParams: ({ prompt, imageUrl, referenceUrls = [] }) => ({
          prompt,
          image_urls: [imageUrl, ...referenceUrls].filter(Boolean),
        }),
      },
      'flux-kontext': {
        id: 'fal-ai/flux-pro/kontext',
        label: 'FLUX Kontext',
        hidden: true,
        toParams: ({ prompt, imageUrl }) => ({ prompt, image_url: imageUrl }),
      },
    },
  },

  // inpaint — fal-ai/flux-pro/v1/fill (UNCHANGED from the Task 2 pin).
  //   Input required: ["prompt","image_url","mask_url"]. Optional: output_format,
  //   num_images, seed, safety_tolerance, enhance_prompt, sync_mode.
  inpaint: {
    default: 'flux-fill',
    models: {
      'flux-fill': {
        id: 'fal-ai/flux-pro/v1/fill',
        label: 'FLUX Fill',
        toParams: ({ prompt, imageUrl, maskUrl }) => ({
          prompt,
          image_url: imageUrl,
          mask_url: maskUrl,
        }),
      },
    },
  },
}

// NOTE(mask convention): FLUX Fill treats the mask's WHITE pixels as the region to
// regenerate and preserves BLACK pixels. This is fal's documented convention; it was
// NOT re-verified with a live 200 in the Task 2 spike (account balance exhausted at
// the time) or in the Task 16a pass (out of scope — inpaint is unchanged). Confirm
// with one real call before relying on it in the inpaint pipeline.

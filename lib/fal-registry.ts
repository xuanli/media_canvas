// SERVER-ONLY. The single place fal endpoint ids + param shapes live.
//
// Endpoint IDs verified against the live fal API on 2026-07-20 during the Task 2 spike.
// The fal account balance was exhausted (all POSTs return HTTP 403 "User is locked …
// Exhausted balance"), so full 200 round-trips were NOT possible. Verification method:
//   * Endpoint EXISTENCE: a valid endpoint returns 403 (locked) vs 404 ("Application
//     '<x>' not found") for a bogus id — routing resolves the app before the balance
//     check, so 403 proves the endpoint id is valid. All ids below returned 403.
//   * Param/response SHAPES: read from each endpoint's live OpenAPI schema at
//     https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id> (HTTP 200, no
//     balance required). Field names/types/required-sets below are copied from those
//     schemas on 2026-07-20.
//
// Common output shape (all three capabilities): { images: Array<{ url: string;
//   width: number; height: number; content_type: string }>, seed, timings, prompt,
//   has_nsfw_concepts }. nano-banana also returns a top-level `description` string and
//   its image objects additionally carry file_size / file_name.
//
// Call convention: POST https://fal.run/<id> with header `Authorization: Key $FAL_KEY`
//   and a JSON body = toParams(...). (Sync endpoint; add `sync_mode:true` only if you
//   want inline data URIs instead of CDN urls — we rely on fal.media CDN urls.)

import 'server-only'

export type Capability = 'generate' | 'edit' | 'inpaint'

export interface ModelEntry {
  id: string
  label: string
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
  // generate — fal-ai/flux-pro/v1.1
  //   Input required: ["prompt"]. Optional: image_size (enum incl. "landscape_16_9",
  //   default "landscape_4_3"), num_images (default 1), output_format ("jpeg"|"png",
  //   default "jpeg"), seed, safety_tolerance, enhance_prompt, sync_mode.
  generate: {
    default: 'flux-1.1-pro',
    models: {
      'flux-1.1-pro': {
        id: 'fal-ai/flux-pro/v1.1',
        label: 'FLUX 1.1 [pro]',
        toParams: ({ prompt }) => ({ prompt, image_size: 'landscape_16_9' }),
      },
    },
  },

  // edit — fal-ai/nano-banana/edit  (default) and fal-ai/flux-pro/kontext (alternate)
  //   nano-banana/edit Input required: ["prompt","image_urls"]. Note it takes an
  //     ARRAY of image urls (base image first, then any reference images), NOT a
  //     single image_url. Optional: aspect_ratio (default "auto"), num_images,
  //     output_format ("jpeg"|"png"|"webp", default "png"), seed, safety_tolerance.
  //   flux-pro/kontext Input required: ["prompt","image_url"] — SINGULAR image_url,
  //     no reference-image array (guidance_scale/aspect_ratio optional).
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
      'flux-kontext': {
        id: 'fal-ai/flux-pro/kontext',
        label: 'FLUX Kontext',
        toParams: ({ prompt, imageUrl }) => ({ prompt, image_url: imageUrl }),
      },
    },
  },

  // inpaint — fal-ai/flux-pro/v1/fill
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
// NOT re-verified with a live 200 in this spike (account balance exhausted). Confirm
// with one real call before relying on it in the inpaint pipeline.

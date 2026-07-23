import { z } from 'zod'
const url = z.string().url()
const aspectEnum = z.enum(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'])
export const opsRequestSchema = z.discriminatedUnion('capability', [
  z.object({ capability: z.literal('generate'), model: z.string(), prompt: z.string().min(1) }),
  z.object({ capability: z.literal('edit'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, referenceUrls: z.array(url).max(8).optional(),
    // Bug fix 2026-07-22: pin the BASE image's ratio — nano-banana-pro's
    // "auto" can adopt a reference image's shape instead. Values = the fal
    // aspect_ratio enum.
    aspectRatio: aspectEnum.optional() }),
  // Task 21: inpaint gains an optional referenceUrls, mirroring 'edit' —
  // gpt-image-2/edit is the only fal endpoint of the ones this app calls
  // that accepts BOTH `mask_url` and `image_urls[]` on the same request
  // (model-capability-probe.md), so a masked region edit can now also carry
  // a reference image in the same call. max(3) mirrors 'edit' above for
  // consistency, though lib/run-op.ts's dispatch only ever resolves one
  // (op.referenceNodeId is a single id, not an array) as of this task.
  z.object({ capability: z.literal('inpaint'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, maskUrl: url, referenceUrls: z.array(url).max(8).optional(),
    aspectRatio: aspectEnum.optional() }),
])
export type OpsRequest = z.infer<typeof opsRequestSchema>

// Resumable generation (user 2026-07-22): POST /api/ops/status polls a
// fal queue request submitted by POST /api/ops. capability+model resolve
// the registry entry server-side (fal's queue API needs the endpoint id for
// status/result lookups) — the client never supplies a raw fal endpoint id.
export const opsStatusSchema = z.object({
  capability: z.enum(['generate', 'edit', 'inpaint']),
  model: z.string(),
  requestId: z.string().min(1).max(128),
})
export type OpsStatusRequest = z.infer<typeof opsStatusSchema>

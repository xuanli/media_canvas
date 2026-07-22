import { z } from 'zod'
const url = z.string().url()
export const opsRequestSchema = z.discriminatedUnion('capability', [
  z.object({ capability: z.literal('generate'), model: z.string(), prompt: z.string().min(1) }),
  z.object({ capability: z.literal('edit'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, referenceUrls: z.array(url).max(3).optional() }),
  // Task 21: inpaint gains an optional referenceUrls, mirroring 'edit' —
  // gpt-image-2/edit is the only fal endpoint of the ones this app calls
  // that accepts BOTH `mask_url` and `image_urls[]` on the same request
  // (model-capability-probe.md), so a masked region edit can now also carry
  // a reference image in the same call. max(3) mirrors 'edit' above for
  // consistency, though lib/run-op.ts's dispatch only ever resolves one
  // (op.referenceNodeId is a single id, not an array) as of this task.
  z.object({ capability: z.literal('inpaint'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, maskUrl: url, referenceUrls: z.array(url).max(3).optional() }),
])
export type OpsRequest = z.infer<typeof opsRequestSchema>

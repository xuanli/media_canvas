import { z } from 'zod'
const url = z.string().url()
export const opsRequestSchema = z.discriminatedUnion('capability', [
  z.object({ capability: z.literal('generate'), model: z.string(), prompt: z.string().min(1) }),
  z.object({ capability: z.literal('edit'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, referenceUrls: z.array(url).max(3).optional() }),
  z.object({ capability: z.literal('inpaint'), model: z.string(), prompt: z.string().min(1),
    imageUrl: url, maskUrl: url }),
])
export type OpsRequest = z.infer<typeof opsRequestSchema>

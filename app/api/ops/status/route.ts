import { fal } from '@fal-ai/client'
import { opsStatusSchema } from '@/lib/schemas'
import { REGISTRY } from '@/lib/fal-registry'
import { normalizeFalError } from '@/lib/errors'
import { checkPasscode } from '@/lib/server-auth'

// Resumable generation (user 2026-07-22): polls a fal queue request that
// POST /api/ops submitted. Responses:
//   { status: 'IN_QUEUE' | 'IN_PROGRESS' }          — still running
//   { imageUrl, width, height }                     — completed (OpsResponse)
//   { error: {...} }                                — failed / unknown request
// Stateless by design: capability+model+requestId is everything needed, so
// ANY session (including one opened after a reload) can pick up polling for
// a pending node that carries its falRequestId.
export async function POST(req: Request) {
  if (!checkPasscode(req)) return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  const parsed = opsStatusSchema.safeParse(await req.json())
  if (!parsed.success) return Response.json({ error: { code: 'bad_request', message: parsed.error.message } }, { status: 400 })
  if (!process.env.FAL_KEY) return Response.json({ error: { code: 'config', message: 'FAL_KEY is not set on the server.' } }, { status: 500 })
  const { capability, model, requestId } = parsed.data
  const entry = REGISTRY[capability].models[model]
  if (!entry) return Response.json({ error: { code: 'bad_request', message: `Unknown model ${model}` } }, { status: 400 })
  try {
    const status = await fal.queue.status(entry.id, { requestId, logs: false })
    if (status.status !== 'COMPLETED') {
      return Response.json({ status: status.status })
    }
    const result = (await fal.queue.result(entry.id, { requestId })) as {
      data: { images: Array<{ url: string; width?: number; height?: number }> }
    }
    const img = result.data.images[0]
    if (!img?.url) throw new Error('model returned no image')
    return Response.json({ imageUrl: img.url, width: img.width ?? 0, height: img.height ?? 0 })
  } catch (e) {
    const n = normalizeFalError(e)
    return Response.json({ error: { code: n.code, message: n.message } }, { status: n.http })
  }
}

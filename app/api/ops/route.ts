import { fal } from '@fal-ai/client'
import { opsRequestSchema } from '@/lib/schemas'
import { REGISTRY } from '@/lib/fal-registry'
import { normalizeFalError } from '@/lib/errors'
import { checkPasscode } from '@/lib/server-auth'

// Task 16b: raised from 120 to cover gpt-image-2's per-model 240_000ms
// timeout (Task 16a measured ~123-161s live) with headroom, matching the
// same "function limit > race timeout" margin the old 120/90s pair had.
// VERIFY AT DEPLOY: Vercel's actual ceiling for this value depends on the
// plan/runtime (e.g. Hobby serverless functions cap at 60s regardless of
// this export, Pro/Enterprise or Fluid-enabled deployments can go higher) —
// confirm the deployed plan actually honors 300s before relying on it in
// production; this is a request, not a guarantee, on some plans.
export const maxDuration = 300

export async function POST(req: Request) {
  if (!checkPasscode(req)) return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  const parsed = opsRequestSchema.safeParse(await req.json())
  if (!parsed.success) return Response.json({ error: { code: 'bad_request', message: parsed.error.message } }, { status: 400 })
  if (process.env.FAL_MOCK === '1') {                 // T1: mock boundary
    const { mockImage } = await import('@/lib/mock')
    await new Promise(r => setTimeout(r, 1500))
    return Response.json(mockImage(parsed.data.prompt))
  }
  if (!process.env.FAL_KEY) return Response.json({ error: { code: 'config', message: 'FAL_KEY is not set on the server.' } }, { status: 500 })
  const body = parsed.data
  const entry = REGISTRY[body.capability].models[body.model]
  if (!entry) return Response.json({ error: { code: 'bad_request', message: `Unknown model ${body.model}` } }, { status: 400 })
  try {
    const input = entry.toParams({
      prompt: body.prompt,
      imageUrl: 'imageUrl' in body ? body.imageUrl : undefined,
      maskUrl: 'maskUrl' in body ? body.maskUrl : undefined,
      referenceUrls: 'referenceUrls' in body ? body.referenceUrls : undefined,
      aspectRatio: 'aspectRatio' in body ? body.aspectRatio : undefined,
    })
    // Resumable generation (user 2026-07-22): was `fal.subscribe` — a
    // single long-lived HTTP round-trip pinned to the submitting browser
    // tab, so a refresh/canvas-switch orphaned the run. Now queue-based:
    // this handler ONLY submits (fast) and returns fal's request id; the
    // client stores it on the pending node and polls /api/ops/status —
    // which any later session can also do, making in-flight generations
    // survive reloads. Per-model timeouts moved client-side (the poll
    // deadline); maxDuration above is now irrelevant headroom.
    const { request_id: requestId } = await fal.queue.submit(entry.id, { input })
    return Response.json({ requestId })
  } catch (e) {
    const n = normalizeFalError(e)
    return Response.json({ error: { code: n.code, message: n.message } }, { status: n.http })
  }
}

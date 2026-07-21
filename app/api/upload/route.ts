import { fal } from '@fal-ai/client'
import { checkPasscode } from '@/lib/server-auth'

export async function POST(req: Request) {
  if (!checkPasscode(req)) return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  const { dataUrl } = await req.json() as { dataUrl?: string }
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl ?? '')
  if (!m) return Response.json({ error: { code: 'bad_request', message: 'Expected a PNG/JPEG data URL.' } }, { status: 400 })
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.byteLength > 8 * 1024 * 1024) return Response.json({ error: { code: 'too_large', message: 'Image exceeds 8MB.' } }, { status: 413 })
  const magicOk = m[1] === 'image/png'                       // S4: verify magic bytes
    ? bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : bytes[0] === 0xff && bytes[1] === 0xd8
  if (!magicOk) return Response.json({ error: { code: 'bad_request', message: 'Bytes do not match declared image type.' } }, { status: 400 })
  if (process.env.FAL_MOCK === '1') return Response.json({ url: dataUrl }) // T1: pass-through
  const url = await fal.storage.upload(new Blob([bytes], { type: m[1] }))
  return Response.json({ url })
}

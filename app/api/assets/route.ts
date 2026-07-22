import { put } from '@vercel/blob'
import { checkPasscode } from '@/lib/server-auth'

// T19a: in-memory mock store for local dev/E2E (STORAGE_MOCK=1) — single-
// process only, same pattern as app/api/canvas/[id]/route.ts's `mem` Map.
// Exported so DELETE in ./[id]/route.ts shares the same store (both files
// live in the same server process, so module-level state is shared).
export const ASSET_MOCK = new Map<string, string>()
const mock = () => process.env.STORAGE_MOCK === '1'

// T19a: POST /api/assets — save a user-uploaded image to the reusable
// assets library. Mirrors app/api/upload/route.ts's magic-byte validation
// exactly; unlike /api/upload (which forwards bytes to fal.ai storage for
// immediate model use), this persists to Vercel Blob under assets/user/ so
// it survives across canvases (per-browser gm-assets list in localStorage
// discovers it — see Task 19 brief).
export async function POST(req: Request) {
  if (!checkPasscode(req))
    return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  const { dataUrl, name } = (await req.json()) as { dataUrl?: string; name?: string }
  const m = /^data:(image\/(?:png|jpeg));base64,(.+)$/.exec(dataUrl ?? '')
  if (!m) return Response.json({ error: { code: 'bad_request', message: 'Expected a PNG/JPEG data URL.' } }, { status: 400 })
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.byteLength > 8 * 1024 * 1024) return Response.json({ error: { code: 'too_large', message: 'Image exceeds 8MB.' } }, { status: 413 })
  const magicOk = m[1] === 'image/png'                       // S4: verify magic bytes
    ? bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : bytes[0] === 0xff && bytes[1] === 0xd8
  if (!magicOk) return Response.json({ error: { code: 'bad_request', message: 'Bytes do not match declared image type.' } }, { status: 400 })

  // 12 chars crypto-random base36 (~62 bits) — not enumerable. Same scheme
  // as POST /api/canvas.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('')
  const ext = m[1] === 'image/png' ? 'png' : 'jpeg'

  if (mock()) {
    ASSET_MOCK.set(id, dataUrl as string)
    return Response.json({ id, url: dataUrl, ...(name ? { name } : {}) })
  }
  const blob = await put(`assets/user/${id}.${ext}`, bytes, {
    access: 'public',
    addRandomSuffix: false,
    contentType: m[1],
  })
  return Response.json({ id, url: blob.url, ...(name ? { name } : {}) })
}

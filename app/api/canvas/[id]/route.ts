import { put, head, del } from '@vercel/blob'
import { checkPasscode } from '@/lib/server-auth'

const key = (id: string) => `canvases/${id}.json`
const valid = (id: string) => /^[a-z0-9]{12}$/i.test(id)

// T1: STORAGE_MOCK — in-memory store for local dev/E2E (single-process only).
const mem = new Map<string, string>()
const mock = () => process.env.STORAGE_MOCK === '1'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!valid(id)) return new Response('bad id', { status: 400 })
  if (mock())
    return mem.has(id)
      ? new Response(mem.get(id), { headers: { 'Content-Type': 'application/json' } })
      : new Response('not found', { status: 404 })
  try {
    const meta = await head(key(id))
    const res = await fetch(meta.url, { cache: 'no-store' })
    return new Response(res.body, { headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!valid(id)) return new Response('bad id', { status: 400 })
  if (!checkPasscode(req))
    return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  const body = await req.text()
  if (body.length > 20 * 1024 * 1024) return new Response('too large', { status: 413 })
  if (mock()) {
    mem.set(id, body)
    return Response.json({ ok: true })
  }
  await put(key(id), body, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })
  return Response.json({ ok: true })
}

// Task 15A: canvas delete (switcher's ✕ row action). `del()` (verified
// signature: `del(urlOrPathname: string[] | string, options?): Promise<void>`
// in the installed @vercel/blob's dist/index.d.ts) doesn't error on an
// already-absent pathname — same idempotent-delete semantics as the blob
// store's S3-like backing — so this always resolves to {ok:true} once
// auth/id validation pass, real store or mock alike; the client (TopNav)
// separately treats a 404 as a successful delete for defense in depth.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!valid(id)) return new Response('bad id', { status: 400 })
  if (!checkPasscode(req))
    return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  if (mock()) {
    mem.delete(id)
    return Response.json({ ok: true })
  }
  await del(key(id))
  return Response.json({ ok: true })
}

import { del } from '@vercel/blob'
import { checkPasscode } from '@/lib/server-auth'
import { ASSET_MOCK } from '../route'

const valid = (id: string) => /^[a-z0-9]{12}$/i.test(id)
const mock = () => process.env.STORAGE_MOCK === '1'

// T19a: DELETE /api/assets/:id — remove a user asset from the library.
// The id doesn't encode its extension, so for the real blob store we pass
// both possible pathnames to a single del() call; del() is idempotent on an
// already-absent pathname (verified in app/api/canvas/[id]/route.ts's
// DELETE comment), so whichever extension doesn't match this asset silently
// no-ops. The try/catch is defense in depth for the same "already gone is
// still success" semantics the canvas route documents.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!valid(id)) return new Response('bad id', { status: 400 })
  if (!checkPasscode(req))
    return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  if (mock()) {
    ASSET_MOCK.delete(id)
    return Response.json({ ok: true })
  }
  try {
    await del([`assets/user/${id}.png`, `assets/user/${id}.jpeg`])
  } catch {
    // already-gone tolerated as success
  }
  return Response.json({ ok: true })
}

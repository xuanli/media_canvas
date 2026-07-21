import { checkPasscode } from '@/lib/server-auth'

export async function POST(req: Request) {
  if (!checkPasscode(req))
    return Response.json({ error: { code: 'unauthorized', message: 'Wrong passcode.' } }, { status: 401 })
  // 12 chars crypto-random base36 (~62 bits) — not enumerable.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('')
  return Response.json({ id })
}

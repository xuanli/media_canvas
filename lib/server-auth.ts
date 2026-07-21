import 'server-only'
import { timingSafeEqual } from 'node:crypto'
export function checkPasscode(req: Request): boolean {
  const expected = process.env.APP_PASSCODE
  // Fail CLOSED in production: a deploy without a passcode refuses mutations.
  if (!expected) return process.env.VERCEL_ENV !== 'production'
  const got = Buffer.from(req.headers.get('x-gm-passcode') ?? '')
  const want = Buffer.from(expected)
  return got.length === want.length && timingSafeEqual(got, want)
}

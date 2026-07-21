const ALLOWED = /(^|\.)fal\.media$/
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url')
  if (!target) return new Response('missing url', { status: 400 })
  let u: URL
  try { u = new URL(target) } catch { return new Response('bad url', { status: 400 }) }
  if (u.protocol !== 'https:' || !ALLOWED.test(u.hostname)) return new Response('host not allowed', { status: 403 })
  let upstream: Response
  try { upstream = await fetch(u, { redirect: 'error' }) } catch { return new Response('upstream fetch failed', { status: 502 }) }
  const ct = upstream.headers.get('Content-Type') ?? ''
  const safeType = /^image\/(png|jpeg|webp|gif|avif)$/.test(ct) ? ct : 'application/octet-stream'
  return new Response(upstream.body, { status: upstream.status, headers: {
    'Content-Type': safeType,
    'Content-Disposition': 'inline; filename="image"',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  }})
}

const ALLOWED = /(^|\.)fal\.media$/
export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url')
  if (!target) return new Response('missing url', { status: 400 })
  let u: URL
  try { u = new URL(target) } catch { return new Response('bad url', { status: 400 }) }
  if (u.protocol !== 'https:' || !ALLOWED.test(u.hostname)) return new Response('host not allowed', { status: 403 })
  const upstream = await fetch(u, { redirect: 'error' })
  return new Response(upstream.body, { status: upstream.status, headers: {
    'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  }})
}

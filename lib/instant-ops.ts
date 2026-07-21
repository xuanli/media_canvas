import type { Rect } from '@/lib/types'

// CORS note (task-2 spike, confirmed live 2026-07-20): fal.media serves
// `access-control-allow-origin: *`, so `crossOrigin='anonymous'` loads
// straight from the CDN without tainting the canvas — no /api/proxy needed
// for these client-side ops. IMG_SRC is the seam the brief calls for: flip it
// to `/api/proxy?url=...` here (and nowhere else) if a future asset host
// doesn't send ACOA:*.
const IMG_SRC = (url: string) => url

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = IMG_SRC(url)
  })
}

function toOut(c: HTMLCanvasElement) {
  return { dataUrl: c.toDataURL('image/png'), width: c.width, height: c.height }
}

export async function cropImage(srcUrl: string, r: Rect) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = r.w
  c.height = r.h
  c.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
  return toOut(c)
}

export async function resizeImage(srcUrl: string, w: number, h: number) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return toOut(c)
}

// White rect on black = the region the inpaint model should replace (verified
// against fal-ai/flux-pro/v1/fill's mask convention in the registry comment;
// live-exercised in Task 11, not here — see CLAUDE.md).
export async function renderRectMask(r: Rect, naturalW: number, naturalH: number): Promise<string> {
  const c = document.createElement('canvas')
  c.width = naturalW
  c.height = naturalH
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, naturalW, naturalH)
  ctx.fillStyle = '#fff'
  ctx.fillRect(r.x, r.y, r.w, r.h)
  return c.toDataURL('image/png')
}

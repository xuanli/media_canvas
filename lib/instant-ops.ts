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

// ── 2026-07-21 deterministic-tools batch (rotate/flip/adjust/redact) ──
// Same load()→canvas→toOut() shape as crop/resize above. ctx.filter is
// supported in all current evergreen browsers (incl. Safari 18+).

export async function rotateImage(srcUrl: string, deg: 90 | -90 | 180) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  const quarter = deg !== 180
  c.width = quarter ? img.naturalHeight : img.naturalWidth
  c.height = quarter ? img.naturalWidth : img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return toOut(c)
}

export async function flipImage(srcUrl: string, axis: 'h' | 'v') {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  if (axis === 'h') {
    ctx.translate(c.width, 0)
    ctx.scale(-1, 1)
  } else {
    ctx.translate(0, c.height)
    ctx.scale(1, -1)
  }
  ctx.drawImage(img, 0, 0)
  return toOut(c)
}

// Composed rotation + flips in one pass (UX round 2 — single child node per
// Apply). Transform order: the flip scales apply in the image's own axes,
// then the rotation — predictable for every 90° step.
export async function transformImage(srcUrl: string, deg: 0 | 90 | 180 | 270, flipH: boolean, flipV: boolean) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  const quarter = deg === 90 || deg === 270
  c.width = quarter ? img.naturalHeight : img.naturalWidth
  c.height = quarter ? img.naturalWidth : img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return toOut(c)
}

// 100 = neutral for all three (CSS-filter percentage semantics).
export async function adjustImage(srcUrl: string, brightness: number, contrast: number, saturation: number) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
  ctx.drawImage(img, 0, 0)
  return toOut(c)
}

// Blur: the region is re-rendered through a blur filter on a region-sized
// temp canvas, drawing the FULL image offset so edge pixels blur against
// their real neighbors instead of transparency. Pixelate: classic
// downscale-then-nearest-neighbor-upscale. `amount` is in natural px (blur
// radius / pixel block size).
export async function redactRegion(srcUrl: string, r: Rect, mode: 'blur' | 'pixelate', amount: number) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const t = document.createElement('canvas')
  const tctx = t.getContext('2d')!
  if (mode === 'blur') {
    t.width = Math.max(1, Math.round(r.w))
    t.height = Math.max(1, Math.round(r.h))
    tctx.filter = `blur(${amount}px)`
    tctx.drawImage(img, -r.x, -r.y)
    ctx.drawImage(t, r.x, r.y)
  } else {
    const block = Math.max(2, amount)
    t.width = Math.max(1, Math.round(r.w / block))
    t.height = Math.max(1, Math.round(r.h / block))
    tctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, t.width, t.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(t, 0, 0, t.width, t.height, r.x, r.y, r.w, r.h)
  }
  return toOut(c)
}

// Soft-region annotation (user 2026-07-21): draws a red rectangle OUTLINE on
// a copy of the image; run-op's inpaint dispatch pairs it with a prompt
// instructing the model to edit only inside the box and erase it from the
// output. Verified live against fal-ai/nano-banana-pro/edit before wiring
// (probe: "add a hot air balloon" + red box over sf-skyline's sky — balloon
// landed inside the box, box removed, rest untouched). JPEG q0.92 keeps the
// upload small for large sources; transparency flattens, which is acceptable
// for a photographic edit source (exact-mask gpt-image-2 remains available).
export async function annotateRegion(srcUrl: string, r: Rect) {
  const img = await load(srcUrl)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  ctx.strokeStyle = '#ff2d2d'
  const lw = Math.max(4, Math.round(Math.min(c.width, c.height) * 0.008))
  ctx.lineWidth = lw
  // Stroke drawn fully OUTSIDE the rect (centered on an expanded rect, so
  // its inner edge touches the region boundary): compositeRegion below only
  // keeps model pixels from INSIDE the rect, which then deterministically
  // removes the box from the final output — the model kept drawing it in
  // real runs (user-reported 2026-07-22) despite the remove-it instruction.
  ctx.strokeRect(r.x - lw / 2, r.y - lw / 2, r.w + lw, r.h + lw)
  return c.toDataURL('image/jpeg', 0.92)
}

// Deterministic finish for guided region edits (user-reported 2026-07-22:
// the red box survived into real results): scale the model output to the
// original's dimensions, then keep it ONLY inside the region rect over an
// untouched copy of the original. Gives guided mode a hard pixel guarantee
// outside the box (and erases the annotation stroke, which lives outside).
export async function compositeRegion(originalUrl: string, resultUrl: string, r: Rect) {
  const [orig, res] = await Promise.all([load(originalUrl), load(resultUrl)])
  const c = document.createElement('canvas')
  c.width = orig.naturalWidth
  c.height = orig.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(orig, 0, 0)
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.drawImage(res, 0, 0, res.naturalWidth, res.naturalHeight, 0, 0, c.width, c.height)
  ctx.restore()
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

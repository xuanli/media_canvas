import type { Rect } from '@/lib/types'

export function displayRectToNatural(
  r: Rect,
  displayW: number,
  naturalW: number
): Rect {
  const s = naturalW / displayW
  const naturalH = Number.MAX_SAFE_INTEGER // height clamped by caller-provided ratio via width scale

  let x = Math.round(r.x * s)
  let y = Math.round(r.y * s)
  let w = Math.round(r.w * s)
  let h = Math.round(r.h * s)

  x = Math.max(0, x)
  y = Math.max(0, y)
  w = Math.min(w, naturalW - x)
  h = Math.min(h, naturalH - y)

  return { x, y, w, h }
}

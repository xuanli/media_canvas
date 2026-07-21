import { describe, it, expect } from 'vitest'
import { displayRectToNatural } from '@/lib/geometry'

describe('displayRectToNatural', () => {
  it('scales uniformly by naturalW/displayW', () => {
    expect(displayRectToNatural({ x: 10, y: 20, w: 100, h: 50 }, 200, 1000))
      .toEqual({ x: 50, y: 100, w: 500, h: 250 })
  })
  it('clamps to image bounds', () => {
    const r = displayRectToNatural({ x: -5, y: 0, w: 300, h: 50 }, 200, 1000)
    expect(r.x).toBe(0); expect(r.x + r.w).toBeLessThanOrEqual(1000)
  })
  it('rounds to integers', () => {
    const r = displayRectToNatural({ x: 1, y: 1, w: 3, h: 3 }, 300, 1000)
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true)
  })
})

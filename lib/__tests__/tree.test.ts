import { describe, it, expect } from 'vitest'
import { nextSeq, placeChildren } from '@/lib/tree'

const P = { x: 0, y: 0, w: 240, h: 180 }

describe('nextSeq', () => {
  it('is max+1', () => { expect(nextSeq([1, 5, 3])).toBe(6) })
  it('starts at 1', () => { expect(nextSeq([])).toBe(1) })
})

describe('placeChildren', () => {
  it('places a single child right of parent, vertically centered', () => {
    const [p] = placeChildren(P, 1, [])
    expect(p.x).toBeGreaterThanOrEqual(P.x + P.w + 60)
    expect(p.y).toBe(P.y)
  })
  it('fans 3 children vertically around parent y', () => {
    const ps = placeChildren(P, 3, [])
    expect(ps[0].y).toBeLessThan(ps[1].y); expect(ps[1].y).toBeLessThan(ps[2].y)
    expect(ps[1].y).toBe(P.y)
  })
  it('nudges below an occupied slot', () => {
    const [first] = placeChildren(P, 1, [])
    const [second] = placeChildren(P, 1, [{ ...first, w: 240, h: 180 }])
    expect(second.y).toBeGreaterThan(first.y)
  })
})

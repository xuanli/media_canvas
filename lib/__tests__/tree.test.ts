import { describe, it, expect } from 'vitest'
import { nextSeq, placeChildren, layoutTree } from '@/lib/tree'

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

describe('layoutTree', () => {
  const N = (id: string, sourceId: string | null = null, w = 240, h = 150) => ({ id, w, h, sourceId })

  it('lays a chain out left-to-right with increasing x', () => {
    const pos = layoutTree([N('a'), N('b', 'a'), N('c', 'b')])
    expect(pos.get('b')!.x).toBeGreaterThan(pos.get('a')!.x)
    expect(pos.get('c')!.x).toBeGreaterThan(pos.get('b')!.x)
    // a straight chain stays on one row (all centered on each other)
    expect(pos.get('a')!.y).toBe(pos.get('b')!.y)
  })

  it('centers a parent on its stacked children', () => {
    const pos = layoutTree([N('p'), N('c1', 'p'), N('c2', 'p')])
    const p = pos.get('p')!, c1 = pos.get('c1')!, c2 = pos.get('c2')!
    expect(c1.y).toBeLessThan(c2.y)
    // parent vertically centered within the children span
    const mid = (c1.y + c2.y + 150) / 2
    expect(Math.abs(p.y + 75 - mid)).toBeLessThan(1)
    // siblings do not overlap
    expect(c2.y).toBeGreaterThanOrEqual(c1.y + 150)
  })

  it('stacks independent roots without overlap and treats dangling sourceIds as roots', () => {
    const pos = layoutTree([N('r1'), N('r2'), N('orphan', 'deleted-node')])
    const ys = [pos.get('r1')!.y, pos.get('r2')!.y, pos.get('orphan')!.y].sort((a, b) => a - b)
    expect(ys[1]).toBeGreaterThanOrEqual(ys[0] + 150)
    expect(ys[2]).toBeGreaterThanOrEqual(ys[1] + 150)
    // all roots share the first column
    expect(pos.get('r2')!.x).toBe(pos.get('r1')!.x)
    expect(pos.get('orphan')!.x).toBe(pos.get('r1')!.x)
  })

  it('does not hang or lose nodes on a sourceId cycle', () => {
    const pos = layoutTree([N('a', 'b'), N('b', 'a'), N('root')])
    expect(pos.size).toBe(3)
  })
})

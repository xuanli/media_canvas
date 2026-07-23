export const GAP_X = 60, GAP_Y = 40, NUDGE = 40

export function nextSeq(seqs: number[]): number {
  return seqs.length ? Math.max(...seqs) + 1 : 1
}

type Box = { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// Whole-canvas auto-layout (user 2026-07-22: "relayout the whole canvas
// with clear node structure"). Classic layered tree: columns by provenance
// depth (roots left, descendants right), each column as wide as its widest
// node; a node is vertically centered on its children block; sibling
// subtrees stack with GAP_Y; independent roots stack with a double gap.
// Pure function (unit-tested) — the ZoomCluster Tidy button applies the
// returned positions via editor.updateShapes.
export interface LayoutNode {
  id: string
  w: number
  h: number
  sourceId: string | null
}

export function layoutTree(nodesIn: LayoutNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodesIn.map((n) => [n.id, n]))
  const children = new Map<string, LayoutNode[]>()
  const roots: LayoutNode[] = []
  for (const n of nodesIn) {
    // A sourceId pointing at a deleted node makes this an effective root.
    if (n.sourceId && byId.has(n.sourceId) && n.sourceId !== n.id) {
      const list = children.get(n.sourceId)
      if (list) list.push(n)
      else children.set(n.sourceId, [n])
    } else {
      roots.push(n)
    }
  }

  // Depth per node (visited guard: a corrupt snapshot with a sourceId cycle
  // must not hang the tab — cycle members simply never get reached from a
  // root and fall back to depth 0 / origin placement).
  const depth = new Map<string, number>()
  const stack: Array<[LayoutNode, number]> = roots.map((r) => [r, 0])
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (depth.has(n.id)) continue
    depth.set(n.id, d)
    for (const c of children.get(n.id) ?? []) stack.push([c, d + 1])
  }

  const colW: number[] = []
  for (const n of nodesIn) {
    const d = depth.get(n.id) ?? 0
    colW[d] = Math.max(colW[d] ?? 0, n.w)
  }
  const colX: number[] = []
  let acc = 0
  for (let d = 0; d < colW.length; d++) {
    colX[d] = acc
    acc += (colW[d] ?? 0) + GAP_X * 2
  }

  // Subtree heights (iterative post-order via recursion with visited guard).
  const H = new Map<string, number>()
  const subH = (n: LayoutNode): number => {
    const memo = H.get(n.id)
    if (memo !== undefined) return memo
    H.set(n.id, n.h) // pre-set breaks cycles
    const kids = children.get(n.id) ?? []
    const kidsH = kids.reduce((s, k) => s + subH(k), 0) + Math.max(0, kids.length - 1) * GAP_Y
    const h = Math.max(n.h, kidsH)
    H.set(n.id, h)
    return h
  }
  roots.forEach(subH)

  const pos = new Map<string, { x: number; y: number }>()
  const assign = (n: LayoutNode, yTop: number) => {
    if (pos.has(n.id)) return // cycle guard
    const kids = children.get(n.id) ?? []
    const total = H.get(n.id) ?? n.h
    pos.set(n.id, { x: colX[depth.get(n.id) ?? 0] ?? 0, y: yTop + (total - n.h) / 2 })
    const kidsH = kids.reduce((s, k) => s + (H.get(k.id) ?? k.h), 0) + Math.max(0, kids.length - 1) * GAP_Y
    let y = yTop + (total - kidsH) / 2
    for (const k of kids) {
      assign(k, y)
      y += (H.get(k.id) ?? k.h) + GAP_Y
    }
  }
  let y0 = 0
  for (const r of roots) {
    assign(r, y0)
    y0 += (H.get(r.id) ?? r.h) + GAP_Y * 2
  }
  // Unreached nodes (cycles): drop them at the origin column untouched
  // rather than losing them entirely.
  for (const n of nodesIn) {
    if (!pos.has(n.id)) pos.set(n.id, { x: 0, y: y0 })
  }
  return pos
}

export function placeChildren(
  parent: Box,
  count: number,
  occupied: Box[]
): Array<{ x: number; y: number }> {
  const x = parent.x + parent.w + GAP_X
  const out: Array<{ x: number; y: number }> = []

  for (let i = 0; i < count; i++) {
    let y = parent.y + (i - (count - 1) / 2) * (parent.h + GAP_Y)
    const box = () => ({ x, y, w: parent.w, h: parent.h })

    while (
      [...occupied, ...out.map((p) => ({ ...p, w: parent.w, h: parent.h }))].some(
        (o) => overlaps(box(), o)
      )
    ) {
      y += NUDGE
    }

    out.push({ x, y })
  }

  return out
}

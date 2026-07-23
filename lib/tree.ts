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
  // Rounds 2-3 (user 2026-07-22: ref nodes stacked at the bottom drawing
  // full-canvas dashed diagonals; a column-left placement still crossed
  // columns): ids of nodes this node feeds as a REFERENCE (dashed edges).
  // Childless roots that only exist as references (logo cards, style refs)
  // are pulled out of the root stack and seated DIRECTLY BELOW their topmost
  // target in the SAME column — the dashed edge becomes a short vertical hop
  // that crosses nothing.
  refTargets?: string[]
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

  // Pure ref-assets leave the root stack (see LayoutNode.refTargets): a
  // childless root whose only relationship is feeding references.
  const isRefAsset = (n: LayoutNode) =>
    roots.includes(n) && !(children.get(n.id)?.length ?? 0) && (n.refTargets?.length ?? 0) > 0
  const mainRoots = roots.filter((r) => !isRefAsset(r))
  const refAssets = roots.filter(isRefAsset)

  // Depth per node (visited guard: a corrupt snapshot with a sourceId cycle
  // must not hang the tab — cycle members simply never get reached from a
  // root and fall back to depth 0 / origin placement).
  const depth = new Map<string, number>()
  const stack: Array<[LayoutNode, number]> = mainRoots.map((r) => [r, 0])
  while (stack.length) {
    const [n, d] = stack.pop()!
    if (depth.has(n.id)) continue
    depth.set(n.id, d)
    for (const c of children.get(n.id) ?? []) stack.push([c, d + 1])
  }
  // Ref-assets share their shallowest target's COLUMN (round 3, user
  // 2026-07-22 "still a lot of line cross"): sitting directly BELOW the
  // target makes the dashed edge a short vertical hop that crosses nothing —
  // an earlier-column placement made every ref edge traverse the columns in
  // between.
  for (const r of refAssets) {
    const targetDepths = (r.refTargets ?? []).map((t) => depth.get(t) ?? 1)
    depth.set(r.id, Math.min(...targetDepths))
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
  for (const r of mainRoots) {
    assign(r, y0)
    y0 += (H.get(r.id) ?? r.h) + GAP_Y * 2
  }

  // Pass 2 — ref-assets: row-aligned with their first (topmost) target,
  // pushed down past any occupant of the same column until free.
  const colBoxes = new Map<number, Array<{ y: number; h: number }>>()
  for (const n of nodesIn) {
    const p = pos.get(n.id)
    if (!p) continue
    const d = depth.get(n.id) ?? 0
    const list = colBoxes.get(d)
    if (list) list.push({ y: p.y, h: n.h })
    else colBoxes.set(d, [{ y: p.y, h: n.h }])
  }
  // Desired seat: directly below the topmost target node.
  const belowTargetY = (r: LayoutNode) => {
    const targets = (r.refTargets ?? [])
      .map((t) => ({ p: pos.get(t), n: byId.get(t) }))
      .filter((x): x is { p: { x: number; y: number }; n: LayoutNode } => !!x.p && !!x.n)
    if (!targets.length) return y0
    const top = targets.reduce((a, b) => (a.p.y <= b.p.y ? a : b))
    return top.p.y + top.n.h + GAP_Y
  }
  const topTarget = (r: LayoutNode) => {
    const targets = (r.refTargets ?? [])
      .map((t) => ({ p: pos.get(t), n: byId.get(t) }))
      .filter((x): x is { p: { x: number; y: number }; n: LayoutNode } => !!x.p && !!x.n)
    if (!targets.length) return null
    return targets.reduce((a, b) => (a.p.y <= b.p.y ? a : b))
  }
  for (const r of [...refAssets].sort((a, b) => belowTargetY(a) - belowTargetY(b))) {
    const d = depth.get(r.id) ?? 0
    const boxes = (colBoxes.get(d) ?? []).sort((a, b) => a.y - b.y)
    const free = (y: number) => !boxes.some((b) => y < b.y + b.h + GAP_Y && b.y < y + r.h + GAP_Y)
    let y = belowTargetY(r)
    for (const b of boxes) {
      const overlaps = y < b.y + b.h + GAP_Y && b.y < y + r.h + GAP_Y
      if (overlaps) y = b.y + b.h + GAP_Y
    }
    // Round 4 (user screenshot: a ref whose below-seat was occupied got
    // pushed past a whole tree row, its edge spearing through the nodes in
    // between): if the resolved below-seat drifted away from the target,
    // try the seat directly ABOVE the target and take whichever is closer.
    const tt = topTarget(r)
    if (tt) {
      const desired = tt.p.y + tt.n.h + GAP_Y
      const above = tt.p.y - r.h - GAP_Y
      if (y !== desired && free(above) && Math.abs(above - tt.p.y) < Math.abs(y - tt.p.y)) {
        y = above
      }
    }
    pos.set(r.id, { x: colX[d] ?? 0, y })
    const list = colBoxes.get(d)
    if (list) list.push({ y, h: r.h })
    else colBoxes.set(d, [{ y, h: r.h }])
  }

  // Unreached nodes (cycles): drop them at the origin column untouched
  // rather than losing them entirely.
  for (const n of nodesIn) {
    if (!pos.has(n.id)) {
      pos.set(n.id, { x: 0, y: y0 })
      y0 += n.h + GAP_Y
    }
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

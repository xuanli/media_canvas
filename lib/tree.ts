export const GAP_X = 60, GAP_Y = 40, NUDGE = 40

export function nextSeq(seqs: number[]): number {
  return seqs.length ? Math.max(...seqs) + 1 : 1
}

type Box = { x: number; y: number; w: number; h: number }

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

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

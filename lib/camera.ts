import type { Editor, TLShapeId } from 'tldraw'

// Shared "frame this node center-stage" camera move (2026-07-22), used by
// CommandBar's tool-arming zoom and ImageNodeShape's double-click. Differs
// from tldraw's zoomToBounds in two user-driven ways (both learned the hard
// way — a small node once framed at 615%):
//   - zoom is CAPPED (default 2x) instead of fit-to-viewport;
//   - the node centers in the VISIBLE band: the command bar (~330px, armed
//     tray height) and top nav (~60px) are reserved so chrome never covers
//     the framed node.
// Camera math: screen = (page + camera) * zoom ⇒ camera = screen/zoom − page.
const SIDE = 120
const TOP = 60
const BOTTOM = 330

export function frameShape(editor: Editor, id: TLShapeId, opts: { maxZoom?: number } = {}): void {
  const b = editor.getShapePageBounds(id)
  if (!b) return
  const vs = editor.getViewportScreenBounds()
  const fit = Math.min((vs.w - SIDE * 2) / b.w, (vs.h - TOP - BOTTOM) / b.h)
  const z = Math.max(0.05, Math.min(fit, opts.maxZoom ?? 2))
  const sx = vs.w / 2
  const sy = TOP + (vs.h - TOP - BOTTOM) / 2
  editor.setCamera(
    { x: sx / z - (b.x + b.w / 2), y: sy / z - (b.y + b.h / 2), z },
    { animation: { duration: 220 } }
  )
}

'use client'

// Positioning note (tldraw 5.2.5): `editor.pageToScreen()` internally reads
// `this.getCamera()` (a `@computed` signal) before applying the screen-bounds
// offset — see node_modules/.../@tldraw/editor/src/lib/editor/Editor.ts
// `pageToScreen()`. Calling it inside `useValue`'s compute function therefore
// captures the camera signal and the menu reactively repositions on pan/zoom;
// no separate `editor.getCamera()` call is needed (matches the brief's
// pseudo-code, verified against source rather than assumed).
import { useEditor, useValue } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'

const VERBS = [
  ['edit', '✦ Edit'],
  ['inpaint', '✦ Inpaint'],
  ['vary', '✦ Vary'],
  ['crop', 'Crop'],
  ['resize', 'Resize'],
] as const

export function ActionMenu() {
  const editor = useEditor()
  const { armedTool, setArmedTool } = useUiStore()
  const sel = useValue(
    'sel',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      const b = editor.getShapePageBounds(s.id)
      if (!b) return null
      const p = editor.pageToScreen({ x: b.x, y: b.y })
      return { id: s.id, x: p.x, y: p.y }
    },
    [editor]
  )
  if (!sel) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: sel.x,
        top: sel.y - 34,
        zIndex: 300,
        display: 'flex',
        gap: 2,
        background: '#232933',
        border: '1px solid #2d3540',
        borderRadius: 7,
        padding: 3,
      }}
    >
      {VERBS.map(([tool, label]) => (
        <button
          key={tool}
          onClick={() => setArmedTool(armedTool === tool ? null : tool)}
          style={{
            background: armedTool === tool ? '#2dd4bf' : 'transparent',
            color: armedTool === tool ? '#0b2622' : '#dfe5ec',
            border: 0,
            borderRadius: 4,
            fontSize: 11,
            padding: '3px 8px',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

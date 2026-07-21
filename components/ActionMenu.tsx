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
      return { id: s.id, x: p.x, y: p.y, status: s.props.status }
    },
    [editor]
  )
  if (!sel) return null
  // Cleanup (whole-branch review): Crop/Resize/✦ Inpaint all arm an overlay
  // that operates on the selected node's *rendered image* — arming them
  // against a 'pending' or 'error' node (no image to draw the overlay over)
  // let you enter a broken state. ✦ Edit/✦ Vary are left ungated: both are
  // model calls that dispatch off the node's assetUrl at generate time
  // (edit even accepts a not-yet-resolved reference elsewhere), not an
  // immediate on-image overlay, so there's nothing to visually break by
  // arming them early.
  const gatedTools = new Set(['crop', 'resize', 'inpaint'])
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
      {VERBS.map(([tool, label]) => {
        const disabled = gatedTools.has(tool) && sel.status !== 'done'
        return (
          <button
            key={tool}
            disabled={disabled}
            title={disabled ? 'waiting for image' : undefined}
            onClick={() => !disabled && setArmedTool(armedTool === tool ? null : tool)}
            style={{
              background: armedTool === tool ? '#2dd4bf' : 'transparent',
              color: armedTool === tool ? '#0b2622' : disabled ? '#5b6472' : '#dfe5ec',
              border: 0,
              borderRadius: 4,
              fontSize: 11,
              padding: '3px 8px',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

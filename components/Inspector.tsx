'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { runOp, runInstantOp } from '@/lib/run-op'
import { displayRectToNatural } from '@/lib/geometry'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import type { Rect } from '@/lib/types'

// Crop aspect presets (task-10 brief: "keep it simple" — a preset fits the
// CURRENT rect, or a centered default, to that ratio; it does not live-
// constrain an in-progress drag).
const ASPECT_PRESETS = [
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['free', null],
] as const

function fitToAspect(dW: number, dH: number, ratio: number, current: Rect | null): Rect {
  if (current && current.w > 4 && current.h > 4) {
    const cx = current.x + current.w / 2
    const cy = current.y + current.h / 2
    let w = current.w
    let h = w / ratio
    if (h > dH) {
      h = current.h
      w = h * ratio
    }
    w = Math.min(w, dW)
    h = Math.min(h, dH)
    return {
      x: Math.max(0, Math.min(dW - w, cx - w / 2)),
      y: Math.max(0, Math.min(dH - h, cy - h / 2)),
      w,
      h,
    }
  }
  // No rect drawn yet: a centered default at ~60% of the image display size.
  let w = dW * 0.6
  let h = w / ratio
  if (h > dH * 0.9) {
    h = dH * 0.6
    w = h * ratio
  }
  return { x: (dW - w) / 2, y: (dH - h) / 2, w, h }
}

// Hardcoded client-side per the task brief: this is the "model picker where
// >1 registered" product decision, not a server-driven list.
const EDIT_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana' },
  { id: 'flux-kontext', label: 'FLUX Kontext' },
] as const

const panel: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  zIndex: 300,
  width: 260,
  background: '#181c22',
  color: '#dfe5ec',
  border: '1px solid #2d3540',
  borderRadius: 8,
  padding: 12,
  fontSize: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const field: CSSProperties = {
  background: '#0f1216',
  color: '#dfe5ec',
  border: '1px solid #2d3540',
  borderRadius: 6,
  padding: '6px 8px',
  fontFamily: 'inherit',
  fontSize: 12,
}

const stepBtn: CSSProperties = {
  background: '#232933',
  color: '#dfe5ec',
  border: '1px solid #2d3540',
  borderRadius: 4,
  width: 22,
  height: 22,
  cursor: 'pointer',
}

const applyBtn: CSSProperties = {
  background: '#2dd4bf',
  color: '#0b2622',
  border: 0,
  borderRadius: 6,
  padding: '8px 10px',
  fontWeight: 600,
  cursor: 'pointer',
}

const formSection: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderTop: '1px solid #2d3540',
  paddingTop: 8,
}

export function Inspector() {
  const editor = useEditor()
  const { armedTool, setArmedTool, cropRect, setCropRect } = useUiStore()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(EDIT_MODELS[0].id)
  const [variants, setVariants] = useState(1)
  const [preset, setPreset] = useState<string>('free')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)

  const sel = useValue(
    'inspector-sel',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      return s as ImageNodeShape
    },
    [editor]
  )

  // Reset form state when selection changes — including the crop rect, so a
  // stale rect drawn on a previously-selected node doesn't ghost onto the
  // next one (cropRect is global ui-store state, not per-shape).
  const selId = sel?.id ?? null
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompt('')
    setModel(EDIT_MODELS[0].id)
    setVariants(1)
    setPreset('free')
    setCropRect(null)
  }, [selId, setCropRect])

  // Clear the drawn crop rect whenever crop isn't the active tool (switching
  // to another verb, or un-arming), so it doesn't linger for next time.
  useEffect(() => {
    if (armedTool !== 'crop') setCropRect(null)
  }, [armedTool, setCropRect])

  // Resize form seeds from the shape's natural size each time it's (re-)armed
  // for this selection, but not on every keystroke thereafter.
  useEffect(() => {
    if (armedTool !== 'resize' || !sel) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(sel.props.naturalW)
    setHeight(sel.props.naturalH)
  }, [armedTool, selId, sel])

  // Vary (locked decision): fires immediately on arming, no form. Guarded by
  // a ref keyed on the selected shape id so a dev-mode StrictMode double
  // effect invocation (or any re-render while still armed) can't double-fire
  // runOp and spawn 4 variants instead of 2.
  const variedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (armedTool !== 'vary' || !sel) {
      variedForRef.current = null
      return
    }
    if (variedForRef.current === sel.id) return
    variedForRef.current = sel.id
    runOp(
      editor,
      sel.id,
      {
        type: 'edit',
        prompt: 'subtle variation, keep composition and subject',
        model: 'nano-banana',
      },
      2
    )
    setArmedTool(null)
  }, [armedTool, sel, editor, setArmedTool])

  if (!sel) return null

  const p = sel.props
  const op = p.op
  const opModel = 'model' in op ? op.model : undefined
  const opPrompt = 'prompt' in op ? op.prompt : undefined

  const runEdit = () => {
    if (!prompt.trim()) return
    runOp(editor, sel.id, { type: 'edit', prompt, model }, variants)
    setArmedTool(null)
    setPrompt('')
    setVariants(1)
  }

  // Display width the CropOverlay measures against (shape.props.w minus the
  // 4px padding on each side) — must match ImageNodeShape's `w={p.w - 8}`.
  const dW = p.w - 8
  const dH = p.naturalW > 0 ? dW * (p.naturalH / p.naturalW) : dW

  const pickPreset = (name: string, ratio: number | null) => {
    setPreset(name)
    if (ratio === null) return // 'free': leave whatever rect is already drawn as-is
    setCropRect(fitToAspect(dW, dH, ratio, cropRect))
  }

  const applyCrop = () => {
    if (!cropRect || cropRect.w < 4 || cropRect.h < 4) return
    void runInstantOp(editor, sel.id, { type: 'crop', rect: displayRectToNatural(cropRect, dW, p.naturalW) })
    setArmedTool(null)
    setCropRect(null)
  }

  const applyResize = () => {
    if (width < 1 || height < 1) return
    void runInstantOp(editor, sel.id, { type: 'resize', width: Math.round(width), height: Math.round(height) })
    setArmedTool(null)
    setCropRect(null)
  }

  const onWidthChange = (v: number) => {
    setWidth(v)
    if (p.naturalW > 0) setHeight(Math.round(v * (p.naturalH / p.naturalW)))
  }

  return (
    <div style={panel}>
      <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#8a95a3' }}>
        v{p.seq} · {op.type}
        {opModel ? ` · ${opModel}` : ''} · {p.naturalW}×{p.naturalH}
      </div>
      {opPrompt && (
        <div style={{ fontSize: 11, color: '#aab3bf', fontStyle: 'italic' }}>&ldquo;{opPrompt}&rdquo;</div>
      )}
      {p.status === 'done' && p.assetUrl && (
        <a href={p.assetUrl} download style={{ color: '#2dd4bf', fontSize: 11 }}>
          Download
        </a>
      )}

      {armedTool === 'edit' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: '1px solid #2d3540',
            paddingTop: 8,
          }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="describe the change…"
            rows={3}
            style={{ ...field, resize: 'vertical' }}
          />
          <select value={model} onChange={(e) => setModel(e.target.value)} style={field}>
            {EDIT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#8a95a3' }}>variants:</span>
            <button onClick={() => setVariants((v) => Math.max(1, v - 1))} style={stepBtn}>
              −
            </button>
            <span>{variants}</span>
            <button onClick={() => setVariants((v) => Math.min(3, v + 1))} style={stepBtn}>
              +
            </button>
          </div>
          <button
            disabled
            title="reference picking arrives in a later task"
            style={{
              background: 'transparent',
              color: '#5b6472',
              border: '1px solid #2d3540',
              borderRadius: 6,
              padding: '6px 8px',
              cursor: 'not-allowed',
            }}
          >
            + Reference
          </button>
          <button
            onClick={runEdit}
            style={{
              background: '#2dd4bf',
              color: '#0b2622',
              border: 0,
              borderRadius: 6,
              padding: '8px 10px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Run
          </button>
        </div>
      )}

      {armedTool === 'crop' && (
        <div style={formSection}>
          <div style={{ color: '#8a95a3' }}>drag on the image to draw a crop rect</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {ASPECT_PRESETS.map(([name, ratio]) => (
              <button
                key={name}
                onClick={() => pickPreset(name, ratio)}
                style={{
                  flex: 1,
                  background: preset === name ? '#2dd4bf' : '#232933',
                  color: preset === name ? '#0b2622' : '#dfe5ec',
                  border: '1px solid #2d3540',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '4px 0',
                  cursor: 'pointer',
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <button onClick={applyCrop} disabled={!cropRect || cropRect.w < 4} style={applyBtn}>
            Apply — instant
          </button>
        </div>
      )}

      {armedTool === 'resize' && (
        <div style={formSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#8a95a3', width: 14 }}>W</span>
            <input
              type="number"
              min={1}
              value={width}
              onChange={(e) => onWidthChange(Number(e.target.value))}
              style={{ ...field, flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#8a95a3', width: 14 }}>H</span>
            <input
              type="number"
              min={1}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={{ ...field, flex: 1 }}
            />
          </div>
          <button onClick={applyResize} disabled={width < 1 || height < 1} style={applyBtn}>
            Apply — instant
          </button>
        </div>
      )}
    </div>
  )
}

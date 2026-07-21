'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { runOp, runInstantOp } from '@/lib/run-op'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import type { RectFrac } from '@/lib/types'

// Crop aspect presets (task-10 brief: "keep it simple" — a preset fits the
// CURRENT rect, or a centered default, to that ratio; it does not live-
// constrain an in-progress drag).
const ASPECT_PRESETS = [
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['free', null],
] as const

// Fix round 1 (task-10-report.md): operates in NATURAL pixel space so a
// preset ratio (e.g. 4:5) means what it says against the actual image, then
// converts back to fractions of the measured box for storage in ui-store.
// This is deliberately independent of the box's own on-screen aspect ratio.
function fitToAspect(
  naturalW: number,
  naturalH: number,
  ratio: number,
  current: RectFrac | null
): RectFrac {
  if (current && current.w * naturalW > 4 && current.h * naturalH > 4) {
    const cw = current.w * naturalW
    const ch = current.h * naturalH
    const cx = current.x * naturalW + cw / 2
    const cy = current.y * naturalH + ch / 2
    let w = cw
    let h = w / ratio
    if (h > naturalH) {
      h = ch
      w = h * ratio
    }
    w = Math.min(w, naturalW)
    h = Math.min(h, naturalH)
    const x = Math.max(0, Math.min(naturalW - w, cx - w / 2))
    const y = Math.max(0, Math.min(naturalH - h, cy - h / 2))
    return { x: x / naturalW, y: y / naturalH, w: w / naturalW, h: h / naturalH }
  }
  // No rect drawn yet: a centered default at ~60% of the natural image size.
  let w = naturalW * 0.6
  let h = w / ratio
  if (h > naturalH * 0.9) {
    h = naturalH * 0.6
    w = h * ratio
  }
  const x = (naturalW - w) / 2
  const y = (naturalH - h) / 2
  return { x: x / naturalW, y: y / naturalH, w: w / naturalW, h: h / naturalH }
}

// Guard shared by the Apply/Run buttons' disabled state and applyCrop's own
// no-op check: both must agree on what counts as "too small to crop/inpaint"
// (Minor from task-10 review — the disabled check used to only look at w).
// Reused as-is for the inpaint region (Task 11) — same "drew a real rect or
// not" question against the same fraction-of-measured-box representation.
function cropTooSmall(frac: RectFrac | null, naturalW: number, naturalH: number): boolean {
  if (!frac) return true
  return frac.w * naturalW < 4 || frac.h * naturalH < 4
}

// Shared by applyCrop and runInpaint: converts a RectFrac (fraction of the
// overlay's measured box) into clamped natural-px Rect. See CropOverlay's
// leading comment / task-10-report.md "Fix round 1" for why this is a
// direct fx*naturalW mapping with no synthetic display-space step.
function fracToNaturalRect(f: RectFrac, naturalW: number, naturalH: number) {
  const x = Math.min(naturalW, Math.max(0, Math.round(f.x * naturalW)))
  const y = Math.min(naturalH, Math.max(0, Math.round(f.y * naturalH)))
  const w = Math.max(1, Math.min(naturalW - x, Math.round(f.w * naturalW)))
  const h = Math.max(1, Math.min(naturalH - y, Math.round(f.h * naturalH)))
  return { x, y, w, h }
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
  const { armedTool, setArmedTool, cropFrac, setCropFrac } = useUiStore()
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
  // next one (cropFrac is global ui-store state, not per-shape).
  const selId = sel?.id ?? null
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompt('')
    setModel(EDIT_MODELS[0].id)
    setVariants(1)
    setPreset('free')
    setCropFrac(null)
  }, [selId, setCropFrac])

  // Clear the drawn region rect whenever neither region tool is active
  // (switching to another verb, or un-arming), so it doesn't linger for next
  // time. crop and inpaint both draw into the same `cropFrac` field (see
  // ui-store.ts) so both are exempted here.
  useEffect(() => {
    if (armedTool !== 'crop' && armedTool !== 'inpaint') setCropFrac(null)
  }, [armedTool, setCropFrac])

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

  const pickPreset = (name: string, ratio: number | null) => {
    setPreset(name)
    if (ratio === null) return // 'free': leave whatever rect is already drawn as-is
    setCropFrac(fitToAspect(p.naturalW, p.naturalH, ratio, cropFrac))
  }

  // Fix round 1 (task-10-report.md): cropFrac is a fraction of the measured
  // overlay box, not a synthetic display-unit rect — natural px is computed
  // directly (fx*naturalW, fy*naturalH per axis) and clamped to bounds,
  // bypassing displayRectToNatural entirely for this path.
  const applyCrop = () => {
    if (cropTooSmall(cropFrac, p.naturalW, p.naturalH)) return
    const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
    void runInstantOp(editor, sel.id, { type: 'crop', rect })
    setArmedTool(null)
    setCropFrac(null)
  }

  // Same fraction→natural-px conversion as applyCrop (fracToNaturalRect),
  // but dispatched through runOp (async model call) rather than
  // runInstantOp — inpaint isn't deterministic client-side work.
  const runInpaint = () => {
    if (cropTooSmall(cropFrac, p.naturalW, p.naturalH) || !prompt.trim()) return
    const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
    runOp(editor, sel.id, { type: 'inpaint', prompt, model: 'flux-fill', rect }, variants)
    setArmedTool(null)
    setCropFrac(null)
    setPrompt('')
    setVariants(1)
  }

  const applyResize = () => {
    if (width < 1 || height < 1) return
    void runInstantOp(editor, sel.id, { type: 'resize', width: Math.round(width), height: Math.round(height) })
    setArmedTool(null)
    setCropFrac(null)
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
          <button
            onClick={applyCrop}
            disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH)}
            style={applyBtn}
          >
            Apply — instant
          </button>
        </div>
      )}

      {armedTool === 'inpaint' && (
        <div style={formSection}>
          <div style={{ color: '#8a95a3' }}>drag on the image to mark the region to replace</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="describe what appears in the region…"
            rows={3}
            style={{ ...field, resize: 'vertical' }}
          />
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
            onClick={runInpaint}
            disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH) || !prompt.trim()}
            style={applyBtn}
          >
            Run — inpaint
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

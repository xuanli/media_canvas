'use client'

// v2 chrome (Task 14, user decision 2026-07-21): the single bottom command
// bar replacing PromptBar + ActionMenu + Inspector — "Bar B" from
// docs/design/ux-directions.html §barB. Three moods, one component:
//   IDLE     — nothing selected: upload + generate (was PromptBar).
//   SELECTED — a node selected, no armedTool: recipe line + verb row (was
//              ActionMenu's floating menu + the top of Inspector's panel).
//   ARMED    — a verb armed: the calm bar morphs into a tray with that
//              verb's full controls, verb row pinned at the tray bottom (was
//              the rest of Inspector's panel).
//
// PORTING NOTE (per task-14 brief, "hard rules"): every effect/handler below
// marked "[PORTED VERBATIM from Inspector.tsx]" is copied with its guards
// intact, not simplified — each guard exists because a prior review found a
// real bug (see the comments inline, kept from the original). The only
// changes are (a) the state now lives in one component with three render
// branches instead of Inspector always rendering when `sel` is truthy, and
// (b) `sel` being null no longer short-circuits with an early `return null`
// before the hooks — hooks must stay unconditional either way, so this is
// not actually a behavior change, just carried forward faithfully.

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { runOp, runInstantOp, createUploadedRoot } from '@/lib/run-op'
import { apiPost } from '@/lib/api-client'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import type { RectFrac } from '@/lib/types'

// ── Ported verbatim from Inspector.tsx (task-10/11 fix-round comments kept) ──

const ASPECT_PRESETS = [
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['free', null],
] as const

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

function cropTooSmall(frac: RectFrac | null, naturalW: number, naturalH: number): boolean {
  if (!frac) return true
  return frac.w * naturalW < 4 || frac.h * naturalH < 4
}

function fracToNaturalRect(f: RectFrac, naturalW: number, naturalH: number) {
  const x = Math.min(naturalW, Math.max(0, Math.round(f.x * naturalW)))
  const y = Math.min(naturalH, Math.max(0, Math.round(f.y * naturalH)))
  const w = Math.max(1, Math.min(naturalW - x, Math.round(f.w * naturalW)))
  const h = Math.max(1, Math.min(naturalH - y, Math.round(f.h * naturalH)))
  return { x, y, w, h }
}

const EDIT_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana' },
  { id: 'flux-kontext', label: 'FLUX Kontext' },
] as const

// verbs shown in both the SELECTED calm bar and pinned to the ARMED tray's
// bottom row (ActionMenu.tsx's VERBS list, unchanged).
const VERBS = [
  ['edit', '✦ Edit'],
  ['inpaint', '✦ Inpaint'],
  ['vary', '✦ Vary'],
  ['crop', 'Crop'],
  ['resize', 'Resize'],
] as const

// ── styling: dark palette tokens already used across the app ──

const barShell: CSSProperties = {
  position: 'absolute',
  bottom: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 300,
  width: 'min(720px, calc(100vw - 24px))',
  background: '#181c22',
  border: '1px solid #2d3540',
  borderRadius: 10,
  color: '#dfe5ec',
  fontSize: 12,
  // "simple CSS max-height/transform transition" (brief) for the tray
  // slide-up; disabled under prefers-reduced-motion via app/globals.css's
  // `.gm-bar` rule.
  overflow: 'hidden',
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

const primaryBtn: CSSProperties = {
  background: '#2dd4bf',
  color: '#0b2622',
  border: 0,
  borderRadius: 6,
  padding: '8px 10px',
  fontWeight: 600,
  cursor: 'pointer',
}

function verbBtnStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    background: active ? '#2dd4bf' : 'transparent',
    color: active ? '#0b2622' : disabled ? '#5b6472' : '#dfe5ec',
    border: '1px solid #2d3540',
    borderRadius: 5,
    fontSize: 11,
    padding: '4px 8px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    fontFamily: 'inherit',
  }
}

export function CommandBar() {
  const editor = useEditor()
  const { armedTool, setArmedTool, cropFrac, setCropFrac, pickingRef, setPickingRef } = useUiStore()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(EDIT_MODELS[0].id)
  const [variants, setVariants] = useState(1)
  const [preset, setPreset] = useState<string>('free')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [refId, setRefId] = useState<TLShapeId | null>(null)

  // IDLE mood's own generate input — separate local state from `prompt`
  // (edit/inpaint's field) since the two moods are mutually exclusive but
  // this keeps a stray idle draft from leaking into an armed tool's prompt
  // or vice versa, matching PromptBar/Inspector having been separate
  // components with separate state before.
  const [genPrompt, setGenPrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Task 15A: click-to-edit node name on the SELECTED recipe line.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const sel = useValue(
    'cmdbar-sel',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      return s as ImageNodeShape
    },
    [editor]
  )

  // [PORTED VERBATIM from Inspector.tsx] Reset form state when selection
  // changes — including the crop rect, so a stale rect drawn on a
  // previously-selected node doesn't ghost onto the next one (cropFrac is
  // global ui-store state, not per-shape). See task-12-report.md Finding 1+2
  // for why this is SELECTION-DRIVEN (prevSelIdRef) rather than
  // pick-flag-driven, with restoringRef swallowing the effect's own
  // programmatic selection restores.
  const selId = sel?.id ?? null
  const editTargetIdRef = useRef<TLShapeId | null>(null)
  const prevSelIdRef = useRef<TLShapeId | null>(selId)
  const restoringRef = useRef(false)
  useEffect(() => {
    if (pickingRef) {
      const targetId = editTargetIdRef.current
      if (sel && targetId && sel.id !== targetId) {
        if (sel.props.status === 'done') {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setRefId(sel.id)
          setPickingRef(false)
        }
        restoringRef.current = true
        editor.select(targetId)
      }
      prevSelIdRef.current = selId
      return
    }
    if (restoringRef.current) {
      restoringRef.current = false
      prevSelIdRef.current = selId
      return
    }
    if (selId !== prevSelIdRef.current) {
      setPrompt('')
      setModel(EDIT_MODELS[0].id)
      setVariants(1)
      setPreset('free')
      setCropFrac(null)
      setRefId(null)
      setEditingName(false)
    }
    prevSelIdRef.current = selId
  }, [selId, pickingRef, sel, editor, setCropFrac, setPickingRef])

  // [PORTED VERBATIM from Inspector.tsx] Clear the drawn region rect and any
  // in-progress prompt on EVERY armedTool change (tracked via a ref so
  // re-renders that leave armedTool unchanged don't wipe mid-typing state).
  // crop and inpaint both draw into the same `cropFrac` field; prompt is
  // local state shared across Edit/Inpaint forms.
  const prevArmedToolRef = useRef(armedTool)
  useEffect(() => {
    if (armedTool !== prevArmedToolRef.current) {
      setCropFrac(null)
      setPrompt('')
      setRefId(null)
    }
    prevArmedToolRef.current = armedTool
  }, [armedTool, setCropFrac])

  // [PORTED VERBATIM from Inspector.tsx] Resize form seeds from the shape's
  // natural size each time it's (re-)armed for this selection, but not on
  // every keystroke thereafter.
  useEffect(() => {
    if (armedTool !== 'resize' || !sel) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(sel.props.naturalW)
    setHeight(sel.props.naturalH)
  }, [armedTool, selId, sel])

  // [PORTED VERBATIM from Inspector.tsx] Vary fires immediately on arming,
  // no form. Guarded by a ref keyed on the selected shape id so a dev-mode
  // StrictMode double effect invocation can't double-fire runOp.
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

  // ── IDLE mood handlers (ported from PromptBar.tsx, plus new Upload) ──

  const go = () => {
    if (!genPrompt.trim()) return
    runOp(editor, null, { type: 'generate', prompt: genPrompt, model: 'flux-1.1-pro' })
    setGenPrompt('')
  }

  const onUploadChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('could not read the file'))
        reader.readAsDataURL(file)
      })
      const { url } = await apiPost<{ url: string }>('/api/upload', { dataUrl }, false)
      await createUploadedRoot(editor, url, file.name)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Hooks are all unconditional above this point; only rendering branches
  // below, same rule Inspector followed with its `if (!sel) return null`.
  if (!sel) {
    return (
      <div style={{ ...barShell, padding: 8, display: 'flex', gap: 6, alignItems: 'center' }} className="gm-bar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => void onUploadChange(e)}
          style={{ display: 'none' }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{ ...stepBtn, width: 'auto', padding: '8px 10px', fontSize: 11 }}
          title="upload PNG/JPEG as a new root node"
        >
          {uploading ? '…' : '📎 Upload'}
        </button>
        <input
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="Describe a new image…"
          style={{ ...field, flex: 1 }}
        />
        <button onClick={go} style={primaryBtn}>
          Generate
        </button>
        {uploadError && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 6,
              background: '#2a1414',
              color: '#ff9c9c',
              border: '1px solid #5a2a2a',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
            }}
          >
            {uploadError}
          </div>
        )}
      </div>
    )
  }

  const p = sel.props
  const op = p.op
  const opModel = 'model' in op ? op.model : undefined
  const opPrompt = 'prompt' in op ? op.prompt : undefined
  const gatedTools = new Set(['crop', 'resize', 'inpaint']) // ActionMenu.tsx's gating, unchanged

  // [PORTED VERBATIM from Inspector.tsx handlers]

  const startPick = () => {
    editTargetIdRef.current = sel.id
    setPickingRef(true)
  }

  // Task 15A: rename is a normal (undoable) update — unlike the
  // history:'ignore' status transitions in run-op.ts's dispatch(), a rename
  // is a direct user edit, not an async settle of something already on the
  // undo stack, so it belongs on the stack like any other prop edit.
  const startEditName = () => {
    setNameDraft(sel.props.name ?? '')
    setEditingName(true)
  }

  const commitName = () => {
    editor.updateShape<ImageNodeShape>({ id: sel.id, type: 'image-node', props: { name: nameDraft.trim() } })
    setEditingName(false)
  }

  const cancelEditName = () => {
    setEditingName(false)
  }

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // stopPropagation so Enter/Escape here don't also reach
    // CanvasApp.tsx's global Escape listener (which would disarm/deselect —
    // the brief is explicit this edit must not bubble into that layering).
    if (e.key === 'Enter') {
      e.stopPropagation()
      commitName()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      cancelEditName()
    }
  }

  const resolveRef = (id: string) => {
    const s = editor.getShape(id as TLShapeId)
    return s && s.type === 'image-node' ? s.props.assetUrl : undefined
  }

  const refNode = refId ? editor.getShape(refId) : undefined
  const refSeq = refNode && refNode.type === 'image-node' ? refNode.props.seq : undefined

  const runEdit = () => {
    if (!prompt.trim()) return
    runOp(
      editor,
      sel.id,
      { type: 'edit', prompt, model, referenceNodeId: refId ?? undefined },
      variants,
      resolveRef,
      refId ?? undefined
    )
    setArmedTool(null)
    setPrompt('')
    setVariants(1)
    setRefId(null)
  }

  const pickPreset = (name: string, ratio: number | null) => {
    setPreset(name)
    if (ratio === null) return
    setCropFrac(fitToAspect(p.naturalW, p.naturalH, ratio, cropFrac))
  }

  const applyCrop = () => {
    if (cropTooSmall(cropFrac, p.naturalW, p.naturalH)) return
    const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
    void runInstantOp(editor, sel.id, { type: 'crop', rect })
    setArmedTool(null)
    setCropFrac(null)
  }

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

  const trayHeader =
    armedTool === 'edit'
      ? `✦ Edit v${p.seq} — creates children of v${p.seq}`
      : armedTool === 'inpaint'
        ? `✦ Inpaint v${p.seq} — creates children of v${p.seq}`
        : armedTool === 'crop'
          ? `Crop v${p.seq} — instant`
          : armedTool === 'resize'
            ? `Resize v${p.seq} — instant`
            : null

  const verbRow = (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {VERBS.map(([tool, label]) => {
        const disabled = gatedTools.has(tool) && p.status !== 'done'
        return (
          <button
            key={tool}
            disabled={disabled}
            title={disabled ? 'waiting for image' : undefined}
            onClick={() => !disabled && setArmedTool(armedTool === tool ? null : tool)}
            style={verbBtnStyle(armedTool === tool, disabled)}
          >
            {label}
          </button>
        )
      })}
      <a
        href={p.status === 'done' ? p.assetUrl : undefined}
        download
        onClick={(e) => {
          if (p.status !== 'done') e.preventDefault()
        }}
        title={p.status === 'done' ? 'download this node' : 'waiting for image'}
        style={{ ...verbBtnStyle(false, p.status !== 'done'), textDecoration: 'none', display: 'inline-block' }}
      >
        ⬇
      </a>
    </div>
  )

  return (
    <div style={{ ...barShell, padding: 8 }} className="gm-bar">
      {!armedTool && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#8a95a3' }}>
            {editingName ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={onNameKeyDown}
                onBlur={cancelEditName}
                placeholder="name this node…"
                style={{ ...field, padding: '3px 6px', fontSize: 11, width: 140 }}
              />
            ) : (
              <span
                onClick={startEditName}
                title="click to rename"
                style={{ color: p.name ? '#dfe5ec' : '#5b6472', fontStyle: p.name ? 'normal' : 'italic', cursor: 'text' }}
              >
                {p.name || 'unnamed'}
              </span>
            )}
            <span>
              v{p.seq} · {op.type}
              {opModel ? ` · ${opModel}` : ''} · {p.naturalW}×{p.naturalH}
            </span>
          </div>
          {opPrompt && (
            <div style={{ fontSize: 11, color: '#aab3bf', fontStyle: 'italic' }}>&ldquo;{opPrompt}&rdquo;</div>
          )}
          {verbRow}
        </div>
      )}

      {armedTool && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: 11,
              color: '#8a95a3',
              paddingBottom: 8,
              borderBottom: '1px solid #2d3540',
              marginBottom: 8,
            }}
          >
            {trayHeader}
          </div>

          {armedTool === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="describe the change…"
                rows={2}
                style={{ ...field, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <select value={model} onChange={(e) => setModel(e.target.value)} style={field}>
                  {EDIT_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <span style={{ color: '#8a95a3' }}>variants:</span>
                <button onClick={() => setVariants((v) => Math.max(1, v - 1))} style={stepBtn}>
                  −
                </button>
                <span>{variants}</span>
                <button onClick={() => setVariants((v) => Math.min(3, v + 1))} style={stepBtn}>
                  +
                </button>
                {refId ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        background: '#0f1216',
                        color: '#2dd4bf',
                        border: '1px solid #2dd4bf',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 11,
                      }}
                    >
                      ref: v{refSeq ?? '?'}
                    </span>
                    <button
                      onClick={() => setRefId(null)}
                      title="remove reference"
                      style={{
                        background: 'transparent',
                        color: '#8a95a3',
                        border: '1px solid #2d3540',
                        borderRadius: 4,
                        width: 22,
                        height: 22,
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={startPick}
                    title={
                      pickingRef
                        ? 'click a done node on the canvas to attach it as a reference'
                        : 'attach another node as a reference image'
                    }
                    style={{
                      background: pickingRef ? '#2dd4bf' : 'transparent',
                      color: pickingRef ? '#0b2622' : '#dfe5ec',
                      border: '1px solid #2d3540',
                      borderRadius: 6,
                      padding: '6px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    {pickingRef ? 'Pick a node…' : '+ Reference'}
                  </button>
                )}
                <button onClick={runEdit} style={{ ...primaryBtn, marginLeft: 'auto' }}>
                  Run
                </button>
              </div>
            </div>
          )}

          {armedTool === 'crop' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#8a95a3' }}>drag on the image to draw a crop rect</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {ASPECT_PRESETS.map(([name, ratio]) => (
                  <button
                    key={name}
                    onClick={() => pickPreset(name, ratio)}
                    style={{
                      background: preset === name ? '#2dd4bf' : '#232933',
                      color: preset === name ? '#0b2622' : '#dfe5ec',
                      border: '1px solid #2d3540',
                      borderRadius: 4,
                      fontSize: 11,
                      padding: '4px 8px',
                      cursor: 'pointer',
                    }}
                  >
                    {name}
                  </button>
                ))}
                <button
                  onClick={applyCrop}
                  disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH)}
                  style={{ ...primaryBtn, marginLeft: 'auto' }}
                >
                  Apply — instant
                </button>
              </div>
            </div>
          )}

          {armedTool === 'inpaint' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#8a95a3' }}>drag on the image to mark the region to replace</div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="describe what appears in the region…"
                rows={2}
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
                <button
                  onClick={runInpaint}
                  disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH) || !prompt.trim()}
                  style={{ ...primaryBtn, marginLeft: 'auto' }}
                >
                  Run — inpaint
                </button>
              </div>
            </div>
          )}

          {armedTool === 'resize' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#8a95a3', width: 14 }}>W</span>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => onWidthChange(Number(e.target.value))}
                  style={{ ...field, flex: 1 }}
                />
                <span style={{ color: '#8a95a3', width: 14 }}>H</span>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  style={{ ...field, flex: 1 }}
                />
                <button onClick={applyResize} disabled={width < 1 || height < 1} style={primaryBtn}>
                  Apply — instant
                </button>
              </div>
            </div>
          )}

          <div style={{ paddingTop: 8, marginTop: 8, borderTop: '1px solid #2d3540' }}>{verbRow}</div>
        </div>
      )}
    </div>
  )
}

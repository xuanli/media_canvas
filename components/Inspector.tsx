'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { runOp } from '@/lib/run-op'
import type { ImageNodeShape } from '@/components/ImageNodeShape'

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

export function Inspector() {
  const editor = useEditor()
  const { armedTool, setArmedTool } = useUiStore()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(EDIT_MODELS[0].id)
  const [variants, setVariants] = useState(1)

  const sel = useValue(
    'inspector-sel',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      return s as ImageNodeShape
    },
    [editor]
  )

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
    </div>
  )
}

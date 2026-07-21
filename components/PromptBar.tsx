'use client'

import { useState } from 'react'
import { useEditor } from 'tldraw'
import { runOp } from '@/lib/run-op'

export function PromptBar() {
  const editor = useEditor()
  const [prompt, setPrompt] = useState('')

  const go = () => {
    if (!prompt.trim()) return
    runOp(editor, null, { type: 'generate', prompt, model: 'flux-1.1-pro' })
    setPrompt('')
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 300,
        display: 'flex',
        gap: 6,
        width: 420,
      }}
    >
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        placeholder="Describe a new image…"
        style={{
          flex: 1,
          background: '#181c22',
          color: '#dfe5ec',
          border: '1px solid #2d3540',
          borderRadius: 6,
          padding: '8px 10px',
        }}
      />
      <button
        onClick={go}
        style={{
          background: '#2dd4bf',
          color: '#0b2622',
          border: 0,
          borderRadius: 6,
          padding: '8px 14px',
          fontWeight: 600,
        }}
      >
        Generate
      </button>
    </div>
  )
}

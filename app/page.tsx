'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api-client'

export default function Home() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const newCanvas = async () => {
    setBusy(true)
    setError(null)
    try {
      const { id } = await apiPost<{ id: string }>('/api/canvas', {}, false)
      router.push(`/c/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#0b0e12',
        color: '#dfe5ec',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>gen_media</div>
        <div style={{ fontSize: 13, color: '#8a95a3' }}>
          A canvas where every generation and edit is a branch you can compare and refine.
        </div>
        <button
          onClick={newCanvas}
          disabled={busy}
          style={{
            marginTop: 8,
            background: '#2dd4bf',
            color: '#0b2622',
            border: 0,
            borderRadius: 6,
            padding: '10px 18px',
            fontWeight: 600,
            fontSize: 13,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Creating…' : 'New canvas'}
        </button>
        {error && <div style={{ fontSize: 12, color: '#d98d80' }}>{error}</div>}
      </div>
    </div>
  )
}

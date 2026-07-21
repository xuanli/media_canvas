'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api-client'

// PasscodeGate (components/PasscodeGate.tsx) isn't reused here: it's a
// full-screen overlay that gates children behind a probe fetch + a hard
// `location.reload()` on submit. What this page needs is different — retry
// the SAME create call inline after a 401, with a "wrong passcode" message
// that stays up on a second failure, no reload. A small inline form matching
// the landing's styling is simpler than adapting PasscodeGate's contract.
export default function Home() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsPasscode, setNeedsPasscode] = useState(false)
  const [passcodeValue, setPasscodeValue] = useState('')
  const [passcodeError, setPasscodeError] = useState<string | null>(null)

  const newCanvas = async (isRetry = false) => {
    setBusy(true)
    setError(null)
    try {
      const { id } = await apiPost<{ id: string }>('/api/canvas', {}, false)
      router.push(`/c/${id}`)
    } catch (e) {
      const status = e && typeof e === 'object' && 'status' in e ? (e as { status?: unknown }).status : undefined
      if (status === 401) {
        setNeedsPasscode(true)
        setPasscodeError(isRetry ? 'Wrong passcode, try again.' : null)
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong.')
      }
      setBusy(false)
    }
  }

  const unlock = async (e: FormEvent) => {
    e.preventDefault()
    localStorage.setItem('gm-passcode', passcodeValue)
    await newCanvas(true)
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
        {needsPasscode ? (
          <form
            onSubmit={unlock}
            style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, width: 220 }}
          >
            <div style={{ fontSize: 12, color: '#8a95a3' }}>This canvas requires a passcode.</div>
            <input
              type="password"
              autoFocus
              value={passcodeValue}
              onChange={(e) => setPasscodeValue(e.target.value)}
              style={{
                background: '#0f1216',
                color: '#dfe5ec',
                border: '1px solid #2d3540',
                borderRadius: 6,
                padding: '8px 10px',
                fontFamily: 'inherit',
                fontSize: 13,
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                background: '#2dd4bf',
                color: '#0b2622',
                border: 0,
                borderRadius: 6,
                padding: '8px 10px',
                fontWeight: 600,
                fontSize: 13,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
            {passcodeError && <div style={{ fontSize: 12, color: '#d98d80' }}>{passcodeError}</div>}
          </form>
        ) : (
          <button
            onClick={() => newCanvas()}
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
        )}
        {error && <div style={{ fontSize: 12, color: '#d98d80' }}>{error}</div>}
      </div>
    </div>
  )
}

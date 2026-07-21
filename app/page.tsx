'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost } from '@/lib/api-client'
import { color, metric, type as typeTok, buttonPrimary, inputField } from '@/lib/design'

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
        background: color.navBg,
        color: color.text,
        fontFamily: typeTok.fontUi,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>gen_media</div>
        <div style={{ fontSize: typeTok.base, color: color.textSecondary }}>
          A canvas where every generation and edit is a branch you can compare and refine.
        </div>
        {needsPasscode ? (
          <form
            onSubmit={unlock}
            style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, width: 220 }}
          >
            <div style={{ fontSize: typeTok.secondary, color: color.textSecondary }}>This canvas requires a passcode.</div>
            <input
              className="gm-input"
              type="password"
              autoFocus
              value={passcodeValue}
              onChange={(e) => setPasscodeValue(e.target.value)}
              style={inputField()}
            />
            <button type="submit" className="gm-btn" disabled={busy} style={buttonPrimary({ disabled: busy })}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
            {passcodeError && <div style={{ fontSize: typeTok.secondary, color: color.danger }}>{passcodeError}</div>}
          </form>
        ) : (
          <button
            className="gm-btn"
            onClick={() => newCanvas()}
            disabled={busy}
            style={{ ...buttonPrimary({ disabled: busy }), marginTop: 8, height: 40, padding: `0 ${metric.gapLg + 6}px` }}
          >
            {busy ? 'Creating…' : 'New canvas'}
          </button>
        )}
        {error && <div style={{ fontSize: typeTok.secondary, color: color.danger }}>{error}</div>}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

// Gates canvas rendering behind the shared passcode (lib/server-auth.ts).
// If localStorage already has one, we optimistically let the app through —
// a wrong stored passcode surfaces later as the save-sync "not saved"
// title, not as a hard block here. Otherwise a cheap probe (POST
// /api/canvas with no passcode header) tells us whether the server actually
// requires one: in local dev without APP_PASSCODE set, checkPasscode()
// fails OPEN, so the probe returns 200 and the gate never shows.
export function PasscodeGate({ children }: { children: ReactNode }) {
  // Lazy initializer (not an effect) so the localStorage read never fires a
  // synchronous setState-in-effect — the probe branch below only runs when
  // there was nothing stored yet.
  const [status, setStatus] = useState<'checking' | 'ok' | 'needed'>(() =>
    typeof localStorage !== 'undefined' && localStorage.getItem('gm-passcode') ? 'ok' : 'checking'
  )
  const [value, setValue] = useState('')

  useEffect(() => {
    if (status !== 'checking') return
    let cancelled = false
    fetch('/api/canvas', { method: 'POST' })
      .then((res) => {
        if (!cancelled) setStatus(res.status === 401 ? 'needed' : 'ok')
      })
      .catch(() => {
        if (!cancelled) setStatus('ok') // fail open on a network hiccup — don't brick the editor
      })
    return () => {
      cancelled = true
    }
  }, [status])

  if (status === 'checking') return null
  if (status === 'ok') return <>{children}</>

  const submit = (e: FormEvent) => {
    e.preventDefault()
    localStorage.setItem('gm-passcode', value)
    location.reload()
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#0b0e12',
        zIndex: 1000,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: 260,
          background: '#181c22',
          border: '1px solid #2d3540',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div style={{ color: '#dfe5ec', fontSize: 13 }}>Enter the passcode to continue.</div>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
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
          Continue
        </button>
      </form>
    </div>
  )
}

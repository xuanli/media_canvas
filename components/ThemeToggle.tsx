'use client'

import { useEffect, useState } from 'react'
import { buttonGhost } from '@/lib/design'

// Light/dark theme toggle (user 2026-07-21). The theme lives in ONE place:
// the data-gm-theme attribute on <html>, which selects the CSS-variable
// palette at the top of app/globals.css. localStorage 'gm-theme' persists
// the choice per browser; app/layout.tsx's inline pre-hydration script
// applies it before first paint so there's no dark→light flash.
//
// The tldraw canvas has its own color scheme preference (not CSS-driven) —
// callers inside <Tldraw> pass `onChange` to mirror the flip into
// editor.user.updateUserPreferences (see TopNav); CanvasApp seeds the same
// value on mount via getStoredTheme().

export type GmTheme = 'dark' | 'light'

export function getStoredTheme(): GmTheme {
  return typeof localStorage !== 'undefined' && localStorage.getItem('gm-theme') === 'light' ? 'light' : 'dark'
}

export function applyTheme(t: GmTheme) {
  document.documentElement.dataset.gmTheme = t
  localStorage.setItem('gm-theme', t)
}

export function ThemeToggle({ onChange }: { onChange?: (t: GmTheme) => void }) {
  // Render the dark glyph on the server / first client render (dark is the
  // default theme), then sync to the stored value after mount — standard
  // hydration-safe localStorage read.
  const [theme, setTheme] = useState<GmTheme>('dark')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time localStorage sync after hydration
    setTheme(getStoredTheme())
  }, [])

  const toggle = () => {
    const next: GmTheme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    onChange?.(next)
  }

  return (
    <button
      className="gm-btn-ghost"
      onClick={toggle}
      title={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
      aria-label={theme === 'dark' ? 'switch to light theme' : 'switch to dark theme'}
      style={buttonGhost({ compact: true })}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

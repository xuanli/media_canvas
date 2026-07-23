'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getPasscode } from '@/lib/api-client'
import { EXAMPLE_CANVAS, forkExampleCanvas } from '@/lib/example-canvas'
import { color, type as typeTok } from '@/lib/design'

// Master-canvas protection (user 2026-07-22, after losing the first example
// to a direct edit/delete): navigating to the example's OWN id forks a fresh
// copy and redirects, so the master is never directly editable through the
// app — every entry point (landing card AND raw URL) produces a copy. Only
// mounts on the example id (Page decides); for any other id it renders the
// real canvas untouched.
export function ExampleForkGuard() {
  const router = useRouter()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const id = await forkExampleCanvas(getPasscode())
        if (!cancelled) router.replace(`/c/${id}`)
      } catch {
        // Passcode missing/wrong or store hiccup — send them home to the
        // example card, which surfaces the passcode prompt properly.
        if (!cancelled) {
          setFailed(true)
          router.replace('/')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: color.navBg,
        color: color.textSecondary,
        fontFamily: typeTok.fontUi,
        fontSize: typeTok.base,
      }}
    >
      {failed ? 'Redirecting…' : `Opening your copy of ${EXAMPLE_CANVAS.title}…`}
    </div>
  )
}

'use client'

import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost, apiDelete } from '@/lib/api-client'
import { color, metric, type as typeTok, buttonPrimary, inputField } from '@/lib/design'
import { IconX } from '@/components/icons'
import { MediaLabMark } from '@/components/TopNav'
import { ConfirmDialog } from '@/components/ConfirmDialog'

// Task 17: "Your canvases" reads the same `gm-recent` localStorage list
// TopNav.tsx maintains (id/label/at, cap 10) — TopNav is the sole WRITER
// (upsertRecent runs on mount of a canvas page); this page only reads it
// and removes entries on delete. loadRecent/removeRecentEntry are
// duplicated locally rather than imported/exported because TopNav's
// helpers are intentionally module-private and this read/remove-only
// contract is small and stable enough not to be worth a shared module for.
const RECENT_KEY = 'gm-recent'

interface RecentEntry {
  id: string
  label: string
  at: number
}

function loadRecent(): RecentEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function removeRecentEntry(id: string): RecentEntry[] {
  const list = loadRecent().filter((e) => e.id !== id)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  }
  return list
}

function formatRelativeTime(at: number): string {
  const diffMin = Math.round((Date.now() - at) / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}

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
  const [recent, setRecent] = useState<RecentEntry[]>([])

  // Task 17: recents live only in localStorage (no server-side canvas
  // list), so this has to be a mount-time client read, same as TopNav's own
  // mount effect. Runs once — this page isn't scoped to a single canvas, so
  // there's no id/rename dependency to react to like TopNav has.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(loadRecent())
  }, [])

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

  // Task 17B: id of the canvas pending delete confirmation, or null when the
  // dialog is closed — replaces the old window.confirm() gate.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Task 17: mirrors TopNav.tsx's onDeleteCanvas exactly — confirm, DELETE
  // via apiDelete (which already treats a 404 as a successful delete for
  // an already-gone canvas), then drop the entry from the local list. No
  // navigation on success since we're already on the landing page.
  // Task 17B: the ✕ click now just opens the confirm dialog; the actual
  // delete moves to `deleteCanvas`, invoked from the dialog's confirm.
  const requestDeleteCanvas = (id: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setConfirmDeleteId(id)
  }

  const deleteCanvas = async (id: string) => {
    try {
      await apiDelete(`/api/canvas/${id}`)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed.')
      return
    }
    setRecent(removeRecentEntry(id))
  }

  const confirmDelete = () => {
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    if (id) void deleteCanvas(id)
  }

  const hasRecent = recent.length > 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // Empty state stays the original hero-only, dead-centered layout;
        // once there are recents, the page anchors to the top and scrolls
        // so the grid below the hero has room to grow past 10 entries.
        justifyContent: hasRecent ? 'flex-start' : 'center',
        overflowY: hasRecent ? 'auto' : 'hidden',
        padding: hasRecent ? '64px 24px 48px' : 0,
        boxSizing: 'border-box',
        background: color.navBg,
        color: color.text,
        fontFamily: typeTok.fontUi,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <MediaLabMark size={44} />
          <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: -0.5 }}>Media Lab</div>
        </div>
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

      {hasRecent && (
        <div style={{ width: '100%', maxWidth: 640, marginTop: 40, display: 'flex', flexDirection: 'column', gap: metric.gapMd }}>
          <div style={{ fontSize: typeTok.secondary, color: color.textSecondary, fontWeight: 600 }}>Your canvases</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: metric.gapMd,
            }}
          >
            {recent.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/c/${entry.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    router.push(`/c/${entry.id}`)
                  }
                }}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  background: color.cardBg,
                  border: `1px solid ${color.border}`,
                  borderRadius: metric.radiusLg,
                  padding: metric.gapMd,
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                }}
              >
                <span
                  style={{
                    fontSize: typeTok.base,
                    color: color.text,
                    paddingRight: 20,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.label}
                </span>
                <span style={{ fontSize: typeTok.micro, color: color.textMuted }}>{formatRelativeTime(entry.at)}</span>
                <button
                  className="gm-icon-btn"
                  aria-label="delete canvas"
                  title="delete canvas"
                  onClick={(e) => requestDeleteCanvas(entry.id, e)}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    width: 22,
                    height: 22,
                    background: 'transparent',
                    color: color.textMuted,
                    border: 0,
                    borderRadius: metric.radiusSm,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ fontSize: typeTok.micro, color: color.textMuted }}>
            This list is saved in your browser — canvases stay available at their links.
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete this canvas?"
        body="The link will stop working for anyone who has it."
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  )
}

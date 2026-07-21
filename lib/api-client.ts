// Client-side fetch wrapper for /api/ops and /api/upload:
//  - attaches the shared passcode header (see lib/server-auth.ts)
//  - caps concurrent in-flight requests at 4 so a multi-variant runOp doesn't
//    hammer fal all at once (queued=false opts out, e.g. mask upload before
//    the ops call that depends on it)
let active = 0
const waiters: Array<() => void> = []

async function slot(): Promise<void> {
  if (active >= 4) await new Promise<void>((r) => waiters.push(r))
  active++
}

function release(): void {
  active--
  waiters.shift()?.()
}

export function getPasscode(): string {
  return typeof localStorage === 'undefined' ? '' : (localStorage.getItem('gm-passcode') ?? '')
}

// Task 15A: canvas delete from the TopNav switcher. Not queued — a one-off
// user action, not a burst of model calls like apiPost's callers. A 404
// (already-gone canvas — e.g. a stale recents entry, or a double-click race)
// is treated as a successful delete by the caller (brief: "404 from delete
// of already-gone canvas → treat as success"), not surfaced as an error —
// hence the distinct return shape instead of throwing on !res.ok for 404.
export async function apiDelete(path: string): Promise<{ ok: true } | { notFound: true }> {
  const res = await fetch(path, { method: 'DELETE', headers: { 'x-gm-passcode': getPasscode() } })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    throw Object.assign(new Error(json?.error?.message ?? res.statusText), {
      code: json?.error?.code,
      status: res.status,
    })
  }
  return { ok: true }
}

export async function apiPost<T>(path: string, body: unknown, queued = true): Promise<T> {
  if (queued) await slot()
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gm-passcode': getPasscode() },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) {
      throw Object.assign(new Error(json?.error?.message ?? res.statusText), {
        code: json?.error?.code,
        status: res.status,
      })
    }
    return json as T
  } finally {
    if (queued) release()
  }
}

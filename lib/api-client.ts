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

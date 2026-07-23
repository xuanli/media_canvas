// The showcase canvas (user 2026-07-22): a hand-built demo tree — Komos
// office → logo on the whiteboard (ref edge) → region edit → Xuan presenting
// at the desk, plus the SF bus-stop ad-swap branch.
//
// The MASTER canvas lives in the shared blob store under this id (built by
// Xuan via the local app, which writes to the same store production reads).
// The landing page's example card COPIES it on open — fetch master snapshot →
// create fresh canvas → PUT snapshot — so every visitor gets their own
// editable playground and nobody mutates the master. Updating the example =
// editing the master canvas; no code change needed.
export const EXAMPLE_CANVAS = {
  id: 'afvsn3s7clig',
  title: '[Example] Komos <> SF Marketing',
} as const

// Copy the master snapshot into a fresh canvas and return its id (or throw).
// Shared by the landing-page example card AND the /c/[id] fork-guard, so the
// master is never directly edited — every entry point forks. Stamps the
// example title into the snapshot's document record so the copy is named
// (the master's own name is blank). `passcode` header value is passed in by
// the caller (client has getPasscode()); a 401 rethrows with status so the
// caller can prompt.
export async function forkExampleCanvas(passcode: string): Promise<string> {
  const snapRes = await fetch(`/api/canvas/${EXAMPLE_CANVAS.id}`, { cache: 'no-store' })
  if (!snapRes.ok) throw new Error('The example canvas is unavailable right now.')
  const snapshot = await snapRes.json()
  try {
    const doc = snapshot?.document?.store?.['document:document']
    if (doc) doc.name = EXAMPLE_CANVAS.title
  } catch {
    // Non-fatal: an unexpected snapshot shape just yields an untitled copy.
  }
  const created = await fetch('/api/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gm-passcode': passcode },
    body: '{}',
  })
  if (created.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 })
  if (!created.ok) throw new Error('Could not create a canvas.')
  const { id } = (await created.json()) as { id: string }
  const put = await fetch(`/api/canvas/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-gm-passcode': passcode },
    body: JSON.stringify(snapshot),
  })
  if (put.status === 401) throw Object.assign(new Error('unauthorized'), { status: 401 })
  if (!put.ok) throw new Error('Could not copy the example canvas.')
  return id
}

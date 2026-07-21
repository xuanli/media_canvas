import { getSnapshot, type Editor } from 'tldraw'
import { getPasscode } from '@/lib/api-client'

// Debounced autosave: any 'document'-scope, 'user'-sourced store change
// (i.e. not tldraw's own remote-sync echoes, not ephemeral/presence state)
// schedules a save 2s out, coalescing bursts (multi-variant runOp, drags)
// into one PUT. `document.title` doubles as a lightweight dirty/error
// indicator so a stalled save is visible without dedicated UI.
export function startSaveSync(editor: Editor, canvasId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = async (opts?: { keepalive?: boolean }) => {
    document.title = '● gen_media'
    const body = JSON.stringify(getSnapshot(editor.store))
    // keepalive lets the flush request survive page unload, but browsers
    // reject keepalive requests with bodies over ~64KB — fall back to a
    // plain fetch for large snapshots (e.g. carrying unsynced data URLs)
    // rather than have the browser silently drop the whole request.
    const useKeepalive = Boolean(opts?.keepalive) && body.length <= 60_000
    // Fix round 2 (whole-branch review): a rejected fetch (offline, DNS
    // failure, CORS, an aborted keepalive request) previously threw out of
    // this async function uncaught — no title update, so a failed save
    // looked identical to a save still in flight. Catch it and surface the
    // same "not saved" title the non-ok-response branch already used below.
    try {
      const res = await fetch(`/api/canvas/${canvasId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-gm-passcode': getPasscode() },
        body,
        ...(useKeepalive ? { keepalive: true } : {}),
      })
      document.title = res.ok ? 'gen_media' : '⚠ gen_media (not saved)'
    } catch {
      document.title = '⚠ gen_media (not saved)'
    }
  }
  const unlisten = editor.store.listen(
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void save(), 2000)
    },
    { scope: 'document', source: 'user' }
  )
  // Flush path: cancel the pending debounce and save immediately with
  // keepalive, since a plain fetch started during unload gets aborted by the
  // browser before it completes. visibilitychange->hidden fires earlier and
  // more reliably than beforeunload (e.g. mobile tab-switch, app backgrounding)
  // so it's wired to the same flush.
  // Residual limitation: a snapshot big enough to skip keepalive (>60KB body,
  // e.g. unsynced data URLs) combined with an instant tab kill (not a normal
  // backgrounding/navigation) can still lose up to the last ~2s of edits —
  // the server still has the last successful debounced save, so this is a
  // small data-loss window on next load, not corruption.
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      void save({ keepalive: true })
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    unlisten()
    window.removeEventListener('beforeunload', flush)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

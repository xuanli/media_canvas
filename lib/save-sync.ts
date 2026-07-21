import { getSnapshot, type Editor } from 'tldraw'
import { getPasscode } from '@/lib/api-client'

// Debounced autosave: any 'document'-scope, 'user'-sourced store change
// (i.e. not tldraw's own remote-sync echoes, not ephemeral/presence state)
// schedules a save 2s out, coalescing bursts (multi-variant runOp, drags)
// into one PUT. `document.title` doubles as a lightweight dirty/error
// indicator so a stalled save is visible without dedicated UI.
export function startSaveSync(editor: Editor, canvasId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = async () => {
    document.title = '● gen_media'
    const body = JSON.stringify(getSnapshot(editor.store))
    const res = await fetch(`/api/canvas/${canvasId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-gm-passcode': getPasscode() },
      body,
    })
    document.title = res.ok ? 'gen_media' : '⚠ gen_media (not saved)'
  }
  const unlisten = editor.store.listen(
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 2000)
    },
    { scope: 'document', source: 'user' }
  )
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      void save()
    }
  }
  window.addEventListener('beforeunload', flush)
  return () => {
    unlisten()
    window.removeEventListener('beforeunload', flush)
  }
}

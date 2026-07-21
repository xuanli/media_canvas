import type { Editor } from 'tldraw'
import type { ImageNodeShape } from '@/components/ImageNodeShape'

// Bug fix (human-reported): a snapshot can capture an image-node mid-flight
// (status 'pending') if the tab was closed, refreshed, or crashed while a
// generate/edit/inpaint call was still in the air — the fetch that would
// eventually resolve that node belonged to the PREVIOUS page load and is
// gone. Loading that snapshot back (on mount, or via Import JSON) would
// otherwise show a spinner that never resolves. Sweep every such node to
// 'error' immediately after a snapshot loads so the existing Retry button +
// op-as-recipe (the op that would produce the node lives ON the node) can
// recover it — same recovery path as any other failed op.
//
// Moved to lib/ (v2 chrome, Task 14): both CanvasApp's mount effect and
// TopNav's JSON-import handler need this, and CanvasApp importing TopNav
// (to mount it) while TopNav imported this back from CanvasApp would be a
// circular module dependency — hoisting it out to a leaf module avoids that
// rather than relying on ESM circular-import semantics to save it.
export function sweepInterruptedNodes(editor: Editor): void {
  const stuck = editor
    .getCurrentPageShapes()
    .filter((s): s is ImageNodeShape => s.type === 'image-node' && s.props.status === 'pending')
  if (stuck.length === 0) return
  editor.updateShapes<ImageNodeShape>(
    stuck.map((s) => ({
      id: s.id,
      type: 'image-node',
      props: { status: 'error', errorCode: 'interrupted', errorMessage: 'Interrupted — press Retry' },
    }))
  )
}

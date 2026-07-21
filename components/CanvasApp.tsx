'use client'

import { Tldraw, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { PromptBar } from '@/components/PromptBar'
import { ActionMenu } from '@/components/ActionMenu'
import { Inspector } from '@/components/Inspector'
import { retryShape } from '@/lib/run-op'

export function CanvasApp({ canvasId }: { canvasId: string }) {
  const editorRef = useRef<Editor | null>(null)
  const onMount = useCallback((editor: Editor) => {
    editorRef.current = editor
  }, [])

  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<{ shapeId?: TLShapeId }>).detail?.shapeId
      if (editorRef.current && id) {
        retryShape(editorRef.current, id)
      }
    }
    window.addEventListener('gm:retry', h)
    return () => window.removeEventListener('gm:retry', h)
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0 }} data-canvas-id={canvasId}>
      {/* hideUi removes tldraw's default toolbar/menus (installed prop,
          verified in node_modules @tldraw/editor TldrawBaseProps) — our own
          verb UI (PromptBar now, node action menu in later tasks) replaces
          it. */}
      <Tldraw shapeUtils={[ImageNodeUtil]} onMount={onMount} hideUi>
        <PromptBar />
        <ActionMenu />
        <Inspector />
      </Tldraw>
    </div>
  )
}

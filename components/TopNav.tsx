'use client'

// v2 chrome (Task 14, user decision 2026-07-21): slim always-visible top nav.
// See docs/design/ux-directions.html §v2-chrome for the mockup this follows —
// wordmark · recent-canvas switcher (client-side, localStorage) · New ·
// Share-link · Export (JSON export/import, now moved here from CanvasApp's
// old top-right corner buttons, + PNG of the selected node) · save-state dot.

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { getSnapshot, loadSnapshot, useEditor, useValue } from 'tldraw'
import { apiPost } from '@/lib/api-client'
import { useUiStore } from '@/lib/ui-store'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import { sweepInterruptedNodes } from '@/lib/sweep-interrupted'

const RECENT_KEY = 'gm-recent'
const RECENT_CAP = 10

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

// Upserts canvasId to the front of the list (cap 10), used by TopNav's
// mount/label effect below. Exported shape kept internal — this is the only
// writer of `gm-recent`.
function upsertRecent(id: string, label: string): RecentEntry[] {
  const list = loadRecent().filter((e) => e.id !== id)
  list.unshift({ id, label, at: Date.now() })
  const capped = list.slice(0, RECENT_CAP)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RECENT_KEY, JSON.stringify(capped))
  }
  return capped
}

const navBar: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: 34,
  zIndex: 400,
  background: '#181c22',
  borderBottom: '1px solid #2d3540',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  fontSize: 11,
  color: '#dfe5ec',
  fontFamily: 'ui-monospace, monospace',
}

const navBtn: CSSProperties = {
  background: 'transparent',
  color: '#dfe5ec',
  border: '1px solid #2d3540',
  borderRadius: 5,
  padding: '4px 8px',
  fontSize: 10.5,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const dropdown: CSSProperties = {
  position: 'absolute',
  top: 32,
  zIndex: 401,
  background: '#181c22',
  border: '1px solid #2d3540',
  borderRadius: 6,
  padding: 4,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 160,
  boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
}

const dropdownItem: CSSProperties = {
  background: 'transparent',
  color: '#dfe5ec',
  border: 0,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

export function TopNav({ canvasId }: { canvasId: string }) {
  const editor = useEditor()
  const router = useRouter()
  const saveState = useUiStore((s) => s.saveState)

  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Recent-canvas list (hard rule): id + label from the first root node's
  // prompt if present, else id + timestamp. `useValue` tracks the first root
  // reactively (createdAt-earliest node with sourceId===null) so the label
  // upgrades from "just the id" to the real prompt the moment generate/
  // upload's optimistic node lands, without a manual re-check.
  const rootPrompt = useValue(
    'topnav-root-prompt',
    () => {
      const roots = editor
        .getCurrentPageShapes()
        .filter((s): s is ImageNodeShape => s.type === 'image-node' && s.props.sourceId === null)
        .sort((a, b) => a.props.createdAt - b.props.createdAt)
      const first = roots[0]
      const op = first?.props.op
      return op && 'prompt' in op && op.prompt ? op.prompt : null
    },
    [editor]
  )

  // This effect *is* the mount/update hook into localStorage (an external
  // system), not a pure state mirror of React state — same precedent as the
  // pick-detection effect in the old Inspector.tsx. It fires once on mount
  // and again whenever the reactive `rootPrompt` (read from the tldraw
  // store) resolves from null to the canvas' actual first-root prompt, which
  // is exactly "updated on canvas mount" per the brief plus the one-time
  // upgrade from an id-only label to the real one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(upsertRecent(canvasId, (rootPrompt ?? canvasId).slice(0, 40)))
  }, [canvasId, rootPrompt])

  useEffect(() => {
    return () => {
      if (importErrorTimerRef.current) clearTimeout(importErrorTimerRef.current)
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current)
    }
  }, [])

  const currentLabel = recent.find((e) => e.id === canvasId)?.label ?? canvasId

  const onNewCanvas = async () => {
    setCreating(true)
    try {
      const { id } = await apiPost<{ id: string }>('/api/canvas', {}, false)
      router.push(`/c/${id}`)
    } catch {
      setCreating(false)
    }
  }

  const onShare = () => {
    void navigator.clipboard.writeText(location.href).then(() => {
      setShareCopied(true)
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current)
      shareTimerRef.current = setTimeout(() => setShareCopied(false), 2000)
    })
  }

  const onExportJson = () => {
    const snapshot = getSnapshot(editor.store)
    const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'gen-media-canvas.json'
    a.click()
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  const onImportChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same filename twice in a row
    if (!file) return
    if (importErrorTimerRef.current) {
      clearTimeout(importErrorTimerRef.current)
      importErrorTimerRef.current = null
    }
    try {
      const snapshot = JSON.parse(await file.text())
      loadSnapshot(editor.store, snapshot)
      sweepInterruptedNodes(editor)
      setImportError(null)
    } catch {
      setImportError('Import failed: not a valid canvas file')
      importErrorTimerRef.current = setTimeout(() => setImportError(null), 4000)
    }
    setExportOpen(false)
  }

  const selectedDone = useValue(
    'topnav-selected-done',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      const shape = s as ImageNodeShape
      return shape.props.status === 'done' ? shape.props.assetUrl : null
    },
    [editor]
  )

  const onExportPng = () => {
    if (!selectedDone) return
    const a = document.createElement('a')
    a.href = selectedDone
    a.download = 'gen-media-node.png'
    a.click()
    setExportOpen(false)
  }

  const saveDot =
    saveState === 'saved'
      ? { color: '#7ec9a2', label: '● saved' }
      : saveState === 'saving'
        ? { color: '#e0c05c', label: '◐ saving' }
        : { color: '#d98d80', label: '⚠ not saved' }

  return (
    <div style={navBar}>
      <span style={{ fontWeight: 600 }}>gen_media</span>

      <div style={{ position: 'relative' }}>
        <button style={navBtn} onClick={() => setSwitcherOpen((v) => !v)}>
          {currentLabel} ▾
        </button>
        {switcherOpen && (
          <div style={dropdown}>
            {recent.length === 0 && <div style={{ ...dropdownItem, color: '#5b6472' }}>No recent canvases</div>}
            {recent.map((e) => (
              <button
                key={e.id}
                style={{ ...dropdownItem, color: e.id === canvasId ? '#2dd4bf' : '#dfe5ec' }}
                onClick={() => {
                  setSwitcherOpen(false)
                  if (e.id !== canvasId) router.push(`/c/${e.id}`)
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span style={{ flex: 1 }} />

      <button style={navBtn} onClick={() => void onNewCanvas()} disabled={creating}>
        {creating ? 'Creating…' : '+ New canvas'}
      </button>
      <button style={navBtn} onClick={onShare}>
        {shareCopied ? 'copied ✓' : 'Share'}
      </button>

      <div style={{ position: 'relative' }}>
        <button style={navBtn} onClick={() => setExportOpen((v) => !v)}>
          Export ▾
        </button>
        {exportOpen && (
          <div style={{ ...dropdown, right: 0 }}>
            <button style={dropdownItem} onClick={onExportJson}>
              Export JSON
            </button>
            <button style={dropdownItem} onClick={() => fileInputRef.current?.click()}>
              Import JSON
            </button>
            <button
              style={{ ...dropdownItem, color: selectedDone ? '#dfe5ec' : '#5b6472', cursor: selectedDone ? 'pointer' : 'not-allowed' }}
              onClick={onExportPng}
              disabled={!selectedDone}
              title={selectedDone ? undefined : 'select a finished node first'}
            >
              PNG of selected node
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => void onImportChange(e)}
              style={{ display: 'none' }}
            />
          </div>
        )}
      </div>

      <span style={{ color: saveDot.color, fontSize: 10.5 }}>{saveDot.label}</span>

      {importError && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 12,
            background: '#2a1414',
            color: '#ff9c9c',
            border: '1px solid #5a2a2a',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            maxWidth: 220,
            zIndex: 401,
          }}
        >
          {importError}
        </div>
      )}
    </div>
  )
}

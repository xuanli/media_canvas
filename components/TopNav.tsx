'use client'

// v2 chrome (Task 14, user decision 2026-07-21): slim always-visible top nav.
// See docs/design/ux-directions.html §v2-chrome for the mockup this follows —
// wordmark · recent-canvas switcher (client-side, localStorage) · New ·
// Share-link · Export (JSON export/import, now moved here from CanvasApp's
// old top-right corner buttons, + PNG of the selected node) · save-state dot.
//
// Task 15A (user feedback 2026-07-21): reordered per user #1 ("New canvas"
// moves next to the switcher) — left cluster is now wordmark · canvas name
// (click-to-edit) · switcher ▾ · + New, right cluster stays Share · Export ▾
// · save dot. Canvas name is stored in the tldraw document record (see
// commitCanvasName below) so it travels in the snapshot/share link. Switcher
// rows gained a delete ✕ (confirm -> DELETE /api/canvas/:id -> remove from
// recents -> if it was the current canvas, navigate home).

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSnapshot, loadSnapshot, useEditor, useValue } from 'tldraw'
import { apiPost, apiDelete } from '@/lib/api-client'
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

// Task 15A: the only writer of a removal from `gm-recent` (delete flow).
function removeRecentEntry(id: string): RecentEntry[] {
  const list = loadRecent().filter((e) => e.id !== id)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  }
  return list
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

const navInput: CSSProperties = {
  background: '#0f1216',
  color: '#dfe5ec',
  border: '1px solid #2dd4bf',
  borderRadius: 5,
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'inherit',
  width: 160,
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
  minWidth: 200,
  boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
}

const dropdownRowBtn: CSSProperties = {
  background: 'transparent',
  color: '#dfe5ec',
  border: 0,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

const dropdownDeleteBtn: CSSProperties = {
  background: 'transparent',
  color: '#8a95a3',
  border: 0,
  borderRadius: 4,
  width: 20,
  height: 20,
  cursor: 'pointer',
  fontSize: 11,
  flexShrink: 0,
}

// Task 15A wordmark (user #4): a small "2 nodes + edge" motif echoing the
// canvas's own node/arrow language, 16px, decorative (aria-hidden — the
// adjacent "gen media" text carries the accessible name via the parent
// link).
function WordmarkGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <line x1="4" y1="12" x2="12" y2="4" stroke="#2dd4bf" strokeWidth="1.5" />
      <circle cx="4" cy="12" r="2.5" fill="#181c22" stroke="#2dd4bf" strokeWidth="1.5" />
      <circle cx="12" cy="4" r="2.5" fill="#2dd4bf" />
    </svg>
  )
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

  // Task 15A: canvas name click-to-edit state.
  const [editingCanvasName, setEditingCanvasName] = useState(false)
  const [canvasNameDraft, setCanvasNameDraft] = useState('')

  // Task 15A: canvas name lives in the tldraw document record (verified in
  // the installed @tldraw/editor 5.2.5: `editor.getDocumentSettings():
  // TLDocument` / `editor.updateDocumentSettings(partial)`, backed by a real
  // store record with scope 'document' — so it serializes into
  // getSnapshot() output and travels with the share link, and
  // save-sync.ts's `store.listen({ scope: 'document', source: 'user' })`
  // already picks up changes to it for autosave with no changes needed
  // there). Default is '' (tlschema's DocumentRecordType default).
  const canvasName = useValue('topnav-canvas-name', () => editor.getDocumentSettings().name, [editor])

  // Recent-canvas list (hard rule): label = canvas name when non-empty, else
  // the first root node's prompt, else the id. `useValue` tracks the first
  // root reactively (createdAt-earliest node with sourceId===null) so the
  // label upgrades from "just the id" to the real prompt the moment
  // generate/upload's optimistic node lands, without a manual re-check; the
  // canvasName value tracked above does the same for renames.
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
  // and again whenever canvasName or the reactive rootPrompt resolve to a
  // better label — exactly "refresh on mount and on rename" per the brief.
  useEffect(() => {
    const label = canvasName && canvasName.trim() ? canvasName : (rootPrompt ?? canvasId)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(upsertRecent(canvasId, label.slice(0, 40)))
  }, [canvasId, rootPrompt, canvasName])

  useEffect(() => {
    return () => {
      if (importErrorTimerRef.current) clearTimeout(importErrorTimerRef.current)
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current)
    }
  }, [])

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

  // Task 15A: canvas rename handlers — same Enter-commits/Esc-cancels
  // contract as CommandBar's node rename, undoable-by-default is moot here
  // (updateDocumentSettings runs with history:'ignore' internally per the
  // installed Editor.ts — a global-settings write, not a shape edit).
  const startEditCanvasName = () => {
    setCanvasNameDraft(canvasName ?? '')
    setEditingCanvasName(true)
  }

  const commitCanvasName = () => {
    editor.updateDocumentSettings({ name: canvasNameDraft.trim() })
    setEditingCanvasName(false)
  }

  const cancelEditCanvasName = () => setEditingCanvasName(false)

  const onCanvasNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.stopPropagation()
      commitCanvasName()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      cancelEditCanvasName()
    }
  }

  // Task 15A: delete a canvas from the switcher dropdown. `e.stopPropagation()`
  // keeps the click off the row's own switch-canvas button underneath it.
  const onDeleteCanvas = async (id: string, e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!window.confirm('Delete this canvas? The link will stop working.')) return
    try {
      await apiDelete(`/api/canvas/${id}`) // resolves for both real deletes and an already-gone 404
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed.')
      return
    }
    setRecent(removeRecentEntry(id))
    if (id === canvasId) router.push('/')
  }

  const saveDot =
    saveState === 'saved'
      ? { color: '#7ec9a2', label: '● saved' }
      : saveState === 'saving'
        ? { color: '#e0c05c', label: '◐ saving' }
        : { color: '#d98d80', label: '⚠ not saved' }

  return (
    <div style={navBar}>
      <Link
        href="/"
        title="all canvases · home"
        style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dfe5ec', textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}
      >
        <WordmarkGlyph />
        <span>gen media</span>
      </Link>

      {editingCanvasName ? (
        <input
          autoFocus
          value={canvasNameDraft}
          onChange={(e) => setCanvasNameDraft(e.target.value)}
          onKeyDown={onCanvasNameKeyDown}
          onBlur={cancelEditCanvasName}
          placeholder="untitled canvas"
          style={navInput}
        />
      ) : (
        <span
          onClick={startEditCanvasName}
          title="click to rename this canvas"
          style={{
            cursor: 'text',
            color: canvasName ? '#dfe5ec' : '#5b6472',
            fontStyle: canvasName ? 'normal' : 'italic',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {canvasName || 'untitled canvas'}
        </span>
      )}

      <div style={{ position: 'relative' }}>
        <button style={navBtn} onClick={() => setSwitcherOpen((v) => !v)} title="recent canvases">
          ▾
        </button>
        {switcherOpen && (
          <div style={dropdown}>
            {recent.length === 0 && <div style={{ ...dropdownItem, color: '#5b6472' }}>No recent canvases</div>}
            {recent.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <button
                  style={{ ...dropdownRowBtn, color: e.id === canvasId ? '#2dd4bf' : '#dfe5ec' }}
                  onClick={() => {
                    setSwitcherOpen(false)
                    if (e.id !== canvasId) router.push(`/c/${e.id}`)
                  }}
                >
                  {e.label}
                </button>
                <button
                  style={dropdownDeleteBtn}
                  title="delete this canvas"
                  onClick={(ev) => void onDeleteCanvas(e.id, ev)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button style={navBtn} onClick={() => void onNewCanvas()} disabled={creating}>
        {creating ? 'Creating…' : '+ New canvas'}
      </button>

      <span style={{ flex: 1 }} />

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

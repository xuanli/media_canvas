'use client'

// Task 19b (inline build): the assets popover behind the idle bar's
// "Add image" button. Three tabs:
//   Upload new  — file → POST /api/assets (durable library copy) → root node
//   Your assets — per-browser library (localStorage 'gm-assets'; blob objects
//                 are durable, discovery is per-browser — same honest model as
//                 canvas recents)
//   Presets     — shipped set from lib/preset-assets.ts
//
// Preset/asset → canvas routing: model APIs (fal) must be able to FETCH the
// image, so relative/localhost preset URLs can't be used directly as node
// assetUrls. Picking a preset rasterizes it client-side (canvas → PNG dataURL;
// also converts the SVG logo, which /api/upload's PNG/JPEG magic-byte check
// would otherwise reject) and uploads to fal storage for an absolute URL.
// User-library assets already carry absolute blob URLs (or dataURLs in
// STORAGE_MOCK) and drop straight in.
//
// Scope cut (noted for the record): assets drop as ROOT NODES only (idle
// mood). Attaching an asset directly as an Edit reference stays via the
// existing pick-a-node flow — drop the asset first, then pick it.

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useEditor, type TLShapeId } from 'tldraw'
import { createUploadedRoot } from '@/lib/run-op'
import { apiPost, apiDelete } from '@/lib/api-client'
import { PRESET_ASSETS } from '@/lib/preset-assets'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IconUpload, IconX } from '@/components/icons'
import { color, metric, type as typeTokens, elevation, buttonSecondary } from '@/lib/design'

const ASSETS_KEY = 'gm-assets'
type UserAsset = { id: string; url: string; name: string; at: number }

function loadAssets(): UserAsset[] {
  if (typeof localStorage === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(ASSETS_KEY) ?? '[]') as UserAsset[]
  } catch {
    return []
  }
}
function saveAssets(list: UserAsset[]) {
  try {
    localStorage.setItem(ASSETS_KEY, JSON.stringify(list))
  } catch {
    // quota (mock-mode dataURLs can be large) — library entry lost, node unaffected
  }
}

// Rasterize any same-origin image URL (incl. SVG) to a PNG dataURL at natural size.
function rasterizeToPngDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || 1024
      c.height = img.naturalHeight || 1024
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('no canvas context'))
      ctx.drawImage(img, 0, 0)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('could not load image'))
    img.src = url
  })
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  background: active ? color.overlayBg : 'transparent',
  color: active ? color.text : color.textSecondary,
  border: 'none',
  borderRadius: metric.radius - 2,
  padding: '5px 10px',
  fontSize: typeTokens.secondary,
  fontFamily: typeTokens.fontUi,
  cursor: 'pointer',
})

export function AssetsPopover({
  open,
  onClose,
  onPlaced,
}: {
  open: boolean
  onClose: () => void
  /** Called with the created node's id after an asset lands on the canvas —
   *  used by the Edit tray to auto-attach the new node as a reference. */
  onPlaced?: (id: TLShapeId) => void
}) {
  const editor = useEditor()
  const [tab, setTab] = useState<'upload' | 'yours' | 'presets'>('upload')
  // Assets derive from localStorage at render time (sync, cheap) — a version
  // counter re-derives after mutations. Avoids setState-in-effect lint.
  const [assetsVersion, setAssetsVersion] = useState(0)
  const assets = open ? loadAssets() : []
  void assetsVersion
  const [busy, setBusy] = useState<string | null>(null) // slug/id currently placing
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Dismissal: outside pointerdown + Escape (same capture-phase pattern as
  // TopNav's menus; stopPropagation only while open so the global Esc
  // layering is untouched otherwise).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, { capture: true })
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true })
      document.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [open, onClose])

  if (!open) return null

  const placeFromUrl = async (key: string, url: string, name: string) => {
    setBusy(key)
    setError(null)
    try {
      const nodeId = await createUploadedRoot(editor, url, name)
      onPlaced?.(nodeId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not place image')
    } finally {
      setBusy(null)
    }
  }

  const placePreset = async (slug: string, url: string, name: string) => {
    setBusy(slug)
    setError(null)
    try {
      const dataUrl = await rasterizeToPngDataUrl(url)
      const up = await apiPost<{ url: string }>('/api/upload', { dataUrl }, false)
      const nodeId = await createUploadedRoot(editor, up.url, name)
      onPlaced?.(nodeId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not place preset')
    } finally {
      setBusy(null)
    }
  }

  const onUploadNew = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('upload')
    setError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('could not read the file'))
        reader.readAsDataURL(file)
      })
      const res = await apiPost<{ id: string; url: string }>('/api/assets', { dataUrl }, false)
      const name = file.name.replace(/\.[^.]+$/, '')
      saveAssets([{ id: res.id, url: res.url, name, at: Date.now() }, ...loadAssets()])
      setAssetsVersion((v) => v + 1)
      const nodeId = await createUploadedRoot(editor, res.url, file.name)
      onPlaced?.(nodeId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setBusy(null)
    }
  }

  const deleteAsset = async (id: string) => {
    try {
      await apiDelete(`/api/assets/${id}`)
    } catch {
      // treat as gone either way; library list is the source of discovery
    }
    saveAssets(loadAssets().filter((a) => a.id !== id))
    setAssetsVersion((v) => v + 1)
  }

  const thumb = (src: string, name: string, key: string, onPick: () => void, onDelete?: () => void) => (
    <div key={key} style={{ position: 'relative' }} className="gm-thumb-wrap">
      <button
        onClick={onPick}
        disabled={busy !== null}
        title={`add "${name}" to the canvas`}
        style={{
          width: 92,
          height: 64,
          padding: 0,
          border: `1px solid ${color.border}`,
          borderRadius: metric.radius - 2,
          overflow: 'hidden',
          background: color.overlayBg,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy === key ? 0.5 : 1,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- plain img for arbitrary data/blob URLs */}
        <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </button>
      {onDelete && (
        <button
          aria-label="delete asset"
          className="gm-thumb-detach"
          onClick={onDelete}
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            width: 18,
            height: 18,
            borderRadius: 9,
            border: 'none',
            background: 'rgba(0,0,0,0.65)',
            color: color.text,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <IconX size={10} />
        </button>
      )}
      <div
        style={{
          fontSize: 10,
          color: color.textSecondary,
          fontFamily: typeTokens.fontUi,
          marginTop: 2,
          maxWidth: 92,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {name}
      </div>
    </div>
  )

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="add image"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 10px)',
        left: 0,
        width: 336,
        background: color.navBg,
        border: `1px solid ${color.border}`,
        borderRadius: metric.radiusLg,
        boxShadow: elevation.bar,
        padding: 10,
        zIndex: 350,
      }}
    >
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={(e) => void onUploadNew(e)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        <button style={tabBtn(tab === 'upload')} onClick={() => setTab('upload')}>Upload new</button>
        <button style={tabBtn(tab === 'yours')} onClick={() => setTab('yours')}>Your assets</button>
        <button style={tabBtn(tab === 'presets')} onClick={() => setTab('presets')}>Presets</button>
      </div>

      {tab === 'upload' && (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          style={{ ...buttonSecondary({ disabled: busy !== null }), width: '100%', height: 64, justifyContent: 'center' }}
        >
          <IconUpload size={16} />
          {busy === 'upload' ? 'Uploading…' : 'Choose a PNG or JPEG'}
        </button>
      )}

      {tab === 'yours' &&
        (assets.length === 0 ? (
          <div style={{ fontSize: typeTokens.secondary, color: color.textSecondary, fontFamily: typeTokens.fontUi, padding: '14px 4px' }}>
            Nothing here yet — images you upload are saved to your library automatically.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
            {assets.map((a) =>
              thumb(a.url, a.name, a.id, () => void placeFromUrl(a.id, a.url, a.name), () => setConfirmId(a.id))
            )}
          </div>
        ))}

      {tab === 'presets' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PRESET_ASSETS.map((p) => thumb(p.url, p.name, p.slug, () => void placePreset(p.slug, p.url, p.name)))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: typeTokens.secondary, color: color.danger, fontFamily: typeTokens.fontUi }}>{error}</div>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        title="Delete this asset?"
        body="It will be removed from your library. Nodes already on canvases keep their images."
        danger
        onConfirm={() => {
          const id = confirmId
          setConfirmId(null)
          if (id) void deleteAsset(id)
        }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  )
}

'use client'

// Assets drawer (user 2026-07-21, replaces AssetsPopover): a left-anchored
// panel below the nav — ONE merged collection: shipped presets (tagged, not
// deletable) + everything the user uploads (deletable). Modes via ui-store:
//   'add'    — clicking an asset drops it onto the canvas as a root node
//   'attach' — same, then auto-attaches the new node as the Edit reference
//              (via pendingRefAttach, consumed by CommandBar)
// Upload lives at the top of the drawer; uploads land in the library AND on
// the canvas in one step.
//
// Same fal-reachability routing as before: presets (relative URLs, incl. the
// SVG logo) are rasterized client-side to PNG and pushed through /api/upload
// for an absolute URL; user assets already carry absolute (or mock-data) URLs.

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useEditor } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { createUploadedRoot } from '@/lib/run-op'
import { apiPost, apiDelete } from '@/lib/api-client'
import { PRESET_ASSETS } from '@/lib/preset-assets'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { IconUpload, IconX } from '@/components/icons'
import { color, metric, type as typeTok, elevation, buttonSecondary } from '@/lib/design'

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
    // quota (mock-mode dataURLs) — library entry lost, canvas node unaffected
  }
}

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

type Item = { key: string; url: string; name: string; preset: boolean; deletableId?: string }

export function AssetsDrawer() {
  const editor = useEditor()
  const { assetsDrawer, setAssetsDrawer, setPendingRefAttach, setPickingRef } = useUiStore()
  const open = assetsDrawer !== null
  const [assetsVersion, setAssetsVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  void assetsVersion

  const close = () => {
    if (assetsDrawer === 'attach') setPickingRef(false) // combined-mode rule
    setAssetsDrawer(null)
  }

  // Escape closes (capture-phase, consumed so the global Esc layering
  // doesn't also deselect/disarm underneath the drawer).
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable-enough (store setters)
  }, [open, assetsDrawer])

  // Persistent edge handle (user 2026-07-21): the drawer can always be
  // opened/collapsed from a slim tab on the left edge, independent of the
  // Upload / + Reference entry points.
  const handle = (
    <button
      aria-label={open ? 'collapse assets' : 'open assets'}
      onClick={() => (open ? close() : setAssetsDrawer('add'))}
      style={{
        position: 'absolute',
        top: '50%',
        left: open ? 272 : 0,
        transform: 'translateY(-50%)',
        zIndex: 451,
        width: 18,
        height: 64,
        border: `1px solid ${color.border}`,
        borderLeft: open ? undefined : 'none',
        borderRadius: '0 8px 8px 0',
        background: color.navBg,
        color: color.textSecondary,
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
      }}
      title={open ? 'collapse assets' : 'assets'}
    >
      <span style={{ fontSize: 10, transform: open ? 'rotate(180deg)' : undefined }}>›</span>
    </button>
  )

  if (!open) return handle

  const items: Item[] = [
    ...loadAssets().map((a) => ({ key: a.id, url: a.url, name: a.name, preset: false, deletableId: a.id })),
    ...PRESET_ASSETS.map((p) => ({ key: p.slug, url: p.url, name: p.name, preset: true })),
  ]

  const finishPlace = (nodeId: string) => {
    if (assetsDrawer === 'attach') setPendingRefAttach(nodeId)
    setAssetsDrawer(null)
  }

  const place = async (item: Item) => {
    setBusy(item.key)
    setError(null)
    try {
      let url = item.url
      if (item.preset) {
        const dataUrl = await rasterizeToPngDataUrl(item.url)
        url = (await apiPost<{ url: string }>('/api/upload', { dataUrl }, false)).url
      }
      const nodeId = await createUploadedRoot(editor, url, item.name)
      finishPlace(nodeId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not place image')
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
      finishPlace(nodeId)
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
      // list is the source of discovery; treat as gone
    }
    saveAssets(loadAssets().filter((a) => a.id !== id))
    setAssetsVersion((v) => v + 1)
  }

  return (
    <>
    {handle}
    <div
      role="dialog"
      aria-label="assets"
      style={{
        position: 'absolute',
        top: 44,
        bottom: 0,
        left: 0,
        width: 272,
        zIndex: 450,
        background: color.navBg,
        borderRight: `1px solid ${color.border}`,
        boxShadow: elevation.bar,
        display: 'flex',
        flexDirection: 'column',
        padding: 12,
        gap: 10,
      }}
    >
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" onChange={(e) => void onUploadNew(e)} style={{ display: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: typeTok.secondary, fontWeight: 600, flex: 1 }}>
          Assets{assetsDrawer === 'attach' ? ' — pick a reference' : ''}
        </div>
        <button
          aria-label="close assets"
          onClick={close}
          style={{ background: 'none', border: 'none', color: color.textSecondary, cursor: 'pointer', padding: 4 }}
        >
          <IconX size={14} />
        </button>
      </div>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        style={{ ...buttonSecondary({ disabled: busy !== null }), width: '100%', justifyContent: 'center' }}
      >
        <IconUpload size={14} />
        {busy === 'upload' ? 'Uploading…' : 'Upload image'}
      </button>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 10, alignContent: 'flex-start' }}>
        {items.map((item) => (
          <div key={item.key} style={{ position: 'relative' }} className="gm-thumb-wrap">
            <button
              onClick={() => void place(item)}
              disabled={busy !== null}
              title={assetsDrawer === 'attach' ? `use "${item.name}" as the reference` : `add "${item.name}" to the canvas`}
              style={{
                width: 116,
                height: 78,
                padding: 0,
                border: `1px solid ${color.border}`,
                borderRadius: metric.radius,
                overflow: 'hidden',
                background: color.overlayBg,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy === item.key ? 0.5 : 1,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary data/blob URLs */}
              <img src={item.url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
            {item.deletableId && (
              <button
                aria-label="delete asset"
                className="gm-thumb-detach"
                onClick={() => setConfirmId(item.deletableId ?? null)}
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, maxWidth: 116 }}>
              <span
                style={{
                  fontSize: 10,
                  color: color.textSecondary,
                  fontFamily: typeTok.fontUi,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                }}
              >
                {item.name}
              </span>
              {item.preset && (
                <span style={{ fontSize: 8, color: color.textMuted, border: `1px solid ${color.border}`, borderRadius: 3, padding: '0 3px' }}>
                  preset
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <div style={{ fontSize: typeTok.secondary, color: color.danger }}>{error}</div>}
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
    </>
  )
}

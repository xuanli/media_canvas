'use client'

import { Tldraw, loadSnapshot, useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { TopNav } from '@/components/TopNav'
import { CommandBar } from '@/components/CommandBar'
import { AssetsDrawer } from '@/components/AssetsDrawer'
import { PasscodeGate } from '@/components/PasscodeGate'
import { createLocalImageRoot, createUploadedRoot, retryShape } from '@/lib/run-op'
import { rasterizeToPngDataUrl } from '@/components/AssetsDrawer'
import { startSaveSync } from '@/lib/save-sync'
import { useUiStore } from '@/lib/ui-store'
import { sweepInterruptedNodes } from '@/lib/sweep-interrupted'
import { ConnectOverlay } from '@/components/overlays/ConnectOverlay'
import { canvasPaint, color, metric, type as typeTok } from '@/lib/design'
import { getStoredTheme } from '@/components/ThemeToggle'
import { IconFit, IconMinus, IconPlus } from '@/components/icons'

export function CanvasApp({ canvasId }: { canvasId: string }) {
  const editorRef = useRef<Editor | null>(null)

  // Loads the stored snapshot (if any — a fresh/never-saved id, e.g. the
  // permanent `/c/local` demo id, 404s and just starts empty) then hands off
  // to startSaveSync for debounced autosave. Returning the stop function lets
  // tldraw's TLOnMountHandler run it as unmount cleanup (confirmed present in
  // the installed 5.2.5 types: `onMount?(editor): (() => void) | void`).
  const onMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      // Force dark mode (human-reported: canvas was rendering tldraw's light
      // theme, clashing with the rest of the app's dark chrome).
      // `editor.user.updateUserPreferences` is the documented source of
      // truth for the color-mode preference (5.2.5 TLUserPreferences.
      // colorScheme: 'dark'|'light'|'system' — verified in the installed
      // @tldraw/editor types); setting it here always wins over the OS
      // theme, unlike a `system`-following prop. Set synchronously so the
      // first paint is already dark, not just after the snapshot fetch.
      // Theme support (user 2026-07-21): was a hard-forced 'dark'. The canvas
      // now follows the app theme (localStorage 'gm-theme', dark default) —
      // ThemeToggle flips this preference live on toggle, this line only
      // seeds the initial mount so first paint matches the chrome.
      editor.user.updateUserPreferences({ colorScheme: getStoredTheme() })

      // Design-critique item 2 fix. Root cause (found by tracing the actual
      // render path, not guessing): tldraw 5.2.5's selection ring, resize/
      // rotate handles, and marquee-select fill are NOT CSS-driven at all —
      // they're painted on an HTML canvas by ShapeIndicatorOverlayUtil /
      // ShapeHandleOverlayUtil / SelectionForegroundOverlayUtil (installed
      // `tldraw` package, src/lib/overlays/*.ts), which read
      // `editor.getCurrentTheme().colors[mode].selectionStroke` /
      // `.selectedContrast` / `.selectionFill` via `ctx.strokeStyle` /
      // `ctx.fillStyle` — plain JS property reads, never `getComputedStyle`
      // or a CSS custom property. That's why BOTH the original `:root`
      // override AND the first attempt at scoping it to `.tl-container`
      // (still kept in app/globals.css for the DOM-rendered bits that DO
      // read `--tl-color-selected`, e.g. text-shape selection styling) were
      // real no-ops for the ring/handles specifically — there was no CSS
      // path to intercept. The actual fix is the theme API:
      // `editor.updateTheme` (confirmed in the installed
      // @tldraw/editor Editor.ts — merges into ThemeManager's registered
      // 'default' theme, which `getCurrentTheme()` resolves by color mode).
      // Overrides both light and dark palettes (dark is forced above, but a
      // future toggle back to light/system shouldn't silently reintroduce
      // tldraw's blue).
      const defaultTheme = editor.getTheme('default')
      if (defaultTheme) {
        // canvasPaint (not color): these feed ctx.strokeStyle/fillStyle —
        // canvas paint can't resolve the CSS var() strings the color tokens
        // became in the theme conversion (2026-07-21).
        const selectionOverride = {
          selectionStroke: canvasPaint.accent,
          selectedContrast: canvasPaint.accentText,
          selectionFill: canvasPaint.selectionFill, // accent-tinted marquee/brush fill
        }
        editor.updateTheme({
          ...defaultTheme,
          colors: {
            ...defaultTheme.colors,
            // Light canvas bg matches globals.css --gm-body-bg (light): a
            // real step darker than the white cards/bars so they pop —
            // tldraw's own near-white default made the chrome look washed
            // out (user 2026-07-21 light-theme contrast pass).
            light: { ...defaultTheme.colors.light, ...selectionOverride, background: '#e7eaef' },
            dark: { ...defaultTheme.colors.dark, ...selectionOverride },
          },
        })
      }

      // Bug fix (user-reported 2026-07-21): deleting a node left its bound
      // arrows dangling on the canvas. tldraw removes the BINDING when a bound
      // shape is deleted, but keeps the arrow shape itself. Cascade-delete
      // every arrow bound to a deleted image-node (both directions: parent
      // edges and ref edges). The image-node type guard prevents recursion
      // when the arrows themselves are then deleted.
      const stopCascade = editor.sideEffects.registerBeforeDeleteHandler('shape', (shape) => {
        if (shape.type !== 'image-node') return
        // getBindingsInvolvingShape (not just ...ToShape): belt-and-braces
        // across binding directions; arrow shape id is binding.fromId. The
        // registered before-delete point still sees the bindings (tldraw
        // removes them after shape before-delete handlers run).
        const arrowIds = [...new Set(editor.getBindingsInvolvingShape(shape.id, 'arrow').map((b) => b.fromId))]
        if (arrowIds.length) editor.deleteShapes(arrowIds)
      })

      let stopSaveSync: (() => void) | null = null
      let cancelled = false
      void (async () => {
        try {
          const res = await fetch(`/api/canvas/${canvasId}`, { cache: 'no-store' })
          if (res.ok) {
            const snapshot = await res.json()
            loadSnapshot(editor.store, snapshot)
            sweepInterruptedNodes(editor)
          }
        } catch {
          // Network error: fall through and start empty, same as a 404.
        }
        if (!cancelled) stopSaveSync = startSaveSync(editor, canvasId)
      })()
      return () => {
        cancelled = true
        stopCascade()
        stopSaveSync?.()
      }
    },
    [canvasId]
  )

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

  // Global Esc layering (Task 12 polish): one level backs out per press.
  // `useUiStore.getState()` (not the `useUiStore()` hook) deliberately reads
  // fresh state at *keypress* time instead of subscribing — this listener is
  // attached once (empty deps) rather than re-attached on every armedTool /
  // pickingRef change. It runs alongside use-drag-rect.ts's own Escape
  // listener (scoped to the mounted Crop/RegionOverlay, which also clears
  // the in-progress rect); both may fire on the same keypress and both end
  // up disarming — redundant but idempotent, not a double-disarm.
  //
  // Task 18: inserted a new intermediate tier for the unified Edit's region
  // mode, BEFORE the generic armedTool-disarm tier — while Edit is armed
  // with "Select region" on, the first Esc only turns regionMode off (back
  // to whole-image edit, tray stays armed); a second Esc (regionMode now
  // false) falls through to the generic tier and disarms the tray. This is
  // the "region-drag Esc clears region first, then tray" layering from the
  // brief. RegionOverlay's own use-drag-rect listener does the same
  // regionMode-off (not armedTool-null) on the same keypress — redundant
  // but idempotent, matching the pattern this comment already documented
  // for Crop.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const { pickingRef, setPickingRef, armedTool, setArmedTool, regionMode, setRegionMode, setCropFrac, connectFrom, setConnectFrom } =
        useUiStore.getState()
      // Connect-in-flight is the topmost tier: Esc cancels the pending
      // connection (ConnectOverlay renders nothing once cleared) before any
      // pick/region/tool disarm logic runs.
      if (connectFrom) {
        setConnectFrom(null)
        return
      }
      if (pickingRef) {
        setPickingRef(false)
        return
      }
      if (armedTool === 'edit' && regionMode) {
        setRegionMode(false)
        setCropFrac(null)
        return
      }
      if (armedTool) {
        setArmedTool(null)
        return
      }
      editorRef.current?.selectNone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drag-drop onto the canvas (user 2026-07-21): accepts (a) asset-drawer
  // tiles (custom MIME set in AssetsDrawer's onDragStart) and (b) OS image
  // files. Capture phase so this wins over tldraw's own external-content
  // drop handling (which would create a raw tldraw image shape outside the
  // node model). preventDefault/stopPropagation run synchronously; the
  // upload/placement work continues async after.
  const onCanvasDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer.types
    if (t.includes('application/x-gm-asset') || t.includes('Files')) {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'copy'
    }
  }
  const onCanvasDrop = (e: React.DragEvent) => {
    const editor = editorRef.current
    if (!editor) return
    const gm = e.dataTransfer.getData('application/x-gm-asset')
    const file = e.dataTransfer.files?.[0]
    if (!gm && !file) return
    e.preventDefault()
    e.stopPropagation()
    const at = editor.screenToPage({ x: e.clientX, y: e.clientY })
    void (async () => {
      try {
        if (gm) {
          const item = JSON.parse(gm) as { url: string; name: string; preset?: boolean }
          // Perceived-speed rework (user 2026-07-21): presets/files place
          // instantly from the local dataURL and sync to blob in the
          // background; library assets place an immediate pending
          // placeholder that fills in as the image loads.
          if (item.preset) {
            await createLocalImageRoot(editor, await rasterizeToPngDataUrl(item.url), item.name, { at })
          } else {
            await createUploadedRoot(editor, item.url, item.name, { at })
          }
        } else if (file && file.type.startsWith('image/')) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('could not read the file'))
            reader.readAsDataURL(file)
          })
          await createLocalImageRoot(editor, dataUrl, file.name, { at })
        }
      } catch {
        // Drop is a convenience path — the drawer/upload buttons surface
        // errors; a failed drop just doesn't place a node.
      }
    })()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0 }}
      data-canvas-id={canvasId}
      onDragOverCapture={onCanvasDragOver}
      onDropCapture={onCanvasDrop}
    >
      <PasscodeGate>
        {/* hideUi removes tldraw's default toolbar/menus (installed prop,
            verified in node_modules @tldraw/editor TldrawBaseProps) — our own
            chrome (TopNav + CommandBar, v2 chrome Task 14) replaces it. */}
        <Tldraw
          shapeUtils={[ImageNodeUtil]}
          onMount={onMount}
          hideUi
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          // Double-clicking empty canvas creates a text shape by default —
          // stray text shapes make no sense in an image-node canvas.
          options={{ createTextOnCanvasDoubleClick: false }}
          // User 2026-07-21: tldraw's right-click context menu still renders
          // under hideUi and exposes ops that bypass this app's model (Move
          // to page, Export as, …). Nulling the component override is the
          // supported removal (ContextMenu?: ComponentType | null, verified
          // in the installed 5.2.5 TLUiComponents).
          components={{ ContextMenu: null }}
        >
          <TopNav canvasId={canvasId} />
          <CommandBar />
        <AssetsDrawer />
          <EmptyHint />
          <ZoomCluster />
          <ConnectOverlay />
        </Tldraw>
      </PasscodeGate>
    </div>
  )
}

// Empty-canvas hint (polish): reactive over the store so it disappears the
// instant a first node is created (pending or done — the point is "you've
// started", not "generation finished").
function EmptyHint() {
  const editor = useEditor()
  const empty = useValue(
    'canvas-empty',
    () => editor.getCurrentPageShapes().every((s) => s.type !== 'image-node'),
    [editor]
  )
  if (!empty) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: '42%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 100,
        color: color.textMuted,
        fontFamily: typeTok.fontUi,
        fontSize: typeTok.base,
        pointerEvents: 'none',
        textAlign: 'center',
      }}
    >
      Type a prompt below to generate your first image
    </div>
  )
}

// Task 15B: zoom cluster — [−] [percent, click resets to 100%] [+] [Fit].
// tldraw camera APIs (verified against the installed 5.2.5 @tldraw/editor
// types: editor.zoomIn/zoomOut/resetZoom/zoomToFit/zoomToSelection,
// editor.getZoomLevel()) mirror exactly what tldraw's own (hidden)
// zoom-in/zoom-out/zoom-to-100/zoom-to-fit/zoom-to-selection actions call
// internally (src/lib/ui/context/actions.tsx in the installed package) —
// same calls, same animation option shape, just our own chrome instead of
// tldraw's default UI. Cmd+=/Cmd+- keep working independently of this
// component: hideUi only skips mounting TldrawUiContent, but TldrawUiInner
// still calls useKeyboardShortcuts() unconditionally ("Keyboard
// shortcuts... should always be mounted, even when the UI is hidden" —
// installed TldrawUi.tsx comment), so no shortcut re-wiring is needed or
// attempted here.
//
// Task 15D (user feedback 2026-07-21): moved BOTTOM-RIGHT -> BOTTOM-LEFT.
// All layout-critical box-model props (position/bottom/left/z-index) live in
// `.gm-zoom-cluster` (app/globals.css), not this component's inline style,
// specifically so that CSS file's collision-avoidance media queries can
// override `bottom`/`left` per breakpoint. See that file for the current
// mirrored collision math against CommandBar's centered bar and the
// re-derived <=1020px lift constant (Task 18: the tallest tray is now the
// unified Edit tray with "Select region" on AND a rect drawn — Inpaint no
// longer exists as its own armed tool — re-measured at 317px, taller than
// Task 15D's armed-'inpaint' 292px because of the new "region locked"
// badge line; the lift was re-derived from fresh measurements, not assumed
// unchanged).
//
// Fix round 1 (review finding — layout collision, historical): this cluster
// and CommandBar's centered bar (up to 720px wide, same bottom row) can
// overlap below ~1104px viewport width — the bar stays at its 720px max
// until the viewport is only 744px wide, at which point it already spans to
// within 12px of each edge, leaving no horizontal room for anything else in
// that row. Two CSS-only breakpoints (`.gm-zoom-cluster`/`.gm-zoom-percent`
// in app/globals.css) close every gap, chosen from that same 720px/12px
// math rather than guessed — see app/globals.css for the exact thresholds
// (unchanged in value by the bottom-left move, since the bar is centered
// and the collision math is symmetric left<->right) and the current lift
// constant's derivation.
function ZoomCluster() {
  const assetsDrawerOpen = useUiStore((st) => st.assetsDrawer !== null)
  const editor = useEditor()
  const zoom = useValue('zoom-cluster-level', () => editor.getZoomLevel(), [editor])
  const hasSelection = useValue(
    'zoom-cluster-has-selection',
    () => editor.getSelectedShapeIds().length > 0,
    [editor]
  )
  const percent = Math.round(zoom * 100)

  const btnStyle = {
    width: metric.controlH,
    height: metric.controlH,
    padding: 0,
    background: 'transparent',
    color: color.textSecondary,
    border: 0,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const

  return (
    <div
      // Layout-critical box-model props (position/bottom/right/z-index) live
      // in the `.gm-zoom-cluster` CSS class, not this inline style object,
      // specifically so the collision-avoidance media queries in
      // app/globals.css can override `bottom` per breakpoint without an
      // !important fight against an inline style.
      className={`gm-zoom-cluster${assetsDrawerOpen ? " gm-zoom-cluster--shifted" : ""}`}
      title={`Zoom: ${percent}%`}
      // Vertical stack (user 2026-07-21): +, %, −, Fit top-to-bottom; the
      // between-button separators moved from borderLeft to borderTop.
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        background: color.barBg,
        border: `1px solid ${color.border}`,
        borderRadius: metric.radius,
        overflow: 'hidden',
        fontFamily: typeTok.fontUi,
        fontSize: typeTok.secondary,
        boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      }}
    >
      <button
        className="gm-icon-btn gm-zoom-plus"
        style={btnStyle}
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => editor.zoomIn(undefined, { animation: { duration: 120 } })}
      >
        <IconPlus size={14} />
      </button>
      <button
        className="gm-icon-btn gm-zoom-percent"
        style={{
          ...btnStyle,
          width: '100%',
          borderTop: `1px solid ${color.border}`,
          color: color.text,
          fontVariantNumeric: 'tabular-nums',
          fontSize: 10,
        }}
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100%"
        onClick={() => editor.resetZoom(undefined, { animation: { duration: 120 } })}
      >
        {percent}%
      </button>
      <button
        className="gm-icon-btn"
        style={{ ...btnStyle, borderTop: `1px solid ${color.border}` }}
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => editor.zoomOut(undefined, { animation: { duration: 120 } })}
      >
        <IconMinus size={14} />
      </button>
      <button
        className="gm-icon-btn"
        style={{ ...btnStyle, borderTop: `1px solid ${color.border}` }}
        aria-label={hasSelection ? 'Fit to selection' : 'Fit to content'}
        title={hasSelection ? 'Fit to selection' : 'Fit to content'}
        onClick={() =>
          hasSelection
            ? editor.zoomToSelection({ animation: { duration: 200 } })
            : editor.zoomToFit({ animation: { duration: 200 } })
        }
      >
        <IconFit size={14} />
      </button>
    </div>
  )
}

'use client'

import { Tldraw, loadSnapshot, useEditor, useValue, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { useCallback, useEffect, useRef } from 'react'
import { ImageNodeUtil } from '@/components/ImageNodeShape'
import { TopNav } from '@/components/TopNav'
import { CommandBar } from '@/components/CommandBar'
import { AssetsDrawer } from '@/components/AssetsDrawer'
import { PasscodeGate } from '@/components/PasscodeGate'
import { retryShape } from '@/lib/run-op'
import { startSaveSync } from '@/lib/save-sync'
import { useUiStore } from '@/lib/ui-store'
import { sweepInterruptedNodes } from '@/lib/sweep-interrupted'
import { color, metric, type as typeTok } from '@/lib/design'
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
      editor.user.updateUserPreferences({ colorScheme: 'dark' })

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
        const selectionOverride = {
          selectionStroke: color.accent,
          selectedContrast: color.accentText,
          selectionFill: 'rgba(45, 212, 191, 0.20)', // accent-tinted marquee/brush fill
        }
        editor.updateTheme({
          ...defaultTheme,
          colors: {
            ...defaultTheme.colors,
            light: { ...defaultTheme.colors.light, ...selectionOverride },
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
      const { pickingRef, setPickingRef, armedTool, setArmedTool, regionMode, setRegionMode, setCropFrac } =
        useUiStore.getState()
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

  return (
    <div style={{ position: 'fixed', inset: 0 }} data-canvas-id={canvasId}>
      <PasscodeGate>
        {/* hideUi removes tldraw's default toolbar/menus (installed prop,
            verified in node_modules @tldraw/editor TldrawBaseProps) — our own
            chrome (TopNav + CommandBar, v2 chrome Task 14) replaces it. */}
        <Tldraw
          shapeUtils={[ImageNodeUtil]}
          onMount={onMount}
          hideUi
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        >
          <TopNav canvasId={canvasId} />
          <CommandBar />
        <AssetsDrawer />
          <EmptyHint />
          <ZoomCluster />
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
      className="gm-zoom-cluster"
      title={`Zoom: ${percent}%`}
      style={{
        display: 'flex',
        alignItems: 'center',
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
        className="gm-icon-btn"
        style={btnStyle}
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => editor.zoomOut(undefined, { animation: { duration: 120 } })}
      >
        <IconMinus size={14} />
      </button>
      <button
        className="gm-icon-btn gm-zoom-percent"
        style={{
          ...btnStyle,
          width: 48,
          borderLeft: `1px solid ${color.border}`,
          borderRight: `1px solid ${color.border}`,
          color: color.text,
          fontVariantNumeric: 'tabular-nums',
        }}
        aria-label="Reset zoom to 100%"
        title="Reset zoom to 100%"
        onClick={() => editor.resetZoom(undefined, { animation: { duration: 120 } })}
      >
        {percent}%
      </button>
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
        className="gm-icon-btn"
        style={{ ...btnStyle, width: 'auto', padding: '0 10px', gap: 6, borderLeft: `1px solid ${color.border}` }}
        aria-label={hasSelection ? 'Fit to selection' : 'Fit to content'}
        title={hasSelection ? 'Fit to selection' : 'Fit to content'}
        onClick={() =>
          hasSelection
            ? editor.zoomToSelection({ animation: { duration: 200 } })
            : editor.zoomToFit({ animation: { duration: 200 } })
        }
      >
        <IconFit size={14} />
        Fit
      </button>
    </div>
  )
}

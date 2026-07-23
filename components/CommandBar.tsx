'use client'

// v2 chrome (Task 14, user decision 2026-07-21): the single bottom command
// bar replacing PromptBar + ActionMenu + Inspector — "Bar B" from
// docs/design/ux-directions.html §barB. Three moods, one component:
//   IDLE     — nothing selected: upload + generate (was PromptBar).
//   SELECTED — a node selected, no armedTool: recipe line + verb row (was
//              ActionMenu's floating menu + the top of Inspector's panel).
//   ARMED    — a verb armed: the calm bar morphs into a tray with that
//              verb's full controls, verb row pinned at the tray bottom (was
//              the rest of Inspector's panel).
//
// PORTING NOTE (per task-14 brief, "hard rules"): every effect/handler below
// marked "[PORTED VERBATIM from Inspector.tsx]" is copied with its guards
// intact, not simplified — each guard exists because a prior review found a
// real bug (see the comments inline, kept from the original). The only
// changes are (a) the state now lives in one component with three render
// branches instead of Inspector always rendering when `sel` is truthy, and
// (b) `sel` being null no longer short-circuits with an early `return null`
// before the hooks — hooks must stay unconditional either way, so this is
// not actually a behavior change, just carried forward faithfully.

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import { useUiStore } from '@/lib/ui-store'
import { runOp, runInstantOp, createLocalImageRoot } from '@/lib/run-op'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import type { RectFrac } from '@/lib/types'
import { ModelSelect } from '@/components/ModelSelect'
import { frameShape } from '@/lib/camera'
import { color, metric, type as typeTok, buttonPrimary, buttonSecondary, inputField, textareaField, stepButton, elevation } from '@/lib/design'
import { IconDownload, IconUpload, IconX } from '@/components/icons'

// ── Ported verbatim from Inspector.tsx (task-10/11 fix-round comments kept) ──

const ASPECT_PRESETS = [
  ['4:5', 4 / 5],
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['free', null],
] as const

function fitToAspect(
  naturalW: number,
  naturalH: number,
  ratio: number,
  current: RectFrac | null
): RectFrac {
  if (current && current.w * naturalW > 4 && current.h * naturalH > 4) {
    const cw = current.w * naturalW
    const ch = current.h * naturalH
    const cx = current.x * naturalW + cw / 2
    const cy = current.y * naturalH + ch / 2
    let w = cw
    let h = w / ratio
    if (h > naturalH) {
      h = ch
      w = h * ratio
    }
    w = Math.min(w, naturalW)
    h = Math.min(h, naturalH)
    const x = Math.max(0, Math.min(naturalW - w, cx - w / 2))
    const y = Math.max(0, Math.min(naturalH - h, cy - h / 2))
    return { x: x / naturalW, y: y / naturalH, w: w / naturalW, h: h / naturalH }
  }
  let w = naturalW * 0.6
  let h = w / ratio
  if (h > naturalH * 0.9) {
    h = naturalH * 0.6
    w = h * ratio
  }
  const x = (naturalW - w) / 2
  const y = (naturalH - h) / 2
  return { x: x / naturalW, y: y / naturalH, w: w / naturalW, h: h / naturalH }
}

function cropTooSmall(frac: RectFrac | null, naturalW: number, naturalH: number): boolean {
  if (!frac) return true
  return frac.w * naturalW < 4 || frac.h * naturalH < 4
}

function fracToNaturalRect(f: RectFrac, naturalW: number, naturalH: number) {
  const x = Math.min(naturalW, Math.max(0, Math.round(f.x * naturalW)))
  const y = Math.min(naturalH, Math.max(0, Math.round(f.y * naturalH)))
  const w = Math.max(1, Math.min(naturalW - x, Math.round(f.w * naturalW)))
  const h = Math.max(1, Math.min(naturalH - y, Math.round(f.h * naturalH)))
  return { x, y, w, h }
}

// Mirrors lib/fal-registry.ts's `REGISTRY.edit.models` VISIBLE entries (i.e.
// excluding any `hidden: true` entry) — Task 16b removed flux-kontext from
// this list since 16a flagged it `hidden: true` in the registry (retired
// from the picker, still registered/callable). Both lists must be updated
// together when the registry's edit model set changes.
const EDIT_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana Pro' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'seedream-5-lite', label: 'Seedream 5 Lite' },
] as const

// Mirrors lib/fal-registry.ts's `REGISTRY.generate.models` — order/default
// (nano-banana first) matches `REGISTRY.generate.default`. Both lists must
// be updated together when the registry's generate model set changes.
const GENERATE_MODELS = [
  // FLUX 1.1 retired from the picker (user 2026-07-21) — same pattern as
  // flux-kontext in EDIT_MODELS: hidden in the registry, still registered/
  // callable so nodes created with it retry fine.
  { id: 'nano-banana', label: 'Nano Banana Pro' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'seedream-5-lite', label: 'Seedream 5 Lite' },
] as const

// verbs shown in both the SELECTED calm bar and pinned to the ARMED tray's
// bottom row (ActionMenu.tsx's VERBS list). Task 15D (user decision
// 2026-07-21): '✦ Vary' removed outright — it fired an immediate no-form
// edit op with no tray of its own, and the user asked for the verb gone
// entirely rather than hidden/disabled. Task 18 (user decision 2026-07-21,
// supersedes CLAUDE.md's earlier same-day "Edit and Inpaint stay SEPARATE"
// note): '✦ Inpaint' removed the same way — it's now the armed Edit tray's
// "Select region" toggle (see armedTool === 'edit' branch below), not its
// own verb.
const VERBS = [
  ['edit', '✦ Edit'],
  ['crop', 'Crop'],
  ['resize', 'Resize'],
  ['transform', 'Rotate/Flip'],
  ['adjust', 'Adjust'],
  ['redact', 'Redact'],
] as const

// ── Task 15B styling: built on lib/design.ts tokens (was ad-hoc inline
// objects — the source of the Upload/input/Generate height mismatch this
// task fixes: `field`/`primaryBtn`/the old Upload button override all now
// share the exact same `metric.controlH` (32px) instead of drifting). ──

// Task 15D: the bar now FLOATS above the canvas edge instead of sitting
// flush against it — bottom offset 12 -> 28, plus a soft elevation shadow
// (lib/design.ts's `elevation.bar`) to sell the raised framing. The
// <=960px watermark-clearance override in app/globals.css
// (`.gm-bar { bottom: 44px !important }`) still applies unchanged: 44 was
// already derived to clear the tldraw watermark's y-band with margin
// regardless of this component's own default bottom, so raising the
// default here doesn't need that derivation redone (44 > 28 either way).
const barShell: CSSProperties = {
  position: 'absolute',
  bottom: 28,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 300,
  width: 'min(720px, calc(100vw - 24px))',
  background: color.barBg,
  border: `1px solid ${color.border}`,
  borderRadius: metric.radiusLg,
  color: color.text,
  fontSize: typeTok.secondary,
  fontFamily: typeTok.fontUi,
  boxShadow: elevation.bar,
  // "simple CSS max-height/transform transition" (brief) for the tray
  // slide-up; disabled under prefers-reduced-motion via app/globals.css's
  // `.gm-bar` rule.
  overflow: 'hidden',
}

// Task 15D: bar padding 8 -> 10 (brief: "bar padding ... 10px" as part of
// the taller floating presence).
const BAR_PADDING = 10

const field: CSSProperties = inputField()

const stepBtn: CSSProperties = stepButton()

function verbBtnStyle(active: boolean, disabled: boolean): CSSProperties {
  // Token-fidelity fix (review finding): the pre-design-system verbBtnStyle
  // used a dedicated disabled-text literal (#5b6472, now color.textDisabled)
  // distinct from the muted/informational gray (color.textMuted) that
  // buttonSecondary() defaults to — restore that here via the explicit
  // override rather than changing the shared default (Upload's disabled
  // state and other buttonSecondary() call sites never had this literal).
  //
  // Design-critique item 8: `quiet: true` — the armed verb (this button when
  // `active` is the currently-armed tool) used to take a full solid-accent
  // fill, which combined with "Pick a node…" and Run being solid accent too
  // meant three filled-teal controls competing at once. accentDim + accent
  // text/border keeps the armed state legible while leaving solid
  // color.accent free for exactly one control (Run) per screen.
  return buttonSecondary({ active, disabled, disabledColor: color.textDisabled, quiet: true })
}

const TRAY_THUMB_SIZE = 48

// Task 15D: Edit/Inpaint tray-header thumbnails (source node always;
// reference node too, once attached to an armed Edit). Replaces the old
// text-only "ref: v{seq}" chip that used to live in the Edit form's control
// row — the detach button's accessible name ("remove reference") is
// preserved unchanged via `detachAriaLabel` so nothing that depended on
// that name (e2e, screen readers) sees a behavior change, just a different
// visual affordance. `onDetach` unset (source thumb) renders no detach
// button at all.
function TrayThumb({
  src,
  label,
  onDetach,
  detachAriaLabel,
}: {
  src?: string
  label: string
  onDetach?: () => void
  detachAriaLabel?: string
}) {
  return (
    <div
      className={onDetach ? 'gm-thumb-wrap' : undefined}
      style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center', width: TRAY_THUMB_SIZE }}
    >
      <div
        style={{
          position: 'relative',
          width: TRAY_THUMB_SIZE,
          height: TRAY_THUMB_SIZE,
          borderRadius: 4,
          overflow: 'hidden',
          background: color.fieldBg,
          border: `1px solid ${color.border}`,
          flexShrink: 0,
        }}
      >
        {src && (
          // tldraw asset/data URLs (mock uploads included) aren't
          // Next/Image compatible remote sources; every other node
          // thumbnail in this codebase (ImageNodeShape's AssetView)
          // already uses a plain <img> for the same reason.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
        {onDetach && (
          <button
            type="button"
            className="gm-icon-btn gm-thumb-detach"
            onClick={onDetach}
            title={detachAriaLabel}
            aria-label={detachAriaLabel}
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 16,
              height: 16,
              padding: 0,
              background: 'rgba(0,0,0,0.65)',
              border: 'none',
              borderRadius: 3,
              color: color.text,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <IconX size={10} />
          </button>
        )}
      </div>
      <span style={{ fontSize: 10, color: color.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: TRAY_THUMB_SIZE }}>
        {label}
      </span>
    </div>
  )
}

export function CommandBar() {
  const editor = useEditor()
  const { armedTool, setArmedTool, cropFrac, setCropFrac, pickingRef, setPickingRef, regionMode, setRegionMode , assetsDrawer, setAssetsDrawer, pendingRefAttach, setPendingRefAttach } =
    useUiStore()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(EDIT_MODELS[0].id)
  const [variants, setVariants] = useState(1)
  const [preset, setPreset] = useState<string>('free')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  // Adjust tray (2026-07-21 deterministic-tools batch): 100 = neutral,
  // CSS-filter percentage semantics. Re-seeded on every (re-)arm below.
  const [adjBrightness, setAdjBrightness] = useState(100)
  const [adjContrast, setAdjContrast] = useState(100)
  const [adjSaturation, setAdjSaturation] = useState(100)
  // Redact tray: blur radius / pixel block size in NATURAL px.
  const [redactMode, setRedactMode] = useState<'blur' | 'pixelate'>('blur')
  const [redactAmount, setRedactAmount] = useState(16)
  // Rotate/Flip tray (UX round 2): composed into one 'transform' op on Apply.
  const [xfDeg, setXfDeg] = useState<0 | 90 | 180 | 270>(0)
  const [xfFlipH, setXfFlipH] = useState(false)
  const [xfFlipV, setXfFlipV] = useState(false)
  // Multi-reference (user 2026-07-21): the Edit tray holds N references —
  // repeated + Reference picks append; multi-select normalizes into this.
  const [refIds, setRefIds] = useState<TLShapeId[]>([])

  // IDLE mood's own generate input — separate local state from `prompt`
  // (edit/inpaint's field) since the two moods are mutually exclusive but
  // this keeps a stray idle draft from leaking into an armed tool's prompt
  // or vice versa, matching PromptBar/Inspector having been separate
  // components with separate state before.
  const [genPrompt, setGenPrompt] = useState('')
  const [genModel, setGenModel] = useState<string>(GENERATE_MODELS[0].id)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const [uploadError, setUploadError] = useState<string | null>(null)

  // Task 15A: click-to-edit node name on the SELECTED recipe line.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const sel = useValue(
    'cmdbar-sel',
    () => {
      const s = editor.getOnlySelectedShape()
      if (!s || s.type !== 'image-node') return null
      return s as ImageNodeShape
    },
    [editor]
  )

  // Multi-select compose (user 2026-07-21): 2+ done image-nodes selected →
  // the bar enters a "combine" mood. First-selected acts as the base
  // (child hangs off it); the rest ride along as references. Selection
  // order is tldraw's selected-ids order.
  const multiSel = useValue(
    'cmdbar-multisel',
    () => {
      const shapes = editor
        .getSelectedShapes()
        .filter((s): s is ImageNodeShape => s.type === 'image-node' && (s as ImageNodeShape).props.status === 'done')
      return shapes.length >= 2 ? shapes : null
    },
    [editor]
  )

  // [PORTED VERBATIM from Inspector.tsx] Reset form state when selection
  // changes — including the crop rect, so a stale rect drawn on a
  // previously-selected node doesn't ghost onto the next one (cropFrac is
  // global ui-store state, not per-shape). See task-12-report.md Finding 1+2
  // for why this is SELECTION-DRIVEN (prevSelIdRef) rather than
  // pick-flag-driven, with restoringRef swallowing the effect's own
  // programmatic selection restores.
  const selId = sel?.id ?? null
  const editTargetIdRef = useRef<TLShapeId | null>(null)
  const prevSelIdRef = useRef<TLShapeId | null>(selId)
  const restoringRef = useRef(false)
  useEffect(() => {
    if (pickingRef) {
      const targetId = editTargetIdRef.current
      if (sel && targetId && sel.id !== targetId) {
        if (sel.props.status === 'done') {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setRefIds((prev) => (prev.includes(sel.id) ? prev : [...prev, sel.id]))
          setPickingRef(false)
          // combined-mode rule (2026-07-21): a canvas pick ends the ATTACH
          // half; the drawer itself stays open in browse mode (user pref).
          // getState() so this guarded effect's deps stay untouched.
          const st = useUiStore.getState()
          if (st.assetsDrawer === 'attach') st.setAssetsDrawer('add')
        }
        restoringRef.current = true
        editor.select(targetId)
      }
      prevSelIdRef.current = selId
      return
    }
    if (restoringRef.current) {
      restoringRef.current = false
      prevSelIdRef.current = selId
      return
    }
    if (selId !== prevSelIdRef.current) {
      setPrompt('')
      setModel(EDIT_MODELS[0].id)
      setVariants(1)
      setPreset('free')
      setCropFrac(null)
      setRefIds([])
      setEditingName(false)
      // Task 18 addition: a stale "Select region" toggle must not survive
      // onto a newly-selected node — armedTool itself isn't reset by this
      // effect (selecting a different node while Edit stays armed is
      // existing, intended behavior), so without this the region overlay
      // could stay armed against the new selection with no drawn rect.
      setRegionMode(false)
    }
    prevSelIdRef.current = selId
  }, [selId, pickingRef, sel, editor, setCropFrac, setPickingRef, setRegionMode])

  // Bug fix (user-reported 2026-07-21): selecting a node should land you
  // straight in Edit mode — selection intent IS edit intent. Keyed on
  // SELECTION CHANGE via autoArmedForRef (not "whenever no tool is armed"),
  // so Esc-closing the tray doesn't instantly re-open it; pickingRef guard
  // keeps the reference-pick flow from being hijacked; pending/error nodes
  // don't arm (nothing to edit yet) — but a pending node that finishes WHILE
  // selected arms then, which is the desirable "ready for you" moment.
  const autoArmedForRef = useRef<TLShapeId | null>(null)
  useEffect(() => {
    if (!sel) {
      autoArmedForRef.current = null
      return
    }
    if (sel.props.status !== 'done' || pickingRef) return
    if (autoArmedForRef.current === selId) return
    autoArmedForRef.current = selId
    if (armedTool === null) setArmedTool('edit')
  }, [selId, sel, pickingRef, armedTool, setArmedTool])

  // Assets-drawer 'attach' handoff (user 2026-07-21): the drawer placed an
  // asset as a root node and parked its id in ui-store; consume it into the
  // Edit form's reference slot. Placing a root doesn't change selection, so
  // the selId-reset effect can't race this.
  useEffect(() => {
    if (!pendingRefAttach) return
    const rid = pendingRefAttach as TLShapeId
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ordered handoff from the drawer, runs once per parked id (same pattern as the multi-select consume below)
    setRefIds((prev) => (prev.includes(rid) ? prev : [...prev, rid]))
    setPendingRefAttach(null)
    // combined-mode rule: an asset pick ends the canvas-pick half too
    setPickingRef(false)
  }, [pendingRefAttach, setPendingRefAttach, setPickingRef])

  // Multi-select normalization (user 2026-07-21: a separate multi-select
  // "combine" tray was strange — selecting 2+ nodes is just a fast way to
  // say base + references). Collapse the selection to the first-selected
  // (base) and queue the rest; they land as reference thumbs in the ONE
  // familiar Edit tray (auto-armed by the selection effect above). The
  // consume effect runs after the selection-reset effect has cleared state
  // for the new selection (declaration order = run order).
  const pendingMultiRefsRef = useRef<TLShapeId[] | null>(null)
  useEffect(() => {
    if (!multiSel) return
    const [base, ...rest] = multiSel
    pendingMultiRefsRef.current = rest.map((r) => r.id)
    editor.select(base.id)
  }, [multiSel, editor])
  useEffect(() => {
    const queued = pendingMultiRefsRef.current
    if (!queued || !selId) return
    pendingMultiRefsRef.current = null
     
    setRefIds((prev) => [...new Set([...prev, ...queued])])
  }, [selId])

  // [PORTED VERBATIM from Inspector.tsx] Clear the drawn region rect and any
  // in-progress prompt on EVERY armedTool change (tracked via a ref so
  // re-renders that leave armedTool unchanged don't wipe mid-typing state).
  // crop and inpaint both draw into the same `cropFrac` field; prompt is
  // local state shared across Edit/Inpaint forms.
  // Task 18 addition: also clear `regionMode` on every armedTool change —
  // otherwise leaving the Edit tray with "Select region" on and re-arming
  // Edit later (or arming crop/resize in between) would silently re-arm
  // RegionOverlay too, since ImageNodeShape.tsx's render gate is
  // `armedTool === 'edit' && regionMode` and regionMode is store state that
  // outlives any single armedTool value on its own.
  const prevArmedToolRef = useRef(armedTool)
  useEffect(() => {
    if (armedTool !== prevArmedToolRef.current) {
      setCropFrac(null)
      setPrompt('')
      setRefIds([])
      setRegionMode(false)
    }
    prevArmedToolRef.current = armedTool
  }, [armedTool, setCropFrac, setRegionMode])

  // [PORTED VERBATIM from Inspector.tsx] Resize form seeds from the shape's
  // natural size each time it's (re-)armed for this selection, but not on
  // every keystroke thereafter.
  useEffect(() => {
    if (armedTool !== 'resize' || !sel) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(sel.props.naturalW)
    setHeight(sel.props.naturalH)
  }, [armedTool, selId, sel])

  // Camera restore for the region-tools zoom-to-node flow (zoomToNode, in
  // the SELECTED branch below, saves into this ref): as soon as NO
  // region-drawing surface is active anymore — regardless of how it ended
  // (Esc via CanvasApp's global handler, the Select-region toggle, Apply/Run
  // clearing armedTool, or arming a non-region verb) — glide back to where
  // the user was. No-op when nothing was saved. Deliberately NOT restored on
  // deselect-while-armed (sel gone but tool still armed): the user has
  // clearly moved on, snapping the camera would fight them.
  const prevCameraRef = useRef<{ x: number; y: number; z: number } | null>(null)
  // User 2026-07-22: ALL tools zoom now, not just the region-drawing ones —
  // plain Edit (without region) is the one surface that keeps the camera.
  const zoomSurfaceActive =
    (armedTool !== null && armedTool !== 'edit') || (armedTool === 'edit' && regionMode)
  useEffect(() => {
    if (zoomSurfaceActive) return
    const c = prevCameraRef.current
    if (!c) return
    prevCameraRef.current = null
    editor.setCamera(c, { animation: { duration: 220 } })
  }, [zoomSurfaceActive, editor])

  // Rotate/Flip tray seeds back to identity each time it's (re-)armed.
  useEffect(() => {
    if (armedTool !== 'transform') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setXfDeg(0)
     
    setXfFlipH(false)
     
    setXfFlipV(false)
  }, [armedTool, selId])

  // Adjust tray seeds back to neutral each time it's (re-)armed for a
  // selection — same pattern as the resize seed above.
  useEffect(() => {
    if (armedTool !== 'adjust') return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdjBrightness(100)
     
    setAdjContrast(100)
     
    setAdjSaturation(100)
  }, [armedTool, selId])

  // Task 15D (user decision 2026-07-21): the '✦ Vary' verb — and the
  // no-form immediate-fire effect that used to live here — is REMOVED
  // outright, not disabled. It always dispatched `{ type: 'edit', ... }` (no
  // distinct 'vary' op type ever existed on a node's stored recipe), so
  // deleting this effect has no data migration implications: any node a
  // user previously created via Vary is stored and renders exactly like any
  // other edit-created node.

  // ── IDLE mood handlers (ported from PromptBar.tsx, plus new Upload) ──

  const go = () => {
    if (!genPrompt.trim()) return
    runOp(editor, null, { type: 'generate', prompt: genPrompt, model: genModel })
    setGenPrompt('')
  }

  const onUploadChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('could not read the file'))
        reader.readAsDataURL(file)
      })
      // Perceived-speed rework (user 2026-07-21): node appears instantly
      // from the local dataURL; the blob upload runs in the background
      // inside createLocalImageRoot ('unsynced' badge on failure).
      await createLocalImageRoot(editor, dataUrl, file.name)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Hooks are all unconditional above this point; only rendering branches
  // below, same rule Inspector followed with its `if (!sel) return null`.
  if (!sel) {
    // NOTE: no `position` override on the div below — barShell is
    // position:absolute and must stay so (a prior inline edit set relative
    // for the popover anchor, which knocked the whole bar to the top of the
    // page; absolute elements are already positioning anchors).
    return (
      <div
        style={{
          ...barShell,
          padding: BAR_PADDING,
          // Prompt-bar redesign (user 2026-07-21: "not super well designed"):
          // the old single row squeezed Upload | textarea | select | button
          // side by side. Now the prompt is the hero — a full-width,
          // borderless-looking field on top — with a quiet control row
          // underneath (Upload left; model + Generate right), the layout
          // convention of modern prompt bars.
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          // barShell's overflow:hidden exists for the ARMED tray's slide
          // animation; the idle bar must NOT clip — the assets popover
          // renders above the bar (bottom: 100% + 10px) and would be
          // invisible under overflow:hidden (user-reported: "where is it?").
          overflow: 'visible',
        }}
        className="gm-bar"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => void onUploadChange(e)}
          style={{ display: 'none' }}
        />
        {/* Enter submits; Shift+Enter inserts a newline (kept from Task 20). */}
        <textarea
          className="gm-input"
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              go()
            }
          }}
          placeholder="Describe an image to create…  (Enter to run, Shift+Enter for a new line)"
          rows={2}
          autoFocus
          style={{ ...textareaField({ large: true }), width: '100%', minHeight: 64, resize: 'none' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* User 2026-07-21: this Upload is the DIRECT path — file picker
              straight to a canvas root node (onUploadChange ends in
              createUploadedRoot), distinct from the assets drawer (which
              keeps its own handle for browsing assets/presets). Accessible
              name stays "Upload" for the E2E selector. */}
          <button
            className="gm-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={buttonSecondary({ disabled: uploading, active: false })}
            title="upload an image straight onto the canvas"
          >
            <IconUpload size={14} />
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <span style={{ flex: 1 }} />
          <ModelSelect value={genModel} onChange={setGenModel} options={GENERATE_MODELS} ariaLabel="generate model" />
          {/* "Run", not "Generate" (user 2026-07-21) — also matches the
              armed Edit tray's primary button, so both moods share one verb. */}
          <button
            className="gm-btn"
            onClick={go}
            disabled={!genPrompt.trim()}
            style={buttonPrimary({ disabled: !genPrompt.trim() })}
          >
            Run
          </button>
        </div>
        {uploadError && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 6,
              background: '#2a1414',
              color: '#ff9c9c',
              border: '1px solid #5a2a2a',
              borderRadius: metric.radius,
              padding: '4px 8px',
              fontSize: typeTok.micro,
            }}
          >
            {uploadError}
          </div>
        )}
      </div>
    )
  }

  const p = sel.props
  const op = p.op
  const opModel = 'model' in op ? op.model : undefined
  const opPrompt = 'prompt' in op ? op.prompt : undefined
  // User-reported 2026-07-21: a still-generating node offered the full Edit
  // tray (armedTool survives selection change, and only crop/resize were
  // gated). EVERY tool now waits for a done node; `toolReady` below also
  // suppresses the armed-tray render for pending/error nodes.
  const gatedTools = new Set(['edit', 'crop', 'resize', 'transform', 'adjust', 'redact'])
  const toolReady = p.status === 'done'

  // Task 18: "region active" — the Edit tray's "Select region" toggle is on
  // AND a real (non-trivial) rect has actually been drawn. Drives the run
  // routing (edit vs. inpaint op), the model-select/+Reference locks, and
  // the "region locked" badge — all from this one boolean so they can never
  // disagree with each other or with what Run is about to dispatch.
  const regionActive = regionMode && !!cropFrac && !cropTooSmall(cropFrac, p.naturalW, p.naturalH)

  // [PORTED VERBATIM from Inspector.tsx handlers]

  const startPick = () => {
    editTargetIdRef.current = sel.id
    setPickingRef(true)
  }

  // Task 15A: rename is a normal (undoable) update — unlike the
  // history:'ignore' status transitions in run-op.ts's dispatch(), a rename
  // is a direct user edit, not an async settle of something already on the
  // undo stack, so it belongs on the stack like any other prop edit.
  const startEditName = () => {
    setNameDraft(sel.props.name ?? '')
    setEditingName(true)
  }

  const commitName = () => {
    editor.updateShape<ImageNodeShape>({ id: sel.id, type: 'image-node', props: { name: nameDraft.trim() } })
    setEditingName(false)
  }

  const cancelEditName = () => {
    setEditingName(false)
  }

  const onNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // stopPropagation so Enter/Escape here don't also reach
    // CanvasApp.tsx's global Escape listener (which would disarm/deselect —
    // the brief is explicit this edit must not bubble into that layering).
    if (e.key === 'Enter') {
      e.stopPropagation()
      commitName()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      cancelEditName()
    }
  }

  const resolveRef = (id: string) => {
    const s = editor.getShape(id as TLShapeId)
    return s && s.type === 'image-node' ? s.props.assetUrl : undefined
  }



  // Task 18: unified Run — routes by whether a region is active (see
  // `regionActive` above), UNCHANGED schema/dispatch either way (run-op.ts's
  // runOp/dispatch handle both branches).
  // Task 21: the region branch now dispatches model: 'gpt-image-2' (was
  // 'flux-fill', removed from the registry entirely — see
  // lib/fal-registry.ts) and — new — passes referenceNodeId/refFromId
  // through exactly like the whole-image edit branch below, since
  // gpt-image-2 is reference-capable (region + reference is now possible in
  // one call; FLUX Fill never supported a reference image at all).
  const runEdit = () => {
    if (!prompt.trim()) return
    if (regionActive) {
      const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
      // Soft-region support (user 2026-07-21): the SELECTED model rides
      // along, no longer hardcoded to gpt-image-2 — run-op's inpaint
      // dispatch picks the strategy per model (gpt-image-2 → pixel mask;
      // others → red-box annotated image + instruction prompt).
      runOp(
        editor,
        sel.id,
        { type: 'inpaint', prompt, model, rect, referenceNodeIds: refIds.length ? [...refIds] : undefined },
        variants,
        resolveRef,
        undefined,
        refIds.length ? [...refIds] : undefined
      )
    } else {
      runOp(
        editor,
        sel.id,
        { type: 'edit', prompt, model, referenceNodeIds: refIds.length ? [...refIds] : undefined },
        variants,
        resolveRef,
        undefined,
        refIds.length ? [...refIds] : undefined
      )
    }
    setArmedTool(null)
    setPrompt('')
    setVariants(1)
    setRefIds([])
    setCropFrac(null)
    setRegionMode(false)
  }

  // Task 18: toggles the "Select region" mode. Turning it ON clears any
  // attached reference (regions and references are mutually exclusive per
  // the brief's locks — this covers the case where a ref was attached
  // BEFORE the toggle, not just after). Turning it OFF (or re-toggling)
  // also clears any drawn rect, matching "clearing region restores both"
  // (model picker + reference button re-enable once regionActive goes
  // false).
  // Region-drawing tools zoom the target node to center-stage first (user
  // 2026-07-21: "make the targeted node center and big so the user knows
  // where to select"). Round 2 fixes (user: "zoom too much? the box cover
  // some of node" / "after I press esc, should we return back"):
  //   - zoom is CAPPED at 1.5x — plain zoomToBounds fit a small node to the
  //     whole viewport (observed 615%);
  //   - the node centers in the VISIBLE area (bar ~330px + nav ~60px
  //     reserved), not the raw viewport, so the armed tray doesn't sit on
  //     top of it;
  //   - the pre-zoom camera is remembered (prevCameraRef, declared with the
  //     unconditional hooks above the !sel early-return) and restored by the
  //     effect up there when the region tool is dismissed however that
  //     happens (Esc, toggle off, Apply/Run, switching verbs).
  const zoomToNode = () => {
    if (!prevCameraRef.current) prevCameraRef.current = { ...editor.getCamera() }
    // Shared framing (lib/camera.ts frameShape): capped zoom + chrome-aware
    // centering — same move ImageNodeShape's double-click uses.
    frameShape(editor, sel.id)
  }

  const toggleRegion = () => {
    const next = !regionMode
    setRegionMode(next)
    setCropFrac(null)
    if (next) {
      setRefIds([])
      zoomToNode()
    }
  }


  const pickPreset = (name: string, ratio: number | null) => {
    setPreset(name)
    if (ratio === null) return
    setCropFrac(fitToAspect(p.naturalW, p.naturalH, ratio, cropFrac))
  }

  const applyCrop = () => {
    if (cropTooSmall(cropFrac, p.naturalW, p.naturalH)) return
    const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
    void runInstantOp(editor, sel.id, { type: 'crop', rect })
    setArmedTool(null)
    setCropFrac(null)
  }

  const applyResize = () => {
    if (width < 1 || height < 1) return
    void runInstantOp(editor, sel.id, { type: 'resize', width: Math.round(width), height: Math.round(height) })
    setArmedTool(null)
    setCropFrac(null)
  }

  const onWidthChange = (v: number) => {
    setWidth(v)
    if (p.naturalW > 0) setHeight(Math.round(v * (p.naturalH / p.naturalW)))
  }

  const applyTransform = () => {
    if (xfDeg === 0 && !xfFlipH && !xfFlipV) return
    void runInstantOp(editor, sel.id, { type: 'transform', deg: xfDeg, flipH: xfFlipH, flipV: xfFlipV })
    setArmedTool(null)
  }

  const applyAdjust = () => {
    void runInstantOp(editor, sel.id, {
      type: 'adjust',
      brightness: adjBrightness,
      contrast: adjContrast,
      saturation: adjSaturation,
    })
    setArmedTool(null)
  }

  const applyRedact = () => {
    if (cropTooSmall(cropFrac, p.naturalW, p.naturalH)) return
    const rect = fracToNaturalRect(cropFrac!, p.naturalW, p.naturalH)
    void runInstantOp(editor, sel.id, { type: 'redact', rect, mode: redactMode, amount: redactAmount })
    setArmedTool(null)
    setCropFrac(null)
  }

  const trayHeader =
    armedTool === 'edit'
      ? `✦ Edit v${p.seq} — creates children of v${p.seq}`
      : armedTool === 'crop'
        ? `Crop v${p.seq} — instant`
        : armedTool === 'resize'
          ? `Resize v${p.seq} — instant`
          : armedTool === 'transform'
            ? `Rotate/Flip v${p.seq} — instant`
            : armedTool === 'adjust'
              ? `Adjust v${p.seq} — instant`
              : armedTool === 'redact'
                ? `Redact v${p.seq} — instant`
                : null

  const verbRow = (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
      {VERBS.map(([tool, label]) => {
        const disabled = gatedTools.has(tool) && p.status !== 'done'
        return (
          <button
            key={tool}
            className="gm-btn"
            disabled={disabled}
            title={disabled ? 'waiting for image' : undefined}
            onClick={() => {
              if (disabled) return
              const next = armedTool === tool ? null : tool
              setArmedTool(next)
              // Every tool frames the node center-stage (user 2026-07-22)
              // EXCEPT plain Edit, which keeps the current view — its
              // "Select region" toggle zooms separately when switched on.
              if (next && next !== 'edit') zoomToNode()
            }}
            style={verbBtnStyle(armedTool === tool, disabled)}
          >
            {label}
          </button>
        )
      })}
      <a
        href={p.status === 'done' ? p.assetUrl : undefined}
        download
        onClick={(e) => {
          if (p.status !== 'done') e.preventDefault()
        }}
        title={p.status === 'done' ? 'download this node' : 'waiting for image'}
        aria-label={p.status === 'done' ? 'download this node' : 'waiting for image'}
        className="gm-btn"
        style={{ ...verbBtnStyle(false, p.status !== 'done'), textDecoration: 'none' }}
      >
        <IconDownload size={14} />
      </a>
    </div>
  )

  return (
    <div
      style={{
        ...barShell,
        padding: BAR_PADDING,
      }}
      className="gm-bar"
    >
      {/* Tray redesign (user 2026-07-22, first-principles pass): the verb
          row is a MODE SWITCHER (mutually exclusive tools) — tab semantics —
          so it now sits on TOP of the content it switches, in decision order
          (pick tool → configure → commit), instead of below the form with
          the same visual weight as the form's own controls. */}
      <div style={{ paddingBottom: 8, borderBottom: `1px solid ${color.border}`, marginBottom: 8 }}>{verbRow}</div>

      {(!armedTool || !toolReady) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: typeTok.fontMono, fontSize: typeTok.micro, color: color.textSecondary }}>
            {editingName ? (
              <input
                className="gm-input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={onNameKeyDown}
                onBlur={cancelEditName}
                placeholder="name this node…"
                style={{ ...inputField({ width: 140 }), height: 24, fontSize: typeTok.micro, padding: '0 6px' }}
              />
            ) : (
              <span
                onClick={startEditName}
                title="click to rename"
                style={{ color: p.name ? color.text : color.textMuted, fontStyle: p.name ? 'normal' : 'italic', cursor: 'text' }}
              >
                {p.name || 'unnamed'}
              </span>
            )}
            <span>
              v{p.seq} · {op.type}
              {opModel ? ` · ${opModel}` : ''} · {p.naturalW}×{p.naturalH}
            </span>
          </div>
          {opPrompt && (
            <div style={{ fontSize: typeTok.micro, color: color.textSecondary, fontStyle: 'italic' }}>&ldquo;{opPrompt}&rdquo;</div>
          )}
        </div>
      )}

      {armedTool && toolReady && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingBottom: 8,
            }}
          >
            {/* Redesign 2026-07-22: the big "editing" TrayThumb block became
                a single compact context line (20px inline thumb + header) —
                context shouldn't cost ~70px of tray height. Style-ref thumbs
                keep their TrayThumb chips (the detach affordance lives
                there), rendered as their own row only when refs exist. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {armedTool === 'edit' && p.assetUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.assetUrl}
                  alt=""
                  style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              )}
              <span style={{ fontFamily: typeTok.fontMono, fontSize: typeTok.micro, color: color.textSecondary }}>{trayHeader}</span>
            </div>
            {armedTool === 'edit' && refIds.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                {refIds.map((rid) => {
                  const rn = editor.getShape(rid)
                  return (
                    <TrayThumb
                      key={rid}
                      src={rn && rn.type === 'image-node' ? (rn as ImageNodeShape).props.assetUrl : undefined}
                      label="style ref"
                      onDetach={() => setRefIds((prev) => prev.filter((x) => x !== rid))}
                      detachAriaLabel="remove reference"
                    />
                  )
                })}
              </div>
            )}
          </div>

          {armedTool === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Task 18: absorbs the old standalone Inpaint tray — this
                  drag hint only shows once "Select region" is on, mirroring
                  the old inpaint tray's always-shown hint (which had no
                  toggle to gate it on). */}
              {regionMode && (
                <div style={{ color: color.textSecondary }}>drag on the image to mark the region to edit</div>
              )}
              {/* Task 21: badge reworded from "region locked — pixels
                  outside can't change" — that was FLUX Fill's hard
                  composite guarantee (regenerate the mask, paste it back
                  over the untouched original). gpt-image-2 is an
                  instruction-based masked edit on a single model call, a
                  softer "focuses the edit here" guarantee, not a
                  pixel-level compositing one — this wording no longer
                  overclaims what the model actually does. */}
              {regionActive && (
                <div className="gm-region-badge">
                  {model === 'gpt-image-2' ? 'editing this region (exact mask)' : 'editing this region (guided)'}
                </div>
              )}
              {/* Soft-region support (user 2026-07-21, supersedes Task 21's
                  gpt-image-2 lock): every edit model can take a region now —
                  gpt-image-2 via its real pixel mask, the rest via a
                  red-box-annotated source image + instruction prompt
                  (run-op.ts's inpaint dispatch; verified live against
                  nano-banana-pro before wiring). This one-liner tells the
                  user which guarantee they're getting. */}
              {regionActive && model !== 'gpt-image-2' && (
                <div style={{ color: color.textSecondary, fontSize: typeTok.micro }}>
                  guided: the result is composited back — pixels outside the box stay untouched
                </div>
              )}
              <textarea
                className="gm-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={regionMode ? 'describe the change to this region…' : 'describe the change…'}
                rows={2}
                style={{ ...textareaField({ large: true }), resize: 'vertical' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {/* Soft-region support (user 2026-07-21): the picker stays
                    LIVE while a region is drawn — the Task 21 gpt-image-2
                    lock chip is gone since every model can serve a region
                    now (exact mask vs guided annotation, chosen in
                    run-op.ts's inpaint dispatch by model id). */}
                {/* Redesign 2026-07-22 — grouped by function: INPUT
                    MODIFIERS (Select region, + Reference: they change what
                    goes into the model) cluster left; EXECUTION SETTINGS
                    (model, variants) and the COMMIT action (Run) cluster
                    right, with Run terminal at bottom-right — the same slot
                    every other tool's Apply occupies. */}
                <button
                  className="gm-btn"
                  onClick={toggleRegion}
                  title={
                    regionMode
                      ? 'back to whole-image edit'
                      : 'draw a rect region to focus the edit there'
                  }
                  style={buttonSecondary({ active: regionMode, quiet: true })}
                >
                  Select region
                </button>
                {/* Task 15D: the ref chip ("ref: v{seq}" + separate detach
                    button) that used to render here when refId was set is
                    GONE — its job moved to the "style ref" TrayThumb in the
                    tray header above (same detach affordance, same
                    "remove reference" accessible name, now on the
                    thumbnail itself). This button stays exactly as before,
                    just gated on `!refId` since there's nothing left for it
                    to do once a ref is attached (re-picking means
                    detach-then-"+ Reference" again, unchanged UX).
                    Task 18 had also force-disabled this while a region was
                    active (FLUX Fill had no reference-image field at all).
                    Task 21 REMOVES that region-specific disable: the region
                    branch now always routes to gpt-image-2, which — like
                    every other model in EDIT_MODELS — accepts
                    referenceUrls (model-capability-probe.md), so the old
                    hardcoded `disabled={regionActive}` would now be
                    disabling a control the selected model can actually
                    serve. Gating is on capability, not on region-mode: since
                    no currently-registered edit model lacks a referenceUrls
                    param, that capability check trivially reduces to
                    "always enabled" today, but the disable is no longer
                    hardcoded to "region is on". */}
                {(
                  <>
                    {/* ONE reference entry point (user 2026-07-21): clicking
                        arms canvas pick mode AND opens the assets drawer in
                        attach mode simultaneously — whichever source the user
                        clicks first wins; succeeding or canceling either ends
                        both (combined-mode rule). */}
                    <button
                      className="gm-btn"
                      onClick={() => {
                        if (pickingRef || assetsDrawer === 'attach') {
                          setPickingRef(false)
                          if (assetsDrawer === 'attach') setAssetsDrawer('add') // stay open
                        } else {
                          startPick()
                          setAssetsDrawer('attach')
                        }
                      }}
                      title="pick a node on the canvas, or choose from assets"
                      style={buttonSecondary({ active: pickingRef || assetsDrawer === 'attach', quiet: true })}
                    >
                      {pickingRef ? 'Pick a node or asset…' : '+ Reference'}
                    </button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <ModelSelect value={model} onChange={setModel} options={EDIT_MODELS} ariaLabel="edit model" />
                <button className="gm-btn" onClick={() => setVariants((v) => Math.max(1, v - 1))} style={stepBtn} title="fewer variants" aria-label="fewer variants">
                  −
                </button>
                <span title="variants" style={{ fontVariantNumeric: 'tabular-nums' }}>{variants}×</span>
                <button className="gm-btn" onClick={() => setVariants((v) => Math.min(3, v + 1))} style={stepBtn} title="more variants" aria-label="more variants">
                  +
                </button>
                <button
                  className="gm-btn"
                  onClick={runEdit}
                  disabled={!prompt.trim() || (regionMode && cropTooSmall(cropFrac, p.naturalW, p.naturalH))}
                  style={{
                    ...buttonPrimary({
                      disabled: !prompt.trim() || (regionMode && cropTooSmall(cropFrac, p.naturalW, p.naturalH)),
                    }),
                  }}
                >
                  Run
                </button>
              </div>
            </div>
          )}

          {armedTool === 'crop' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: color.textSecondary }}>drag on the image to draw a crop rect</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {ASPECT_PRESETS.map(([name, ratio]) => (
                  <button
                    key={name}
                    className="gm-btn"
                    onClick={() => pickPreset(name, ratio)}
                    style={buttonSecondary({ active: preset === name })}
                  >
                    {name}
                  </button>
                ))}
                <button
                  className="gm-btn"
                  onClick={applyCrop}
                  disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH)}
                  style={{ ...buttonPrimary({ disabled: cropTooSmall(cropFrac, p.naturalW, p.naturalH) }), marginLeft: 'auto' }}
                >
                  Apply — instant
                </button>
              </div>
            </div>
          )}

          {armedTool === 'resize' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: color.textSecondary, width: 14 }}>W</span>
                <input
                  className="gm-input"
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => onWidthChange(Number(e.target.value))}
                  style={{ ...field, flex: 1 }}
                />
                <span style={{ color: color.textSecondary, width: 14 }}>H</span>
                <input
                  className="gm-input"
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  style={{ ...field, flex: 1 }}
                />
                <button className="gm-btn" onClick={applyResize} disabled={width < 1 || height < 1} style={buttonPrimary({ disabled: width < 1 || height < 1 })}>
                  Apply — instant
                </button>
              </div>
            </div>
          )}

          {/* UX round 2 (user 2026-07-21: 180° took two clicks/two nodes,
              and flip doesn't deserve two verb-row buttons): rotation and
              flips are ONE control — pick presets/toggles freely, Apply
              composes them into a single 'transform' op → one child node. */}
          {armedTool === 'transform' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: color.textSecondary }}>rotate</span>
              {([0, 90, 180, 270] as const).map((d) => (
                <button
                  key={d}
                  className="gm-btn"
                  onClick={() => setXfDeg(d)}
                  style={buttonSecondary({ active: xfDeg === d })}
                >
                  {d}°
                </button>
              ))}
              <span style={{ color: color.textSecondary, marginLeft: 8 }}>flip</span>
              <button
                className="gm-btn"
                onClick={() => setXfFlipH((v) => !v)}
                title="mirror left↔right"
                style={buttonSecondary({ active: xfFlipH })}
              >
                H
              </button>
              <button
                className="gm-btn"
                onClick={() => setXfFlipV((v) => !v)}
                title="mirror top↕bottom"
                style={buttonSecondary({ active: xfFlipV })}
              >
                V
              </button>
              <button
                className="gm-btn"
                onClick={applyTransform}
                disabled={xfDeg === 0 && !xfFlipH && !xfFlipV}
                style={{
                  ...buttonPrimary({ disabled: xfDeg === 0 && !xfFlipH && !xfFlipV }),
                  marginLeft: 'auto',
                }}
              >
                Apply — instant
              </button>
            </div>
          )}

          {armedTool === 'adjust' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(
                [
                  ['brightness', adjBrightness, setAdjBrightness],
                  ['contrast', adjContrast, setAdjContrast],
                  ['saturation', adjSaturation, setAdjSaturation],
                ] as const
              ).map(([label, value, setValue]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: color.textSecondary, width: 72 }}>{label}</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                    style={{ flex: 1 }}
                    aria-label={label}
                  />
                  <span style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}%</span>
                </div>
              ))}
              <div style={{ display: 'flex' }}>
                <button className="gm-btn" onClick={applyAdjust} style={{ ...buttonPrimary({}), marginLeft: 'auto' }}>
                  Apply — instant
                </button>
              </div>
            </div>
          )}

          {armedTool === 'redact' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: color.textSecondary }}>drag on the image to mark the region to redact</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="gm-btn"
                  onClick={() => setRedactMode('blur')}
                  style={buttonSecondary({ active: redactMode === 'blur' })}
                >
                  Blur
                </button>
                <button
                  className="gm-btn"
                  onClick={() => setRedactMode('pixelate')}
                  style={buttonSecondary({ active: redactMode === 'pixelate' })}
                >
                  Pixelate
                </button>
                <span style={{ color: color.textSecondary }}>strength</span>
                <input
                  type="range"
                  min={4}
                  max={48}
                  value={redactAmount}
                  onChange={(e) => setRedactAmount(Number(e.target.value))}
                  style={{ flex: 1 }}
                  aria-label="redact strength"
                />
                <button
                  className="gm-btn"
                  onClick={applyRedact}
                  disabled={cropTooSmall(cropFrac, p.naturalW, p.naturalH)}
                  style={{ ...buttonPrimary({ disabled: cropTooSmall(cropFrac, p.naturalW, p.naturalH) }), marginLeft: 'auto' }}
                >
                  Apply — instant
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

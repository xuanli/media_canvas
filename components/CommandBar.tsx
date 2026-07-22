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
import { runOp, runInstantOp, createUploadedRoot } from '@/lib/run-op'
import { apiPost } from '@/lib/api-client'
import type { ImageNodeShape } from '@/components/ImageNodeShape'
import type { RectFrac } from '@/lib/types'
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
  { id: 'nano-banana', label: 'Nano Banana 2' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'seedream-5-lite', label: 'Seedream 5 Lite' },
] as const

// Mirrors lib/fal-registry.ts's `REGISTRY.generate.models` — order/default
// (nano-banana first) matches `REGISTRY.generate.default`. Both lists must
// be updated together when the registry's generate model set changes.
const GENERATE_MODELS = [
  { id: 'nano-banana', label: 'Nano Banana 2' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'seedream-5-lite', label: 'Seedream 5 Lite' },
  { id: 'flux-1.1-pro', label: 'FLUX 1.1' },
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

const primaryBtn: CSSProperties = buttonPrimary()

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
  const { armedTool, setArmedTool, cropFrac, setCropFrac, pickingRef, setPickingRef, regionMode, setRegionMode } =
    useUiStore()
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState<string>(EDIT_MODELS[0].id)
  const [variants, setVariants] = useState(1)
  const [preset, setPreset] = useState<string>('free')
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [refId, setRefId] = useState<TLShapeId | null>(null)

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
          setRefId(sel.id)
          setPickingRef(false)
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
      setRefId(null)
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
      setRefId(null)
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
      const { url } = await apiPost<{ url: string }>('/api/upload', { dataUrl }, false)
      await createUploadedRoot(editor, url, file.name)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Hooks are all unconditional above this point; only rendering branches
  // below, same rule Inspector followed with its `if (!sel) return null`.
  if (!sel) {
    return (
      <div style={{ ...barShell, padding: BAR_PADDING, display: 'flex', gap: 6, alignItems: 'center' }} className="gm-bar">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={(e) => void onUploadChange(e)}
          style={{ display: 'none' }}
        />
        <button
          className="gm-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={buttonSecondary({ disabled: uploading })}
          title="upload PNG/JPEG as a new root node"
        >
          <IconUpload size={14} />
          {uploading ? '…' : 'Upload'}
        </button>
        {/* Task 20 (user feedback 2026-07-21): the idle prompt grows from a
            single-line input to a multi-line textarea — same textareaField()
            token language (padding/line-height) the armed Edit tray's prompt
            already uses, so switching create<->edit reads as one bar, not
            two UIs. `resize: 'none'` (unlike the tray's `resize: 'vertical'`)
            since this is the calm/idle state, not an active editing form —
            keeps the bar's height predictable for the zoom-cluster collision
            math below. `minHeight: 64` backstops rows=2's natural height
            (~62px: 2*20px line-height + 20px vertical padding + 2px border)
            per the brief's "~64px min-height" so it never dips under that
            floor at odd zoom/font-scale settings.
            Enter still submits (matching the old single-line input's native
            no-newline behavior); Shift+Enter now inserts a newline, which a
            plain <input> could never do — the one behavior extension this
            task makes, requiring `e.preventDefault()` so the submitting
            Enter doesn't also insert a newline before `go()` clears the
            field. */}
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
          placeholder="Describe a new image…"
          rows={2}
          style={{ ...textareaField({ large: true }), flex: 1, minHeight: 64, resize: 'none' }}
        />
        {/* Task 16b: idle-mood generate model picker — same styling (gm-input
            class + inputField() token, no appearance-none/chevron override)
            as the Edit tray's picker below, since that's the tray's actual
            current pattern, a bare <select className="gm-input">. */}
        <select
          className="gm-input"
          value={genModel}
          onChange={(e) => setGenModel(e.target.value)}
          style={field}
          aria-label="generate model"
        >
          {GENERATE_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button className="gm-btn" onClick={go} style={primaryBtn}>
          Generate
        </button>
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
  const gatedTools = new Set(['crop', 'resize']) // ActionMenu.tsx's gating, unchanged (Task 18: 'inpaint' dropped — no longer its own verb)

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

  const refNode = refId ? editor.getShape(refId) : undefined

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
      runOp(
        editor,
        sel.id,
        { type: 'inpaint', prompt, model: 'gpt-image-2', rect, referenceNodeId: refId ?? undefined },
        variants,
        resolveRef,
        refId ?? undefined
      )
    } else {
      runOp(
        editor,
        sel.id,
        { type: 'edit', prompt, model, referenceNodeId: refId ?? undefined },
        variants,
        resolveRef,
        refId ?? undefined
      )
    }
    setArmedTool(null)
    setPrompt('')
    setVariants(1)
    setRefId(null)
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
  const toggleRegion = () => {
    const next = !regionMode
    setRegionMode(next)
    setCropFrac(null)
    if (next) setRefId(null)
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

  const trayHeader =
    armedTool === 'edit'
      ? `✦ Edit v${p.seq} — creates children of v${p.seq}`
      : armedTool === 'crop'
        ? `Crop v${p.seq} — instant`
        : armedTool === 'resize'
          ? `Resize v${p.seq} — instant`
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
            onClick={() => !disabled && setArmedTool(armedTool === tool ? null : tool)}
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
    <div style={{ ...barShell, padding: BAR_PADDING }} className="gm-bar">
      {!armedTool && (
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
          {verbRow}
        </div>
      )}

      {armedTool && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingBottom: 8,
              borderBottom: `1px solid ${color.border}`,
              marginBottom: 8,
            }}
          >
            {armedTool === 'edit' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <TrayThumb src={p.status === 'done' ? p.assetUrl : undefined} label="editing" />
                {refId && (
                  <TrayThumb
                    src={refNode && refNode.type === 'image-node' ? refNode.props.assetUrl : undefined}
                    label="style ref"
                    onDetach={() => setRefId(null)}
                    detachAriaLabel="remove reference"
                  />
                )}
              </div>
            )}
            <div style={{ fontFamily: typeTok.fontMono, fontSize: typeTok.micro, color: color.textSecondary }}>{trayHeader}</div>
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
              {regionActive && <div className="gm-region-badge">editing this region</div>}
              {/* Task 21: one-line note (brief: "if the user had
                  nano-banana/seedream selected and draws a region, show
                  gpt-image-2 as the region model with a one-line note") —
                  only shown when it's actually informative, i.e. the model
                  the user had picked before drawing a region differs from
                  the one Run will actually use. */}
              {regionActive && model !== 'gpt-image-2' && (
                <div style={{ color: color.textSecondary, fontSize: typeTok.micro }}>
                  region editing uses GPT Image 2
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
                {/* Task 21 (was Task 18's region-active lock): gpt-image-2 is
                    now the ONLY regionCapable model (lib/fal-registry.ts),
                    so this is no longer "locked to the default while a
                    region is set" among several choices — it's the sole
                    model the 'inpaint' capability has. Still shown as a
                    disabled, non-selectable field rather than the live
                    picker so it can't be typo'd into disagreeing with what
                    Run actually sends (same rationale as the Task 18
                    version, updated model). */}
                {regionActive ? (
                  <span
                    title="region editing routes through GPT Image 2 — the only model that supports a mask + reference in one call"
                    style={{ ...field, display: 'inline-flex', alignItems: 'center', color: color.textDisabled, cursor: 'not-allowed' }}
                  >
                    GPT Image 2 (region)
                  </span>
                ) : (
                  <select className="gm-input" value={model} onChange={(e) => setModel(e.target.value)} style={field}>
                    {EDIT_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                )}
                <span style={{ color: color.textSecondary }}>variants:</span>
                <button className="gm-btn" onClick={() => setVariants((v) => Math.max(1, v - 1))} style={stepBtn}>
                  −
                </button>
                <span>{variants}</span>
                <button className="gm-btn" onClick={() => setVariants((v) => Math.min(3, v + 1))} style={stepBtn}>
                  +
                </button>
                <button
                  className="gm-btn"
                  onClick={toggleRegion}
                  title={
                    regionMode
                      ? 'back to whole-image edit'
                      : 'draw a rect region — GPT Image 2 focuses the edit there'
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
                {!refId && (
                  <button
                    className="gm-btn"
                    onClick={startPick}
                    title={
                      pickingRef
                        ? 'click a done node on the canvas to attach it as a reference'
                        : 'attach another node as a reference image'
                    }
                    style={buttonSecondary({ active: pickingRef, quiet: true })}
                  >
                    {pickingRef ? 'Pick a node…' : '+ Reference'}
                  </button>
                )}
                <button
                  className="gm-btn"
                  onClick={runEdit}
                  disabled={!prompt.trim() || (regionMode && cropTooSmall(cropFrac, p.naturalW, p.naturalH))}
                  style={{
                    ...buttonPrimary({
                      disabled: !prompt.trim() || (regionMode && cropTooSmall(cropFrac, p.naturalW, p.naturalH)),
                    }),
                    marginLeft: 'auto',
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

          <div style={{ paddingTop: 8, marginTop: 8, borderTop: `1px solid ${color.border}` }}>{verbRow}</div>
        </div>
      )}
    </div>
  )
}

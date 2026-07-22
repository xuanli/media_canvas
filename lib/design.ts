// Task 15B: shared design tokens for the app's own chrome (TopNav,
// CommandBar, node cards, PasscodeGate, landing page) — NOT the tldraw
// canvas internals (hideUi already strips that). "Runway-grade": restrained
// monochrome-plus-one-accent look. See .superpowers/sdd/task-15b-brief.md
// for the source spec this module encodes: 32px control height, 8px radius,
// 1px rgba(255,255,255,0.08) borders, accent ONLY on primary
// actions/focus/selection.
//
// Pattern: raw tokens (color/metric/type/motion) for one-off styling, plus
// CSSProperties builder functions (buttonPrimary/buttonSecondary/
// buttonGhost/inputField/...) for the repeated control shapes, so every
// button/input across the app shares literally the same height/radius/
// padding math instead of hand-copied inline objects drifting apart (the
// root cause of the Upload-button misalignment bug this task fixes).
//
// Hover/focus-visible states need real CSS (:hover, :focus-visible aren't
// expressible in inline style objects) — those live in app/globals.css as
// companion classes (`gm-btn`, `gm-btn-ghost`, `gm-input`, `gm-dropdown-row`,
// `gm-icon-btn`) applied via className alongside the inline styles below.

import type { CSSProperties } from 'react'

export const color = {
  // Surfaces (brief: bar #17181b on nav #0f1012)
  navBg: '#0f1012',
  barBg: '#17181b',
  overlayBg: '#1c1d22', // dropdown/menu/tray-header surface, one step up
  fieldBg: '#0b0c0e',
  cardBg: '#1a1d22',
  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.16)',
  // Text
  text: '#e6e9ee',
  textSecondary: '#9aa3ad',
  textMuted: '#666f7a',
  // Distinct from textMuted (informational/placeholder gray): the original
  // (pre-design-system, task-14) literal for disabled *interactive* text —
  // restored here as its own token after a review caught it having drifted
  // to textMuted during the buttonSecondary() refactor. See verbBtnStyle in
  // CommandBar.tsx for the one call site that opts into it via
  // buttonSecondary's `disabledColor`.
  textDisabled: '#5b6472',
  // Accent — the ONLY color besides monochrome: primary actions, focus
  // rings, selection/armed states. Everything else stays monochrome.
  accent: '#2dd4bf',
  accentText: '#0b2622', // dark text/icon on accent fill
  accentDim: 'rgba(45,212,191,0.14)', // accent-tinted chip/hover surface
  // Status colors (small dots/badges only, never a button fill)
  success: '#7ec9a2',
  warning: '#e0c05c',
  danger: '#d98d80',
} as const

export const metric = {
  controlH: 32,
  // Task 15D: the floating bar's own presence grew taller — the IDLE prompt
  // input and the ARMED edit/inpaint textareas opt into this, everything
  // else (model select, variant steppers, resize W/H fields) stays at the
  // plain `controlH` per the brief's "secondary controls stay 32px".
  controlHLarge: 40,
  radius: 8,
  radiusLg: 10, // node card
  radiusSm: 6, // dropdown rows / chips / small step buttons
  paddingX: 12,
  gapXs: 4,
  gapSm: 6,
  gapMd: 8,
  gapLg: 12,
} as const

export const type = {
  fontUi: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  // Monospace reserved for recipe/metadata lines only — never chrome labels.
  fontMono: 'ui-monospace, "SF Mono", Menlo, monospace',
  base: 13,
  secondary: 12,
  micro: 11,
  nano: 9,
} as const

export const motion = {
  fast: '120ms ease-out',
  base: '150ms ease-out',
  slow: '160ms ease-out',
} as const

// Task 15D: the command bar now floats above the canvas (bottom 12 -> 28)
// instead of sitting flush — a soft elevation shadow sells the "raised"
// framing. Token'd (not inlined in CommandBar.tsx) so any other surface
// that floats above the canvas later reuses the same shadow language.
export const elevation = {
  bar: '0 12px 32px rgba(0,0,0,0.40), 0 2px 8px rgba(0,0,0,0.28)',
} as const

// ── control builders ────────────────────────────────────────────────────

interface ButtonOpts {
  active?: boolean
  disabled?: boolean
  compact?: boolean // no horizontal padding growth, used for icon-only squares
  disabledColor?: string // override the disabled-state text color (buttonSecondary only)
  // Design-critique item 8: "quiet-selected" — active state takes accentDim
  // fill + accent text/border instead of a full solid accent fill. Used for
  // controls that indicate an armed/picking STATE (armed verb pill, "Pick a
  // node…") rather than a primary CTA, so solid color.accent stays reserved
  // for exactly one control per screen (Run/Apply/Generate). Chip-style
  // `active` uses (aspect presets, current-canvas markers) are unaffected —
  // they don't pass `quiet` and keep the prior solid-accent `active` look.
  quiet?: boolean
}

/** Primary: filled accent, dark text. Generate/Run/Apply/Continue. */
export function buttonPrimary(opts: ButtonOpts = {}): CSSProperties {
  const { disabled = false } = opts
  return {
    height: metric.controlH,
    padding: `0 ${metric.paddingX}px`,
    background: color.accent,
    color: color.accentText,
    border: '1px solid transparent',
    borderRadius: metric.radius,
    fontFamily: type.fontUi,
    fontSize: type.base,
    fontWeight: 600,
    lineHeight: `${metric.controlH - 2}px`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metric.gapSm,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  }
}

/** Secondary: bordered, transparent fill. `active` = armed/selected (takes accent fill). */
export function buttonSecondary(opts: ButtonOpts = {}): CSSProperties {
  const { active = false, disabled = false, disabledColor = color.textMuted, quiet = false } = opts
  return {
    height: metric.controlH,
    padding: `0 ${metric.paddingX}px`,
    background: active ? (quiet ? color.accentDim : color.accent) : 'transparent',
    color: active ? (quiet ? color.accent : color.accentText) : disabled ? disabledColor : color.text,
    border: `1px solid ${active ? (quiet ? color.accent : 'transparent') : color.border}`,
    borderRadius: metric.radius,
    fontFamily: type.fontUi,
    fontSize: type.secondary,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metric.gapSm,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  }
}

/** Tertiary/icon: borderless, hover-surface (add className="gm-btn-ghost" for the hover rule). */
export function buttonGhost(opts: ButtonOpts = {}): CSSProperties {
  const { disabled = false, compact = false } = opts
  return {
    height: metric.controlH,
    padding: compact ? 0 : `0 ${metric.paddingX}px`,
    width: compact ? metric.controlH : undefined,
    background: 'transparent',
    color: disabled ? color.textMuted : color.textSecondary,
    border: '1px solid transparent',
    borderRadius: metric.radius,
    fontFamily: type.fontUi,
    fontSize: type.secondary,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: metric.gapSm,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
  }
}

/** A small square icon-only step control (variant stepper, ref-chip remove, zoom cluster). */
export function stepButton(opts: ButtonOpts = {}): CSSProperties {
  const { disabled = false, active = false } = opts
  return {
    width: 22,
    height: 22,
    padding: 0,
    background: active ? color.accent : color.overlayBg,
    color: active ? color.accentText : color.text,
    border: `1px solid ${active ? 'transparent' : color.border}`,
    borderRadius: metric.radiusSm,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  }
}

/** Text input / select, single-line. `large` opts into controlHLarge (Task
 * 15D: the IDLE mood's own generate prompt input) — default stays
 * metric.controlH for every other (secondary) control. */
export function inputField(opts: { width?: number | string; large?: boolean } = {}): CSSProperties {
  return {
    height: opts.large ? metric.controlHLarge : metric.controlH,
    padding: `0 ${metric.paddingX}px`,
    background: color.fieldBg,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: metric.radius,
    fontFamily: type.fontUi,
    fontSize: type.base,
    boxSizing: 'border-box',
    width: opts.width,
  }
}

/** Multi-line prompt field — no fixed height, sized by `rows`. `large`
 * (Task 15D: armed edit/inpaint prompt textareas) roomier padding/line
 * height so each row reads at the same taller `controlHLarge` scale as the
 * idle prompt input, instead of just growing via more `rows`. */
export function textareaField(opts: { large?: boolean } = {}): CSSProperties {
  return {
    padding: opts.large ? '10px 12px' : `${metric.gapSm}px ${metric.paddingX}px`,
    lineHeight: opts.large ? '20px' : undefined,
    background: color.fieldBg,
    color: color.text,
    border: `1px solid ${color.border}`,
    borderRadius: metric.radius,
    fontFamily: type.fontUi,
    fontSize: type.base,
    boxSizing: 'border-box',
  }
}

/** Dropdown / menu surface shell. */
export function menuSurface(): CSSProperties {
  return {
    background: color.overlayBg,
    border: `1px solid ${color.border}`,
    borderRadius: metric.radius,
    padding: 4,
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    boxSizing: 'border-box',
  }
}

/** A menu row button (add className="gm-dropdown-row" for hover). */
export function menuRow(): CSSProperties {
  return {
    background: 'transparent',
    color: color.text,
    border: 0,
    borderRadius: metric.radiusSm,
    padding: '6px 8px',
    fontSize: type.micro,
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: type.fontUi,
  }
}

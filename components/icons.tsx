'use client'

// Task 15B: hand-written 16px inline SVG icons replacing emoji/ad-hoc
// unicode glyphs across the chrome (TopNav/CommandBar/ImageNodeShape). All
// share the same contract: 16x16 viewBox, 1.5 stroke, currentColor, no
// fill unless noted, aria-hidden (the parent control carries the
// accessible name via text or aria-label — icons never introduce their own
// accessible name). ✦ stays plain text elsewhere (brand glyph for AI ops,
// not an icon).

import type { CSSProperties, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base(size: number, style?: CSSProperties): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    style: { display: 'block', flexShrink: 0, ...style },
  }
}

export function IconUpload({ size = 16, ...rest }: IconProps) {
  // tray-arrow-up
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 10.5V2.5" />
      <path d="M4.5 6L8 2.5L11.5 6" />
      <path d="M2.5 9.5V12a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

export function IconPlus({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </svg>
  )
}

export function IconMinus({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 8h10" />
    </svg>
  )
}

export function IconShare({ size = 16, ...rest }: IconProps) {
  // link glyph
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6.5 9.5L9.5 6.5" />
      <path d="M7 4.2L7.8 3.4a2.5 2.5 0 0 1 3.6 3.6l-1 1" />
      <path d="M9 11.8L8.2 12.6a2.5 2.5 0 0 1-3.6-3.6l1-1" />
    </svg>
  )
}

export function IconDownload({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 2.5V9.5" />
      <path d="M4.5 7L8 10.5L11.5 7" />
      <path d="M2.5 12.5h11" />
    </svg>
  )
}

export function IconChevronDown({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 6l4 4l4-4" />
    </svg>
  )
}

export function IconX({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </svg>
  )
}

export function IconCheck({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3.5 8.5l3 3l6-7" />
    </svg>
  )
}

export function IconFit({ size = 16, ...rest }: IconProps) {
  // frame corners — "fit to content/selection"
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 5.5V3a.5.5 0 0 1 .5-.5h2.5" />
      <path d="M13.5 5.5V3a.5.5 0 0 0-.5-.5h-2.5" />
      <path d="M2.5 10.5V13a.5.5 0 0 0 .5.5h2.5" />
      <path d="M13.5 10.5V13a.5.5 0 0 1-.5.5h-2.5" />
    </svg>
  )
}

export function IconWarning({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 2.7l6 10.6a.9.9 0 0 1-.78 1.3H2.78a.9.9 0 0 1-.78-1.3L8 2.7Z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconSpinner({ size = 16, className, ...rest }: IconProps) {
  // Pending status — a simple ring dash; spins via the gm-spin CSS class
  // (globals.css), which respects prefers-reduced-motion by not animating.
  return (
    <svg {...base(size)} className={className ? `gm-spin ${className}` : 'gm-spin'} {...rest}>
      <circle cx="8" cy="8" r="5.5" opacity="0.25" />
      <path d="M13.5 8a5.5 5.5 0 0 0-5.5-5.5" />
    </svg>
  )
}

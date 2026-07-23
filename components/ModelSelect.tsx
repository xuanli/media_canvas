'use client'

import { useEffect, useRef, useState } from 'react'
import { color, inputField, menuSurface, menuRow, type as typeTok } from '@/lib/design'
import { IconCheck, IconChevronDown } from '@/components/icons'

// Custom model picker (user 2026-07-22: the native <select> popup is
// OS-chrome — light gray with a blue highlight — and can't be themed).
// Same visual language as TopNav's dropdowns (menuSurface + gm-dropdown-row
// hover rows); opens ABOVE the trigger since the command bar sits at the
// bottom of the viewport.
//
// Esc while open closes ONLY the menu: the window keydown listener is
// registered in the CAPTURE phase and stops propagation, so CanvasApp's
// global Esc layering (disarm tool / clear region) never sees that press.
export function ModelSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (id: string) => void
  options: ReadonlyArray<{ readonly id: string; readonly label: string }>
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [open])

  const current = options.find((o) => o.id === value)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="gm-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...inputField(),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {current?.label ?? value}
        <IconChevronDown size={12} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            ...menuSurface(),
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            minWidth: '100%',
            zIndex: 20,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === value}
              className="gm-dropdown-row"
              onClick={() => {
                onChange(o.id)
                setOpen(false)
              }}
              style={{
                ...menuRow(),
                fontSize: typeTok.secondary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                color: o.id === value ? color.accent : color.text,
              }}
            >
              <span style={{ width: 14, display: 'inline-flex' }}>
                {o.id === value && <IconCheck size={12} />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

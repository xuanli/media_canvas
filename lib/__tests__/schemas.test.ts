import { describe, it, expect } from 'vitest'
import { opsRequestSchema } from '@/lib/schemas'

describe('opsRequestSchema', () => {
  it('accepts a valid generate request', () => {
    const r = opsRequestSchema.safeParse({ capability: 'generate', model: 'flux-1.1-pro', prompt: 'a cat' })
    expect(r.success).toBe(true)
  })
  it('rejects edit without imageUrl', () => {
    expect(opsRequestSchema.safeParse({ capability: 'edit', model: 'nano-banana', prompt: 'x' }).success).toBe(false)
  })
  it('rejects inpaint without maskUrl', () => {
    expect(opsRequestSchema.safeParse({ capability: 'inpaint', model: 'flux-fill', prompt: 'x', imageUrl: 'https://a/b.png' }).success).toBe(false)
  })
  it('rejects unknown capability', () => {
    expect(opsRequestSchema.safeParse({ capability: 'video', model: 'x', prompt: 'x' }).success).toBe(false)
  })
})

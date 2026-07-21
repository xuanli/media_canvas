import { describe, it, expect } from 'vitest'
import { normalizeFalError } from '@/lib/errors'
describe('normalizeFalError', () => {
  it('maps 429 to rate_limited', () => {
    expect(normalizeFalError({ status: 429 }).code).toBe('rate_limited')
    expect(normalizeFalError({ status: 429 }).http).toBe(429)
  })
  it('maps 422 to content_policy', () => {
    expect(normalizeFalError({ status: 422 }).code).toBe('content_policy')
  })
  it('maps timeout-ish errors', () => {
    expect(normalizeFalError(new Error('Request timed out')).code).toBe('timeout')
  })
  it('defaults to model_error with message preserved', () => {
    const n = normalizeFalError(new Error('boom'))
    expect(n.code).toBe('model_error'); expect(n.message).toContain('boom')
  })
})

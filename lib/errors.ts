export interface NormalizedError { code: 'rate_limited' | 'content_policy' | 'timeout' | 'model_error'; message: string; http: number }
export function normalizeFalError(e: unknown): NormalizedError {
  const status = (e as { status?: number })?.status
  const message = e instanceof Error ? e.message : JSON.stringify(e)
  if (status === 429) return { code: 'rate_limited', message: 'Model is rate-limited; try again shortly.', http: 429 }
  if (status === 422) return { code: 'content_policy', message: 'The model declined this request (content policy).', http: 422 }
  if (/tim(e|ed) ?out/i.test(message)) return { code: 'timeout', message: 'Model call timed out after 90s.', http: 504 }
  return { code: 'model_error', message: `Model call failed: ${message}`.slice(0, 300), http: 502 }
}

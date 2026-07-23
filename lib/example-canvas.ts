// The showcase canvas (user 2026-07-22): a hand-built demo tree — Komos
// office → logo on the whiteboard (ref edge) → region edit → Xuan presenting
// at the desk, plus the SF bus-stop ad-swap branch.
//
// The MASTER canvas lives in the shared blob store under this id (built by
// Xuan via the local app, which writes to the same store production reads).
// The landing page's example card COPIES it on open — fetch master snapshot →
// create fresh canvas → PUT snapshot — so every visitor gets their own
// editable playground and nobody mutates the master. Updating the example =
// editing the master canvas; no code change needed.
export const EXAMPLE_CANVAS = {
  id: '9thdqcxlnkk4',
  title: '[Example] Komos <> SF Marketing',
} as const

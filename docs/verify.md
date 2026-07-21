# verify.md — the 3-minute demo path

This is the human pass on top of the automated suites. Run it locally before
every deploy, and once against production after every deploy.

**Automation coverage** (so you know what's already proven before you start):

- `pnpm test` — unit tests on pure logic (tree ops, schemas, error
  normalization). `lib/__tests__/*.test.ts`.
- `pnpm test:e2e` — Playwright, fully mocked (`FAL_MOCK=1 STORAGE_MOCK=1`, no
  real fal spend, no Blob token, no passcode needed). Exercises: generate →
  root node, edit → variant children + labeled arrow, reload persistence,
  crop drag → instant child (real pointer drag, camera-did-not-pan check),
  and the reference-pick flow (chip, selection restore, dashed ref arrow on
  run). Asserts zero console errors on every spec. See `e2e/demo.spec.ts`.
- **Human-only** (marked below): real-model output quality, UX feel/latency,
  the production fail-closed check, and anything that needs a real fal call
  or a real Blob store.

Steps marked **[E2E]** are already covered by `e2e/demo.spec.ts` — running
them here is a sanity re-check, not new coverage. Steps marked **[HUMAN]**
have no automated equivalent (judgment call or requires production
infrastructure) and must be walked by hand.

## Setup

Local, fully offline (no fal spend, no Blob token, no passcode):

```bash
FAL_MOCK=1 STORAGE_MOCK=1 pnpm dev
```

Or against a real dev deployment with `FAL_KEY` set (real fal spend applies).

## Checklist

1. **[E2E]** Landing → "New canvas" → `/c/:id` loads empty state.
2. **[E2E]** Generate root: type a prompt in the bottom prompt bar (e.g.
   "cozy ramen shop exterior, tokyo alley, dusk, cinematic"), press Enter →
   a pending `v1 · generate` node appears immediately, fills in with an
   image shortly after.
3. **[HUMAN]** Select the root → ✦ Edit → 3 variants → "make it rainy" → Run.
   Confirm 3 pending sibling nodes appear at once and fill in independently
   (not blocking each other). *(The 2-variant case is E2E-covered; the
   "do variants render as independent siblings, not overwrite" judgment is
   a human check on real output.)*
4. **[HUMAN]** Double-click the best child → camera zooms to fit. Select it →
   ✦ Inpaint → draw a rect over some sub-region (e.g. a sign) → prompt (e.g.
   "hand-painted sign reading OPEN LATE") → 2 variants → Run. Confirm only
   the masked region changed and the rest of the image is pixel-identical to
   the parent (this is the whack-a-mole guarantee — inspect closely).
5. **[E2E]** Crop: select a done node → Crop → drag a rect → "Apply —
   instant" → child appears immediately (no ✦ spinner, no network wait).
   Also try Resize (512) → instant child. Confirm the canvas did not pan
   during the drag.
6. **[E2E]** Reference pick: select a node → ✦ Edit → "+ Reference" → click
   a different done node on the canvas → a `ref: vN` chip appears, selection
   snaps back to the edit target → type a prompt (e.g. "match this
   lighting") → Run → child appears with a solid parent arrow AND a dashed
   `ref` arrow back to the picked node.
7. **[HUMAN]** Reload the page → identical tree layout and node states.
   Open the same `/c/:id` URL in a second browser (or incognito window) →
   same canvas, same tree (proves canvas-as-URL: the Blob snapshot, not
   local storage, is the source of truth).
8. **[HUMAN]** Error path — do ONE of:
   - Trigger a real content-policy rejection with a bogus/flagged prompt, OR
   - Temporarily unset `FAL_KEY` (or use a bad key) and run any ✦ op.
   Confirm the node lands in an `⚠ <message>` error state (not a silent
   hang or crash) and clicking **Retry** re-runs the same op successfully
   once the underlying issue is fixed.
9. **[HUMAN]** Export the canvas (top-right Export button) → downloads a
   JSON snapshot. Start a new canvas, Import that JSON file back in →
   the full tree (nodes + arrows + positions) reappears identical.
10. **[HUMAN — production only]** Fail-closed check, run against the
    deployed production URL, not local dev:
    ```bash
    curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<prod-url>/api/ops \
      -H 'Content-Type: application/json' -d '{}'
    ```
    Expect `401`. This proves `APP_PASSCODE` is enforced server-side in
    production even with no header sent at all — the passcode gate fails
    CLOSED (`lib/server-auth.ts`: `if (!expected) return process.env.VERCEL_ENV
    !== 'production'`), unlike local dev where an unset passcode fails open.

Every line must pass before shipping. Steps 3, 4, 7, 8, 9, 10 have no
automated substitute — walk them by hand every time before a deploy.

# Execution ledger — task-by-task record of the subagent build, reviews, and adjudications.

Task 1: complete (commits 339cf68..d5c5f56 incl. 948e1d0 CLAUDE.md restore; review clean after 1 fix round; Next 16 adjudicated)
Task 2: complete (commit cdb9806 + doc fix; PASS; review approved; CORS ok; tldraw 5.2.5 corrections recorded)
  Minor (deferred to final review): nano-banana toParams can emit empty image_urls if imageUrl undefined — unreachable via zod route schema, verify in final review
  Live verified post-credits: generate+edit 200s; inpaint deferred to Task 11
Task 3: complete (commit 7c410d7, review approved)
  Minor (deferred): zod v4 deprecation z.string().url() -> z.url() in lib/schemas.ts
Task 4: complete (commit d61cbc5, review approved, live-verified real+mock+400)
  Minor (deferred): clearTimeout on won race in /api/ops; slice-by-code-unit in mock.ts; Task 13 must actually write docs/verify.md incl. prod fail-closed check
Task 5: complete (commits b24185a+ec39856; review approved; security HIGH fixed: proxy CT allowlist+nosniff+CSP, 502 on redirect; re-review approved)
  Minor (deferred): base64 strictness in upload; 8MB cap live-untested
Task 6: complete (commit f671d11, review approved)
  Adjudicated: inert height clamp in displayRectToNatural accepted — aspect-matched display means <=1px overflow, canvas ops clip safely; final review to sanity-check Task 10/11 call sites
  Minor (deferred): Math.max spread scale; O(n*k) collision rebuild
Task 7: complete (commit 4113fa6, review approved)
  CORRECTED KNOWLEDGE: BaseBoxShapeUtil<ImageNodeShape> DOES compile once getIndicatorPath replaces indicator() — Task 7 report's claim 2 is false; plain ShapeUtil + manual getGeometry/onResize kept (harmless, redundant). Cleanup candidate for final review.
  Facts for later tasks: TLGlobalShapePropsMap augmentation required; keep a VALUE import of ImageNodeUtil (not type-only) so augmentation stays in program; Retry button pattern verified against tldraw CSS defaults
Task 8: complete (commits c53f5c8+dc69147; review approved; root multi-variant placement fixed + re-review approved)
  Minor (deferred): done()/fail() mislabel if updateShape throws; createArrow dashed param unused until Task 12
Task 9: complete (commits fd49c11+cbfe509; review approved after form-reset fix; re-review clean)
  Minor (deferred): wholesale zustand subscriptions; as-cast vs type predicate in Inspector; Vary-via-effect indirection
Task 10: complete (commits 2766f99+b8c7542; review approved; precision fix to measured-box fractions + objectFit fill; re-review clean)
  Minor (deferred): resize aspect-lock one-directional; Crop/Resize buttons not gated on status done; RectFrac naming adopted (resolves DisplayRect concern)
Task 11: complete (commits 9adef6a+05a5e6e+5deb74a; review approved after 3-finding fix incl. Critical tool-state bleed; re-review clean; flux-fill live-verified with visual region confirmation)
  Minor (deferred): overlay JSX duplication (border-style param); no unit tests for id regex/fracToNaturalRect/STORAGE_MOCK/debounce
Task 12: complete (commits 8f55378+217cf75; review approved after 5-finding fix incl. 2 Critical pick-flow bugs + dims backfill; re-review clean, nuance proven safe)
  Minor (deferred): sel in dep array redundancy; deselect-to-empty mid-pick hides panel (pre-existing)
Task 12b: complete (commits dee9188+25420be+466d9df+3dab7b8; 5/5 specs stable; 3 fix rounds on error-filter design — final design: console noise ignored, canvas health asserted from response log, PROVEN live via negative check)
  Review-loop note: rounds 1-2 rejected for correlation race / non-consuming excuse / dead snapshot — good catch chain, record for submission narrative
Task 13: complete (commit 8459141, tag v0.1; DEPLOYED https://genmedia-theta.vercel.app; all prod checks green incl. fail-closed 401 + blob round-trip + real generate; task-review folded into final whole-branch review)

Final fix wave (2026-07-21): complete (single commit "fix: interrupted-node
recovery, undo semantics, dark canvas, doc drift, cleanup"). Pre-submission
fixes from the whole-branch review + one human-reported bug:
  1. Stuck-pending recovery: sweepInterruptedNodes(editor) helper swept after
     both loadSnapshot call sites (mount + import) in CanvasApp.tsx — pending
     nodes orphaned by a dead page-load become retryable error nodes instead
     of dead spinners.
  2. Undo semantics: done()/fail()/dims-backfill/retryShape status updates in
     lib/run-op.ts wrapped in editor.run(fn, { history: 'ignore' }) (verified
     against installed tldraw 5.2.5 @tldraw/editor types — TLEditorRunOptions
     extends TLHistoryBatchOptions) so Cmd-Z after a result removes the node
     instead of reverting it to a dead pending spinner.
  3. README dead path: .superpowers/sdd/progress.md copied verbatim to this
     file (docs/superpowers/progress-ledger.md) with a header line; README's
     AI-collaboration section now points at docs/superpowers/ + git history.
  4. Stale doc lines fixed: CLAUDE.md "(React Flow)"->"(tldraw)", the
     persistenceKey clause rewritten to the canvas-as-URL decision, upload op
     marked cut; design spec's persistenceKey sentence annotated superseded;
     README's text-placement claim under pain point 3 corrected (parked, not
     shipped); README/verify.md geometry test claims fixed post-deletion.
  5. Human-reported bug: canvas forced to dark mode via
     editor.user.updateUserPreferences({ colorScheme: 'dark' }) in onMount
     (verified against TLUserPreferences types; inferDarkMode does not exist
     in the installed 5.2.5 props).
  6. Minor: "not synced" corner badge on done+unsynced nodes in
     ImageNodeShape.tsx, tooltip only, no retry wiring (YAGNI per spec).
  7. Minor: save-sync.ts's save() fetch wrapped in try/catch, sets the
     '(not saved)' title on rejection same as the non-ok-response branch.
  8. Cleanup: deleted dead lib/geometry.ts + its test (superseded by
     RectFrac math) and 3 unused public/*.svg scaffold assets; corrected the
     ImageNodeShape.tsx header comment's false BaseBoxShapeUtil claim per the
     Task 7 note above; gated Crop/Resize/Inpaint arming in ActionMenu.tsx on
     status==='done' (resolves the Task 10 deferred-minor above).
  Gates: tsc --noEmit clean; pnpm test 13/13 passing across 3 files (down
  from 16/4 — geometry.test.ts removed); eslint clean. E2E explicitly
  deferred to the controller (human's dev server held port 3000).
  Concerns for controller: undo-semantics (2) and dark-mode default (5) are
  the two changes most worth a real-browser/E2E pass; full details in
  .superpowers/sdd/task-13-report.md "## Final fix wave".

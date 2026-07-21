import { test, expect, type Locator, type Page } from '@playwright/test'

// Mocked demo path (FAL_MOCK=1 STORAGE_MOCK=1): no real fal calls, no blob
// token, no passcode. Every spec asserts zero console errors — this is the
// first time these flows are exercised in a real browser rather than by API
// contract, so a console error is treated as a signal worth failing on.
// Known, by-design noise: CanvasApp.tsx's onMount fetches
// `/api/canvas/:id` to load a prior snapshot; a fresh id 404s and the app
// falls through to starting empty (explicit comment in that file). Chromium
// logs any failed resource fetch as a console 'error' regardless of whether
// application code handles the status, so this fires on every fresh canvas
// — twice, because Next dev's React StrictMode double-invokes the mount
// effect (and therefore the fetch) in development. Verified via
// route.ts: GET can 404 by design, PUT (the save path) never returns 404 —
// so this filter can't mask a real save failure.
const EXPECTED_FRESH_CANVAS_404 = /\/api\/canvas\/[a-z0-9]{12}$/

// Derive bad canvas responses: PUT/POST failures or unexpected GET statuses.
// Evaluated at assertion time (not at setup), so it sees all recorded responses.
const badCanvasResponses = (rs: Array<{ url: string; method: string; status: number }>) =>
  rs.filter(
    (r) =>
      (r.method === 'PUT' && r.status >= 400) ||
      (r.method === 'GET' && r.status !== 200 && r.status !== 404) ||
      (r.method === 'POST' && r.status >= 400)
  )

async function newCanvas(page: Page) {
  const errors: string[] = []

  // Record all /api/canvas responses for network-truth validation.
  // Console messages for /api/canvas are noise (expected mount 404s, React
  // StrictMode double-logs, unordered event delivery); the response log is
  // the source of truth for canvas API health and structurally catches save
  // failures that a console-correlation filter could mask.
  const canvasResponses: Array<{ url: string; method: string; status: number }> = []
  page.on('response', (res) => {
    if (res.url().includes('/api/canvas/')) {
      canvasResponses.push({
        url: res.url(),
        method: res.request().method(),
        status: res.status(),
      })
    }
  })

  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const url = m.location().url
    // Unconditionally ignore console errors from /api/canvas requests;
    // the response handler validates actual API health.
    if (EXPECTED_FRESH_CANVAS_404.test(url)) return
    errors.push(m.text())
  })

  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await page.getByRole('button', { name: /new canvas/i }).click()
  await page.waitForURL(/\/c\/[a-z0-9]{12}/)
  return { errors, canvasResponses }
}

const mockImg = (page: Page) => page.locator('img[src^="data:image/svg"]')

// tldraw's rendered <img> carries pointer-events:none (ImageNodeShape.tsx's
// AssetView — deliberate, so drag/resize handles work over it); tldraw does
// its own geometry-based hit-testing rather than relying on native DOM event
// targets, so a real click dispatched at the node's coordinates still
// selects it correctly even though the browser's native hit-test resolves
// to a DOM element underneath (confirmed against the real app: force-click
// at the node's position correctly selects it and populates the command
// bar's verb row). `force: true` bypasses Playwright's "target element
// receives the event" actionability check, which would otherwise reject
// this by design.
//
// v2 chrome (Task 14): the verb buttons (✦ Edit, Crop, ...), Run/Apply, and
// the prompt fields all moved from the old ActionMenu (floating over the
// node) + Inspector (right-side panel) into one bottom CommandBar, but every
// button/placeholder KEPT ITS TEXT — these selectors are all
// getByRole(name)/getByPlaceholder, i.e. accessible-name based, not
// DOM-position based, so they needed no changes to keep passing. Confirmed
// by reading CommandBar.tsx's render output against each assertion below,
// NOT by an actual E2E run: port 3000 was held by the human's own dev server
// this session (see task-14-report.md "E2E" section) — DEFERRED-PORT-BUSY.
const clickNode = (n: Locator) => n.click({ force: true })

test('generate creates a root node', async ({ page }) => {
  const { errors, canvasResponses } = await newCanvas(page)
  await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/v1 · generate/)).toBeVisible() // pending node, immediate
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 }) // mock fills in (1.5s server delay)
  expect(errors).toEqual([])
  expect(badCanvasResponses(canvasResponses)).toEqual([])
})

test('edit spawns variant children with arrows', async ({ page }) => {
  const { errors, canvasResponses } = await newCanvas(page)
  await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
  await page.keyboard.press('Enter')
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
  await clickNode(mockImg(page).first()) // select node
  await page.getByRole('button', { name: '✦ Edit' }).click()
  await page.getByPlaceholder(/describe the change/i).fill('make it snowy')
  await page.getByRole('button', { name: /^run$/i }).click()
  await expect(mockImg(page)).toHaveCount(2, { timeout: 10_000 })
  await expect(page.getByText(/v2 · edit/)).toBeVisible()
  // Arrow labeled 'edit': confirm the edit operation created a labeled arrow
  // (tldraw's off-screen .tl-text-measure clone sorts first in DOM order, so
  // .last() is the real on-canvas label, mirroring the reference spec's proven
  // pattern for label assertions).
  await expect(page.getByText('edit', { exact: true }).last()).toBeVisible()
  // Solid parent->child arrow: tldraw renders each shape as a
  // div[data-shape-type=<type>] (confirmed against the real DOM — no
  // '.tl-arrow-hint' class exists in the installed 5.2.5).
  await expect(page.locator('div[data-shape-type="arrow"]').first()).toBeVisible()
  expect(errors).toEqual([])
  expect(badCanvasResponses(canvasResponses)).toEqual([])
})

test('canvas persists across reload', async ({ page }) => {
  const { errors, canvasResponses } = await newCanvas(page)
  await page.getByPlaceholder('Describe a new image…').fill('persistence check')
  await page.keyboard.press('Enter')
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
  await page.waitForTimeout(2500) // let debounced save fire (save-sync.ts: 2s debounce)
  await page.reload()
  await expect(page.getByText(/v1 · generate/)).toBeVisible({ timeout: 10_000 })
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
  expect(errors).toEqual([])
  expect(badCanvasResponses(canvasResponses)).toEqual([])
})

// Crop is an INSTANT op (lib/run-op.ts runInstantOp): no 1.5s mock server
// delay, the child is created already status:'done' with a local canvas
// dataURL (image/png, not the svg+xml the generate/edit mock returns — see
// lib/instant-ops.ts's cropImage -> canvas.toDataURL('image/png')). This
// exercises the CropOverlay's real pointer-drag path (use-drag-rect.ts) for
// the first time, rather than asserting against the contract alone.
test('crop drag creates an instant child without panning the canvas', async ({ page }) => {
  const { errors, canvasResponses } = await newCanvas(page)
  await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
  await page.keyboard.press('Enter')
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })

  const node = mockImg(page).first()
  await clickNode(node) // select
  await page.getByRole('button', { name: 'Crop' }).click()
  await expect(page.getByText(/drag on the image to draw a crop rect/i)).toBeVisible()

  const box = await node.boundingBox()
  if (!box) throw new Error('node has no bounding box')
  const nodeCenterBefore = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  // Real mouse drag over the CropOverlay (it sits above AssetView with
  // pointerEvents:'all', zIndex:10 — see CropOverlay.tsx) rather than a
  // synthetic fill of ui-store state, to exercise drag-vs-pan for real.
  const startX = box.x + box.width * 0.2
  const startY = box.y + box.height * 0.2
  const endX = box.x + box.width * 0.8
  const endY = box.y + box.height * 0.8
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 10, startY + 10)
  await page.mouse.move(endX, endY, { steps: 5 })
  await page.mouse.up()

  await expect(page.getByRole('button', { name: /apply — instant/i })).toBeEnabled()
  await page.getByRole('button', { name: /apply — instant/i }).click()

  // Instant: assert it lands fast (no 10s mock-network budget needed).
  await expect(page.locator('img[src^="data:image/png"]')).toHaveCount(1, { timeout: 2_000 })

  // Camera-did-not-pan check: if the drag had panned the canvas instead of
  // drawing a rect, the ORIGINAL node would now sit under a different screen
  // position than before the drag (tldraw pans by translating the camera,
  // which moves every shape's screen bounds together). We assert the
  // originally-selected node's screen position is unchanged post-drag —
  // simpler and more direct than reading the camera signal through a window
  // hook, and it would fail if a pan (rather than a rect-draw) had occurred.
  const boxAfter = await node.boundingBox()
  if (!boxAfter) throw new Error('node lost its bounding box after crop')
  const nodeCenterAfter = { x: boxAfter.x + boxAfter.width / 2, y: boxAfter.y + boxAfter.height / 2 }
  expect(Math.abs(nodeCenterAfter.x - nodeCenterBefore.x)).toBeLessThan(2)
  expect(Math.abs(nodeCenterAfter.y - nodeCenterBefore.y)).toBeLessThan(2)

  expect(errors).toEqual([])
  expect(badCanvasResponses(canvasResponses)).toEqual([])
})

// Reference-pick flow (Task 12): select A, arm Edit, "+ Reference", click B
// (a different done node) on the canvas, expect a "ref: vN" chip and
// selection restored to A (CommandBar.tsx's pick-detection effect — ported
// verbatim from the old Inspector.tsx — snaps tldraw's selection back to the
// edit target after a valid pick). Then Run
// spawns a child off A with both a solid parent arrow and a dashed 'ref'
// arrow from B (lib/run-op.ts createArrow(..., dashed=true) for the ref leg).
test('reference pick flow: chip, selection restore, run', async ({ page }) => {
  const { errors, canvasResponses } = await newCanvas(page)

  // Root A
  await page.getByPlaceholder('Describe a new image…').fill('root A')
  await page.keyboard.press('Enter')
  await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })

  // Root B: CommandBar's idle-mood go() passes sourceId=null every time (was
  // PromptBar's go(), ported unchanged), so a second Enter with nothing
  // selected creates a second ROOT (see run-op.ts: no `sel` is read here,
  // sourceId is always null from the idle-mood generate handler).
  await page.getByPlaceholder('Describe a new image…').fill('root B')
  await page.keyboard.press('Enter')
  await expect(mockImg(page)).toHaveCount(2, { timeout: 10_000 })

  const nodeA = mockImg(page).first()
  const nodeB = mockImg(page).nth(1)

  await clickNode(nodeA)
  await page.getByRole('button', { name: '✦ Edit' }).click()
  await page.getByPlaceholder(/describe the change/i).fill('combine with reference')
  await page.getByRole('button', { name: '+ Reference' }).click()
  await expect(page.getByText(/pick a node/i)).toBeVisible()

  await clickNode(nodeB) // pickable node: dashed border, crosshair cursor (ImageNodeShape.tsx)

  await expect(page.getByText(/ref: v/i)).toBeVisible()
  // Selection restored to A: the ActionMenu (only rendered for the selected
  // image-node) and the Edit form (armedTool survives the pick) are back.
  // Indirect proof: ActionMenu renders for any selected node, but the prompt
  // value still reflects A's edit — if selection had landed on B, the Inspector's
  // reset-effect would have cleared the prompt.
  await expect(page.getByRole('button', { name: '✦ Edit' })).toBeVisible()
  await expect(page.getByPlaceholder(/describe the change/i)).toHaveValue('combine with reference')

  await page.getByRole('button', { name: /^run$/i }).click()
  await expect(mockImg(page)).toHaveCount(3, { timeout: 10_000 })
  await expect(page.getByText(/v3 · edit/)).toBeVisible()

  // Dashed 'ref' arrow: tldraw renders arrow dash style via the SVG path's
  // stroke-dasharray, and the label is a rich-text element inside the arrow
  // shape group carrying the 'ref' text (createArrow(..., 'ref', true) in
  // run-op.ts). tldraw also keeps an off-screen `.tl-text-measure` clone of
  // every rich-text label (used to size the shape) matching the same text —
  // that clone sorts first in DOM order and Playwright correctly reports it
  // as not-visible (zero-size/clipped measurement node), so `.first()` would
  // flake; `.last()` is the real on-canvas label (confirmed against the DOM:
  // its ancestor chain is `.tl-shape > .tl-html-layer > .tl-canvas`).
  await expect(page.getByText('ref', { exact: true }).last()).toBeVisible()

  expect(errors).toEqual([])
  expect(badCanvasResponses(canvasResponses)).toEqual([])
})

import { test, expect, type Page } from '@playwright/test'

// Review fix round 1 — layout collision (Finding 1): the zoom cluster
// (components/CanvasApp.tsx ZoomCluster — bottom-left as of Task 15D, was
// bottom-right) and the centered CommandBar (components/CommandBar.tsx)
// share the same fixed bottom row and must never intersect at any viewport
// width >= 720px, across all four CommandBar moods (idle / selected /
// armed-edit / armed-edit-with-region — Task 18 renamed the fourth mood
// from 'armed-inpaint': Inpaint is no longer its own armed tool, absorbed
// into Edit's "Select region" toggle — see CommandBar.tsx. The tallest,
// most collision-prone shape is now the armed Edit tray WITH region mode
// on (thumb row + region drag-hint + textarea + the full control row,
// which now also carries the "Select region" toggle button), re-measured
// for this task — see app/globals.css's lift-constant derivation comment).
// This spec is the regression guard for that: 3 widths x 4 moods = 12
// bounding-box intersection checks. The intersection check itself
// (`intersects`) is side-agnostic — it only needed updating for the
// cluster's move if the collision MATH changed, and it didn't (the bar is
// centered, so left<->right is symmetric); only this comment and the
// mirrored CSS (app/globals.css) needed the update.

const WIDTHS = [800, 1024, 1440] as const
const HEIGHT = 800

function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

async function newCanvas(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /new canvas/i }).click()
  await page.waitForURL(/\/c\/[a-z0-9]{12}/)
}

const mockImg = (page: Page) => page.locator('img[src^="data:image/svg"]')
const clickNode = (n: ReturnType<typeof mockImg>) => n.first().click({ force: true })

async function assertNoOverlap(page: Page, label: string) {
  const bar = page.locator('.gm-bar')
  const cluster = page.locator('.gm-zoom-cluster')
  await expect(bar).toBeVisible()
  await expect(cluster).toBeVisible()
  const barBox = await bar.boundingBox()
  const clusterBox = await cluster.boundingBox()
  if (!barBox || !clusterBox) throw new Error(`${label}: missing bounding box`)
  expect(intersects(barBox, clusterBox), `${label}: bar ${JSON.stringify(barBox)} vs cluster ${JSON.stringify(clusterBox)}`).toBe(
    false
  )
}

for (const width of WIDTHS) {
  test.describe(`viewport ${width}x${HEIGHT}`, () => {
    test.use({ viewport: { width, height: HEIGHT } })

    test(`idle mood — no overlap at ${width}`, async ({ page }) => {
      await newCanvas(page)
      await assertNoOverlap(page, `idle@${width}`)
    })

    test(`selected mood — no overlap at ${width}`, async ({ page }) => {
      await newCanvas(page)
      await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
      await page.keyboard.press('Enter')
      await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
      await clickNode(mockImg(page))
      await expect(page.getByRole('button', { name: '✦ Edit' })).toBeVisible()
      await assertNoOverlap(page, `selected@${width}`)
    })

    test(`armed-edit mood — no overlap at ${width}`, async ({ page }) => {
      await newCanvas(page)
      await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
      await page.keyboard.press('Enter')
      await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
      await clickNode(mockImg(page))
      await page.getByRole('button', { name: '✦ Edit' }).click()
      await expect(page.getByPlaceholder(/describe the change/i)).toBeVisible()
      await assertNoOverlap(page, `armed-edit@${width}`)
    })

    test(`armed-edit-with-region mood — no overlap at ${width}`, async ({ page }) => {
      await newCanvas(page)
      await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
      await page.keyboard.press('Enter')
      await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
      const node = mockImg(page).first()
      await clickNode(node)
      await page.getByRole('button', { name: '✦ Edit' }).click()
      await page.getByRole('button', { name: 'Select region' }).click()
      await expect(page.getByPlaceholder(/describe the change to this region/i)).toBeVisible()
      // Draw an actual rect (not just toggle "Select region" on) — measured
      // (isolated Playwright sweep, see app/globals.css's lift-constant
      // comment) to add another ~25px to the tray for the "editing this
      // region" badge line (Task 21: reworded from "region locked", same
      // line height/position — see CommandBar.tsx), making THIS the true
      // tallest tray state (317px), not the no-rect-yet toggle state
      // (292px). Exercising the taller state here is what makes this
      // collision guard meaningful.
      const box = await node.boundingBox()
      if (!box) throw new Error('node has no bounding box')
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 5 })
      await page.mouse.up()
      await expect(page.getByText(/editing this region/i)).toBeVisible()
      await assertNoOverlap(page, `armed-edit-with-region@${width}`)
    })
  })
}

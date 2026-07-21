import { test, expect, type Page } from '@playwright/test'

// Review fix round 1 — layout collision (Finding 1): the bottom-right zoom
// cluster (components/CanvasApp.tsx ZoomCluster) and the centered
// CommandBar (components/CommandBar.tsx) share the same fixed bottom row
// and must never intersect at any viewport width >= 720px, across all four
// CommandBar moods (idle / selected / armed-edit / armed-inpaint — the
// armed 'inpaint' tray is the tallest, most collision-prone shape). This
// spec is the regression guard for that: 3 widths x 4 moods = 12 bounding-
// box intersection checks.

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

    test(`armed-inpaint mood — no overlap at ${width}`, async ({ page }) => {
      await newCanvas(page)
      await page.getByPlaceholder('Describe a new image…').fill('a cozy cafe')
      await page.keyboard.press('Enter')
      await expect(mockImg(page)).toHaveCount(1, { timeout: 10_000 })
      await clickNode(mockImg(page))
      await page.getByRole('button', { name: '✦ Inpaint' }).click()
      await expect(page.getByPlaceholder(/describe what appears in the region/i)).toBeVisible()
      await assertNoOverlap(page, `armed-inpaint@${width}`)
    })
  })
}

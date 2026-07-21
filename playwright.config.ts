import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'FAL_MOCK=1 STORAGE_MOCK=1 pnpm dev',
    port: 3000,
    reuseExistingServer: false,
  },
  use: { baseURL: 'http://localhost:3000' },
})

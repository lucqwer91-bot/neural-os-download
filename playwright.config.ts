import { defineConfig } from '@playwright/test'

// End-to-end smoke tests against the built Electron app (run `npm run test:e2e`).
// Files end in .e2e.ts so Vitest does not pick them up.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  reporter: 'list',
  use: { trace: 'off', screenshot: 'only-on-failure' }
})

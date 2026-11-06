import { defineConfig, devices } from '@playwright/test'

// Always use a new loopback-only workerd + local D1/R2 fixture, never a live Site.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/site' }]],
  outputDir: 'test-results/site',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'site-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../site/scripts/site-runtime-serve.mjs --port=4175',
    url: 'http://127.0.0.1:4175/products',
    wait: { stdout: /Isolated Site runtime ready at http:\/\/127\.0\.0\.1:4175;/ },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    timeout: 120_000,
    reuseExistingServer: false,
  },
})

import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))
const e2eDataDirectory = resolve(frontendDirectory, '.playwright-data')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node ../frontend/e2e/reset-data.mjs && ./mvnw spring-boot:run',
      cwd: '../backend',
      env: {
        SMART_INVENTORY_DATA_DIR: e2eDataDirectory,
        SMART_INVENTORY_ALLOWED_ORIGINS: 'http://localhost:5173',
      },
      url: 'http://localhost:8080/api/auth/csrf',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --host localhost',
      cwd: '.',
      url: 'http://localhost:5173/products',
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
})

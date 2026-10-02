import { defineConfig, devices } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = dirname(fileURLToPath(import.meta.url))
const backend = process.env.SMART_INVENTORY_BACKEND ?? 'java'
if (backend !== 'java' && backend !== 'rust') {
  throw new Error('SMART_INVENTORY_BACKEND must be java or rust.')
}
const isRust = backend === 'rust'
const e2eDataDirectory = resolve(frontendDirectory, isRust ? '.playwright-data-rust' : '.playwright-data')

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
      command: isRust
        ? 'node ../frontend/e2e/reset-data.mjs && cargo run --locked --bin smart-inventory-server'
        : 'node ../frontend/e2e/reset-data.mjs && ./mvnw spring-boot:run',
      cwd: isRust ? '../backend-rust' : '../backend',
      env: {
        SMART_INVENTORY_BACKEND: backend,
        SMART_INVENTORY_DATA_DIR: e2eDataDirectory,
        SMART_INVENTORY_ALLOWED_ORIGINS: 'http://localhost:5173',
        SMART_INVENTORY_HOST: '127.0.0.1',
        SMART_INVENTORY_PORT: '8080',
        PORT: '8080',
        SMART_INVENTORY_SECURE_COOKIE: 'false',
      },
      url: 'http://127.0.0.1:8080/api/auth/csrf',
      timeout: isRust ? 300_000 : 120_000,
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

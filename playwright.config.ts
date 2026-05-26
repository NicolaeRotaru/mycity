import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test config.
 *
 * Esperti consultati:
 * - QA Engineer: "Critical path E2E = 80% del valore con 20% dell'effort.
 *   Skip unit test prematuri, focus su flusso buyer/seller/rider end-to-end."
 * - SRE: "headless di default, debug via PLAYWRIGHT_DEBUG=1."
 *
 * Run:
 *   npx playwright install      # 1 volta
 *   npx playwright test         # tutti
 *   npx playwright test --ui    # debug UI
 *   npx playwright test signup  # solo signup
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});

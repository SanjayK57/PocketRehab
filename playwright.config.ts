import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (vite preview).
 * Camera tests use Chromium's fake camera; no real camera or person is needed.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    // The coach speaks; keep test runs silent.
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /responsive\.spec\.ts/ },
    { name: 'tablet-chromium', use: { ...devices['Galaxy Tab S4'] }, testMatch: /responsive\.spec\.ts/ },
  ],
});

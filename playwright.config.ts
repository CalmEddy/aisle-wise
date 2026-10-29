import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests: the built app (vite preview) on a phone-sized screen.
 * Run `npm run build` first, then `npm run e2e`.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    ...devices['Pixel 5'],
    viewport: { width: 375, height: 760 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
});

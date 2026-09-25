import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Use the local Chrome when Playwright's bundled browser isn't installed.
    channel: process.env.PW_CHANNEL || undefined,
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});

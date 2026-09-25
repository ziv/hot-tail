import { defineConfig, devices } from '@playwright/test';

const chromiumArgs = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
];

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        channel: process.env.PW_CHANNEL || undefined,
        launchOptions: { args: chromiumArgs },
      },
    },
    // Other engines run only the determinism check (J4): the sim must hash identically everywhere.
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /determinism/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /determinism/ },
  ],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});

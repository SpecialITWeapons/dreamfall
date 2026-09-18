// The bench runs on Playwright because what it measures is a frame of the real
// page in a real browser. It is a tool, not a test: `playwright.config.ts`
// names `tests/e2e` alone, so `npm run test:e2e` never sees this file, and
// `tools/` never ends up in the bundle.
import { defineConfig, devices } from '@playwright/test';

// A bench is run against a browser somebody chose: the one Playwright brought,
// or a build being compared against another. `BENCH_CHROME` is that choice.
const executablePath = process.env.BENCH_CHROME;

export default defineConfig({
  testDir: '.',
  // Five vantages, rounds of frames each, on a rasteriser with no GPU behind it.
  timeout: 20 * 60_000,
  retries: 0,
  reporter: 'list',
  workers: 1,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'bench',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(executablePath ? { executablePath } : {}),
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});

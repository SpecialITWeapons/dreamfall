// Parity: the same five vantages as the bench, photographed and compared
// against pictures taken earlier on this machine. It is a tool, not a test --
// `playwright.config.ts` names `tests/e2e` alone -- and it never runs in CI.
//
// The references are **not committed**, and that is the whole design decision.
// A reference PNG is a photograph of one rasteriser: CI's SwiftShader would
// pin the repository to whatever `ubuntu-latest` shipped that month, and the
// morning the image changes every reference is stale at once and nobody can
// tell a regression from a driver update. Locally the same rasteriser is
// bit-identical run to run (measured: two captures of one frame differ by 0),
// which is exactly what a before-and-after needs.
import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PARITY_CHROME;

export default defineConfig({
  testDir: '.',
  timeout: 10 * 60_000,
  retries: 0,
  reporter: 'list',
  workers: 1,
  snapshotPathTemplate: '{testDir}/references/{arg}{ext}',
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'parity',
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

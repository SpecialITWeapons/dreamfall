import { defineConfig, devices } from '@playwright/test';

// There is no GPU in CI: Chromium renders WebGL2 in software via SwiftShader.
// Locally the same flags don't get in the way, and without `?webgl=1` the page takes WebGPU.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // One worker, one after another, on purpose. Two workers on four cores were
  // tried: 18.9 minutes instead of 23.7, and three tests timed out that pass
  // alone -- a software rasteriser wants the whole machine, and a second one
  // beside it turns every fifteen-second poll into a coin toss. The time the
  // suite takes is the rasteriser's, not the runner's to parallelise away.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
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

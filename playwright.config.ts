import { defineConfig, devices } from '@playwright/test';

// There is no GPU in CI: Chromium renders WebGL2 in software via SwiftShader.
// Locally the same flags don't get in the way, and without `?webgl=1` the page takes WebGPU.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  // Forty-odd tests in one file ran one after another on one worker, which was
  // forty minutes of CI on a software rasteriser. Each test opens its own page
  // in its own context, so they share nothing but the preview server; two
  // workers on a four-core runner is what the runner can rasterise at once.
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
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

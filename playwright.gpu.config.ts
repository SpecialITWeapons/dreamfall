// The browser tests on this machine's own GPU: the same suite as
// `playwright.config.ts`, with ANGLE on D3D11 instead of SwiftShader. The tests
// still ask for `?webgl=1`, so this is WebGL2 on hardware; it is for a person
// at a machine with a GPU and never runs in CI, where there is none.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'gpu',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-angle=d3d11',
            '--enable-gpu',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
            '--force_high_performance_gpu',
          ],
        },
      },
    },
  ],
});

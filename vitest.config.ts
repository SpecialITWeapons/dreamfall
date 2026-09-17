import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
      // Vitest's own default is five seconds, and a handful of these tests fill
      // a 560 x 560 height window -- the real one, over the real sampler,
      // because a settlement seated against a stub world would prove nothing
      // about the world. One of those takes four to six seconds on this
      // container depending on what else it is doing, which made a green suite
      // a matter of luck. Nothing here should take twenty.
      testTimeout: 20_000,
    },
  }),
);

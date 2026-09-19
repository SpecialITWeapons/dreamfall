// The dump runs on Vitest because it is the one runner this repository already
// carries that can import a TypeScript module of the engine. It is a tool, not
// a test: `tools/` never ends up in the bundle and the unit suite never sees
// this file, because the suite's own config includes `tests/unit` alone.
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from '../../vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: { include: ['tools/figure/*.dump.ts'], environment: 'node', testTimeout: 60_000 },
  }),
);

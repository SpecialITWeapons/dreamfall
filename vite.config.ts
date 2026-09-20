import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    // `three/webgpu` is a megabyte of the bundle and changes only on the
    // upgrade that is its own PR; the engine changes every week. In one chunk a
    // change to the engine invalidated the whole megabyte in every browser's
    // cache, and the warning about a chunk over 500 kB was about that chunk.
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
    // that chunk is a megabyte by nature; the limit is here so the warning
    // means something again when the engine's own chunk crosses it
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5173, strictPort: true },
});

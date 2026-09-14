import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: { target: 'esnext', sourcemap: true },
  server: { port: 5173, strictPort: true },
});

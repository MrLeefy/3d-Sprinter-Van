import { defineConfig } from 'vite';

// SINGLE=1 builds the self-contained page: three.js is left as bare imports and loaded
// from jsDelivr through an import map, so the inlined bundle holds only this project's code.
const single = !!process.env.SINGLE;

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    target: 'es2022',
    minify: !single,
    rollupOptions: single ? { external: [/^three(\/.*)?$/] } : {},
  },
  server: { host: true },
});

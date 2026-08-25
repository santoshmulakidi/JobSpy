import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/audio/capture-preload.ts',
      fileName: () => 'capture-preload.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});

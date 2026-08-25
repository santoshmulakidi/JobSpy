import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/audio/utility-entry.ts',
      fileName: () => 'audio-utility.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});

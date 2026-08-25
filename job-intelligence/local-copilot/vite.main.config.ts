import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/bootstrap.ts',
      fileName: () => 'main.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron', 'ws'],
    },
  },
});

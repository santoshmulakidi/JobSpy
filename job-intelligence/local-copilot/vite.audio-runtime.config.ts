import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main/audio/audio-pipeline-runtime.ts',
      fileName: () => 'audio-pipeline-runtime.cjs',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron', 'node:path'],
    },
  },
});

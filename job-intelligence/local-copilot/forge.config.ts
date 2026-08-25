import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/bootstrap.ts',
            config: 'vite.main.config.ts',
          },
          {
            entry: 'src/preload/index.ts',
            config: 'vite.preload.config.ts',
          },
          {
            entry: 'src/audio/utility-entry.ts',
            config: 'vite.utility.config.ts',
          },
          {
            entry: 'src/audio/capture-preload.ts',
            config: 'vite.capture-preload.config.ts',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.ts',
          },
        ],
      },
    },
  ],
};

export default config;

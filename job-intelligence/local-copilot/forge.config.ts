import type { ForgeConfig } from '@electron-forge/shared-types';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const windowsSigning = process.env.WIN_CERT_FILE
  ? {
      certificateFile: process.env.WIN_CERT_FILE,
      certificatePassword: process.env.WIN_CERT_PASSWORD,
    }
  : {};

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    ...(process.platform === 'win32' ? windowsSigning : {}),
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
      name: '@electron-forge/plugin-fuses',
      config: {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
      },
    },
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
          {
            entry: 'src/main/audio/audio-pipeline-runtime.ts',
            config: 'vite.audio-runtime.config.ts',
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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (...parts: string[]): string => readFileSync(join(root, ...parts), 'utf8');

function collectSources(directory: string, suffixes: string[]): string[] {
  const absolute = join(root, directory);
  const found: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) {
      found.push(...collectSources(join(directory, entry), suffixes));
    } else if (suffixes.some((suffix) => entry.endsWith(suffix))) {
      found.push(readFileSync(path, 'utf8'));
    }
  }
  return found;
}

describe('packaged security audit', () => {
  it('pins the approved Electron runtime', () => {
    const pkg = JSON.parse(read('package.json')) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.electron).toBe('43.0.0');
  });

  it('keeps the sandbox enabled and the renderer on the hardened local scheme', () => {
    const bootstrap = read('src/main/bootstrap.ts');
    expect(bootstrap).toContain('app.enableSandbox()');
    expect(bootstrap).toContain("frame-ancestors 'none'");
    expect(bootstrap).toContain("connect-src 'none'");
    expect(bootstrap).toContain("Only local copilot assets may be loaded.");
  });

  it('blocks navigation away from the local scheme before any window loads', () => {
    const policy = read('src/main/security/navigation-policy.ts');
    expect(policy).toContain("'will-navigate'");
    expect(policy).toContain('event.preventDefault()');
    expect(policy).toContain("action: 'deny'");
  });

  it('exposes only typed bridge methods without raw ipcRenderer channels', () => {
    const preload = read('src/preload/index.ts');
    expect(preload).not.toMatch(/ipcRenderer\.send\b/);
    expect(preload).not.toMatch(/nodeIntegration|contextIsolation:\s*false/);
  });

  it('disables source maps in every production build target', () => {
    for (const config of ['vite.main.config.ts', 'vite.preload.config.ts', 'vite.renderer.config.ts']) {
      expect(read(config)).not.toContain('sourcemap: true');
    }
  });

  it('hardens the packaged app with Electron fuses', () => {
    const forge = read('forge.config.ts');
    expect(forge).toContain('asar: true');
    expect(forge).toContain('[FuseV1Options.RunAsNode]: false');
    expect(forge).toContain('[FuseV1Options.EnableCookieEncryption]: true');
    expect(forge).toContain('[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false');
    expect(forge).toContain('[FuseV1Options.EnableNodeCliInspectArguments]: false');
    expect(forge).toContain('[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true');
    expect(forge).toContain('[FuseV1Options.OnlyLoadAppFromAsar]: true');
  });

  it('contains no hardcoded provider credentials in shipped sources', () => {
    const sources = [
      ...collectSources('src', ['.ts', '.tsx']),
      read('forge.config.ts'),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(source).not.toMatch(/AKIA[0-9A-Z]{16}/);
    }
  });
});

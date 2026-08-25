import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { Database } from '../../src/main/storage/database';
import {
  SecretNotFoundError,
  SecretStorageUnavailableError,
  SecretStore,
  type SafeStorage,
} from '../../src/main/storage/secrets';

const syntheticSecret = 'synthetic-provider-key-9f91b5da-6e62-4a6b-a483';
const workspaceDirectories: string[] = [];

function createWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'local-copilot-storage-'));
  workspaceDirectories.push(directory);
  return directory;
}

function createSafeStorage(available = true): SafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64url')}`),
    decryptString: (value) => Buffer.from(value.toString().replace('encrypted:', ''), 'base64url').toString(),
  };
}

function allFileBytes(directory: string): Buffer[] {
  return readdirSync(directory, { recursive: true })
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => join(directory, entry))
    .filter((path) => lstatSync(path).isFile())
    .map((path) => readFileSync(path));
}

afterEach(() => {
  for (const directory of workspaceDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local storage', () => {
  it('applies the initial schema exactly once and enables WAL', () => {
    const directory = createWorkspace();
    const databasePath = join(directory, 'copilot.sqlite');
    const database = Database.open(databasePath);

    expect(database.connection.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(
      database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual(
      expect.arrayContaining([
        'app_settings',
        'attachments',
        'diagnostic_events',
        'prompt_profiles',
        'provider_configs',
        'recordings',
        'schema_migrations',
        'sessions',
        'transcript_segments',
        'turns',
      ]),
    );
    expect(database.connection.prepare('SELECT version FROM schema_migrations').all()).toEqual([
      { version: 1 },
    ]);
    database.close();

    const reopened = Database.open(databasePath);
    expect(reopened.connection.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    reopened.close();
  });

  it('rolls back all writes when a transaction fails', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));

    expect(() =>
      database.transaction(() => {
        database.connection
          .prepare('INSERT INTO app_settings (setting_key, value_json, updated_at) VALUES (?, ?, ?)')
          .run('theme', '{"mode":"dark"}', '2026-08-24T00:00:00.000Z');
        throw new Error('force rollback');
      }),
    ).toThrow('force rollback');
    expect(database.connection.prepare('SELECT * FROM app_settings').all()).toEqual([]);
    database.close();
  });

  it('keeps a secret out of SQLite and returns only masked status metadata', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));
    const store = new SecretStore({
      database,
      directory: join(directory, 'secrets'),
      safeStorage: createSafeStorage(),
    });

    const status = store.save('openai', syntheticSecret);

    expect(status).toEqual({ providerId: 'openai', configured: true });
    expect(JSON.stringify(status)).not.toContain(syntheticSecret);
    database.close();
    expect(allFileBytes(directory).some((contents) => contents.includes(syntheticSecret))).toBe(false);
  });

  it('decrypts a saved secret only inside the main-process callback', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));
    const store = new SecretStore({
      database,
      directory: join(directory, 'secrets'),
      safeStorage: createSafeStorage(),
    });
    store.save('openai', syntheticSecret);

    let observedSecret: string | undefined;
    const result = store.withSecret('openai', (secret) => {
      observedSecret = secret;
      return 'provider-client-created';
    });

    expect(result).toBe('provider-client-created');
    expect(observedSecret).toBe(syntheticSecret);
    database.close();
  });

  it('replaces an existing secret without returning the secret or its reference', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));
    const store = new SecretStore({
      database,
      directory: join(directory, 'secrets'),
      safeStorage: createSafeStorage(),
    });
    store.save('openai', 'first-secret');

    const status = store.save('openai', syntheticSecret);

    expect(status).toEqual({ providerId: 'openai', configured: true });
    expect(JSON.stringify(status)).not.toContain(syntheticSecret);
    expect(JSON.stringify(status)).not.toContain('secret_reference');
    expect(store.withSecret('openai', (secret) => secret)).toBe(syntheticSecret);
    database.close();
  });

  it('removes a secret and reports masked unconfigured status', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));
    const store = new SecretStore({
      database,
      directory: join(directory, 'secrets'),
      safeStorage: createSafeStorage(),
    });
    store.save('openai', syntheticSecret);

    const status = store.delete('openai');

    expect(status).toEqual({ providerId: 'openai', configured: false });
    expect(JSON.stringify(status)).not.toContain(syntheticSecret);
    expect(() => store.withSecret('openai', () => undefined)).toThrow(SecretNotFoundError);
    database.close();
  });

  it('fails closed before writing when safeStorage encryption is unavailable', () => {
    const directory = createWorkspace();
    const database = Database.open(join(directory, 'copilot.sqlite'));
    const store = new SecretStore({
      database,
      directory: join(directory, 'secrets'),
      safeStorage: createSafeStorage(false),
    });

    expect(() => store.save('openai', syntheticSecret)).toThrow(SecretStorageUnavailableError);
    expect(database.connection.prepare('SELECT * FROM provider_configs').all()).toEqual([]);
    expect(() => readdirSync(join(directory, 'secrets'))).toThrow();
    database.close();
  });
});

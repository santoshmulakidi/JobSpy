import { safeStorage as electronSafeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import { Database } from './database';

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
}

export interface SecretStoreOptions {
  readonly database: Database;
  readonly directory: string;
}

/** Serializable metadata that may safely cross the renderer boundary. */
export interface SecretStatus {
  readonly providerId: string;
  readonly configured: boolean;
}

export class SecretStorageUnavailableError extends Error {
  constructor() {
    super('Protected secret storage is unavailable.');
    this.name = 'SecretStorageUnavailableError';
  }
}

export class SecretNotFoundError extends Error {
  constructor() {
    super('No protected secret is configured for this provider.');
    this.name = 'SecretNotFoundError';
  }
}

export class SecretReferenceInvalidError extends Error {
  constructor() {
    super('Protected secret reference is invalid.');
    this.name = 'SecretReferenceInvalidError';
  }
}

interface SecretReferenceRow {
  secret_reference_id: string | null;
}

const UUID_V4_REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Main-process-only provider secret store. The database contains an opaque file
 * reference; the DPAPI-encrypted payload is stored separately from SQLite.
 */
export class SecretStore {
  private readonly database: Database;
  private readonly directory: string;
  private readonly safeStorage: SafeStorage;

  private constructor(options: SecretStoreOptions, safeStorage: SafeStorage) {
    this.database = options.database;
    this.directory = resolve(options.directory);
    this.safeStorage = safeStorage;
  }

  /** Production construction always uses Electron's Windows-DPAPI safeStorage. */
  static create(options: SecretStoreOptions): SecretStore {
    return new SecretStore(options, electronSafeStorage);
  }

  /** Explicit test seam for isolated unit and integration tests. */
  static createForTesting(options: SecretStoreOptions, safeStorage: SafeStorage): SecretStore {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('Test secret storage is unavailable outside test execution.');
    }
    return new SecretStore(options, safeStorage);
  }

  save(providerId: string, secret: string): SecretStatus {
    this.ensureEncryptionAvailable();
    const encryptedSecret = this.safeStorage.encryptString(secret);
    const previousReference = this.findReference(providerId);
    const reference = randomUUID();
    const secretPath = this.secretPath(reference);

    mkdirSync(this.directory, { recursive: true });
    writeFileSync(secretPath, encryptedSecret, { encoding: undefined, flag: 'wx', mode: 0o600 });

    try {
      this.database.transaction(() => {
        this.database.connection
          .prepare(
            `INSERT INTO provider_configs (provider_id, secret_reference_id)
             VALUES (?, ?)
             ON CONFLICT(provider_id) DO UPDATE SET
               secret_reference_id = excluded.secret_reference_id,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(providerId, reference);
      });
    } catch (error) {
      rmSync(secretPath, { force: true });
      throw error;
    }

    if (previousReference) {
      rmSync(this.secretPath(previousReference), { force: true });
    }
    return { providerId, configured: true };
  }

  withSecret<T>(providerId: string, useSecret: (secret: string) => T): T {
    this.ensureEncryptionAvailable();
    const reference = this.findReference(providerId);
    if (!reference) {
      throw new SecretNotFoundError();
    }

    const path = this.secretPath(reference);
    if (!existsSync(path)) {
      throw new SecretNotFoundError();
    }
    const encryptedSecret = readFileSync(path);
    try {
      return useSecret(this.safeStorage.decryptString(encryptedSecret));
    } finally {
      encryptedSecret.fill(0);
    }
  }

  delete(providerId: string): SecretStatus {
    this.ensureEncryptionAvailable();
    const reference = this.findReference(providerId);
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          'UPDATE provider_configs SET secret_reference_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE provider_id = ?',
        )
        .run(providerId);
    });
    if (reference) {
      rmSync(this.secretPath(reference), { force: true });
    }
    return { providerId, configured: false };
  }

  isConfigured(providerId: string): boolean {
    const reference = this.findReference(providerId);
    return Boolean(reference && existsSync(this.secretPath(reference)));
  }

  private ensureEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError();
    }
  }

  private findReference(providerId: string): string | undefined {
    const row = this.database.connection
      .prepare('SELECT secret_reference_id FROM provider_configs WHERE provider_id = ?')
      .get(providerId) as SecretReferenceRow | undefined;
    const reference = row?.secret_reference_id;
    if (reference !== undefined && reference !== null) {
      this.validateReference(reference);
    }
    return reference ?? undefined;
  }

  private secretPath(reference: string): string {
    this.validateReference(reference);
    const path = resolve(this.directory, `${reference}.bin`);
    const pathFromDirectory = relative(this.directory, path);
    if (
      pathFromDirectory.length === 0 ||
      pathFromDirectory.startsWith('..') ||
      isAbsolute(pathFromDirectory)
    ) {
      throw new SecretReferenceInvalidError();
    }
    return path;
  }

  private validateReference(reference: string): void {
    if (!UUID_V4_REFERENCE.test(reference)) {
      throw new SecretReferenceInvalidError();
    }
  }
}

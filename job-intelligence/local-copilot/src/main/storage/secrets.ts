import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { Database } from './database';

export interface SafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
}

export interface SecretStoreOptions {
  readonly database: Database;
  readonly directory: string;
  readonly safeStorage: SafeStorage;
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

interface SecretReferenceRow {
  secret_reference_id: string | null;
}

/**
 * Main-process-only provider secret store. The database contains an opaque file
 * reference; the DPAPI-encrypted payload is stored separately from SQLite.
 */
export class SecretStore {
  private readonly database: Database;
  private readonly directory: string;
  private readonly safeStorage: SafeStorage;

  constructor(options: SecretStoreOptions) {
    this.database = options.database;
    this.directory = options.directory;
    this.safeStorage = options.safeStorage;
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

  private ensureEncryptionAvailable(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new SecretStorageUnavailableError();
    }
  }

  private findReference(providerId: string): string | undefined {
    const row = this.database.connection
      .prepare('SELECT secret_reference_id FROM provider_configs WHERE provider_id = ?')
      .get(providerId) as SecretReferenceRow | undefined;
    return row?.secret_reference_id ?? undefined;
  }

  private secretPath(reference: string): string {
    return join(this.directory, `${reference}.bin`);
  }
}

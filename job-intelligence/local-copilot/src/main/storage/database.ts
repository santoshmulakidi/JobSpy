import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import initialMigration from './migrations/001-initial.sql?raw';

interface Migration {
  readonly version: number;
  readonly sql: string;
}

const migrations: readonly Migration[] = [{ version: 1, sql: initialMigration }];

/** Main-process-only SQLite access. It is intentionally never exposed over IPC. */
export class Database {
  private constructor(
    readonly path: string,
    readonly connection: DatabaseSync,
  ) {}

  static open(path: string): Database {
    mkdirSync(dirname(path), { recursive: true });
    const connection = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    connection.exec('PRAGMA journal_mode = WAL;');
    connection.exec('PRAGMA foreign_keys = ON;');
    connection.exec('PRAGMA busy_timeout = 5000;');

    const database = new Database(path, connection);
    database.applyMigrations();
    return database;
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.connection.exec('COMMIT;');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }

  private applyMigrations(): void {
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY CHECK (version > 0), applied_at TEXT NOT NULL) STRICT;',
    );
    const appliedVersions = new Set(
      this.connection
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => Number((row as { version: number }).version)),
    );

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      this.transaction(() => {
        this.connection.exec(migration.sql);
        this.connection
          .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
      });
    }
  }
}

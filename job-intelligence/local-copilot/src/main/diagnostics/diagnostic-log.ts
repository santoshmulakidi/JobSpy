import { randomUUID } from 'node:crypto';

import type { Database } from '../storage/database';

const DEFAULT_RETENTION_DAYS = 14;
const MAX_METADATA_ENTRIES = 20;
const MAX_STRING_LENGTH = 200;
const SENSITIVE_KEY_PATTERN =
  /(key|token|secret|password|auth|credential|transcript|question|answer|text|audio|screenshot|image|content|payload|message|path|code|data)/i;

export type RedactedMetadata = Record<string, string | number | boolean | null>;

export interface DiagnosticEventEntry {
  readonly eventId: string;
  readonly subsystem: string;
  readonly eventType: string;
  readonly metadata: RedactedMetadata;
  readonly occurredAt: string;
}

interface EventRow {
  event_id: string;
  subsystem: string;
  event_type: string;
  metadata_json: string;
  occurred_at: string;
}

/**
 * Keeps only primitive values under non-sensitive keys, truncates strings, and
 * drops everything else so diagnostics can never carry prompts, answers, or
 * credentials.
 */
export function redactMetadata(metadata: unknown): RedactedMetadata {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const redacted: RedactedMetadata = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (Object.keys(redacted).length >= MAX_METADATA_ENTRIES) break;
    if (SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (value === null) {
      redacted[key] = null;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      redacted[key] = value;
    } else if (typeof value === 'boolean') {
      redacted[key] = value;
    } else if (typeof value === 'string') {
      redacted[key] = value.slice(0, MAX_STRING_LENGTH);
    }
  }
  return redacted;
}

/** Rolling structured diagnostics with a fixed retention window and redacted payloads. */
export class DiagnosticLog {
  private readonly database: Database;
  private readonly retentionDays: number;
  private readonly now: () => Date;

  constructor(
    database: Database,
    options?: { readonly retentionDays?: number; readonly now?: () => Date },
  ) {
    this.database = database;
    this.retentionDays = options?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.now = options?.now ?? (() => new Date());
  }

  record(event: { readonly subsystem: string; readonly eventType: string; readonly metadata?: unknown }): void {
    this.prune();
    this.database.connection
      .prepare(
        `INSERT INTO diagnostic_events (event_id, subsystem, event_type, metadata_json, occurred_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        event.subsystem,
        event.eventType,
        JSON.stringify(redactMetadata(event.metadata)),
        this.now().toISOString(),
      );
  }

  prune(): number {
    const cutoff = new Date(this.now().getTime() - this.retentionDays * 86_400_000).toISOString();
    const result = this.database.connection
      .prepare('DELETE FROM diagnostic_events WHERE occurred_at < ?')
      .run(cutoff);
    return Number(result.changes);
  }

  recentEvents(limit = 100): DiagnosticEventEntry[] {
    const rows = this.database.connection
      .prepare(
        `SELECT event_id, subsystem, event_type, metadata_json, occurred_at
         FROM diagnostic_events ORDER BY occurred_at DESC LIMIT ?`,
      )
      .all(Math.min(Math.max(1, limit), 500)) as unknown as EventRow[];
    return rows.map((row) => ({
      eventId: row.event_id,
      subsystem: row.subsystem,
      eventType: row.event_type,
      metadata: redactMetadata(safeParse(row.metadata_json)),
      occurredAt: row.occurred_at,
    }));
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

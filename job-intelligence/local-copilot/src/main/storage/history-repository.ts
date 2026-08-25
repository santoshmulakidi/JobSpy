import { randomUUID } from 'node:crypto';

import type { Database } from './database';

export interface HistoryCaptureConfig {
  readonly microphone: boolean;
  readonly systemAudio: boolean;
  readonly sttProviderId: string;
}

export interface HistoryTurn {
  readonly turnId: string;
  readonly role: 'user' | 'model';
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly status: string;
  readonly text: string;
  readonly latencyMs: number | null;
  readonly createdAt: string;
}

export interface HistorySessionSummary {
  readonly sessionId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly turnCount: number;
  readonly preview: string;
}

export interface HistorySessionDetail {
  readonly sessionId: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly captureConfig: HistoryCaptureConfig;
  readonly turns: readonly HistoryTurn[];
}

/** Count-only proof of deletion. It never carries session content. */
export interface DeletionReceipt {
  readonly sessions: number;
  readonly turns: number;
  readonly screenshots: number;
  readonly recordings: number;
}

interface SessionRow {
  session_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  capture_config_json: string;
}

interface TurnRow {
  turn_id: string;
  role: 'user' | 'model';
  provider_id: string | null;
  model_id: string | null;
  status: string;
  text: string;
  latency_ms: number | null;
  created_at: string;
}

interface SummaryRow {
  session_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  preview: string | null;
}

/** Main-process persistence for opted-in sessions. Ephemeral sessions never reach this class. */
export class HistoryRepository {
  private readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  startSession(captureConfig: HistoryCaptureConfig): string {
    const sessionId = randomUUID();
    this.database.connection
      .prepare(
        `INSERT INTO sessions (session_id, profile_id, capture_config_json, status, started_at)
         VALUES (?, NULL, ?, 'active', ?)`,
      )
      .run(sessionId, JSON.stringify(captureConfig), new Date().toISOString());
    return sessionId;
  }

  endSession(sessionId: string): void {
    this.database.connection
      .prepare(
        `UPDATE sessions SET status = 'ended', ended_at = ?
         WHERE session_id = ? AND status = 'active'`,
      )
      .run(new Date().toISOString(), sessionId);
  }

  addUserTurn(sessionId: string, text: string): void {
    this.insertTurn({
      sessionId,
      role: 'user',
      text,
      status: 'completed',
      providerId: null,
      modelId: null,
      latencyMs: null,
    });
  }

  addModelTurn(sessionId: string, turn: {
    readonly providerId: string;
    readonly modelId?: string;
    readonly status: 'completed' | 'failed';
    readonly text: string;
    readonly latencyMs?: number;
  }): void {
    this.insertTurn({
      sessionId,
      role: 'model',
      text: turn.text,
      status: turn.status,
      providerId: turn.providerId,
      modelId: turn.modelId ?? null,
      latencyMs: turn.latencyMs ?? null,
    });
  }

  listSessions(limit = 20): HistorySessionSummary[] {
    const rows = this.database.connection
      .prepare(
        `SELECT s.session_id, s.status, s.started_at, s.ended_at,
           (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.session_id) AS turn_count,
           (SELECT t.text FROM turns t WHERE t.session_id = s.session_id AND t.role = 'user'
             ORDER BY t.created_at LIMIT 1) AS preview
         FROM sessions s
         ORDER BY s.started_at DESC
         LIMIT ?`,
      )
      .all(Math.min(Math.max(1, limit), 100)) as unknown as SummaryRow[];
    return rows.map((row) => ({
      sessionId: row.session_id,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      turnCount: Number(row.turn_count),
      preview: row.preview ?? '',
    }));
  }

  getSession(sessionId: string): HistorySessionDetail | undefined {
    const session = this.database.connection
      .prepare('SELECT session_id, status, started_at, ended_at, capture_config_json FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRow | undefined;
    if (!session) return undefined;

    let captureConfig: HistoryCaptureConfig = { microphone: false, systemAudio: false, sttProviderId: '' };
    try {
      captureConfig = { ...captureConfig, ...JSON.parse(session.capture_config_json) } as HistoryCaptureConfig;
    } catch {
      // Corrupt metadata keeps the session readable with defaults.
    }

    const turns = this.database.connection
      .prepare(
        `SELECT turn_id, role, provider_id, model_id, status, text, latency_ms, created_at
         FROM turns WHERE session_id = ? ORDER BY created_at`,
      )
      .all(sessionId) as unknown as TurnRow[];

    return {
      sessionId: session.session_id,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      captureConfig,
      turns: turns.map((turn) => ({
        turnId: turn.turn_id,
        role: turn.role,
        providerId: turn.provider_id,
        modelId: turn.model_id,
        status: turn.status,
        text: turn.text,
        latencyMs: turn.latency_ms === null ? null : Number(turn.latency_ms),
        createdAt: turn.created_at,
      })),
    };
  }

  deleteSession(sessionId: string): DeletionReceipt | null {
    return this.database.transaction(() => {
      const existing = this.database.connection
        .prepare('SELECT session_id FROM sessions WHERE session_id = ?')
        .get(sessionId);
      if (!existing) return null;
      return this.deleteWhere('session_id = ?', sessionId);
    });
  }

  purgeAll(): DeletionReceipt {
    return this.database.transaction(() => this.deleteWhere('1 = 1'));
  }

  private deleteWhere(where: string, ...params: readonly string[]): DeletionReceipt {
    const counts = {
      turns: this.countRows('turns', where, params),
      screenshots: this.countRows('attachments', where, params),
      recordings: this.countRows('recordings', where, params),
    };
    const result = this.database.connection
      .prepare(`DELETE FROM sessions WHERE ${where}`)
      .run(...params);
    return { sessions: Number(result.changes), ...counts };
  }

  private countRows(table: 'turns' | 'attachments' | 'recordings', where: string, params: readonly string[]): number {
    const row = this.database.connection
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
      .get(...params) as { n: number | bigint };
    return Number(row.n);
  }

  addRecording(sessionId: string, fileReference: string): void {
    this.database.connection
      .prepare(
        `INSERT INTO recordings (recording_id, session_id, file_reference, retention_policy_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), sessionId, fileReference, JSON.stringify({ retainDays: null }), new Date().toISOString());
  }

  private insertTurn(turn: {
    readonly sessionId: string;
    readonly role: 'user' | 'model';
    readonly providerId: string | null;
    readonly modelId: string | null;
    readonly status: string;
    readonly text: string;
    readonly latencyMs: number | null;
  }): void {
    this.database.connection
      .prepare(
        `INSERT INTO turns (turn_id, session_id, role, provider_id, model_id, status, text, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        turn.sessionId,
        turn.role,
        turn.providerId,
        turn.modelId,
        turn.status,
        turn.text,
        turn.latencyMs,
        new Date().toISOString(),
      );
  }
}

const EXPORT_FILENAME_STAMP = /[:]/g;

export function exportSessionMarkdown(detail: HistorySessionDetail): string {
  const lines: string[] = [
    `# Copilot session ${detail.sessionId.slice(0, 8)}`,
    '',
    `- Started: ${detail.startedAt}`,
    `- Ended: ${detail.endedAt ?? '(active)'}`,
    `- Status: ${detail.status}`,
    `- Capture: ${describeCapture(detail.captureConfig)}`,
    '',
  ];
  for (const turn of detail.turns) {
    lines.push(`## ${turn.role === 'user' ? 'Question' : 'Answer'} — ${turn.createdAt}`);
    if (turn.role === 'model') {
      const source = [turn.providerId, turn.modelId].filter(Boolean).join(' · ');
      const suffix = [source || null, turn.latencyMs === null ? null : `${turn.latencyMs} ms`, turn.status]
        .filter(Boolean)
        .join(', ');
      lines.push(`*${suffix}*`);
    }
    lines.push('', turn.text.trim() || '(no content)', '');
  }
  return lines.join('\n');
}

export function exportSessionJson(detail: HistorySessionDetail): string {
  return JSON.stringify(detail, null, 2);
}

export function historyExportFilename(detail: HistorySessionDetail, format: 'markdown' | 'json'): string {
  const stamp = detail.startedAt.replace(EXPORT_FILENAME_STAMP, '-').slice(0, 19);
  return `copilot-session-${stamp}.${format === 'json' ? 'json' : 'md'}`;
}

function describeCapture(config: HistoryCaptureConfig): string {
  const sources = [
    ...(config.microphone ? ['microphone'] : []),
    ...(config.systemAudio ? ['system audio'] : []),
  ];
  const source = sources.length ? sources.join(' + ') : 'no audio';
  return `${source} via ${config.sttProviderId || 'unknown provider'}`;
}

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DiagnosticLog } from '../../src/main/diagnostics/diagnostic-log';
import { Database } from '../../src/main/storage/database';
import { HistoryRepository } from '../../src/main/storage/history-repository';

const workspaces: string[] = [];
const databases: Database[] = [];

function createWorkspace(): { repository: HistoryRepository; diagnostics: DiagnosticLog; database: Database; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'local-copilot-privacy-'));
  workspaces.push(directory);
  const path = join(directory, 'copilot.sqlite');
  const database = Database.open(path);
  databases.push(database);
  return {
    repository: new HistoryRepository(database),
    diagnostics: new DiagnosticLog(database),
    database,
    path,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('privacy lifecycle', () => {
  let workspace!: ReturnType<typeof createWorkspace>;

  beforeEach(() => {
    workspace = createWorkspace();
  });

  function seedSession(prefix: string): string {
    const sessionId = workspace.repository.startSession({ microphone: true, systemAudio: false, sttProviderId: 'deepgram' });
    workspace.repository.addUserTurn(sessionId, `${prefix} question about the notice period`);
    workspace.repository.addModelTurn(sessionId, {
      providerId: 'openai',
      modelId: 'gpt-test',
      status: 'completed',
      text: `${prefix} answer with sk-synthetic-${prefix}-key inside`,
      latencyMs: 120,
    });
    return sessionId;
  }

  function seedScreenshotAndRecording(sessionId: string, prefix: string): void {
    workspace.database.connection
      .prepare(
        `INSERT INTO attachments (attachment_id, session_id, kind, approved_file_reference, metadata_json, created_at)
         VALUES (?, ?, 'screenshot', NULL, ?, ?)`,
      )
      .run(`att-${prefix}`, sessionId, JSON.stringify({ width: 100 }), new Date().toISOString());
    workspace.database.connection
      .prepare(
        `INSERT INTO recordings (recording_id, session_id, file_reference, retention_policy_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(`rec-${prefix}`, sessionId, `recordings/${prefix}.pcm`, JSON.stringify({ retainDays: 7 }), new Date().toISOString());
  }

  it('deletes one session with a receipt that carries counts only', () => {
    const removedId = seedSession('removed');
    const keptId = seedSession('kept');
    seedScreenshotAndRecording(removedId, 'removed');

    const receipt = workspace.repository.deleteSession(removedId);

    expect(receipt).toEqual({ sessions: 1, turns: 2, screenshots: 1, recordings: 1 });
    expect(Object.values(receipt!).every((value) => typeof value === 'number' && Number.isInteger(value))).toBe(true);
    expect(workspace.repository.getSession(removedId)).toBeUndefined();
    expect(workspace.repository.getSession(keptId)).toBeDefined();
    expect(workspace.database.connection
      .prepare('SELECT COUNT(*) AS n FROM turns WHERE session_id = ?')
      .get(keptId)).toMatchObject({ n: 2 });
  });

  it('purges every session and leaves no synthetic content in the database file', () => {
    const firstId = seedSession('first');
    const secondId = seedSession('second');
    seedScreenshotAndRecording(firstId, 'first');

    const receipt = workspace.repository.purgeAll();

    expect(receipt).toEqual({ sessions: 2, turns: 4, screenshots: 1, recordings: 1 });
    for (const table of ['sessions', 'turns', 'attachments', 'recordings']) {
      expect(workspace.database.connection.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 });
    }

    workspace.database.connection.exec('VACUUM;');
    workspace.database.connection.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const bytes = readFileSync(workspace.path).toString('latin1');
    expect(bytes).not.toContain('sk-synthetic-first-key');
    expect(bytes).not.toContain('sk-synthetic-second-key');
    expect(bytes).not.toContain('question about the notice period');
  });

  it('records diagnostics with redacted metadata and never stores content or credentials', () => {
    workspace.diagnostics.record({
      subsystem: 'answers',
      eventType: 'generation-failed',
      metadata: {
        providerId: 'openai',
        apiKey: 'sk-must-not-persist',
        transcript: 'the user said something private',
        latencyMs: 432,
        attempts: 2,
        note: 'x'.repeat(500),
        nested: { hidden: true },
      },
    });

    const events = workspace.diagnostics.recentEvents();
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event).toMatchObject({ subsystem: 'answers', eventType: 'generation-failed' });
    expect(event.metadata).toEqual({
      providerId: 'openai',
      latencyMs: 432,
      attempts: 2,
      note: 'x'.repeat(200),
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('sk-must-not-persist');
    expect(serialized).not.toContain('something private');
    expect(serialized).not.toContain('hidden');
  });

  it('prunes diagnostic events older than the retention window', () => {
    let now = new Date('2026-08-25T12:00:00.000Z');
    const rolling = new DiagnosticLog(workspace.database, { now: () => now });
    rolling.record({ subsystem: 'audio', eventType: 'utility-process-failed' });
    rolling.record({ subsystem: 'transcription', eventType: 'transcription-failed' });
    expect(rolling.recentEvents()).toHaveLength(2);

    now = new Date(now.getTime() + 14 * 86_400_000);
    expect(rolling.prune()).toBe(0);
    expect(rolling.recentEvents()).toHaveLength(2);

    now = new Date(now.getTime() + 86_400_000);
    expect(rolling.prune()).toBe(2);
    expect(rolling.recentEvents()).toHaveLength(0);

    rolling.record({ subsystem: 'answers', eventType: 'generation-failed' });
    expect(rolling.recentEvents()).toHaveLength(1);
  });
});

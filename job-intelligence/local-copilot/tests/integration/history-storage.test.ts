import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Database } from '../../src/main/storage/database';
import {
  exportSessionJson,
  exportSessionMarkdown,
  HistoryRepository,
  historyExportFilename,
} from '../../src/main/storage/history-repository';

const workspaces: string[] = [];
const databases: Database[] = [];

function createRepository(): { repository: HistoryRepository; database: Database } {
  const directory = mkdtempSync(join(tmpdir(), 'local-copilot-history-'));
  workspaces.push(directory);
  const database = Database.open(join(directory, 'copilot.sqlite'));
  databases.push(database);
  return { repository: new HistoryRepository(database), database };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

let active!: HistoryRepository;

beforeEach(() => {
  active = createRepository().repository;
});

describe('HistoryRepository', () => {
  it('persists an opted-in session with question and answer turns', () => {
    const sessionId = active.startSession({ microphone: true, systemAudio: false, sttProviderId: 'deepgram' });
    expect(active.listSessions()).toHaveLength(1);

    active.addUserTurn(sessionId, 'What is the notice period?');
    active.addModelTurn(sessionId, {
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
      status: 'completed',
      text: 'The posting mentions two weeks.',
      latencyMs: 432,
    });

    const summary = active.listSessions()[0]!;
    expect(summary).toMatchObject({
      sessionId,
      status: 'active',
      turnCount: 2,
      preview: 'What is the notice period?',
    });

    const detail = active.getSession(sessionId)!;
    expect(detail.captureConfig).toEqual({ microphone: true, systemAudio: false, sttProviderId: 'deepgram' });
    expect(detail.turns.map(({ role, status }) => `${role}:${status}`)).toEqual(['user:completed', 'model:completed']);
    expect(detail.turns[1]).toMatchObject({ modelId: 'gpt-4o-mini', latencyMs: 432 });

    active.endSession(sessionId);
    expect(active.listSessions()[0]).toMatchObject({ status: 'ended', turnCount: 2 });
  });

  it('records failed answers without content and keeps the pairing', () => {
    const sessionId = active.startSession({ microphone: false, systemAudio: true, sttProviderId: 'elevenlabs' });
    active.addUserTurn(sessionId, 'Why did the request fail?');
    active.addModelTurn(sessionId, { providerId: 'gemini', status: 'failed', text: '' });

    const turns = active.getSession(sessionId)!.turns;
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: 'model', status: 'failed', text: '' });
  });

  it('deletes sessions with count-only receipts and reports unknown ids', () => {
    const sessionId = active.startSession({ microphone: false, systemAudio: false, sttProviderId: 'deepgram' });
    active.addUserTurn(sessionId, 'What is the notice period?');

    expect(active.deleteSession(sessionId)).toEqual({ sessions: 1, turns: 1, screenshots: 0, recordings: 0 });
    expect(active.deleteSession(sessionId)).toBeNull();
    expect(active.listSessions()).toHaveLength(0);
    expect(active.getSession(sessionId)).toBeUndefined();
  });

  it('bounds listing and survives corrupt capture metadata', () => {
    const { repository, database } = createRepository();
    database.connection
      .prepare("INSERT INTO sessions (session_id, profile_id, capture_config_json, status, started_at) VALUES ('broken', NULL, '{not-json', 'active', ?)")
      .run(new Date().toISOString());

    const broken = repository.getSession('broken')!;
    expect(broken.captureConfig).toEqual({ microphone: false, systemAudio: false, sttProviderId: '' });
    expect(repository.listSessions(500).length).toBeLessThanOrEqual(100);
    expect(repository.listSessions(0)).toHaveLength(1);
  });

  it('exports markdown and json with a stable filename stamp', () => {
    const sessionId = active.startSession({ microphone: true, systemAudio: true, sttProviderId: 'deepgram' });
    active.endSession(sessionId);
    active.addUserTurn(sessionId, 'Is this offer safe?');
    active.addModelTurn(sessionId, {
      providerId: 'anthropic',
      modelId: 'claude-test',
      status: 'completed',
      text: '**Yes** — the equity section is standard.',
      latencyMs: 250,
    });
    const detail = active.getSession(sessionId)!;

    const markdown = exportSessionMarkdown(detail);
    expect(markdown).toContain('# Copilot session');
    expect(markdown).toContain('- Capture: microphone + system audio via deepgram');
    expect(markdown).toContain('## Question —');
    expect(markdown).toContain('**Yes** — the equity section is standard.');

    const json = JSON.parse(exportSessionJson(detail));
    expect(json.sessionId).toBe(sessionId);
    expect(json.turns).toHaveLength(2);
    expect(historyExportFilename(detail, 'markdown')).toMatch(/^copilot-session-\d{4}-\d{2}-\d{2}[T-][\d-]{8}\.md$/);
    expect(historyExportFilename(detail, 'json')).toMatch(/\.json$/);
  });
});

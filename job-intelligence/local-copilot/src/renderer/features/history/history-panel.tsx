import type { CopilotController, CopilotUiState, HistoryExportFormat } from '../../../renderer/copilot-controller';

function formatStartedAt(startedAt: string): string {
  const date = new Date(startedAt);
  return Number.isNaN(date.getTime()) ? startedAt : date.toLocaleString();
}

export function HistoryPanel({ state, controller }: { readonly state: CopilotUiState; readonly controller: CopilotController }) {
  if (!state.persistHistory) {
    return <section className="panel history-panel" aria-labelledby="history-heading">
      <div className="section-heading"><div><p className="eyebrow">Stored on this device only</p><h2 id="history-heading">History</h2></div></div>
      <p className="placeholder">Sessions are ephemeral. Enable “Save history” to keep questions and answers here.</p>
    </section>;
  }

  return <section className="panel history-panel" aria-labelledby="history-heading">
    <div className="section-heading"><div><p className="eyebrow">Stored on this device only</p><h2 id="history-heading">History</h2></div><button type="button" onClick={() => void controller.loadHistory()}>Refresh</button></div>
    {state.history.length === 0
      ? <p className="placeholder">No saved sessions yet.</p>
      : <ul aria-label="Saved sessions">{state.history.map((session) => (
        <li key={session.sessionId}>
          <span>{formatStartedAt(session.startedAt)}</span>
          <small>{session.turnCount} turn{session.turnCount === 1 ? '' : 's'} · {session.status}</small>
          <small>{session.preview.slice(0, 80) || '(no question)'}</small>
          <span className="status">
            <button type="button" disabled={session.turnCount === 0} data-format="markdown" onClick={() => void controller.exportHistory(session.sessionId, 'markdown' satisfies HistoryExportFormat)}>Markdown</button>
            <button type="button" disabled={session.turnCount === 0} data-format="json" onClick={() => void controller.exportHistory(session.sessionId, 'json' satisfies HistoryExportFormat)}>JSON</button>
            <button type="button" className="danger" onClick={() => void controller.deleteHistory(session.sessionId)}>Delete</button>
          </span>
        </li>
      ))}</ul>}
  </section>;
}

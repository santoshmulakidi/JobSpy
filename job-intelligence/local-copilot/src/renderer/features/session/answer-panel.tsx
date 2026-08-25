import type { CopilotController, CopilotUiState } from '../../copilot-controller';
import { StreamingMarkdown } from './streaming-markdown';

export function AnswerPanel({ state, controller }: { readonly state: CopilotUiState; readonly controller: CopilotController }) {
  return <section className="panel answer-panel" aria-labelledby="answer-heading">
    <div className="section-heading"><div><p className="eyebrow">Local overlay</p><h2 id="answer-heading">Answer</h2></div>{state.model && <span className="status">{state.model} · {state.latencyMs} ms</span>}</div>
    <div aria-live="polite" aria-busy={state.answerPending}>{state.answer ? <StreamingMarkdown content={state.answer} /> : <p className="placeholder">Answers stream here as inert, sanitized Markdown.</p>}</div>
    <div className="button-row"><button type="button" disabled={!state.answerPending} onClick={() => void controller.cancelAnswer()}>Cancel</button><button type="button" disabled={!state.answerConnected || !state.transcriptDraft.trim()} onClick={() => void controller.retryAnswer()}>Retry</button></div>
  </section>;
}

import type { CopilotController, CopilotUiState } from '../../copilot-controller';

export function TranscriptPanel({ state, controller }: { readonly state: CopilotUiState; readonly controller: CopilotController }) {
  return <section className="panel" aria-labelledby="transcript-heading">
    <div className="section-heading"><div><p className="eyebrow">Edit before sending</p><h2 id="transcript-heading">Question</h2></div><span className="status">{state.transcriptFinal ? 'Ready' : 'Listening'}</span></div>
    <label className="sr-only" htmlFor="transcript">Transcript or question</label>
    <textarea id="transcript" rows={3} value={state.transcriptDraft} placeholder="Captured speech appears here…" onChange={(event) => controller.editTranscript(event.currentTarget.value)} />
    <button className="primary" type="button" disabled={!state.answerConnected || !state.transcriptDraft.trim()} onClick={() => void controller.sendQuestion()}>Send question</button>
    {!state.answerConnected && <small>Answer sending activates when the typed provider event bridge is connected.</small>}
  </section>;
}

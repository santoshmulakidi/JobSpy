import type { CopilotController, CopilotUiState } from '../../copilot-controller';
import { ScreenshotPreview } from './screenshot-preview';
import { AnswerPanel } from './answer-panel';
import { TranscriptPanel } from './transcript-panel';

export function SessionView({ state, controller }: { readonly state: CopilotUiState; readonly controller: CopilotController }) {
  const active = ['capturing', 'paused', 'generating'].includes(state.phase);
  return <>
    <section className="session-bar" aria-label="Session controls">
      <div aria-live="polite"><span className={`signal signal-${state.phase}`} /> <strong>{phaseLabel(state.phase)}</strong></div>
      <div className="button-row">
        {!active && <button className="primary" type="button" disabled={state.sessionPending} onClick={() => void controller.startSession()}>Start session</button>}
        {active && <button className="danger" type="button" disabled={state.sessionPending} onClick={() => void controller.stopSession()}>Stop</button>}
        <button type="button" onClick={() => void controller.previewScreenshot()}>Screenshot</button>
      </div>
    </section>
    {state.screenshot && <ScreenshotPreview preview={state.screenshot} approved={state.approvedScreenshotId === state.screenshot.id} onConfirm={(id, edits) => void controller.confirmScreenshot(id, edits)} onRemove={(id) => void controller.discardScreenshot(id)} />}
    <TranscriptPanel state={state} controller={controller} />
    <AnswerPanel state={state} controller={controller} />
  </>;
}

function phaseLabel(phase: CopilotUiState['phase']): string {
  return ({ idle: 'Ready', capturing: 'Listening', paused: 'Paused', generating: 'Answering', error: 'Needs attention', stopped: 'Stopped' })[phase];
}

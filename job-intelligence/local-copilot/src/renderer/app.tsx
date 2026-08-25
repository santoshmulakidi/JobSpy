import { useEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

import { createCopilotController, type CopilotController } from './copilot-controller';
import { HistoryPanel } from './features/history/history-panel';
import { ProviderSetup } from './features/settings/provider-setup';
import { SessionView } from './features/session/session-view';
import './styles/tokens.css';

export function CopilotApp({ controller }: { readonly controller: CopilotController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => { if (!state.loaded) void controller.load(); }, [controller, state.loaded]);

  return <main className="app-shell" data-theme={state.theme} style={{ '--font-scale': state.fontScale } as React.CSSProperties}>
    <header className="titlebar">
      <button className="drag-handle" type="button" aria-label="Move copilot overlay" title="Drag to move the overlay"><span aria-hidden="true" className="grip" /><span>Local Copilot</span></button>
      <span className="privacy-chip">Ephemeral by default</span>
      <button type="button" aria-label="Hide copilot instantly" title="Hide instantly" onClick={() => void controller.hide()}>Hide</button>
    </header>
    <div className="messages"><p aria-live="polite">{state.message}</p><p role="alert">{state.error}</p></div>
    <div className="workspace">
      <div className="primary-column"><SessionView state={state} controller={controller} /></div>
      <aside className="settings-column" aria-label="Copilot settings">
        <ProviderSetup state={state} controller={controller} />
        <section className="panel compact-settings" aria-labelledby="display-heading">
          <h2 id="display-heading">Overlay</h2>
          <label>Theme<select value={state.theme} onChange={(event) => controller.setTheme(event.currentTarget.value as typeof state.theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Text size <output>{Math.round(state.fontScale * 100)}%</output><input type="range" min="0.9" max="1.4" step="0.1" value={state.fontScale} onChange={(event) => controller.setFontScale(event.currentTarget.valueAsNumber)} /></label>
          <label>Opacity <output>{Math.round(state.opacity * 100)}%</output><input type="range" min="0.1" max="1" step="0.1" value={state.opacity} onChange={(event) => void controller.setOpacity(event.currentTarget.valueAsNumber)} /></label>
          <label className="check"><input type="checkbox" checked={state.alwaysOnTop} onChange={(event) => void controller.setAlwaysOnTop(event.currentTarget.checked)} /> Always on top</label>
          <label className="check"><input type="checkbox" checked={state.persistHistory} onChange={(event) => controller.setPersistHistory(event.currentTarget.checked)} /> Save history</label>
          <fieldset><legend>Move overlay</legend><div className="button-row"><button type="button" aria-label="Move overlay left" onClick={() => void controller.move(-20, 0)}>←</button><button type="button" aria-label="Move overlay up" onClick={() => void controller.move(0, -20)}>↑</button><button type="button" aria-label="Move overlay down" onClick={() => void controller.move(0, 20)}>↓</button><button type="button" aria-label="Move overlay right" onClick={() => void controller.move(20, 0)}>→</button></div></fieldset>
          <small>Window edges remain natively resizable. Global shortcuts are unavailable in this build.</small>
        </section>
        <HistoryPanel state={state} controller={controller} />
      </aside>
    </div>
    <div className="resize-hint" aria-hidden="true" />
  </main>;
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (!root) throw new Error('Renderer root is missing.');
  createRoot(root).render(<CopilotApp controller={createCopilotController(window.copilot)} />);
}

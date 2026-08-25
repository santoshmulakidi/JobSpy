import { useState, type FormEvent } from 'react';

import type { CopilotController, CopilotUiState } from '../../copilot-controller';

export function ProviderSetup({ state, controller }: { readonly state: CopilotUiState; readonly controller: CopilotController }) {
  const [providerId, setProviderId] = useState('');
  const [secret, setSecret] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void controller.saveProviderSecret(providerId, secret).then(() => setSecret(''));
  };
  const llm = state.providers.filter(({ kind }) => kind === 'llm');
  const stt = state.providers.filter(({ kind }) => kind === 'stt');
  const selected = state.providers.find(({ id }) => id === providerId);

  return <section className="panel provider-setup" aria-labelledby="provider-heading">
    <div className="section-heading"><div><p className="eyebrow">Bring your own key</p><h2 id="provider-heading">Providers</h2></div></div>
    <label>Speech provider<select value={state.selectedSttProviderId} onChange={(event) => controller.selectSttProvider(event.currentTarget.value)}>
      <option value="">Choose speech provider</option>{stt.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
    </select></label>
    <label>Answer provider<select value={state.selectedLlmProviderId} onChange={(event) => controller.selectLlmProvider(event.currentTarget.value)}>
      <option value="">Choose answer provider</option>{llm.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}{provider.optional ? ' — optional' : ''}</option>)}
    </select></label>
    {state.selectedLlmProviderId === 'opencode' && <aside className="attention" role="note"><strong>OpenCode ox-alpha is experimental and may be unstable.</strong> ox-alpha and ox-alpha-free may change without notice.</aside>}
    {state.providers.find(({ id }) => id === state.selectedLlmProviderId)?.models?.length ? <label>OpenCode model<select value={state.selectedModel} onChange={(event) => controller.selectModel(event.currentTarget.value)}>
      {state.providers.find(({ id }) => id === state.selectedLlmProviderId)!.models!.map((model) => <option key={model}>{model}</option>)}
    </select></label> : null}
    <ul className="disclosures" aria-label="Provider destinations">{state.providers.map((provider) => <li key={provider.id}><span>{provider.name}</span><small>{provider.destination}</small><span className={`status ${provider.validated ? 'good' : ''}`}>{provider.validated ? 'Validated' : provider.configured ? 'Key saved' : 'Not configured'}</span></li>)}</ul>
    <form onSubmit={submit} className="secret-form">
      <label>Provider for API key<select required value={providerId} onChange={(event) => setProviderId(event.currentTarget.value)}><option value="">Choose provider</option>{state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
      <label>API key<input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.currentTarget.value)} /></label>
      <div className="button-row"><button className="primary" type="submit">Save key</button><button type="button" disabled={!selected?.configured} onClick={() => void controller.testProvider(providerId)}>Test connection</button></div>
      <small>Keys are sent to the main process for Windows-protected storage and are never shown again.</small>
    </form>
  </section>;
}

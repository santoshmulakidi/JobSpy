const { ipcRenderer } = require('electron');

ipcRenderer.on('audio:capture-port', (event, message) => {
  if (message?.type !== 'audio-capture-port' || event.ports.length !== 1) {
    ipcRenderer.send('audio-fixture-error', 'invalid capture connection');
    return;
  }
  const [port] = event.ports;
  port.onmessage = ({ data }) => {
    if (data?.type === 'start-capture' && data.lifecycle === message.lifecycle) {
      for (const [capturedAt, values] of [[10, [1, 2, 3, 4]], [20, [5, 6, 7, 8]]]) {
        const pcm = Int16Array.from(values);
        port.postMessage({
          type: 'audio-chunk',
          lifecycle: message.lifecycle,
          chunk: { source: 'microphone', capturedAt, sampleRate: 48_000, channels: 1, pcm },
        });
        pcm.fill(0);
        ipcRenderer.send('audio-fixture-detached', pcm.every((sample) => sample === 0));
      }
    } else if (data?.type === 'stop-capture') {
      port.postMessage({ type: 'capture-stopped', lifecycle: message.lifecycle });
      port.close();
    }
  };
  port.start();
});

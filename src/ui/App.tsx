import { useEffect, useState } from 'react';

import { isPluginToUIMessage, type PluginToUIMessage } from '../shared/messages';
import { postToPlugin } from './messages';

const INITIAL_SOURCE = String.raw`Write Markdown with inline math such as $\alpha + \beta$.`;

export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [status, setStatus] = useState('Loading selection settings…');

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const candidate =
        typeof event.data === 'object' && event.data !== null && 'pluginMessage' in event.data
          ? (event.data as { pluginMessage?: unknown }).pluginMessage
          : undefined;

      if (!isPluginToUIMessage(candidate)) return;

      handlePluginMessage(candidate, setSource, setStatus);
    };

    window.addEventListener('message', onMessage);
    postToPlugin({ type: 'REQUEST_SELECTION_STYLE' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <main className="app">
      <header>
        <h1>Math Text</h1>
        <p>Markdown and LaTeX source</p>
      </header>
      <label htmlFor="source">Source</label>
      <textarea
        id="source"
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
      />
      <p className="status" aria-live="polite">
        {status}
      </p>
      <footer>
        <button type="button" onClick={() => postToPlugin({ type: 'CLOSE' })}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled
          title="Available after rendering is added"
        >
          Apply
        </button>
      </footer>
    </main>
  );
}

function handlePluginMessage(
  message: PluginToUIMessage,
  setSource: (value: string) => void,
  setStatus: (value: string) => void,
): void {
  switch (message.type) {
    case 'INITIALIZE':
      if (message.source !== undefined) setSource(message.source);
      setStatus('Ready. Rendering will be added in the next implementation steps.');
      return;
    case 'SELECTION_CHANGED':
      setStatus('Selection settings received.');
      return;
    case 'RENDER_ERROR':
      setStatus(message.message);
  }
}

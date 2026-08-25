import { useEffect, useRef, useState } from 'react';

import { DEFAULT_TYPOGRAPHY } from '../figma/typography';
import { formatMathErrorForUi, MathJaxSvgRenderer, renderDocumentMath } from '../math';
import { parseMarkdown } from '../parser';
import { isPluginToUIMessage, type PluginToUIMessage } from '../shared/messages';
import type { RenderSettings } from '../shared/types';
import { postToPlugin } from './messages';
import { SourceEditor } from './SourceEditor';

const INITIAL_SOURCE = String.raw`Write Markdown with inline math such as $\alpha + \beta$.`;
const DEFAULT_SETTINGS: RenderSettings = {
  width: 480,
  mathScale: 1,
  inheritTypography: true,
  typography: DEFAULT_TYPOGRAPHY,
};

export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [status, setStatus] = useState('Loading selection settings…');
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [isApplying, setIsApplying] = useState(false);
  const renderer = useRef<MathJaxSvgRenderer | undefined>(undefined);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const candidate =
        typeof event.data === 'object' && event.data !== null && 'pluginMessage' in event.data
          ? (event.data as { pluginMessage?: unknown }).pluginMessage
          : undefined;
      if (!isPluginToUIMessage(candidate)) return;
      handlePluginMessage(candidate, setSource, setSettings, setStatus);
    };
    window.addEventListener('message', onMessage);
    postToPlugin({ type: 'REQUEST_SELECTION_STYLE' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const apply = async (): Promise<void> => {
    setIsApplying(true);
    setStatus('Parsing and rendering local MathJax SVG…');
    try {
      const document = parseMarkdown(source);
      const engine = renderer.current ?? new MathJaxSvgRenderer();
      renderer.current = engine;
      const math = await renderDocumentMath(document, settings.mathScale, engine);
      postToPlugin({ type: 'RENDER_DOCUMENT', source, math, settings });
      setStatus(
        math.length === 0
          ? 'Sent document with no math.'
          : `Sent ${math.length} rendered math expression${math.length === 1 ? '' : 's'}.`,
      );
    } catch (error: unknown) {
      setStatus(formatMathErrorForUi(error));
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <main className="app">
      <header>
        <h1>Math Text</h1>
        <p>Markdown and LaTeX source</p>
      </header>
      <label id="source-label">Source</label>
      <SourceEditor value={source} onChange={setSource} />
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
          disabled={isApplying}
          onClick={() => void apply()}
        >
          {isApplying ? 'Rendering…' : 'Apply'}
        </button>
      </footer>
    </main>
  );
}

function handlePluginMessage(
  message: PluginToUIMessage,
  setSource: (value: string) => void,
  setSettings: (update: (current: RenderSettings) => RenderSettings) => void,
  setStatus: (value: string) => void,
): void {
  switch (message.type) {
    case 'INITIALIZE':
    case 'SELECTION_CHANGED':
      if (message.source !== undefined) setSource(message.source);
      if (message.width !== undefined || message.typography !== undefined) {
        setSettings((current) => ({
          ...current,
          ...(message.width === undefined ? {} : { width: message.width }),
          ...(message.typography === undefined ? {} : { typography: message.typography }),
        }));
      }
      setStatus(message.status ?? 'Ready. Apply parses and renders all math locally.');
      return;
    case 'RENDER_ERROR':
      setStatus(message.message);
  }
}

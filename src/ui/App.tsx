import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_TYPOGRAPHY } from '../figma/typography';
import { formatMathErrorForUi, MathJaxSvgRenderer, renderDocumentMath } from '../math';
import { parseMarkdown } from '../parser';
import { isPluginToUIMessage, type WorkflowMode } from '../shared/messages';
import type { RenderSettings } from '../shared/types';
import { postToPlugin } from './messages';
import { SourceEditor } from './SourceEditor';
import { AutoApplyGate } from './auto-apply-gate';

const INITIAL_SOURCE = String.raw`Write Markdown with inline math such as $\alpha + \beta$.`;
const DEFAULT_SETTINGS: RenderSettings = {
  width: 480,
  mathScale: 1,
  inheritTypography: true,
  typography: DEFAULT_TYPOGRAPHY,
};
type Context = {
  readonly mode: WorkflowMode;
  readonly token: number;
  readonly autoApply: boolean;
  readonly canApply: boolean;
};

export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [status, setStatus] = useState('Loading workflow settings…');
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [context, setContext] = useState<Context>({
    mode: 'create',
    token: 0,
    autoApply: false,
    canApply: true,
  });
  const [isApplying, setIsApplying] = useState(false);
  const renderer = useRef<MathJaxSvgRenderer | undefined>(undefined);
  const autoApplied = useRef(new AutoApplyGate());

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const candidate =
        typeof event.data === 'object' && event.data !== null && 'pluginMessage' in event.data
          ? (event.data as { pluginMessage?: unknown }).pluginMessage
          : undefined;
      if (!isPluginToUIMessage(candidate)) return;
      if (candidate.type === 'INITIALIZE' || candidate.type === 'SELECTION_CHANGED') {
        if (candidate.source !== undefined) setSource(candidate.source);
        if (candidate.settings !== undefined) setSettings(candidate.settings);
        else if (candidate.width !== undefined || candidate.typography !== undefined)
          setSettings((old) => ({
            ...old,
            ...(candidate.width === undefined ? {} : { width: candidate.width }),
            ...(candidate.typography === undefined ? {} : { typography: candidate.typography }),
          }));
        setContext({
          mode: candidate.workflow ?? 'create',
          token: candidate.workflowToken ?? 0,
          autoApply: candidate.autoApply === true,
          canApply: candidate.canApply !== false,
        });
        setStatus(candidate.status ?? 'Ready. Apply parses and renders all math locally.');
      } else setStatus(candidate.message);
    };
    window.addEventListener('message', onMessage);
    // This is an acknowledgement/resume request, not a request to choose a target in locked modes.
    postToPlugin({ type: 'REQUEST_INITIALIZATION' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const apply = useCallback(
    async (auto = false): Promise<void> => {
      if (!context.canApply || isApplying) return;
      setIsApplying(true);
      setStatus(
        auto ? 'Rendering canonical document…' : 'Parsing and rendering local MathJax SVG…',
      );
      try {
        const document = parseMarkdown(source);
        const engine = renderer.current ?? new MathJaxSvgRenderer();
        renderer.current = engine;
        const math = await renderDocumentMath(document, settings.mathScale, engine);
        postToPlugin({
          type: 'RENDER_DOCUMENT',
          source,
          math,
          settings,
          workflowToken: context.token,
        });
        setStatus('Sent render request.');
      } catch (error: unknown) {
        setStatus(formatMathErrorForUi(error));
      } finally {
        setIsApplying(false);
      }
    },
    [context.canApply, context.token, isApplying, settings, source],
  );

  useEffect(() => {
    if (!context.autoApply || !context.canApply || !autoApplied.current.claim(context.token))
      return;
    void apply(true);
  }, [apply, context]);

  const buttonLabel =
    context.mode === 'edit'
      ? 'Apply changes'
      : context.mode === 'reflow'
        ? 'Reflowing…'
        : context.mode === 'sync-typography'
          ? 'Syncing…'
          : 'Apply';
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
          disabled={isApplying || !context.canApply || context.autoApply}
          onClick={() => void apply()}
        >
          {isApplying ? 'Rendering…' : buttonLabel}
        </button>
      </footer>
    </main>
  );
}

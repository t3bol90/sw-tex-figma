import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_TYPOGRAPHY } from '../figma/typography';
import { formatMathErrorForUi, MathJaxSvgRenderer, renderDocumentMath } from '../math';
import { parseMarkdown } from '../parser';
import { isPluginToUIMessage, type PluginToUIMessage, type WorkflowMode } from '../shared/messages';
import type { RenderSettings } from '../shared/types';
import { postToPlugin } from './messages';
import { SourceEditor } from './SourceEditor';
import { AutoApplyGate } from './auto-apply-gate';
import { ApplyEpochGate } from './apply-epoch';
import { hexToRgb, rgbToHex } from './color';

const INITIAL_SOURCE = String.raw`Write Markdown with inline math such as $\alpha + \beta$.`;
const DEFAULT_SETTINGS: RenderSettings = {
  width: 480,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left',
  typography: DEFAULT_TYPOGRAPHY,
};
type Context = {
  readonly mode: WorkflowMode;
  readonly token: number;
  readonly autoApply: boolean;
  readonly canApply: boolean;
};
/** Apply is impossible until the controller supplies a real workflow token. */
export const INITIAL_CONTEXT: Context = {
  mode: 'create',
  token: 0,
  autoApply: false,
  canApply: false,
};
type InitializationMessage = Extract<
  PluginToUIMessage,
  { type: 'INITIALIZE' | 'SELECTION_CHANGED' }
>;
/** Reject partial controller-shaped messages as an Apply context. */
/** Applies a lazy family style response only if it still matches the visible family. */
/** Case-insensitive trimmed family filter which never hides the current exact choice. */
export const filterFontFamilies = (
  families: readonly string[],
  selectedFamily: string,
  query: string,
): readonly string[] => {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  const matching = families.filter(
    (family) => normalized.length === 0 || family.toLocaleLowerCase('en-US').includes(normalized),
  );
  return [selectedFamily, ...matching.filter((family) => family !== selectedFamily)];
};

export const settingsFromFontStyles = (
  settings: RenderSettings,
  selectedFamily: string,
  family: string,
  styles: readonly string[],
): RenderSettings | undefined => {
  if (family !== selectedFamily || styles.length === 0) return undefined;
  return settings.typography.fontName.family === family &&
    styles.includes(settings.typography.fontName.style)
    ? settings
    : {
        ...settings,
        mathScale: 1,
        typography: {
          ...settings.typography,
          fontName: { family, style: styles[0]! },
        },
      };
};

export const contextFromInitialization = (candidate: InitializationMessage): Context => {
  const token =
    candidate.workflowToken !== undefined && candidate.workflowToken >= 1
      ? candidate.workflowToken
      : 0;
  const canApply =
    candidate.canApply === true &&
    token >= 1 &&
    candidate.settings !== undefined &&
    candidate.workflow !== undefined;
  return {
    mode: candidate.workflow ?? 'create',
    token,
    autoApply: canApply && candidate.autoApply === true,
    canApply,
  };
};

export function App() {
  const [source, setSource] = useState(INITIAL_SOURCE);
  const [status, setStatus] = useState('Initializing…');
  const [settings, setSettings] = useState<RenderSettings>(DEFAULT_SETTINGS);
  const [context, setContext] = useState<Context>(INITIAL_CONTEXT);
  const [fontFamilies, setFontFamilies] = useState<readonly string[]>([]);
  const [familyStyles, setFamilyStyles] = useState<readonly string[]>([]);
  const [fontStatus, setFontStatus] = useState<string | undefined>(undefined);
  const [selectedFamily, setSelectedFamily] = useState(settings.typography.fontName.family);
  const [familyQuery, setFamilyQuery] = useState('');
  const visibleFontFamilies = useMemo(
    () => filterFontFamilies(fontFamilies, selectedFamily, familyQuery),
    [fontFamilies, selectedFamily, familyQuery],
  );
  const hasFamilySearchMatch = useMemo(() => {
    const normalized = familyQuery.trim().toLocaleLowerCase('en-US');
    return (
      normalized.length === 0 ||
      fontFamilies.some((family) => family.toLocaleLowerCase('en-US').includes(normalized))
    );
  }, [fontFamilies, familyQuery]);
  // The message listener is intentionally installed once; this ref prevents it
  // from comparing a late style response to a stale initial family closure.
  const selectedFamilyRef = useRef(selectedFamily);
  const [isApplying, setIsApplying] = useState(false);
  const renderer = useRef<MathJaxSvgRenderer | undefined>(undefined);
  const autoApplied = useRef(new AutoApplyGate());
  // Every input/context change invalidates an in-flight local MathJax result.
  const applyEpoch = useRef(new ApplyEpochGate());
  const invalidateApply = useCallback((): void => {
    applyEpoch.current.invalidate();
    // Allow a newer request to start; the old finally is epoch-guarded below.
    setIsApplying(false);
  }, []);

  useEffect(() => {
    selectedFamilyRef.current = selectedFamily;
  }, [selectedFamily]);

  useEffect(() => {
    // Styles are requested lazily for the visible family; all choices remain exact pairs.
    if (fontFamilies.includes(selectedFamily))
      postToPlugin({ type: 'REQUEST_FONT_STYLES', family: selectedFamily });
  }, [fontFamilies, selectedFamily]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      const candidate =
        typeof event.data === 'object' && event.data !== null && 'pluginMessage' in event.data
          ? (event.data as { pluginMessage?: unknown }).pluginMessage
          : undefined;
      if (!isPluginToUIMessage(candidate)) return;
      if (candidate.type === 'AVAILABLE_FONT_FAMILIES') {
        setFontFamilies(candidate.families);
        setFontStatus(candidate.status);
        return;
      }
      if (candidate.type === 'AVAILABLE_FONT_STYLES') {
        if (candidate.family === selectedFamilyRef.current) {
          setFamilyStyles(candidate.styles);
          setFontStatus(candidate.status);
          setSettings(
            (old) =>
              settingsFromFontStyles(
                old,
                selectedFamilyRef.current,
                candidate.family,
                candidate.styles,
              ) ?? old,
          );
        }
        return;
      }
      if (candidate.type === 'INITIALIZE' || candidate.type === 'SELECTION_CHANGED') {
        if (candidate.source !== undefined) {
          invalidateApply();
          setSource(candidate.source);
        }
        if (candidate.settings !== undefined) {
          invalidateApply();
          setSettings(candidate.settings);
          selectedFamilyRef.current = candidate.settings.typography.fontName.family;
          setSelectedFamily(candidate.settings.typography.fontName.family);
        } else if (candidate.width !== undefined || candidate.typography !== undefined)
          setSettings((old) => ({
            ...old,
            ...(candidate.width === undefined ? {} : { width: candidate.width }),
            ...(candidate.typography === undefined ? {} : { typography: candidate.typography }),
          }));
        invalidateApply();
        setContext(contextFromInitialization(candidate));
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
      const epoch = applyEpoch.current.begin();
      setIsApplying(true);
      setStatus(
        auto ? 'Rendering canonical document…' : 'Parsing and rendering local MathJax SVG…',
      );
      try {
        const document = parseMarkdown(source);
        const engine = renderer.current ?? new MathJaxSvgRenderer();
        renderer.current = engine;
        const math = await renderDocumentMath(document, 1, engine);
        // Do not let an older asynchronous MathJax result overwrite newer input.
        if (!applyEpoch.current.isCurrent(epoch)) return;
        postToPlugin({
          type: 'RENDER_DOCUMENT',
          source,
          math,
          settings: { ...settings, mathScale: 1 },
          workflowToken: context.token,
        });
        setStatus('Sent render request.');
      } catch (error: unknown) {
        if (applyEpoch.current.isCurrent(epoch)) setStatus(formatMathErrorForUi(error));
      } finally {
        if (applyEpoch.current.isCurrent(epoch)) setIsApplying(false);
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
        ? 'Apply reflow'
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
      <SourceEditor
        value={source}
        onChange={(value) => {
          invalidateApply();
          setSource(value);
        }}
      />
      <section className="controls" aria-label="Layout controls">
        <label>
          Width (px)
          <input
            type="number"
            min="1"
            max="100000"
            step="1"
            value={settings.width}
            onChange={(event) => {
              const width = Number(event.target.value);
              if (Number.isFinite(width) && width >= 1 && width <= 100000) {
                invalidateApply();
                setSettings((old) => ({ ...old, width }));
              }
            }}
          />
        </label>
        <label>
          <span>Search font families</span>
          <input
            type="search"
            aria-label="Search font families"
            placeholder="Search font families"
            value={familyQuery}
            onChange={(event) => setFamilyQuery(event.target.value)}
          />
          <span>Font family</span>
          <select
            aria-label="Font family"
            value={selectedFamily}
            onChange={(event) => {
              const family = event.target.value;
              if (family) {
                invalidateApply();
                // Do not let stale styles from the prior family form an invalid pair.
                setFamilyStyles([]);
                selectedFamilyRef.current = family;
                setSelectedFamily(family);
              }
            }}
          >
            {visibleFontFamilies.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
          {!hasFamilySearchMatch && familyQuery.trim().length > 0 ? (
            <span className="control-status">
              No matching families. Current selection remains available.
            </span>
          ) : null}
        </label>
        <label>
          Font style
          <select
            value={settings.typography.fontName.style}
            onChange={(event) => {
              const style = event.target.value;
              if (familyStyles.includes(style)) {
                invalidateApply();
                setSettings((old) => ({
                  ...old,
                  typography: { ...old.typography, fontName: { family: selectedFamily, style } },
                  mathScale: 1,
                }));
              }
            }}
          >
            <option value={settings.typography.fontName.style}>
              {settings.typography.fontName.style}
            </option>
            {familyStyles
              .filter((style) => style !== settings.typography.fontName.style)
              .map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
          </select>
          {fontStatus ? <span className="control-status">{fontStatus}</span> : null}
        </label>
        <label>
          Font size (px)
          <input
            type="number"
            min="1"
            max="512"
            step="1"
            value={settings.typography.fontSize}
            onChange={(event) => {
              const fontSize = Number(event.target.value);
              if (Number.isFinite(fontSize) && fontSize >= 1 && fontSize <= 512) {
                invalidateApply();
                setSettings((old) => ({
                  ...old,
                  mathScale: 1,
                  typography: { ...old.typography, fontSize },
                }));
              }
            }}
          />
        </label>
        <label>
          Text color
          <input
            type="color"
            value={rgbToHex(settings.typography.fills[0]?.color ?? { r: 0, g: 0, b: 0 })}
            onChange={(event) => {
              const color = hexToRgb(event.target.value);
              if (color) {
                invalidateApply();
                setSettings((old) => ({
                  ...old,
                  typography: {
                    ...old.typography,
                    fills: [
                      {
                        type: 'SOLID',
                        color,
                        ...(old.typography.fills[0]?.opacity === undefined
                          ? {}
                          : { opacity: old.typography.fills[0].opacity }),
                      },
                    ],
                  },
                }));
              }
            }}
          />
        </label>
        <label>
          Text alignment
          <select
            value={settings.textAlignment}
            onChange={(event) => {
              const textAlignment = event.target.value;
              if (
                textAlignment === 'left' ||
                textAlignment === 'center' ||
                textAlignment === 'right' ||
                textAlignment === 'justify'
              ) {
                invalidateApply();
                setSettings((old) => ({ ...old, textAlignment }));
              }
            }}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justify</option>
          </select>
        </label>
      </section>
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
          disabled={isApplying || !context.canApply}
          onClick={() => void apply()}
        >
          {isApplying ? 'Rendering…' : buttonLabel}
        </button>
      </footer>
    </main>
  );
}

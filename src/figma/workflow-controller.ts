import { validateRenderedMathPayloads } from '../layout';
import { parseMarkdown } from '../parser';
import {
  isFontDescriptor,
  MAX_FONT_FAMILIES,
  MAX_FONT_STYLES,
  type PluginToUIMessage,
  type UIToPluginMessage,
  type WorkflowMode,
} from '../shared/messages';
import type { PersistedDocumentState } from '../shared/persistence';
import type { FontDescriptor, RenderSettings, TypographyContext } from '../shared/types';
import type { GeneratedSceneNode } from './generated-target';
import type { SelectionSnapshotOutcome, TextSelectionSnapshot } from './selection';
import { DEFAULT_PARAGRAPH_WIDTH } from './selection';
import { DEFAULT_TYPOGRAPHY } from './typography';

/** A controller-held node reference; this identity never crosses the iframe boundary. */
export interface WorkflowTarget {
  readonly node: GeneratedSceneNode;
  readonly state: PersistedDocumentState;
  readonly width: number;
}
export interface WorkflowRenderRequest {
  readonly source: string;
  readonly document: ReturnType<typeof parseMarkdown>;
  readonly math: Extract<UIToPluginMessage, { type: 'RENDER_DOCUMENT' }>['math'];
  readonly settings: RenderSettings;
  readonly workflow: WorkflowMode;
  readonly selectedSnapshot?: TextSelectionSnapshot;
  readonly target?: WorkflowTarget;
}
export interface WorkflowRenderResult {
  readonly rootName: string;
  /** The renderer returns this only after replacement commit and v3 persistence succeeds. */
  readonly nextTarget?: WorkflowTarget;
  /** A selected native text target was consumed and must never be reused. */
  readonly consumedSelectedSnapshot?: boolean;
}
export interface WorkflowControllerDependencies {
  readonly mode: WorkflowMode;
  readSelection(): Promise<SelectionSnapshotOutcome>;
  availableFonts?(): Promise<readonly FontDescriptor[]>;
  readTarget(): Promise<WorkflowTarget | undefined>;
  readSyncedTypography?(target: WorkflowTarget): Promise<TypographyContext | undefined>;
  renderDocument(request: WorkflowRenderRequest): Promise<WorkflowRenderResult>;
  postToUi(message: PluginToUIMessage): void;
  closePlugin(): void;
  readonly defaults?: { readonly width?: number; readonly typography?: TypographyContext };
}
export interface WorkflowController {
  initialize(): Promise<void>;
  selectionChanged(): Promise<void>;
  handleMessage(message: UIToPluginMessage): void;
}
type ContextMessage = Extract<PluginToUIMessage, { type: 'INITIALIZE' | 'SELECTION_CHANGED' }>;
/** `type?: never` prevents cached controller messages from being reused as payloads. */
type ContextPayload = Omit<Extract<PluginToUIMessage, { type: 'INITIALIZE' }>, 'type'> & {
  readonly type?: never;
};
const defaultsFor = (dependencies: WorkflowControllerDependencies): RenderSettings => ({
  width: dependencies.defaults?.width ?? DEFAULT_PARAGRAPH_WIDTH,
  typography: dependencies.defaults?.typography ?? DEFAULT_TYPOGRAPHY,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left',
});
const statusForSelection = (
  outcome: Exclude<SelectionSnapshotOutcome, { kind: 'selected' }>,
): string => {
  switch (outcome.kind) {
    case 'no-selection':
      return 'No text layer is selected. The result will be inserted near the viewport center.';
    case 'multiple-selection':
      return 'Select exactly one supported text layer to replace it; otherwise Apply creates a new result.';
    case 'non-text-selection':
      return 'No supported text layer is selected. Apply creates a new result.';
    case 'invalid-text-selection':
      return `Could not replace selected text: ${outcome.issue.message} Apply creates a new result.`;
  }
};
const messageFor = (type: ContextMessage['type'], payload: ContextPayload): ContextMessage =>
  type === 'INITIALIZE'
    ? { ...payload, type: 'INITIALIZE' }
    : { ...payload, type: 'SELECTION_CHANGED' };
const payloadFromContext = (context: ContextMessage): ContextPayload => {
  const { type, ...payload } = context;
  void type;
  return payload;
};

/** Controller owns mode and replacement target. UI messages have neither a target id nor a mode switch. */
export function createWorkflowController(
  dependencies: WorkflowControllerDependencies,
): WorkflowController {
  const mode = dependencies.mode;
  let latestSnapshot: TextSelectionSnapshot | undefined;
  let target: WorkflowTarget | undefined;
  let generation = 0;
  let rendering = false;
  let lastContext: ContextMessage | undefined;
  let fontLoad: Promise<void> | undefined;
  /** Retained so an early pre-iframe post can be replayed without refetching. */
  let cachedFontFamilies:
    Extract<PluginToUIMessage, { type: 'AVAILABLE_FONT_FAMILIES' }> | undefined;
  let cachedFontInventory: readonly FontDescriptor[] | undefined;
  const postContext = (type: ContextMessage['type'], payload: ContextPayload): void => {
    const message = messageFor(type, payload);
    lastContext = message;
    dependencies.postToUi(message);
  };
  // Inventory is intentionally independent of generation and target locking. A late
  // result updates only choices, never source/settings/status or the Apply token.
  const postCachedFontFamilies = (): void => {
    if (cachedFontFamilies) dependencies.postToUi(cachedFontFamilies);
  };
  const postFontStyles = (family: string): void => {
    if (!cachedFontInventory) return;
    const styles = cachedFontInventory
      .filter((font) => font.family === family)
      .map((font) => font.style)
      .sort((left, right) => left.localeCompare(right));
    const limited = styles.slice(0, MAX_FONT_STYLES);
    dependencies.postToUi({
      type: 'AVAILABLE_FONT_STYLES',
      family,
      styles: limited,
      ...(styles.length > limited.length
        ? { status: `Too many styles for ${family}; showing the first ${MAX_FONT_STYLES}.` }
        : {}),
    });
  };
  const loadFonts = (): void => {
    if (fontLoad || !dependencies.availableFonts) return;
    fontLoad = dependencies
      .availableFonts()
      .then((fonts) => {
        // Preserve every valid pair for on-demand lookup. A global sorted pair
        // slice would hide later families such as Roboto.
        cachedFontInventory = [...fonts]
          .filter(isFontDescriptor)
          .filter(
            (font, index, all) =>
              all.findIndex(
                (other) => other.family === font.family && other.style === font.style,
              ) === index,
          );
        const families = [...new Set(cachedFontInventory.map((font) => font.family))].sort(
          (left, right) => left.localeCompare(right),
        );
        // Do not alphabetically trim families: it would make later real families
        // (such as Roboto) unreachable. An implausibly oversized inventory fails
        // honestly instead of silently hiding a suffix of the alphabet.
        cachedFontFamilies =
          families.length > MAX_FONT_FAMILIES
            ? {
                type: 'AVAILABLE_FONT_FAMILIES',
                families: [],
                status: `Figma returned too many font families (${families.length}). The current font remains available.`,
              }
            : {
                type: 'AVAILABLE_FONT_FAMILIES',
                families,
                ...(families.length === 0
                  ? {
                      status:
                        'No usable Figma fonts were returned. The current font remains available.',
                    }
                  : {}),
              };
        postCachedFontFamilies();
      })
      .catch(() => {
        cachedFontInventory = [];
        cachedFontFamilies = {
          type: 'AVAILABLE_FONT_FAMILIES',
          families: [],
          status: 'Could not load Figma fonts. The current font remains available.',
        };
        postCachedFontFamilies();
      });
  };
  const initializeCreate = async (type: ContextMessage['type']): Promise<void> => {
    const request = ++generation;
    const outcome = await dependencies.readSelection();
    if (request !== generation || rendering) return;
    if (outcome.kind === 'selected') {
      latestSnapshot = outcome.snapshot;
      const settings: RenderSettings = {
        width: outcome.snapshot.width,
        typography: outcome.snapshot.typography,
        mathScale: 1,
        inheritTypography: true,
        textAlignment: 'left',
      };
      postContext(type, {
        source: outcome.snapshot.source,
        width: settings.width,
        typography: settings.typography,
        settings,
        workflow: mode,
        workflowToken: generation,
        canApply: true,
        status: 'Inherited source, typography, and width from the selected text layer.',
      });
      return;
    }
    latestSnapshot = undefined;
    const settings = defaultsFor(dependencies);
    postContext(type, {
      width: settings.width,
      typography: settings.typography,
      settings,
      workflow: mode,
      workflowToken: generation,
      canApply: true,
      status: statusForSelection(outcome),
    });
  };
  const initializeExisting = async (): Promise<void> => {
    const request = ++generation;
    const found = await dependencies.readTarget();
    if (request !== generation || rendering) return;
    target = found;
    if (!found) {
      const settings = defaultsFor(dependencies);
      postContext('INITIALIZE', {
        settings,
        width: settings.width,
        typography: settings.typography,
        workflow: mode,
        workflowToken: generation,
        canApply: false,
        status:
          'Select one valid generated Math Text document or one of its descendants. Nothing can be replaced.',
      });
      return;
    }
    let settings: RenderSettings = {
      width: found.state.width,
      mathScale: 1,
      inheritTypography: found.state.inheritTypography,
      typography: found.state.typography,
      textAlignment: found.state.textAlignment,
    };
    if (mode === 'sync-typography') {
      const typography = await dependencies.readSyncedTypography?.(found);
      if (!typography || request !== generation) {
        target = undefined;
        postContext('INITIALIZE', {
          settings,
          workflow: mode,
          workflowToken: generation,
          canApply: false,
          status: 'No supported native prose typography was found. The document was not changed.',
        });
        return;
      }
      settings = { ...settings, typography, inheritTypography: true };
    }
    postContext('INITIALIZE', {
      source: found.state.source,
      settings,
      width: settings.width,
      typography: settings.typography,
      workflow: mode,
      workflowToken: generation,
      canApply: true,
      autoApply: mode === 'sync-typography',
      status:
        mode === 'edit'
          ? 'Loaded canonical source and settings. Edit source, then Apply.'
          : mode === 'reflow'
            ? 'Loaded canonical source and settings. Adjust controls, then Apply reflow.'
            : 'Loaded canonical source and settings. Syncing typography automatically…',
    });
  };
  const initialize = async (): Promise<void> => {
    loadFonts();
    if (mode === 'create') await initializeCreate('INITIALIZE');
    else await initializeExisting();
  };
  const render = async (
    message: Extract<UIToPluginMessage, { type: 'RENDER_DOCUMENT' }>,
  ): Promise<void> => {
    if (rendering) {
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: 'A render is already in progress. Wait for it to finish.',
      });
      return;
    }
    if (message.workflowToken !== generation) {
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: 'This UI request is stale. Wait for initialization to resume.',
      });
      return;
    }
    if (mode !== 'create' && !target) {
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: 'No valid generated document is locked for this workflow.',
      });
      return;
    }
    rendering = true;
    const selectedSnapshot = latestSnapshot;
    const lockedTarget = target;
    try {
      const document = parseMarkdown(message.source);
      validateRenderedMathPayloads(document, message.math);
      // Locked targets protect replacement identity and canonical source, not UI controls.
      // Edit/Reflow honour the validated submitted layout and typography settings.
      const settings: RenderSettings = lockedTarget
        ? mode === 'sync-typography'
          ? {
              ...message.settings,
              width: message.settings.width,
              textAlignment: message.settings.textAlignment,
              mathScale: 1,
              inheritTypography: true,
              typography:
                (await dependencies.readSyncedTypography?.(lockedTarget)) ??
                (() => {
                  throw new Error('No supported native prose typography was found.');
                })(),
            }
          : { ...message.settings, mathScale: 1 }
        : { ...message.settings, mathScale: 1 };
      const result = await dependencies.renderDocument({
        source: message.source,
        document,
        math: message.math,
        settings,
        workflow: mode,
        selectedSnapshot,
        target: lockedTarget,
      });
      if (result.nextTarget) target = result.nextTarget;
      if (result.consumedSelectedSnapshot) latestSnapshot = undefined;
      const label =
        mode === 'create'
          ? 'Created'
          : mode === 'edit'
            ? 'Updated'
            : mode === 'reflow'
              ? 'Reflowed'
              : 'Synced typography for';
      dependencies.postToUi({ type: 'RENDER_SUCCESS', message: `${label} ${result.rootName}.` });
    } catch (error: unknown) {
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: `Could not ${mode === 'create' ? 'render' : 'update'} document: ${error instanceof Error ? error.message : 'Unknown rendering failure.'}`,
      });
    } finally {
      rendering = false;
    }
  };
  return {
    initialize,
    // Selection is captured once during initialization; later canvas changes must
    // never overwrite an in-progress Create editor or replacement snapshot.
    selectionChanged: async () => undefined,
    handleMessage: (message) => {
      if (message.type === 'CLOSE') dependencies.closePlugin();
      else if (message.type === 'REQUEST_FONT_STYLES') {
        postFontStyles(message.family);
      } else if (
        message.type === 'REQUEST_SELECTION_STYLE' ||
        message.type === 'REQUEST_INITIALIZATION'
      ) {
        // The iframe may subscribe after our first post. Resume the exact locked context; never retarget it.
        if (lastContext) {
          dependencies.postToUi(messageFor('INITIALIZE', payloadFromContext(lastContext)));
          postCachedFontFamilies();
        } else {
          // Fonts may have resolved before a slow initial target/selection read.
          // Replay their cached result to this now-subscribed iframe, then resume context.
          postCachedFontFamilies();
          void initialize();
        }
      } else void render(message);
    },
  };
}

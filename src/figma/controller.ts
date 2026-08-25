import { validateRenderedMathPayloads } from '../layout';
import { parseMarkdown } from '../parser';
import {
  isRenderSettings,
  type PluginToUIMessage,
  type UIToPluginMessage,
} from '../shared/messages';
import type { TypographyContext } from '../shared/types';
import {
  DEFAULT_PARAGRAPH_WIDTH,
  type SelectionSnapshotOutcome,
  type TextSelectionSnapshot,
} from './selection';
import { DEFAULT_TYPOGRAPHY } from './typography';

export interface RenderControllerRequest {
  readonly source: string;
  readonly document: ReturnType<typeof parseMarkdown>;
  readonly math: Extract<UIToPluginMessage, { type: 'RENDER_DOCUMENT' }>['math'];
  readonly settings: Extract<UIToPluginMessage, { type: 'RENDER_DOCUMENT' }>['settings'];
  readonly selectedSnapshot?: TextSelectionSnapshot;
}
export interface RenderControllerResult {
  readonly rootName: string;
}
export interface SelectionControllerDependencies {
  readSelection(): Promise<SelectionSnapshotOutcome>;
  postToUi(message: PluginToUIMessage): void;
  closePlugin(): void;
  renderDocument?(request: RenderControllerRequest): Promise<RenderControllerResult>;
  readonly defaults?: { readonly width?: number; readonly typography?: TypographyContext };
}
export interface SelectionController {
  initialize(): Promise<void>;
  selectionChanged(): Promise<void>;
  handleMessage(message: UIToPluginMessage): void;
  readonly selectedSnapshot: TextSelectionSnapshot | undefined;
}
const fallbackStatus = (
  outcome: Exclude<SelectionSnapshotOutcome, { kind: 'selected' }>,
): string => {
  switch (outcome.kind) {
    case 'no-selection':
      return 'No text layer is selected. Using default source settings.';
    case 'multiple-selection':
      return `Select exactly one text layer to inherit its settings (${outcome.count} layers selected).`;
    case 'non-text-selection':
      return `Select a text layer to inherit its settings (selected ${outcome.nodeType}).`;
    case 'invalid-text-selection':
      return `Could not inherit the selected text: ${outcome.issue.message} Using defaults instead.`;
  }
};
/** Selection reads and Apply renders are deliberately independent. Apply is single-flight. */
export function createSelectionController(
  dependencies: SelectionControllerDependencies,
): SelectionController {
  let requestId = 0;
  let latestSnapshot: TextSelectionSnapshot | undefined;
  let rendering = false;
  const defaults = {
    width: dependencies.defaults?.width ?? DEFAULT_PARAGRAPH_WIDTH,
    typography: dependencies.defaults?.typography ?? DEFAULT_TYPOGRAPHY,
  };
  const refresh = async (messageType: 'INITIALIZE' | 'SELECTION_CHANGED'): Promise<void> => {
    const id = ++requestId;
    const outcome = await dependencies.readSelection();
    if (id !== requestId) return;
    if (outcome.kind === 'selected') {
      latestSnapshot = outcome.snapshot;
      dependencies.postToUi({
        type: messageType,
        source: outcome.snapshot.source,
        width: outcome.snapshot.width,
        typography: outcome.snapshot.typography,
        status: 'Inherited source, typography, and width from the selected text layer.',
      });
      return;
    }
    latestSnapshot = undefined;
    dependencies.postToUi({
      type: messageType,
      width: defaults.width,
      typography: defaults.typography,
      status: fallbackStatus(outcome),
    });
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
    if (!dependencies.renderDocument) {
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: 'Document rendering is not configured.',
      });
      return;
    }
    rendering = true;
    try {
      // Reparse trusted canonical source at the controller boundary. The UI AST is never accepted.
      if (!isRenderSettings(message.settings)) throw new Error('Render settings are invalid.');
      const document = parseMarkdown(message.source);
      validateRenderedMathPayloads(document, message.math);
      const result = await dependencies.renderDocument({
        source: message.source,
        document,
        math: message.math,
        settings: message.settings,
        selectedSnapshot: latestSnapshot,
      });
      dependencies.postToUi({ type: 'RENDER_SUCCESS', message: `Created ${result.rootName}.` });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unknown rendering failure.';
      dependencies.postToUi({
        type: 'RENDER_ERROR',
        message: `Could not render document: ${reason}`,
      });
    } finally {
      rendering = false;
    }
  };
  return {
    initialize: () => refresh('INITIALIZE'),
    selectionChanged: () => refresh('SELECTION_CHANGED'),
    handleMessage: (message) => {
      switch (message.type) {
        case 'REQUEST_SELECTION_STYLE':
          void refresh('SELECTION_CHANGED');
          return;
        case 'CLOSE':
          dependencies.closePlugin();
          return;
        case 'RENDER_DOCUMENT':
          void render(message);
      }
    },
    get selectedSnapshot() {
      return latestSnapshot;
    },
  };
}

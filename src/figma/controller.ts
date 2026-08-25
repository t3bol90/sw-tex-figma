import type { PluginToUIMessage, UIToPluginMessage } from '../shared/messages';
import type { TypographyContext } from '../shared/types';
import {
  DEFAULT_PARAGRAPH_WIDTH,
  type SelectionSnapshotOutcome,
  type TextSelectionSnapshot,
} from './selection';
import { DEFAULT_TYPOGRAPHY } from './typography';

export interface SelectionControllerDependencies {
  readSelection(): Promise<SelectionSnapshotOutcome>;
  postToUi(message: PluginToUIMessage): void;
  closePlugin(): void;
  readonly defaults?: { readonly width?: number; readonly typography?: TypographyContext };
}

export interface SelectionController {
  initialize(): Promise<void>;
  selectionChanged(): Promise<void>;
  handleMessage(message: UIToPluginMessage): void;
  /** Most recent clean snapshot, retained for a later non-destructive replacement flow. */
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

/**
 * Coordinates asynchronous selection reads. A monotonically increasing request
 * id prevents a slow old font load from replacing a newer selection in the UI.
 */
export function createSelectionController(
  dependencies: SelectionControllerDependencies,
): SelectionController {
  let requestId = 0;
  let latestSnapshot: TextSelectionSnapshot | undefined;
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
          dependencies.postToUi({
            type: 'RENDER_ERROR',
            message:
              'Document rendering is not available until the rendering workflow is implemented.',
          });
      }
    },
    get selectedSnapshot(): TextSelectionSnapshot | undefined {
      return latestSnapshot;
    },
  };
}

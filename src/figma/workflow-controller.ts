import { validateRenderedMathPayloads } from '../layout';
import { parseMarkdown } from '../parser';
import type { PluginToUIMessage, UIToPluginMessage, WorkflowMode } from '../shared/messages';
import type { PersistedDocumentState } from '../shared/persistence';
import type { RenderSettings, TypographyContext } from '../shared/types';
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
  /** The renderer returns this only after replacement commit and v2 persistence succeeds. */
  readonly nextTarget?: WorkflowTarget;
  /** A selected native text target was consumed and must never be reused. */
  readonly consumedSelectedSnapshot?: boolean;
}
export interface WorkflowControllerDependencies {
  readonly mode: WorkflowMode;
  readSelection(): Promise<SelectionSnapshotOutcome>;
  readTarget(): Promise<WorkflowTarget | undefined>;
  readSyncedTypography?(target: WorkflowTarget): Promise<TypographyContext | undefined>;
  currentWidth?(target: WorkflowTarget): number | undefined;
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
const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const effectiveWidth = (
  target: WorkflowTarget,
  dependencies: WorkflowControllerDependencies,
): number => {
  const currentWidth = dependencies.currentWidth?.(target) ?? target.width;
  return isPositive(currentWidth) && Math.abs(currentWidth - target.state.compiledWidth) > 0.01
    ? currentWidth
    : target.state.width;
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
  const postContext = (type: ContextMessage['type'], payload: ContextPayload): void => {
    const message = messageFor(type, payload);
    lastContext = message;
    dependencies.postToUi(message);
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
      width: effectiveWidth(found, dependencies),
      mathScale: found.state.mathScale,
      inheritTypography: found.state.inheritTypography,
      typography: found.state.typography,
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
      autoApply: mode === 'reflow' || mode === 'sync-typography',
      status:
        mode === 'edit'
          ? 'Loaded canonical source and settings. Edit source, then Apply.'
          : 'Loaded canonical source and settings. Rendering automatically…',
    });
  };
  const initialize = async (): Promise<void> => {
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
      const settings: RenderSettings = lockedTarget
        ? {
            width: effectiveWidth(lockedTarget, dependencies),
            mathScale: lockedTarget.state.mathScale,
            inheritTypography:
              mode === 'sync-typography' ? true : lockedTarget.state.inheritTypography,
            typography:
              mode === 'sync-typography'
                ? ((await dependencies.readSyncedTypography?.(lockedTarget)) ??
                  (() => {
                    throw new Error('No supported native prose typography was found.');
                  })())
                : lockedTarget.state.typography,
          }
        : message.settings;
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
    selectionChanged: async () => {
      if (mode === 'create' && !rendering) await initializeCreate('SELECTION_CHANGED');
    },
    handleMessage: (message) => {
      if (message.type === 'CLOSE') dependencies.closePlugin();
      else if (
        message.type === 'REQUEST_SELECTION_STYLE' ||
        message.type === 'REQUEST_INITIALIZATION'
      ) {
        // The iframe may subscribe after our first post. Resume the exact locked context; never retarget it.
        if (lastContext)
          dependencies.postToUi(messageFor('INITIALIZE', payloadFromContext(lastContext)));
        else void initialize();
      } else void render(message);
    },
  };
}

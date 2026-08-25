import { describe, expect, it } from 'vitest';
import { createPersistedDocumentState, readPersistedDocumentState } from '../src/figma/persistence';
import type { GeneratedSceneNode } from '../src/figma/generated-target';
import {
  readSelectionSnapshot,
  selectedSnapshotNode,
  type FigmaSelectedTextNode,
} from '../src/figma/selection';
import {
  createWorkflowController,
  type WorkflowRenderRequest,
} from '../src/figma/workflow-controller';
import type { PluginToUIMessage } from '../src/shared/messages';

const settings = {
  width: 200,
  mathScale: 1,
  inheritTypography: true,
  typography: {
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' as const },
    letterSpacing: { unit: 'PIXELS' as const, value: 0 },
    fills: [],
  },
};
const state = createPersistedDocumentState('canonical $x$', settings, 200);
const node: GeneratedSceneNode = { type: 'FRAME', getPluginData: () => '' };
const target = { node, state, width: 200 };
const render = (token: number) => ({
  type: 'RENDER_DOCUMENT' as const,
  source: 'canonical $x$',
  math: [
    {
      latex: 'x',
      display: false,
      svg: '<svg/>',
      metrics: { width: 1, height: 1, ascent: 1, descent: 0, baseline: 1 },
    },
  ],
  settings,
  workflowToken: token,
});
const tokenOf = (message: PluginToUIMessage | undefined): number =>
  message?.type === 'INITIALIZE' ? (message.workflowToken ?? 0) : 0;

describe('workflow controller', () => {
  it('locks edit target and resends its canonical context during UI handshake', async () => {
    const sent: PluginToUIMessage[] = [];
    let reads = 0;
    const controller = createWorkflowController({
      mode: 'edit',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => (++reads === 1 ? target : undefined),
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    expect(reads).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      type: 'INITIALIZE',
      source: 'canonical $x$',
      settings,
      workflow: 'edit',
      canApply: true,
    });
  });
  it('resumes a create selection-change context as INITIALIZE without rereading selection', async () => {
    const sent: PluginToUIMessage[] = [];
    let reads = 0;
    const inherited = {
      kind: 'selected' as const,
      snapshot: {
        source: 'selected',
        width: 123,
        typography: settings.typography,
        placement: { x: 1, y: 2, rotation: 0 },
      },
    };
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => (++reads === 1 ? { kind: 'no-selection' as const } : inherited),
      readTarget: async () => undefined,
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    await controller.selectionChanged();
    const changed = sent[1];
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    expect(reads).toBe(2);
    expect(sent[2]).toMatchObject({
      type: 'INITIALIZE',
      source: 'selected',
      workflowToken: changed?.type === 'SELECTION_CHANGED' ? changed.workflowToken : undefined,
    });
  });
  it('uses a manual root width for reflow and marks only auto workflows for auto apply', async () => {
    const sent: PluginToUIMessage[] = [];
    const calls: WorkflowRenderRequest[] = [];
    const controller = createWorkflowController({
      mode: 'reflow',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      currentWidth: () => 345,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(sent[0]).toMatchObject({ autoApply: true, settings: { width: 345 } });
    controller.handleMessage(render(tokenOf(sent[0])));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.settings.width).toBe(345);
  });
  it('rejects invalid generated selection without exposing a destructive Apply', async () => {
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'sync-typography',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      renderDocument: async () => ({ rootName: 'bad' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(sent[0]).toMatchObject({ canApply: false, workflow: 'sync-typography' });
    controller.handleMessage(render(tokenOf(sent[0])));
    expect(sent.at(-1)).toMatchObject({
      type: 'RENDER_ERROR',
      message: expect.stringContaining('No valid'),
    });
  });
  it('updates the locked target after commit so a second edit applies to the replacement', async () => {
    const sent: PluginToUIMessage[] = [];
    const nextNode: GeneratedSceneNode = { type: 'FRAME', getPluginData: () => '' };
    const nextTarget = { node: nextNode, state, width: 200 };
    const calls: WorkflowRenderRequest[] = [];
    const controller = createWorkflowController({
      mode: 'edit',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph', nextTarget };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    const token = tokenOf(sent[0]);
    controller.handleMessage(render(token));
    await Promise.resolve();
    await Promise.resolve();
    controller.handleMessage(render(token));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.target).toBe(target);
    expect(calls[1]?.target).toBe(nextTarget);
  });
  it('does not falsely reflow a v1 over-wide root: migration uses its geometry as compiled width', async () => {
    const v2 = JSON.parse(
      JSON.stringify(createPersistedDocumentState('canonical $x$', settings, 333)),
    ) as Record<string, unknown>;
    v2.version = 1;
    delete v2.compiledWidth;
    const values = new Map([
      ['math-text-version', '1'],
      ['math-text-document', JSON.stringify(v2)],
    ]);
    const migrated = readPersistedDocumentState(
      { getPluginData: (key) => values.get(key) ?? '' },
      333,
    );
    if (!migrated) throw new Error('expected v1 migration');
    const v1Target = { node, state: migrated, width: 333 };
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'reflow',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => v1Target,
      currentWidth: () => 333,
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(migrated).toMatchObject({ compiledWidth: 333, width: 200 });
    expect(sent[0]).toMatchObject({ settings: { width: 200 } });
  });
  it('aborts a sync if its later freshness typography read becomes invalid', async () => {
    const sent: PluginToUIMessage[] = [];
    let reads = 0;
    let renders = 0;
    const controller = createWorkflowController({
      mode: 'sync-typography',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      readSyncedTypography: async () => (++reads === 1 ? settings.typography : undefined),
      renderDocument: async () => {
        renders += 1;
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage(render(tokenOf(sent[0])));
    await Promise.resolve();
    await Promise.resolve();
    expect(renders).toBe(0);
    expect(sent.at(-1)).toMatchObject({
      type: 'RENDER_ERROR',
      message: expect.stringContaining('No supported native'),
    });
  });
  it('keeps create without selection as insertion rather than replacement', async () => {
    const sent: PluginToUIMessage[] = [];
    const calls: WorkflowRenderRequest[] = [];
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage(render(tokenOf(sent[0])));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.selectedSnapshot).toBeUndefined();
  });
  it('passes the WeakMap-selected native TextNode only for the first create replacement', async () => {
    const native: FigmaSelectedTextNode = {
      type: 'TEXT',
      characters: 'native',
      width: 100,
      x: 1,
      y: 2,
      rotation: 0,
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      fills: [],
    };
    const selected = await readSelectionSnapshot({
      mixed: Symbol('mixed'),
      currentPage: { selection: [native] },
      loadFontAsync: async () => undefined,
    });
    if (selected.kind !== 'selected') throw new Error('expected selection');
    const calls: WorkflowRenderRequest[] = [];
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => selected,
      readTarget: async () => undefined,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph', consumedSelectedSnapshot: true };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    const token = tokenOf(sent[0]);
    controller.handleMessage({ ...render(token), source: 'native $x$' });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.selectedSnapshot && selectedSnapshotNode(calls[0].selectedSnapshot)).toBe(
      native,
    );
    controller.handleMessage({ ...render(token), source: 'native $x$' });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[1]?.selectedSnapshot).toBeUndefined();
  });
});

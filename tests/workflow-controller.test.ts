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
  textAlignment: 'left' as const,
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
  it('captures create selection once and ignores later selection changes', async () => {
    const sent: PluginToUIMessage[] = [];
    let reads = 0;
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () =>
        ++reads === 1
          ? { kind: 'no-selection' as const }
          : {
              kind: 'selected' as const,
              snapshot: {
                source: 'selected',
                width: 123,
                typography: settings.typography,
                placement: { x: 1, y: 2, rotation: 0 },
              },
            },
      readTarget: async () => undefined,
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    const initial = sent[0];
    await controller.selectionChanged();
    expect(reads).toBe(1);
    expect(sent).toHaveLength(1);
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    expect(sent[1]).toMatchObject({ type: 'INITIALIZE', workflowToken: tokenOf(initial) });
  });
  it('initializes reflow from persisted width and honours submitted settings without auto apply', async () => {
    const sent: PluginToUIMessage[] = [];
    const calls: WorkflowRenderRequest[] = [];
    const controller = createWorkflowController({
      mode: 'reflow',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(sent[0]).toMatchObject({ autoApply: false, settings: { width: 200 } });
    controller.handleMessage(render(tokenOf(sent[0])));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.settings.width).toBe(200);
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
    delete v2.textAlignment;
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
  it('uses submitted edit/reflow controls and forces mathScale to one', async () => {
    const calls: WorkflowRenderRequest[] = [];
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'edit',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage({
      ...render(tokenOf(sent[0])),
      settings: {
        ...settings,
        width: 321,
        textAlignment: 'right',
        mathScale: 1,
        typography: { ...settings.typography, fontSize: 24 },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.settings).toMatchObject({
      width: 321,
      textAlignment: 'right',
      mathScale: 1,
      typography: { fontSize: 24 },
    });
  });
  it('deduplicates, sorts, bounds Figma fonts and reports a failed list without losing current selector context', async () => {
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: async () => [
        { family: 'Z', style: 'Regular' },
        { family: 'A', style: 'Bold' },
        { family: 'A', style: 'Bold' },
        { family: '', style: 'bad' },
      ],
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    await Promise.resolve();
    expect(sent.find((message) => message.type === 'AVAILABLE_FONT_FAMILIES')).toMatchObject({
      families: ['A', 'Z'],
    });
    controller.handleMessage({ type: 'REQUEST_FONT_STYLES', family: 'A' });
    expect(sent.at(-1)).toMatchObject({
      type: 'AVAILABLE_FONT_STYLES',
      family: 'A',
      styles: ['Bold'],
    });
    const capped: PluginToUIMessage[] = [];
    const capController = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: async () =>
        Array.from({ length: 5001 }, (_, index) => ({ family: `F${index}`, style: 'Regular' })),
      renderDocument: async () => ({ rootName: 'x' }),
      postToUi: (message) => capped.push(message),
      closePlugin: () => undefined,
    });
    await capController.initialize();
    await Promise.resolve();
    const cappedFonts = capped.find((message) => message.type === 'AVAILABLE_FONT_FAMILIES');
    expect(cappedFonts?.type === 'AVAILABLE_FONT_FAMILIES' && cappedFonts.families).toHaveLength(
      5001,
    );
    const failed: PluginToUIMessage[] = [];
    const failing = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: async () => {
        throw new Error('no fonts');
      },
      renderDocument: async () => ({ rootName: 'x' }),
      postToUi: (message) => failed.push(message),
      closePlugin: () => undefined,
    });
    await failing.initialize();
    await Promise.resolve();
    expect(failed.find((message) => message.type === 'AVAILABLE_FONT_FAMILIES')).toMatchObject({
      families: [],
      status: expect.stringContaining('Could not load Figma fonts'),
    });
  });
  it('posts a usable context before deferred fonts and keeps its token stable when fonts arrive', async () => {
    const sent: PluginToUIMessage[] = [];
    const calls: WorkflowRenderRequest[] = [];
    let fetches = 0;
    let resolveFonts: ((fonts: readonly { family: string; style: string }[]) => void) | undefined;
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: () => {
        fetches += 1;
        return new Promise((resolve) => {
          resolveFonts = resolve;
        });
      },
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    const initial = sent[0];
    expect(initial).toMatchObject({ type: 'INITIALIZE', canApply: true });
    const token = tokenOf(initial);
    controller.handleMessage(render(token));
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    expect(fetches).toBe(1);
    resolveFonts?.([{ family: 'Inter', style: 'Regular' }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ type: 'AVAILABLE_FONT_FAMILIES', families: ['Inter'] });
    expect(tokenOf(sent.find((message) => message.type === 'INITIALIZE'))).toBe(token);
    expect(sent.filter((message) => message.type === 'RENDER_ERROR')).toHaveLength(0);
  });
  it('syncs fresh prose typography while preserving submitted width and alignment', async () => {
    const sent: PluginToUIMessage[] = [];
    const calls: WorkflowRenderRequest[] = [];
    const fresh = {
      ...settings.typography,
      fontName: { family: 'Inter', style: 'Bold' },
      fontSize: 22,
    };
    const controller = createWorkflowController({
      mode: 'sync-typography',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => target,
      readSyncedTypography: async () => fresh,
      renderDocument: async (request) => {
        calls.push(request);
        return { rootName: 'Math Paragraph' };
      },
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage({
      ...render(tokenOf(sent[0])),
      settings: { ...settings, width: 321, textAlignment: 'center' },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls[0]?.settings).toMatchObject({
      width: 321,
      textAlignment: 'center',
      mathScale: 1,
      typography: fresh,
    });
  });
  it('replays cached fonts with the exact locked context after an early UI post is lost', async () => {
    const sent: PluginToUIMessage[] = [];
    let fetches = 0;
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: async () => {
        fetches += 1;
        return [{ family: 'Inter', style: 'Regular' }];
      },
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    await Promise.resolve();
    const firstContext = sent.find((message) => message.type === 'INITIALIZE');
    const firstToken = tokenOf(firstContext);
    sent.length = 0; // Simulate posts that arrived before the iframe listener subscribed.
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: 'INITIALIZE', workflowToken: firstToken });
    expect(sent[1]).toMatchObject({ type: 'AVAILABLE_FONT_FAMILIES', families: ['Inter'] });
    expect(fetches).toBe(1);
  });
  it('replays early cached fonts while a slow first context is still unresolved', async () => {
    const sent: PluginToUIMessage[] = [];
    const selectionResolvers: Array<(result: { kind: 'no-selection' }) => void> = [];
    let resolveFonts: ((fonts: readonly { family: string; style: string }[]) => void) | undefined;
    let fontFetches = 0;
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: () =>
        new Promise((resolve) => {
          selectionResolvers.push(resolve);
        }),
      readTarget: async () => undefined,
      availableFonts: () => {
        fontFetches += 1;
        return new Promise((resolve) => {
          resolveFonts = resolve;
        });
      },
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    const firstInitialization = controller.initialize();
    resolveFonts?.([{ family: 'Inter', style: 'Regular' }]);
    await Promise.resolve();
    await Promise.resolve();
    sent.length = 0; // Both early posts were before iframe subscription.
    controller.handleMessage({ type: 'REQUEST_INITIALIZATION' });
    await Promise.resolve(); // The request starts a second, still context-only initialization.
    selectionResolvers.forEach((resolve) => resolve({ kind: 'no-selection' }));
    await firstInitialization;
    await Promise.resolve();
    await Promise.resolve();
    expect(sent.find((message) => message.type === 'AVAILABLE_FONT_FAMILIES')).toMatchObject({
      families: ['Inter'],
    });
    expect(sent.find((message) => message.type === 'INITIALIZE')).toMatchObject({
      canApply: true,
      workflowToken: expect.any(Number),
    });
    expect(fontFetches).toBe(1);
  });
  it('does not retarget Create after a successful render-induced selection change', async () => {
    const sent: PluginToUIMessage[] = [];
    let reads = 0;
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () =>
        ++reads === 1
          ? { kind: 'no-selection' as const }
          : {
              kind: 'selected' as const,
              snapshot: {
                source: 'new selection',
                width: 100,
                typography: settings.typography,
                placement: { x: 0, y: 0, rotation: 0 },
              },
            },
      readTarget: async () => undefined,
      renderDocument: async () => ({ rootName: 'Math Paragraph' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    controller.handleMessage(render(tokenOf(sent[0])));
    await Promise.resolve();
    await Promise.resolve();
    const beforeSelectionChange = sent.length;
    await controller.selectionChanged();
    expect(reads).toBe(1);
    expect(sent).toHaveLength(beforeSelectionChange);
  });
  it('keeps Roboto selectable after more than 5000 earlier sorted style pairs', async () => {
    const sent: PluginToUIMessage[] = [];
    const controller = createWorkflowController({
      mode: 'create',
      readSelection: async () => ({ kind: 'no-selection' }),
      readTarget: async () => undefined,
      availableFonts: async () => [
        ...Array.from({ length: 5001 }, (_, index) => ({
          family: 'Mukta Vaani',
          style: `Style ${index}`,
        })),
        { family: 'Roboto', style: 'Regular' },
      ],
      renderDocument: async () => ({ rootName: 'x' }),
      postToUi: (message) => sent.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    await Promise.resolve();
    expect(sent.find((message) => message.type === 'AVAILABLE_FONT_FAMILIES')).toMatchObject({
      families: expect.arrayContaining(['Mukta Vaani', 'Roboto']),
    });
    controller.handleMessage({ type: 'REQUEST_FONT_STYLES', family: 'Roboto' });
    expect(sent.at(-1)).toMatchObject({
      type: 'AVAILABLE_FONT_STYLES',
      family: 'Roboto',
      styles: ['Regular'],
    });
  });
});

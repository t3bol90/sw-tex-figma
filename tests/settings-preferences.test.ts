import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsPreferences,
  SETTINGS_PREFERENCES_KEY,
  type PreferencesStorage,
} from '../src/figma/settings-preferences';
import {
  createWorkflowController,
  type WorkflowControllerDependencies,
} from '../src/figma/workflow-controller';
import { DEFAULT_TYPOGRAPHY } from '../src/figma/typography';
import { createPersistedDocumentState } from '../src/figma/persistence';
import {
  isPluginToUIMessage,
  isUIToPluginMessage,
  type PluginToUIMessage,
} from '../src/shared/messages';
import type { RenderSettings } from '../src/shared/types';
import { PreferenceSession } from '../src/ui/preference-session';

const settings: RenderSettings = {
  width: 820,
  mathScale: 1,
  inheritTypography: false,
  textAlignment: 'center',
  typography: {
    ...DEFAULT_TYPOGRAPHY,
    fontName: { family: 'Roboto', style: 'Bold' },
    fontSize: 24,
    fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 }, opacity: 0.65 }],
  },
};
const memoryStorage = (initial?: unknown) => {
  let value = initial;
  return {
    getAsync: vi.fn(async () => value),
    setAsync: vi.fn(async (_key: string, next: unknown) => {
      value = next;
    }),
  };
};
const session = (
  storage: PreferencesStorage,
  overrides: Partial<WorkflowControllerDependencies> = {},
) => {
  const messages: PluginToUIMessage[] = [];
  const closePlugin = vi.fn();
  const renderDocument = vi.fn(async () => ({ rootName: 'Result' }));
  const preferences = createSettingsPreferences(storage);
  const controller = createWorkflowController({
    mode: 'create',
    readSelection: async () => ({ kind: 'no-selection' }),
    readTarget: async () => undefined,
    closePlugin,
    renderDocument,
    postToUi: (message) => messages.push(message),
    preferences,
    ...overrides,
  });
  return { controller, messages, closePlugin, renderDocument, preferences };
};
const initialized = (messages: readonly PluginToUIMessage[]) => {
  const message = messages.find((message) => message.type === 'INITIALIZE');
  if (message?.type !== 'INITIALIZE' || !message.workflowToken) throw new Error('Missing context');
  return message;
};

describe('remembered settings', () => {
  it('saves before Apply and reopens every setting, without source or node identity', async () => {
    const storage = memoryStorage();
    const first = session(storage);
    await first.controller.initialize();
    const withUnrelatedData = { ...settings, source: 'private draft', nodeId: 'secret' };
    first.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings: withUnrelatedData,
      workflowToken: initialized(first.messages).workflowToken!,
      revision: 1,
    });
    await first.preferences.flush();
    expect(first.renderDocument).not.toHaveBeenCalled();
    expect(first.messages.at(-1)).toMatchObject({ type: 'PREFERENCES_SAVED', revision: 1 });
    expect(storage.setAsync).toHaveBeenCalledWith(SETTINGS_PREFERENCES_KEY, {
      version: 1,
      settings,
    });
    const reopened = session(storage);
    await reopened.controller.initialize();
    expect(initialized(reopened.messages).settings).toEqual(settings);
  });
  it.each([
    undefined,
    { version: 2, settings },
    { version: 1, settings: { ...settings, mathScale: 2 } },
    {
      version: 1,
      settings: { ...settings, typography: { ...settings.typography, fontSize: NaN } },
    },
  ])('uses built-in defaults for absent or corrupt storage %j', async (stored) => {
    const next = session(memoryStorage(stored));
    await next.controller.initialize();
    expect(initialized(next.messages).settings).toMatchObject({
      width: 480,
      mathScale: 1,
      textAlignment: 'left',
      typography: DEFAULT_TYPOGRAPHY,
    });
  });
  it('survives storage read failure', async () => {
    const storage = memoryStorage();
    storage.getAsync.mockRejectedValue(new Error('Unavailable'));
    const next = session(storage);
    await next.controller.initialize();
    expect(initialized(next.messages)).toMatchObject({ canApply: true, settings: { width: 480 } });
  });
  it('loads defaults before publishing context while font inventory remains independent', async () => {
    let resolveRead: ((value: unknown) => void) | undefined;
    const storage: PreferencesStorage = {
      getAsync: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      setAsync: async () => undefined,
    };
    const next = session(storage, {
      availableFonts: async () => [{ family: 'Inter', style: 'Regular' }],
    });
    const loading = next.controller.initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(next.messages.some((message) => message.type === 'INITIALIZE')).toBe(false);
    expect(next.messages.some((message) => message.type === 'AVAILABLE_FONT_FAMILIES')).toBe(true);
    resolveRead?.({ version: 1, settings });
    await loading;
    expect(initialized(next.messages).settings).toEqual(settings);
  });
  it('gives selected native text and existing documents priority without writing preferences', async () => {
    const storage = memoryStorage({ version: 1, settings });
    const typography = { ...DEFAULT_TYPOGRAPHY, fontSize: 31 };
    const native = session(storage, {
      readSelection: async () => ({
        kind: 'selected',
        snapshot: {
          source: 'selected',
          width: 333,
          typography,
          placement: { x: 0, y: 0, rotation: 0 },
        },
      }),
    });
    await native.controller.initialize();
    expect(initialized(native.messages)).toMatchObject({
      source: 'selected',
      settings: { width: 333, typography },
    });
    const documentSettings = { ...settings, width: 444, textAlignment: 'right' as const };
    const existing = session(storage, {
      mode: 'edit',
      readTarget: async () => ({
        node: { type: 'FRAME', getPluginData: () => '' },
        state: createPersistedDocumentState('canonical', documentSettings, 444),
        width: 444,
      }),
    });
    await existing.controller.initialize();
    expect(initialized(existing.messages)).toMatchObject({
      source: 'canonical',
      settings: documentSettings,
    });
    expect(storage.setAsync).not.toHaveBeenCalled();
  });
  it('serializes rapid changes and waits for every write before Close', async () => {
    const writes: Array<() => void> = [];
    const storage = memoryStorage();
    storage.setAsync.mockImplementation(
      (_key, next) =>
        new Promise((resolve) => {
          writes.push(() => {
            resolve();
          });
          void next;
        }),
    );
    const next = session(storage);
    await next.controller.initialize();
    const workflowToken = initialized(next.messages).workflowToken!;
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken,
      revision: 1,
    });
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings: { ...settings, width: 900 },
      workflowToken,
      revision: 2,
    });
    next.controller.handleMessage({ type: 'CLOSE' });
    await Promise.resolve();
    expect(next.closePlugin).not.toHaveBeenCalled();
    expect(storage.setAsync).toHaveBeenCalledTimes(1);
    writes[0]?.();
    await vi.waitFor(() => expect(storage.setAsync).toHaveBeenCalledTimes(2));
    expect(next.closePlugin).not.toHaveBeenCalled();
    writes[1]?.();
    await vi.waitFor(() => expect(next.closePlugin).toHaveBeenCalledOnce());
    expect(storage.setAsync.mock.calls[1]?.[1]).toEqual({
      version: 1,
      settings: { ...settings, width: 900 },
    });
  });
  it('reports a rejected save and allows a later write to succeed', async () => {
    const storage = memoryStorage();
    storage.setAsync.mockRejectedValueOnce(new Error('Unavailable'));
    const next = session(storage);
    await next.controller.initialize();
    const workflowToken = initialized(next.messages).workflowToken!;
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken,
      revision: 1,
    });
    await next.preferences.flush();
    expect(next.messages.at(-1)).toMatchObject({ type: 'PREFERENCES_ERROR', revision: 1 });
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken,
      revision: 2,
    });
    await next.preferences.flush();
    expect(next.messages.at(-1)).toMatchObject({ type: 'PREFERENCES_SAVED', revision: 2 });
  });
  it('rejects stale tokens and reordered revisions without writing', async () => {
    const storage = memoryStorage();
    const next = session(storage);
    await next.controller.initialize();
    const workflowToken = initialized(next.messages).workflowToken!;
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken: workflowToken + 1,
      revision: 1,
    });
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken,
      revision: 2,
    });
    next.controller.handleMessage({
      type: 'SAVE_PREFERENCES',
      settings: { ...settings, width: 900 },
      workflowToken,
      revision: 1,
    });
    await next.preferences.flush();
    expect(storage.setAsync).toHaveBeenCalledTimes(1);
  });
});

describe('preference UI session and protocol', () => {
  it('does not save hydration and only accepts acknowledgement of the latest user change', () => {
    const next = new PreferenceSession();
    expect(next.change(settings)).toBeUndefined();
    expect(next.initialize(3)).toBe(true);
    expect(next.initialize(3)).toBe(false);
    expect(next.initialize(2)).toBe(false);
    expect(next.change(settings)).toMatchObject({ workflowToken: 3, revision: 1 });
    expect(next.change({ ...settings, width: 900 })).toMatchObject({ revision: 2 });
    expect(next.accepts({ type: 'PREFERENCES_SAVED', workflowToken: 3, revision: 1 })).toBe(false);
    expect(next.accepts({ type: 'PREFERENCES_SAVED', workflowToken: 2, revision: 2 })).toBe(false);
    expect(next.accepts({ type: 'PREFERENCES_ERROR', workflowToken: 3, revision: 2 })).toBe(true);
  });
  it('validates preferences messages and acknowledgements', () => {
    const valid = { type: 'SAVE_PREFERENCES', settings, workflowToken: 1, revision: 1 };
    expect(isUIToPluginMessage(valid)).toBe(true);
    for (const malformed of [
      { ...valid, revision: 0 },
      { ...valid, workflowToken: NaN },
      { ...valid, settings: { ...settings, mathScale: 2 } },
      { ...valid, source: 'draft' },
    ])
      expect(isUIToPluginMessage(malformed)).toBe(false);
    expect(isPluginToUIMessage({ type: 'PREFERENCES_SAVED', workflowToken: 1, revision: 1 })).toBe(
      true,
    );
    expect(isPluginToUIMessage({ type: 'PREFERENCES_ERROR', workflowToken: 1, revision: -1 })).toBe(
      false,
    );
  });
});

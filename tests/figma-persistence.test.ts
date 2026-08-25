import { describe, expect, it } from 'vitest';
import {
  createPersistedDocumentState,
  parsePersistedDocumentState,
  persistDocumentState,
  readPersistedDocumentState,
  serializePersistedDocumentState,
} from '../src/figma/persistence';
const settings = {
  width: 100,
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
describe('versioned document persistence', () => {
  it('round trips strict canonical v1 state and both metadata keys', () => {
    const state = createPersistedDocumentState('a $x$', settings);
    const data = new Map<string, string>();
    let relaunch: Record<string, string> = {};
    persistDocumentState(
      {
        setPluginData: (key, value) => data.set(key, value),
        setRelaunchData: (value) => {
          relaunch = value;
        },
      },
      'a $x$',
      settings,
    );
    expect(parsePersistedDocumentState(serializePersistedDocumentState(state))).toEqual(state);
    expect(data.get('math-text-version')).toBe('1');
    expect(readPersistedDocumentState({ getPluginData: (key) => data.get(key) ?? '' })).toEqual(
      state,
    );
    expect(
      readPersistedDocumentState({
        getPluginData: (key) => (key === 'math-text-document' ? (data.get(key) ?? '') : ''),
      }),
    ).toBeUndefined();
    expect(
      readPersistedDocumentState({
        getPluginData: (key) =>
          key === 'math-text-version' ? 'not-a-number' : (data.get(key) ?? ''),
      }),
    ).toBeUndefined();
    expect(relaunch).toEqual({ edit: 'Edit Math Text' });
  });
  it('rejects malformed, unknown-version, extra-key, and oversized state safely', () => {
    const valid = JSON.parse(
      serializePersistedDocumentState(createPersistedDocumentState('x', settings)),
    ) as Record<string, unknown>;
    expect(parsePersistedDocumentState('{')).toBeUndefined();
    expect(parsePersistedDocumentState(JSON.stringify({ ...valid, version: 2 }))).toBeUndefined();
    expect(parsePersistedDocumentState(JSON.stringify({ ...valid, extra: true }))).toBeUndefined();
    expect(parsePersistedDocumentState('x'.repeat(900_001))).toBeUndefined();
    // Byte, not UTF-16 code-unit, limits prevent multibyte formulas bypassing the budget.
    expect(parsePersistedDocumentState('😀'.repeat(300_000))).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  createPersistedDocumentState,
  parsePersistedDocumentState,
  persistDocumentState,
  readPersistedDocumentState,
  serializePersistedDocumentState,
  utf8ByteLength,
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
  it('counts UTF-8 bytes without TextEncoder, including replacement semantics for lone surrogates', () => {
    expect(utf8ByteLength('ASCII')).toBe(5);
    expect(utf8ByteLength('©')).toBe(2);
    expect(utf8ByteLength('漢')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('A©漢😀')).toBe(10);
    expect(utf8ByteLength('\ud800')).toBe(3);
    expect(utf8ByteLength('\udc00')).toBe(3);
  });
  it('round trips strict canonical v2 state and both metadata keys', () => {
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
    expect(data.get('math-text-version')).toBe('2');
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
    expect(parsePersistedDocumentState(JSON.stringify({ ...valid, version: 3 }))).toBeUndefined();
    expect(parsePersistedDocumentState(JSON.stringify({ ...valid, extra: true }))).toBeUndefined();
    expect(parsePersistedDocumentState('x'.repeat(900_001))).toBeUndefined();
    // Byte, not UTF-16 code-unit, limits prevent multibyte formulas bypassing the budget.
    expect(parsePersistedDocumentState('😀'.repeat(300_000))).toBeUndefined();
  });

  it('migrates strict v1 only in memory using the current root width fallback', () => {
    const v1 = {
      ...createPersistedDocumentState('old', settings),
      version: 1,
      compiledWidth: undefined,
    } as Record<string, unknown>;
    delete v1.compiledWidth;
    const data = new Map<string, string>([
      ['math-text-version', '1'],
      ['math-text-document', JSON.stringify(v1)],
    ]);
    const migrated = readPersistedDocumentState(
      { getPluginData: (key) => data.get(key) ?? '' },
      333,
    );
    expect(migrated).toMatchObject({ version: 2, source: 'old', width: 100, compiledWidth: 333 });
    expect(data.get('math-text-version')).toBe('1');
    data.set('math-text-version', '2');
    expect(
      readPersistedDocumentState({ getPluginData: (key) => data.get(key) ?? '' }, 333),
    ).toBeUndefined();
  });
});

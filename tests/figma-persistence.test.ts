import { describe, expect, it } from 'vitest';
import {
  createPersistedDocumentState,
  parsePersistedDocumentState,
  persistDocumentState,
  readPersistedDocumentState,
  serializePersistedDocumentState,
  utf8ByteLength,
  isPersistedDocumentStateV1,
  isPersistedDocumentStateV2,
  parseStoredDocumentState,
} from '../src/figma/persistence';
const settings = {
  width: 100,
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
  it('round trips strict canonical v3 state and both metadata keys', () => {
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
    expect(data.get('math-text-version')).toBe('3');
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
  it('round trips justified v3 state without a schema version bump', () => {
    const justified = { ...settings, textAlignment: 'justify' as const };
    const state = createPersistedDocumentState('one two', justified);
    expect(state.version).toBe(3);
    expect(parsePersistedDocumentState(serializePersistedDocumentState(state))).toEqual(state);
  });
  it('rejects nested unknown v3 persistence keys but accepts Figma typography fields', () => {
    const withFill = {
      ...settings,
      typography: {
        ...settings.typography,
        fills: [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }],
      },
    };
    const valid = createPersistedDocumentState('x', withFill);
    expect(parsePersistedDocumentState(JSON.stringify(valid))).toBeDefined();
    const candidates = [
      { ...valid, typography: { ...valid.typography, extra: true } },
      {
        ...valid,
        typography: {
          ...valid.typography,
          fontName: { ...valid.typography.fontName, extra: true },
        },
      },
      {
        ...valid,
        typography: {
          ...valid.typography,
          lineHeight: { ...valid.typography.lineHeight, extra: true },
        },
      },
      {
        ...valid,
        typography: {
          ...valid.typography,
          letterSpacing: { ...valid.typography.letterSpacing, extra: true },
        },
      },
      {
        ...valid,
        typography: { ...valid.typography, fills: [{ ...valid.typography.fills[0], extra: true }] },
      },
      {
        ...valid,
        typography: {
          ...valid.typography,
          fills: [
            {
              ...valid.typography.fills[0],
              color: { ...valid.typography.fills[0].color, extra: true },
            },
          ],
        },
      },
    ];
    for (const candidate of candidates)
      expect(parsePersistedDocumentState(JSON.stringify(candidate))).toBeUndefined();
  });
  it('rejects malformed, unknown-version, extra-key, and oversized state safely', () => {
    const valid = JSON.parse(
      serializePersistedDocumentState(createPersistedDocumentState('x', settings)),
    ) as Record<string, unknown>;
    expect(parsePersistedDocumentState('{')).toBeUndefined();
    expect(parsePersistedDocumentState(JSON.stringify({ ...valid, version: 4 }))).toBeUndefined();
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
    delete v1.textAlignment;
    const data = new Map<string, string>([
      ['math-text-version', '1'],
      ['math-text-document', JSON.stringify(v1)],
    ]);
    const migrated = readPersistedDocumentState(
      { getPluginData: (key) => data.get(key) ?? '' },
      333,
    );
    expect(migrated).toMatchObject({ version: 3, source: 'old', width: 100, compiledWidth: 333 });
    expect(data.get('math-text-version')).toBe('1');
    data.set('math-text-version', '3');
    expect(
      readPersistedDocumentState({ getPluginData: (key) => data.get(key) ?? '' }, 333),
    ).toBeUndefined();
  });
  it('strictly parses v1 and v2 then migrates both to v3 without retaining independent scale', () => {
    const current = JSON.parse(
      serializePersistedDocumentState(createPersistedDocumentState('old', settings, 222)),
    ) as Record<string, unknown>;
    const v1: Record<string, unknown> = { ...current, version: 1, mathScale: 2 };
    delete v1.compiledWidth;
    delete v1.textAlignment;
    const v2: Record<string, unknown> = { ...current, version: 2, mathScale: 2 };
    delete v2.textAlignment;
    expect(isPersistedDocumentStateV1(v1)).toBe(true);
    expect(isPersistedDocumentStateV2(v2)).toBe(true);
    expect(parseStoredDocumentState(JSON.stringify(v1))?.version).toBe(1);
    const data = new Map([
      ['math-text-version', '2'],
      ['math-text-document', JSON.stringify(v2)],
    ]);
    const migrated = readPersistedDocumentState(
      { getPluginData: (key) => data.get(key) ?? '' },
      999,
    );
    expect(migrated).toMatchObject({
      version: 3,
      compiledWidth: 222,
      textAlignment: 'left',
      mathScale: 1,
    });
    expect(data.get('math-text-document')).toBe(JSON.stringify(v2));
  });
  it('migrates permissive legacy typography into the closed v3 wire shape', () => {
    const current = createPersistedDocumentState('old', settings, 222);
    const v1 = {
      ...current,
      version: 1,
      mathScale: 2,
      typography: {
        ...settings.typography,
        fontName: { ...settings.typography.fontName, legacyExtra: true },
      },
    } as Record<string, unknown>;
    delete v1.compiledWidth;
    delete v1.textAlignment;
    const data = new Map([
      ['math-text-version', '1'],
      ['math-text-document', JSON.stringify(v1)],
    ]);
    const migrated = readPersistedDocumentState(
      { getPluginData: (key) => data.get(key) ?? '' },
      222,
    );
    expect(migrated?.typography.fontName).toEqual(settings.typography.fontName);
    expect(parsePersistedDocumentState(JSON.stringify(migrated))).toEqual(migrated);
  });
  it('requires v3 alignment and rejects version metadata mismatch', () => {
    const valid = JSON.parse(
      serializePersistedDocumentState(createPersistedDocumentState('x', settings)),
    ) as Record<string, unknown>;
    const missing = { ...valid };
    delete missing.textAlignment;
    expect(parsePersistedDocumentState(JSON.stringify(missing))).toBeUndefined();
    expect(
      parsePersistedDocumentState(JSON.stringify({ ...valid, textAlignment: 'justify' })),
    ).toMatchObject({
      textAlignment: 'justify',
    });
    const data = new Map([
      ['math-text-version', '2'],
      ['math-text-document', JSON.stringify(valid)],
    ]);
    expect(
      readPersistedDocumentState({ getPluginData: (key) => data.get(key) ?? '' }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import type { FontDescriptor, TypographyContext } from '../src/shared/types';

import {
  BoundedTextMeasurementCache,
  createTextMeasurementCacheKey,
  FigmaTextMeasurer,
  measureTextWithFigma,
  TextMeasurementError,
  type FigmaMeasurementTextNode,
} from '../src/figma/text-measurement';

const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'PIXELS' as const, value: 24 },
  letterSpacing: { unit: 'PERCENT' as const, value: 2 },
  fills: [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0 }, opacity: 0.8 }],
};

function fakeNode(events: string[], width = 40, height = 24): FigmaMeasurementTextNode {
  const node: FigmaMeasurementTextNode = {
    set fontName(value: FontDescriptor) {
      events.push(`fontName:${value.family}/${value.style}`);
    },
    set fontSize(value: number) {
      events.push(`fontSize:${value}`);
    },
    set lineHeight(value: TypographyContext['lineHeight']) {
      events.push(`lineHeight:${value.unit}`);
    },
    set letterSpacing(value: TypographyContext['letterSpacing']) {
      events.push(`letterSpacing:${value.unit}`);
    },
    set fills(value: TypographyContext['fills']) {
      events.push(`fills:${value.length}`);
    },
    set textAutoResize(value: 'WIDTH_AND_HEIGHT') {
      events.push(`textAutoResize:${value}`);
    },
    set characters(value: string) {
      events.push(`characters:${value}`);
    },
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    remove() {
      events.push('remove');
    },
  };
  return node;
}

describe('native Figma text measurement', () => {
  it('loads the exact font, applies supported properties before characters, and removes the node', async () => {
    const events: string[] = [];
    const result = await measureTextWithFigma(
      {
        loadFontAsync: async (font) => {
          events.push(`load:${font.family}/${font.style}`);
        },
        createText: () => {
          events.push('create');
          return fakeNode(events);
        },
      },
      { text: 'hello', typography },
    );
    expect(result).toEqual({ width: 40, height: 24 });
    expect(events).toEqual([
      'create',
      'load:Inter/Regular',
      'fontName:Inter/Regular',
      'fontSize:16',
      'lineHeight:PIXELS',
      'letterSpacing:PERCENT',
      'fills:1',
      'textAutoResize:WIDTH_AND_HEIGHT',
      'characters:hello',
      'remove',
    ]);
  });

  it('includes font identity and cleans up when font loading fails', async () => {
    const events: string[] = [];
    await expect(
      measureTextWithFigma(
        {
          loadFontAsync: async () => {
            throw new Error('not installed');
          },
          createText: () => fakeNode(events),
        },
        { text: 'hello', typography },
      ),
    ).rejects.toMatchObject({
      code: 'FONT_LOAD_FAILED',
      fontName: { family: 'Inter', style: 'Regular' },
      message: expect.stringContaining('Inter Regular'),
    });
    expect(events).toEqual(['remove']);
  });

  it('cleans up when applying a property or reading bounds fails', async () => {
    const events: string[] = [];
    const node = fakeNode(events, Number.NaN, 10);
    await expect(
      measureTextWithFigma(
        { loadFontAsync: async () => undefined, createText: () => node },
        { text: 'hello', typography },
      ),
    ).rejects.toMatchObject({ code: 'MEASUREMENT_FAILED' });
    expect(events.at(-1)).toBe('remove');
  });
  it('derives an ordinary-space advance from NBSP in the exact effective font', async () => {
    const seen: string[] = [];
    const measurer = new FigmaTextMeasurer({
      loadFontAsync: async () => undefined,
      createText: () => {
        let characters = '';
        return {
          fontName: {},
          fontSize: 0,
          lineHeight: {},
          letterSpacing: {},
          fills: [],
          set characters(value: string) {
            characters = value;
            seen.push(value);
          },
          get characters() {
            return characters;
          },
          get width() {
            return characters === ' ' ? 0 : characters === '\u00a0' ? 4 : 10;
          },
          get height() {
            return 20;
          },
          remove() {},
        };
      },
    });
    expect((await measurer.measure({ text: ' ', typography })).width).toBe(0);
    expect(await measurer.measureOrdinarySpaceAdvance({ text: ' ', typography })).toBe(4);
    expect(seen).toContain('\u00a0');
  });
});

describe('text measurement cache', () => {
  const request = { text: 'x', typography };

  it('separates every measurement-affecting property and font resolution input', () => {
    const key = createTextMeasurementCacheKey(request);
    expect(createTextMeasurementCacheKey(request)).toBe(key);
    expect(createTextMeasurementCacheKey({ ...request, text: 'y' })).not.toBe(key);
    expect(
      createTextMeasurementCacheKey({ ...request, typography: { ...typography, fontSize: 17 } }),
    ).not.toBe(key);
    expect(
      createTextMeasurementCacheKey({
        ...request,
        typography: { ...typography, lineHeight: { unit: 'AUTO' as const } },
      }),
    ).not.toBe(key);
    expect(
      createTextMeasurementCacheKey({
        ...request,
        typography: { ...typography, letterSpacing: { unit: 'PIXELS' as const, value: 1 } },
      }),
    ).not.toBe(key);
    expect(
      createTextMeasurementCacheKey({
        ...request,
        fontResolution: { fontName: { family: 'Inter', style: 'Bold' }, marks: ['bold'] },
      }),
    ).not.toBe(key);
  });

  it('hits, uses LRU eviction, clears, and does not cache failures', async () => {
    let creates = 0;
    const measurer = new FigmaTextMeasurer(
      {
        loadFontAsync: async () => undefined,
        createText: () => {
          creates += 1;
          return fakeNode([]);
        },
      },
      new BoundedTextMeasurementCache(2),
    );
    await measurer.measure(request);
    await measurer.measure(request);
    expect(creates).toBe(1);
    await measurer.measure({ ...request, text: 'two' });
    await measurer.measure(request); // promote x
    await measurer.measure({ ...request, text: 'three' });
    expect(measurer.cacheSize).toBe(2);
    await measurer.measure({ ...request, text: 'two' }); // was least recently used
    expect(creates).toBe(4);
    measurer.clear();
    expect(measurer.cacheSize).toBe(0);

    let attempts = 0;
    const failing = new FigmaTextMeasurer({
      loadFontAsync: async () => {
        attempts += 1;
        throw new Error('missing');
      },
      createText: () => fakeNode([]),
    });
    await expect(failing.measure(request)).rejects.toBeInstanceOf(TextMeasurementError);
    await expect(failing.measure(request)).rejects.toBeInstanceOf(TextMeasurementError);
    expect(attempts).toBe(2);
    expect(failing.cacheSize).toBe(0);
  });
});

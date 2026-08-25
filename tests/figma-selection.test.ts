import { describe, expect, it } from 'vitest';

import { readSelectionSnapshot } from '../src/figma/selection';

const mixed = Symbol('mixed');
const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'PIXELS', value: 24 },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
};

const text = (overrides: Record<string, unknown> = {}) => ({
  type: 'TEXT' as const,
  characters: 'Selected $x$.',
  width: 320,
  x: 10,
  y: 20,
  rotation: 5,
  ...typography,
  ...overrides,
});

const read = async (
  selection: readonly { readonly type: string }[],
  load: (font: { family: string; style: string }) => Promise<void> = async () => undefined,
) => readSelectionSnapshot({ mixed, currentPage: { selection }, loadFontAsync: load });

describe('Figma text selection snapshots', () => {
  it('copies one supported text selection with source, width, typography, and placement', async () => {
    const loadFontAsync = async (font: { family: string; style: string }) => {
      expect(font).toEqual({ family: 'Inter', style: 'Regular' });
    };
    await expect(read([text({ textStyleId: 'style-123' })], loadFontAsync)).resolves.toEqual({
      kind: 'selected',
      snapshot: {
        source: 'Selected $x$.',
        width: 320,
        typography: { ...typography, textStyleId: 'style-123' },
        placement: { x: 10, y: 20, rotation: 5 },
      },
    });
  });

  it('reports no, multiple, and non-text selections without trying to load a font', async () => {
    await expect(read([])).resolves.toEqual({ kind: 'no-selection' });
    await expect(read([text(), text()])).resolves.toEqual({ kind: 'multiple-selection', count: 2 });
    await expect(read([{ type: 'RECTANGLE' }])).resolves.toEqual({
      kind: 'non-text-selection',
      nodeType: 'RECTANGLE',
    });
  });

  it.each([
    ['fontName', 'MIXED_FONT_NAME'],
    ['fontSize', 'MIXED_FONT_SIZE'],
    ['lineHeight', 'MIXED_LINE_HEIGHT'],
    ['letterSpacing', 'MIXED_LETTER_SPACING'],
    ['fills', 'MIXED_FILLS'],
    ['textStyleId', 'MIXED_TEXT_STYLE_ID'],
  ])('rejects mixed %s explicitly', async (property, code) => {
    const outcome = await read([text({ [property]: mixed })]);
    expect(outcome).toMatchObject({
      kind: 'invalid-text-selection',
      issue: { code: 'TYPOGRAPHY', typographyIssue: { code } },
    });
  });

  it('rejects unsupported fills and non-finite geometry instead of coercing it', async () => {
    await expect(read([text({ fills: [{ type: 'GRADIENT_LINEAR' }] })])).resolves.toMatchObject({
      kind: 'invalid-text-selection',
      issue: { code: 'TYPOGRAPHY', typographyIssue: { code: 'UNSUPPORTED_FILL' } },
    });
    await expect(read([text({ width: Number.NaN })])).resolves.toMatchObject({
      kind: 'invalid-text-selection',
      issue: { code: 'INVALID_WIDTH' },
    });
  });

  it('reports an unavailable font with its identity', async () => {
    const outcome = await read([text()], async () => {
      throw new Error('missing');
    });
    expect(outcome).toMatchObject({
      kind: 'invalid-text-selection',
      issue: {
        code: 'FONT_UNAVAILABLE',
        fontName: { family: 'Inter', style: 'Regular' },
        message: expect.stringContaining('Inter Regular'),
      },
    });
  });
});

import { describe, expect, it } from 'vitest';

import type { ParagraphNode } from '../src/shared/document-model';
import type { RenderedMathPayload, TypographyContext } from '../src/shared/types';
import {
  calibrateProseMetrics,
  composeMeasuredParagraph,
  validateProseBaselineCalibration,
  measureDocument,
  measureParagraph,
  tokenizeParagraph,
  validateRenderedMathPayloads,
  type NativeTextMeasurementRequest,
} from '../src/layout';

const typography: TypographyContext = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'PIXELS', value: 20 },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  fills: [],
};
const measure = async ({ text }: NativeTextMeasurementRequest) => ({
  width: [...text].length * 10,
  height: 20,
});
const math = (
  latex: string,
  width = 10,
  ascent = 12,
  descent = 4,
  display = false,
): RenderedMathPayload => ({
  latex,
  display,
  svg: '<svg/>',
  metrics: { width, height: ascent + descent, ascent, descent, baseline: ascent },
});
const paragraph = (children: ParagraphNode['children']): ParagraphNode => ({
  type: 'paragraph',
  children,
});
const measured = async (
  children: ParagraphNode['children'],
  payloads: readonly RenderedMathPayload[] = [],
) =>
  measureParagraph(paragraph(children), {
    typography,
    measureText: measure,
    renderedMath: payloads,
  });
const compose = (value: Awaited<ReturnType<typeof measured>>, width: number) =>
  composeMeasuredParagraph(value, { typography, width });

describe('paragraph tokenization and breaks', () => {
  it('uses real whitespace rather than AST run boundaries', () => {
    const tokens = tokenizeParagraph(
      paragraph([
        { type: 'text', value: 'foo', marks: ['bold'] },
        { type: 'text', value: 'bar' },
        { type: 'math', latex: 'x', display: false },
        { type: 'text', value: '.' },
      ]),
    );
    expect(tokens.map((token) => token.kind)).toEqual(['prose', 'prose', 'math', 'prose']);
  });

  it('accepts exact fits and trims ordinary separator width at a wrap', async () => {
    const plan = compose(await measured([{ type: 'text', value: 'a b' }]), 30);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.children[0]).toMatchObject({ type: 'prose', text: 'a b' });
    const wrapped = compose(await measured([{ type: 'text', value: 'a b' }]), 29);
    expect(
      wrapped.lines.map((line) =>
        line.children.map((child) => (child.type === 'prose' ? child.text : child.latex)).join(''),
      ),
    ).toEqual(['a', 'b']);
  });

  it('does not retain a dropped separator as phantom width after a wrap', async () => {
    const plan = compose(await measured([{ type: 'text', value: 'a b c d' }]), 30);
    expect(
      plan.lines.map((line) =>
        line.children.map((child) => (child.type === 'prose' ? child.text : child.latex)).join(''),
      ),
    ).toEqual(['a b', 'c d']);
    expect(plan.lines.map((line) => line.width)).toEqual([30, 30]);
  });

  it('drops leading/trailing ordinary whitespace but keeps NBSP glued', async () => {
    const ordinary = compose(await measured([{ type: 'text', value: '  a  b  ' }]), 10);
    expect(
      ordinary.lines.map((line) =>
        line.children.map((child) => (child.type === 'prose' ? child.text : '')).join(''),
      ),
    ).toEqual(['a', 'b']);
    const nbsp = compose(await measured([{ type: 'text', value: 'a\u00a0b' }]), 10);
    expect(nbsp.lines).toHaveLength(1);
    expect(nbsp.lines[0]?.width).toBe(30);
  });

  it('overflows one word or one indivisible math box without looping', async () => {
    expect(compose(await measured([{ type: 'text', value: 'long' }]), 10).lines[0]?.width).toBe(40);
    const plan = compose(
      await measured([{ type: 'math', latex: 'verylong', display: false }], [math('verylong', 50)]),
      10,
    );
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.children[0]).toMatchObject({ type: 'math', latex: 'verylong' });
  });

  it('keeps punctuation and marked fragments glued to adjacent math absent whitespace', async () => {
    const p = compose(
      await measured(
        [
          { type: 'text', value: 'a ' },
          { type: 'math', latex: 'x', display: false },
          { type: 'text', value: '.', marks: ['bold'] },
        ],
        [math('x', 10)],
      ),
      15,
    );
    expect(p.lines).toHaveLength(2);
    expect(
      p.lines[1]?.children.map((child) => (child.type === 'math' ? child.latex : child.text)),
    ).toEqual(['x', '.']);
  });

  it('wraps an entire no-whitespace marked group instead of just its first fragment', async () => {
    const plan = compose(
      await measured([
        { type: 'text', value: 'a ' },
        { type: 'text', value: 'b', marks: ['bold'] },
        { type: 'text', value: 'c' },
      ]),
      30,
    );
    expect(
      plan.lines.map((line) =>
        line.children.map((child) => (child.type === 'prose' ? child.text : child.latex)).join(''),
      ),
    ).toEqual(['a', 'bc']);
  });

  it('preserves leading, trailing, and consecutive CommonMark hard-break empty lines', async () => {
    const plan = compose(
      await measured([
        { type: 'break' },
        { type: 'text', value: 'x' },
        { type: 'break' },
        { type: 'break' },
      ]),
      100,
    );
    expect(plan.lines).toHaveLength(4);
    expect(plan.lines.map((line) => line.children.length)).toEqual([0, 1, 0, 0]);
    expect(plan.lines.map((line) => line.forced)).toEqual([true, true, true, false]);
  });
});

describe('ordinary-space advance probes', () => {
  const payload = math('x', 10);
  const zeroSpaceMeasure = async ({ text, fontResolution }: NativeTextMeasurementRequest) => ({
    width: text.includes(' ') ? 0 : [...text].length * 6,
    height: 20,
    ...(fontResolution ? {} : {}),
  });
  it('uses a font-derived probe for terminal ordinary spaces, but not absent spaces or NBSP', async () => {
    const advanceCalls: NativeTextMeasurementRequest[] = [];
    const options = (children: ParagraphNode['children']) =>
      measureParagraph(paragraph(children), {
        typography,
        measureText: zeroSpaceMeasure,
        renderedMath: [payload],
        measureSeparatorAdvance: async (request) => {
          advanceCalls.push(request);
          return request.fontResolution?.fontName.style === 'Bold' ? 5 : 4;
        },
      });
    const spaced = composeMeasuredParagraph(
      await options([
        { type: 'text', value: 'as ' },
        { type: 'math', latex: 'x', display: false },
      ]),
      { typography, width: 100 },
    );
    expect(spaced.lines[0]!.children.map((child) => [child.type, child.x])).toEqual([
      ['prose', 0],
      ['math', 16],
    ]);
    expect(spaced.lines[0]!.children[0]).toMatchObject({ text: 'as ', trailingSeparatorWidth: 4 });
    const unspaced = composeMeasuredParagraph(
      await options([
        { type: 'text', value: 'as' },
        { type: 'math', latex: 'x', display: false },
      ]),
      { typography, width: 100 },
    );
    expect(unspaced.lines[0]!.children.map((child) => child.x)).toEqual([0, 12]);
    const doubled = composeMeasuredParagraph(
      await options([
        { type: 'text', value: 'as  ' },
        { type: 'math', latex: 'x', display: false },
      ]),
      { typography, width: 100 },
    );
    expect(doubled.lines[0]!.children.at(-1)?.x).toBe(20);
    const nbsp = composeMeasuredParagraph(
      await options([
        { type: 'text', value: 'as\u00a0' },
        { type: 'math', latex: 'x', display: false },
      ]),
      { typography, width: 100 },
    );
    expect(nbsp.lines[0]!.children.at(-1)?.x).toBe(18);
    expect(advanceCalls).toHaveLength(2); // one and two U+0020 runs only
  });
  it('uses a marked effective font for its space probe', async () => {
    const plan = await measureParagraph(
      paragraph([{ type: 'text', value: 'a ', marks: ['bold'] }]),
      {
        typography,
        measureText: zeroSpaceMeasure,
        renderedMath: [],
        fontResolver: () => ({ fontName: { family: 'Inter', style: 'Bold' } }),
        measureSeparatorAdvance: async (request) =>
          request.fontResolution?.fontName.style === 'Bold' ? 5 : 4,
      },
    );
    const separator = plan.tokens.at(-1);
    expect(separator?.kind === 'separator' && separator.metrics.width).toBe(5);
  });
});

describe('paragraph plans', () => {
  it('aligns prose and fraction-like math on one baseline and uses empty fallback metrics', async () => {
    const plan = compose(
      await measured(
        [
          { type: 'text', value: 'a ' },
          { type: 'math', latex: '\\frac{x}{y}', display: false },
        ],
        [math('\\frac{x}{y}', 30, 25, 10)],
      ),
      100,
    );
    const [text, fraction] = plan.lines[0]!.children;
    expect(text!.y + text!.metrics.ascent).toBeCloseTo(fraction!.y + fraction!.metrics.ascent);
    expect(plan.lines[0]!.ascent).toBe(25);
    expect(plan.lines[0]!.descent).toBe(10);
    const empty = compose(await measured([{ type: 'break' }]), 100).lines[0]!;
    expect(empty.height).toBe(20);
  });

  it('merges compatible prose but not differing marks or across math', async () => {
    const merged = compose(await measured([{ type: 'text', value: 'a b' }]), 100);
    expect(merged.lines[0]?.children).toHaveLength(1);
    expect(merged.lines[0]?.children[0]).toMatchObject({
      type: 'prose',
      text: 'a b',
      measuredParts: ['a', ' ', 'b'],
    });
    const marked = compose(
      await measured([
        { type: 'text', value: 'a' },
        { type: 'text', value: 'b', marks: ['bold'] },
      ]),
      100,
    );
    expect(marked.lines[0]?.children).toHaveLength(2);
    const barrier = compose(
      await measured(
        [
          { type: 'text', value: 'a' },
          { type: 'math', latex: 'x', display: false },
          { type: 'text', value: 'b' },
        ],
        [math('x')],
      ),
      100,
    );
    expect(barrier.lines[0]?.children.map((child) => child.type)).toEqual([
      'prose',
      'math',
      'prose',
    ]);
  });

  it('scales already-mathScale payload metrics once per selected prose size', async () => {
    const plan = compose(
      await measureParagraph(paragraph([{ type: 'math', latex: 'x', display: false }]), {
        typography: { ...typography, fontSize: 32 },
        measureText: measure,
        renderedMath: [math('x', 10)],
      }),
      100,
    );
    expect(plan.lines[0]?.children[0]).toMatchObject({
      type: 'math',
      svgScale: 2,
      metrics: { width: 20 },
    });
  });

  it('is deterministic across repeated composition', async () => {
    const value = await measured([{ type: 'text', value: 'a b c' }]);
    expect(compose(value, 25)).toEqual(compose(value, 25));
  });

  it('uses a validated replaceable prose baseline estimate', () => {
    const metrics = calibrateProseMetrics({ width: 10, height: 20 }, typography);
    expect(metrics.ascent).toBeCloseTo(14.8);
    expect(metrics.descent).toBeCloseTo(5.2);
    expect(() => validateProseBaselineCalibration({ emAscentRatio: 1 })).toThrow(/between/);
  });

  it('does not merge different resolved fonts and places a whole glued group after a break', async () => {
    const value = await measureParagraph(
      paragraph([
        { type: 'text', value: 'a ' },
        { type: 'text', value: 'bc', marks: ['bold'] },
      ]),
      {
        typography,
        measureText: measure,
        renderedMath: [],
        fontResolver: (marks) =>
          marks === undefined
            ? { fontName: { family: 'Inter', style: 'Regular' } }
            : { fontName: { family: 'Inter', style: 'Bold' }, marks },
      },
    );
    const plan = compose(value, 30);
    expect(
      plan.lines.map((line) =>
        line.children.map((child) => (child.type === 'prose' ? child.text : '')).join(''),
      ),
    ).toEqual(['a', 'bc']);
    const separate = compose(
      await measureParagraph(paragraph([{ type: 'text', value: 'ab' }]), {
        typography,
        measureText: measure,
        renderedMath: [],
        fontResolver: () => ({ fontName: { family: 'Inter', style: 'Regular' } }),
      }),
      100,
    );
    expect(separate.lines[0]?.children).toHaveLength(1);
  });
});

describe('math occurrence validation and async document measurement', () => {
  const document = [
    paragraph([{ type: 'math', latex: 'x', display: false }]),
    { type: 'display-math' as const, latex: 'y' },
    paragraph([{ type: 'text', value: 'after' }]),
  ] as const;
  it('rejects missing, mismatched, and extra math payloads', () => {
    expect(() => validateRenderedMathPayloads(document, [math('x')])).toThrow(/Missing/);
    expect(() =>
      validateRenderedMathPayloads(document, [math('z'), math('y', 10, 12, 4, true)]),
    ).toThrow(/does not match/);
    expect(() =>
      validateRenderedMathPayloads(document, [math('x'), math('y', 10, 12, 4, true), math('z')]),
    ).toThrow(/extra/);
  });
  it('measures prose asynchronously and retains paragraph/display/paragraph block order', async () => {
    const output = await measureDocument(document, {
      typography,
      measureText: measure,
      renderedMath: [math('x'), math('y', 10, 12, 4, true)],
    });
    expect(output.paragraphs).toHaveLength(2);
    expect(output.displayMath[0]).toMatchObject({ latex: 'y', svgScale: 1 });
    expect(output.blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'display-math',
      'paragraph',
    ]);
    expect(output.blocks[2]).toMatchObject({
      type: 'paragraph',
      measured: { paragraph: { children: [{ value: 'after' }] } },
    });
  });
});

describe('justified paragraph planning', () => {
  const justify = (value: Awaited<ReturnType<typeof measured>>, width: number) =>
    composeMeasuredParagraph(value, { typography, width, textAlignment: 'justify' });

  it('marks every retained source gap, including one next to inline math, for equal distribution', async () => {
    const wider = justify(
      await measured(
        [
          { type: 'text', value: 'a ' },
          { type: 'text', value: 'b ', marks: ['bold'] },
          { type: 'math', latex: 'x', display: false },
          { type: 'text', value: ' c d e', marks: ['italic'] },
        ],
        [math('x', 10)],
      ),
      75,
    );
    expect(wider.lines[0]).toMatchObject({ justified: true });
    expect(
      wider.lines[0]!.children.flatMap((child) =>
        child.type === 'prose' && child.justifyGapAfter ? [child.text] : [],
      ),
    ).toEqual(['a ', 'b ', ' ']);
    expect(wider.lines[0]!.children).toContainEqual(
      expect.objectContaining({
        type: 'prose',
        text: 'b ',
        marks: ['bold'],
        justifyGapAfter: true,
      }),
    );
  });

  it('excludes terminal, hard-break, blank, no-space, and over-wide lines', async () => {
    const terminal = justify(await measured([{ type: 'text', value: 'a b' }]), 100);
    expect(terminal.lines[0]!.justified).toBeUndefined();
    const hard = justify(
      await measured([
        { type: 'text', value: 'a b' },
        { type: 'break' },
        { type: 'text', value: 'c d' },
      ]),
      100,
    );
    expect(hard.lines.map((line) => line.justified)).toEqual([undefined, undefined]);
    const blank = justify(await measured([{ type: 'break' }, { type: 'text', value: 'x' }]), 100);
    expect(blank.lines[0]!.justified).toBeUndefined();
    const noSpace = justify(await measured([{ type: 'text', value: 'abcdefghij kl' }]), 50);
    expect(noSpace.lines[0]!.justified).toBeUndefined();
    const overWide = justify(await measured([{ type: 'text', value: 'abcdefghij kl mn' }]), 50);
    expect(overWide.lines[0]!.width).toBeGreaterThan(50);
    expect(overWide.lines[0]!.justified).toBeUndefined();
  });
});

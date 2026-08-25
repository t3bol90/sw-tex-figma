import { describe, expect, it } from 'vitest';

import {
  BoundedMathCache,
  createMathCacheKey,
  formatMathErrorForUi,
  MathJaxSvgRenderer,
  MathRenderError,
  renderDocumentMath,
} from '../src/math';
import { parseMarkdown } from '../src/parser';
import type { RenderedMathPayload } from '../src/shared/types';

describe('math cache', () => {
  it('uses a stable key and separates every output-affecting input', () => {
    const input = {
      latex: String.raw`\alpha`,
      display: false,
      mathScale: 1,
      rendererIdentity: 'renderer@1',
    };
    expect(createMathCacheKey(input)).toBe(createMathCacheKey(input));
    expect(createMathCacheKey({ ...input, display: true })).not.toBe(createMathCacheKey(input));
    expect(createMathCacheKey({ ...input, mathScale: 2 })).not.toBe(createMathCacheKey(input));
    expect(createMathCacheKey({ ...input, rendererIdentity: 'renderer@2' })).not.toBe(
      createMathCacheKey(input),
    );
  });

  it('evicts the least recently used entry at its bound', () => {
    const cache = new BoundedMathCache<number>(2);
    cache.set('one', 1);
    cache.set('two', 2);
    expect(cache.get('one')).toBe(1);
    cache.set('three', 3);
    expect(cache.has('one')).toBe(true);
    expect(cache.has('two')).toBe(false);
    expect(cache.size).toBe(2);
  });
});

describe('document math orchestration', () => {
  it('keeps AST order while rendering repeated work once', async () => {
    const calls: string[] = [];
    const renderer = {
      rendererIdentity: 'test@1',
      render: async ({
        latex,
        display,
        mathScale,
      }: {
        latex: string;
        display: boolean;
        mathScale: number;
      }): Promise<RenderedMathPayload> => {
        calls.push(`${latex}:${display}:${mathScale}`);
        return {
          latex,
          display,
          svg: '<svg/>',
          metrics: { width: 1, height: 1, ascent: 1, descent: 0, baseline: 1 },
        };
      },
    };
    const payloads = await renderDocumentMath(parseMarkdown('A $x$, $x$.\n\n$$x$$'), 1, renderer);
    expect(calls).toEqual(['x:false:1', 'x:true:1']);
    expect(payloads.map(({ latex, display }) => [latex, display])).toEqual([
      ['x', false],
      ['x', false],
      ['x', true],
    ]);
  });

  it('sends an empty valid math list for a no-math document', async () => {
    const renderer = {
      rendererIdentity: 'test@1',
      render: async (): Promise<RenderedMathPayload> => {
        throw new Error('not called');
      },
    };
    await expect(
      renderDocumentMath(parseMarkdown('Plain **text**.'), 1, renderer),
    ).resolves.toEqual([]);
  });
});

describe('MathJax SVG renderer', () => {
  const renderer = new MathJaxSvgRenderer(8);

  it('returns self-contained inline and display SVG with baseline metrics', async () => {
    const inline = await renderer.render({
      latex: String.raw`\alpha + \beta`,
      display: false,
      mathScale: 1,
    });
    const display = await renderer.render({
      latex: String.raw`\frac{x^2}{y}`,
      display: true,
      mathScale: 1.5,
    });
    for (const payload of [inline, display]) {
      expect(payload.svg).toMatch(/^<svg\b/);
      expect(payload.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(payload.svg).not.toMatch(/(?:href|xlink:href)=["'](?:https?:|data:)/i);
      expect(payload.metrics.width).toBeGreaterThan(0);
      expect(payload.metrics.height).toBeGreaterThan(0);
      expect(payload.metrics.baseline).toBe(payload.metrics.ascent);
      expect(payload.metrics.height).toBeCloseTo(
        payload.metrics.ascent + payload.metrics.descent,
        8,
      );
    }
    expect(display.metrics.height).toBeGreaterThan(inline.metrics.height);
  });

  it('renders bundled extended glyph data without a network request', async () => {
    await expect(
      renderer.render({ latex: String.raw`\mathbb{E}`, display: false, mathScale: 1 }),
    ).resolves.toMatchObject({ latex: String.raw`\mathbb{E}` });
  });

  it('turns malformed TeX into a failure rather than merror SVG', async () => {
    await expect(
      renderer.render({ latex: String.raw`\notARealCommand`, display: false, mathScale: 1 }),
    ).rejects.toBeInstanceOf(MathRenderError);
  });
});

describe('UI error formatting', () => {
  it('removes control characters and caps an unsafe error', () => {
    expect(formatMathErrorForUi(new Error(`Bad\nTeX${'x'.repeat(1000)}`))).toMatch(
      /^Could not apply: Bad TeX/,
    );
    expect(formatMathErrorForUi(null)).toBe('Could not apply: Could not render the source.');
  });
});

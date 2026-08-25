import { describe, expect, it } from 'vitest';

import {
  calibrateBaselineFromReferenceGlyph,
  FigmaProseBaselineCalibrator,
} from '../src/figma/baseline-calibration';
import { withExplicitMathPaint } from '../src/figma/math-svg-import';
import { MathJaxSvgRenderer } from '../src/math';

const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'AUTO' as const },
  letterSpacing: { unit: 'PIXELS' as const, value: 0 },
  fills: [],
};

describe('visual quality contracts', () => {
  it('keeps MathJax metrics expression-specific while baseline remains ascent', async () => {
    const renderer = new MathJaxSvgRenderer();
    const formulas = [
      'x',
      String.raw`\alpha`,
      'x_i',
      'x^2',
      String.raw`\frac{x}{y}`,
      String.raw`\sqrt{x}`,
      String.raw`\sum_{i=1}^n`,
      String.raw`\left(\frac{\sqrt{x_i}}{y^2}\right)`,
    ];
    const rendered = await Promise.all(
      formulas.map((latex) => renderer.render({ latex, display: false, mathScale: 1 })),
    );
    for (const payload of rendered) {
      expect(payload.metrics.baseline).toBe(payload.metrics.ascent);
      expect(payload.metrics.height).toBeCloseTo(
        payload.metrics.ascent + payload.metrics.descent,
        8,
      );
    }
    expect(new Set(rendered.map((item) => item.metrics.height)).size).toBeGreaterThan(3);
    expect(rendered[4]!.metrics.height).toBeGreaterThan(rendered[0]!.metrics.height);
    expect(rendered[6]!.metrics.ascent).toBeGreaterThan(rendered[0]!.metrics.ascent);
  });

  it('uses explicit prose paint instead of unsupported currentColor and preserves opacity', async () => {
    const svg = withExplicitMathPaint('<svg><path fill="currentColor" d="M0 0"/></svg>', [
      { type: 'SOLID', color: { r: 1, g: 0.5, b: 0 }, opacity: 0.4 },
    ]);
    expect(svg).toContain('fill="#ff8000" fill-opacity="0.4"');
    expect(svg).not.toContain('currentColor');
    const formula = await new MathJaxSvgRenderer().render({
      latex: String.raw`\alpha + \beta`,
      display: false,
      mathScale: 1,
    });
    const painted = withExplicitMathPaint(formula.svg, [
      { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6 } },
    ]);
    expect(painted).toContain('fill="#336699"');
    expect(painted).toContain('data-latex="\\alpha"');
    expect(painted).toContain('data-latex="+"');
    expect(painted).toContain('data-latex="\\beta"');
    expect(painted.match(/<svg\b/g)).toHaveLength(1);
    expect(painted).not.toContain('currentColor');
    expect(painted.match(/viewBox="[^"]+"/)?.[0]).toBe(formula.svg.match(/viewBox="[^"]+"/)?.[0]);
    expect(painted.match(/width="[^"]+"/)?.[0]).toBe(formula.svg.match(/width="[^"]+"/)?.[0]);
    expect(painted.match(/height="[^"]+"/)?.[0]).toBe(formula.svg.match(/height="[^"]+"/)?.[0]);
  });

  it('extracts and caches a temporary reference-glyph calibration and always cleans it up', async () => {
    let removedText = 0;
    let removedVector = 0;
    let flattened = 0;
    const text = {
      x: 0,
      y: 0,
      fontName: {},
      fontSize: 0,
      lineHeight: {},
      letterSpacing: {},
      fills: [],
      textAutoResize: undefined,
      characters: '',
      width: 8,
      height: 20,
      name: '',
      remove: () => {
        removedText += 1;
      },
    };
    const api = {
      loadFontAsync: async () => undefined,
      createText: () => text,
      flatten: () => {
        flattened += 1;
        return {
          x: 0,
          y: 0,
          width: 8,
          height: 16,
          remove: () => {
            removedVector += 1;
          },
        };
      },
    };
    const calibration = await calibrateBaselineFromReferenceGlyph(api, typography);
    expect(calibration.source).toBe('reference-glyph');
    expect(calibration.emAscentRatio).toBeGreaterThan(0);
    expect(removedText).toBe(1);
    expect(removedVector).toBe(1);
    const cache = new FigmaProseBaselineCalibrator(api, 2);
    await cache.calibrate(typography);
    await cache.calibrate(typography);
    expect(flattened).toBe(2); // direct probe plus exactly one cached probe
    expect(cache.cacheSize).toBe(1);
  });

  it('never reads a consumed TextNode after real-style flatten', async () => {
    let consumed = false;
    const text = {
      x: 0,
      get y() {
        if (consumed) throw new Error('consumed y');
        return 3;
      },
      set y(_value: number) {},
      fontName: {},
      fontSize: 0,
      lineHeight: {},
      letterSpacing: {},
      fills: [],
      textAutoResize: undefined,
      characters: '',
      name: '',
      get width() {
        if (consumed) throw new Error('consumed width');
        return 8;
      },
      get height() {
        if (consumed) throw new Error('consumed height');
        return 20;
      },
      remove() {},
    };
    const api = {
      loadFontAsync: async () => undefined,
      createText: () => text,
      flatten: () => {
        consumed = true;
        return { x: 0, y: 3, width: 8, height: 16, remove() {} };
      },
    };
    await expect(calibrateBaselineFromReferenceGlyph(api, typography)).resolves.toMatchObject({
      source: 'reference-glyph',
    });
  });
  it('falls back honestly when flatten cannot produce usable reference geometry', async () => {
    const api = {
      loadFontAsync: async () => undefined,
      createText: () => ({
        x: 0,
        y: 0,
        fontName: {},
        fontSize: 0,
        lineHeight: {},
        letterSpacing: {},
        fills: [],
        textAutoResize: undefined,
        characters: '',
        width: 8,
        height: 20,
        name: '',
        remove() {},
      }),
      flatten: () => {
        throw new Error('unsupported');
      },
    };
    const calibration = await new FigmaProseBaselineCalibrator(api).calibrate(typography);
    expect(calibration).toMatchObject({ emAscentRatio: 0.8, source: 'fallback' });
  });
});

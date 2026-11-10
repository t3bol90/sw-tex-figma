import { describe, expect, it } from 'vitest';

import { blockTypography, HEADING_SCALE } from '../src/layout';
import type { TypographyContext } from '../src/shared/types';

const base: TypographyContext = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 20,
  lineHeight: { unit: 'PIXELS', value: 30 },
  letterSpacing: { unit: 'PIXELS', value: 1 },
  fills: [],
};

describe('blockTypography', () => {
  it('returns body typography unchanged for paragraphs and unscaled heading levels', () => {
    expect(blockTypography(base, {})).toBe(base);
    expect(blockTypography(base, { heading: 4 })).toBe(base);
  });

  it('scales size and absolute line height and letter spacing together', () => {
    expect(blockTypography(base, { heading: 1 })).toEqual({
      ...base,
      fontSize: 20 * HEADING_SCALE[1],
      lineHeight: { unit: 'PIXELS', value: 30 * HEADING_SCALE[1] },
      letterSpacing: { unit: 'PIXELS', value: 1 * HEADING_SCALE[1] },
    });
    const relative: TypographyContext = {
      ...base,
      lineHeight: { unit: 'INTRINSIC_%', value: 140 },
      letterSpacing: { unit: 'PERCENT', value: 2 },
    };
    const heading = blockTypography(relative, { heading: 2 });
    expect(heading.fontSize).toBeCloseTo(26);
    expect(heading.lineHeight).toEqual(relative.lineHeight);
    expect(heading.letterSpacing).toEqual(relative.letterSpacing);
  });

  it('clamps heading size to the measurable maximum', () => {
    const large = blockTypography({ ...base, fontSize: 500 }, { heading: 1 });
    expect(large.fontSize).toBe(512);
    expect(large.lineHeight).toEqual({ unit: 'PIXELS', value: (30 * 512) / 500 });
  });
});

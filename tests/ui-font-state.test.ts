import { describe, expect, it } from 'vitest';
import { settingsFromFontStyles } from '../src/ui/App';
import type { RenderSettings } from '../src/shared/types';

const settings: RenderSettings = {
  width: 100,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left',
  typography: {
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [],
  },
};
describe('lazy font style UI transition', () => {
  it('uses the currently selected family, ignores a late old-family response, and preserves a matching style', () => {
    const roboto = settingsFromFontStyles(settings, 'Roboto', 'Roboto', ['Regular']);
    expect(roboto?.typography.fontName).toEqual({ family: 'Roboto', style: 'Regular' });
    expect(settingsFromFontStyles(roboto!, 'Roboto', 'Inter', ['Regular'])).toBeUndefined();
    expect(settingsFromFontStyles(roboto!, 'Roboto', 'Roboto', ['Regular'])).toBe(roboto);
  });
});

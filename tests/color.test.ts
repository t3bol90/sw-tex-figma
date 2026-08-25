import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex } from '../src/ui/color';

describe('color controls', () => {
  it('converts black, white, midpoint, clamps safely, and rejects malformed hex', () => {
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 1, g: 1, b: 1 })).toBe('#ffffff');
    expect(rgbToHex({ r: 0.5, g: 0.5, b: 0.5 })).toBe('#808080');
    expect(rgbToHex({ r: -1, g: 2, b: Number.NaN })).toBe('#00ff00');
    expect(hexToRgb('#808080')).toEqual({ r: 128 / 255, g: 128 / 255, b: 128 / 255 });
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 171 / 255, g: 205 / 255, b: 239 / 255 });
    expect(hexToRgb('#fff')).toBeUndefined();
  });
});

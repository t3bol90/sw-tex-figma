import type { RgbColor } from '../shared/types';
const clamp = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const channel = (value: number): string =>
  Math.round(clamp(value) * 255)
    .toString(16)
    .padStart(2, '0');
export const rgbToHex = (color: RgbColor): string =>
  `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
export const hexToRgb = (value: string): RgbColor | undefined => {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return undefined;
  return {
    r: Number.parseInt(value.slice(1, 3), 16) / 255,
    g: Number.parseInt(value.slice(3, 5), 16) / 255,
    b: Number.parseInt(value.slice(5, 7), 16) / 255,
  };
};

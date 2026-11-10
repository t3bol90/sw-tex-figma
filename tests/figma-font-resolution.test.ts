import { describe, expect, it } from 'vite-plus/test';
import { FigmaFontResolver, FontResolutionError } from '../src/figma/font-resolution';
const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'AUTO' as const },
  letterSpacing: { unit: 'PIXELS' as const, value: 0 },
  fills: [],
};
describe('FigmaFontResolver', () => {
  it('chooses exact mark variants and caches the inventory and result', async () => {
    let calls = 0;
    const resolver = new FigmaFontResolver({
      listAvailableFontsAsync: async () => {
        calls += 1;
        return [
          { family: 'Inter', style: 'Bold Italic' },
          { family: 'Inter', style: 'Italic' },
          { family: 'Inter', style: 'Bold' },
          { family: 'Inter', style: 'Regular' },
        ];
      },
    });
    await expect(resolver.resolve(['italic'], typography)).resolves.toMatchObject({
      fontName: { style: 'Italic' },
    });
    await expect(resolver.resolve(['bold'], typography)).resolves.toMatchObject({
      fontName: { style: 'Bold' },
    });
    await expect(resolver.resolve(['bold', 'italic'], typography)).resolves.toMatchObject({
      fontName: { style: 'Bold Italic' },
    });
    await resolver.resolve(['italic'], typography);
    expect(calls).toBe(1);
  });
  it('adds marks to base italic/bold traits instead of erasing them', async () => {
    const resolver = new FigmaFontResolver({
      listAvailableFontsAsync: async () => [
        { family: 'Inter', style: 'Regular' },
        { family: 'Inter', style: 'Italic' },
        { family: 'Inter', style: 'Bold' },
        { family: 'Inter', style: 'Bold Italic' },
      ],
    });
    await expect(
      resolver.resolve(['bold'], { ...typography, fontName: { family: 'Inter', style: 'Italic' } }),
    ).resolves.toMatchObject({ fontName: { style: 'Bold Italic' } });
    await expect(
      resolver.resolve(['italic'], { ...typography, fontName: { family: 'Inter', style: 'Bold' } }),
    ).resolves.toMatchObject({ fontName: { style: 'Bold Italic' } });
  });
  it('fails clearly rather than silently using an unmarked font', async () => {
    const resolver = new FigmaFontResolver({
      listAvailableFontsAsync: async () => [{ family: 'Inter', style: 'Regular' }],
    });
    await expect(resolver.resolve(['italic'], typography)).rejects.toBeInstanceOf(
      FontResolutionError,
    );
  });
});

describe('FigmaFontResolver code marks', () => {
  const fonts = [
    { family: 'Inter', style: 'Regular' },
    { family: 'Inter', style: 'Bold' },
    { family: 'Roboto Mono', style: 'Light' },
    { family: 'Roboto Mono', style: 'Regular' },
    { family: 'Roboto Mono', style: 'Bold' },
    { family: 'Roboto Mono', style: 'Bold Italic' },
  ];
  const resolver = () => new FigmaFontResolver({ listAvailableFontsAsync: async () => fonts });

  it('uses the preferred monospace family and its plain style names', async () => {
    await expect(resolver().resolve(['code'], typography)).resolves.toMatchObject({
      fontName: { family: 'Roboto Mono', style: 'Regular' },
      marks: ['code'],
    });
    await expect(resolver().resolve(['bold', 'code'], typography)).resolves.toMatchObject({
      fontName: { family: 'Roboto Mono', style: 'Bold' },
    });
    await expect(resolver().resolve(['bold', 'code', 'italic'], typography)).resolves.toMatchObject(
      { fontName: { family: 'Roboto Mono', style: 'Bold Italic' } },
    );
  });

  it('drops an unavailable slant rather than failing code', async () => {
    await expect(resolver().resolve(['code', 'italic'], typography)).resolves.toMatchObject({
      fontName: { family: 'Roboto Mono', style: 'Regular' },
    });
  });

  it('keeps a monospace body family for code', async () => {
    await expect(
      resolver().resolve(['code'], {
        ...typography,
        fontName: { family: 'Roboto Mono', style: 'Bold' },
      }),
    ).resolves.toMatchObject({ fontName: { family: 'Roboto Mono', style: 'Bold' } });
  });

  it('falls back to the body family and other marks when no monospace family exists', async () => {
    const bodyOnly = new FigmaFontResolver({
      listAvailableFontsAsync: async () => fonts.filter((font) => font.family === 'Inter'),
    });
    await expect(bodyOnly.resolve(['code'], typography)).resolves.toBeUndefined();
    await expect(bodyOnly.resolve(['bold', 'code'], typography)).resolves.toMatchObject({
      fontName: { family: 'Inter', style: 'Bold' },
    });
    await expect(bodyOnly.resolve(['code', 'italic'], typography)).rejects.toBeInstanceOf(
      FontResolutionError,
    );
  });
});

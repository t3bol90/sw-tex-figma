import { describe, expect, it } from 'vitest';

import {
  isPluginToUIMessage,
  isRenderSettings,
  isTypographyContext,
  isUIToPluginMessage,
} from '../src/shared/messages';

const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'PIXELS', value: 24 },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
};

const settings = {
  width: 480,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left',
  typography,
};

describe('runtime message guards', () => {
  it('accepts complete, bounded render requests', () => {
    const message = {
      type: 'RENDER_DOCUMENT',
      source: 'The value is $\\alpha$.',
      settings,
      workflowToken: 0,
      math: [
        {
          latex: '\\alpha',
          svg: '<svg></svg>',
          display: false,
          metrics: { width: 10, height: 12, ascent: 9, descent: 3, baseline: 9 },
        },
      ],
    };

    expect(isUIToPluginMessage(message)).toBe(true);
  });

  it('accepts a no-math render request and rejects inconsistent baseline metrics', () => {
    expect(
      isUIToPluginMessage({
        type: 'RENDER_DOCUMENT',
        source: 'Plain text',
        settings,
        math: [],
        workflowToken: 0,
      }),
    ).toBe(true);
    expect(
      isUIToPluginMessage({
        type: 'RENDER_DOCUMENT',
        source: 'x',
        settings,
        workflowToken: 0,
        math: [
          {
            latex: 'x',
            svg: '<svg/>',
            display: false,
            metrics: { width: 1, height: 2, ascent: 1, descent: 0, baseline: 1 },
          },
        ],
      }),
    ).toBe(false);
  });

  it('requires an exact workflow token for each render request', () => {
    expect(isUIToPluginMessage({ type: 'RENDER_DOCUMENT', source: 'x', math: [], settings })).toBe(
      false,
    );
    expect(
      isUIToPluginMessage({
        type: 'RENDER_DOCUMENT',
        source: 'x',
        math: [],
        settings,
        workflowToken: 0,
      }),
    ).toBe(true);
  });

  it('rejects malformed UI messages instead of trusting their discriminant', () => {
    expect(isUIToPluginMessage({ type: 'RENDER_DOCUMENT' })).toBe(false);
    expect(isUIToPluginMessage({ type: 'CLOSE', extra: true })).toBe(false);
    expect(
      isUIToPluginMessage({
        type: 'RENDER_DOCUMENT',
        source: 'x',
        math: [],
        settings: { ...settings, mathScale: 0 },
      }),
    ).toBe(false);
    expect(isUIToPluginMessage({ type: 'UNKNOWN' })).toBe(false);
  });

  it('validates serializable typography and settings', () => {
    expect(isTypographyContext(typography)).toBe(true);
    expect(isTypographyContext({ ...typography, fontSize: Number.NaN })).toBe(false);
    expect(isRenderSettings(settings)).toBe(true);
    expect(isRenderSettings({ ...settings, width: -1 })).toBe(false);
  });

  it('accepts controller initialization and rejects invalid controller payloads', () => {
    expect(
      isPluginToUIMessage({ type: 'INITIALIZE', source: 'Example', typography, width: 480 }),
    ).toBe(true);
    expect(isPluginToUIMessage({ type: 'RENDER_ERROR', message: 'Bad TeX' })).toBe(true);
    expect(isPluginToUIMessage({ type: 'INITIALIZE', width: 0 })).toBe(false);
    expect(isPluginToUIMessage({ type: 'RENDER_ERROR', message: 42 })).toBe(false);
  });
  it('rejects spoofed alignment, font size, colors, fills, and font-list bounds', () => {
    expect(isRenderSettings({ ...settings, textAlignment: 'justify' })).toBe(true);
    expect(isRenderSettings({ ...settings, textAlignment: 'diagonal' })).toBe(false);
    expect(isRenderSettings({ ...settings, typography: { ...typography, fontSize: 513 } })).toBe(
      false,
    );
    expect(
      isRenderSettings({
        ...settings,
        typography: { ...typography, fills: [{ type: 'SOLID', color: { r: 2, g: 0, b: 0 } }] },
      }),
    ).toBe(false);
    expect(
      isPluginToUIMessage({
        type: 'INITIALIZE',
        availableFonts: Array.from({ length: 5001 }, () => ({ family: 'A', style: 'B' })),
      }),
    ).toBe(false);
  });
  it('validates bounded lazy font family/style messages and requests', () => {
    expect(isUIToPluginMessage({ type: 'REQUEST_FONT_STYLES', family: 'Roboto' })).toBe(true);
    expect(
      isPluginToUIMessage({ type: 'AVAILABLE_FONT_FAMILIES', families: ['Mukta Vaani', 'Roboto'] }),
    ).toBe(true);
    expect(
      isPluginToUIMessage({ type: 'AVAILABLE_FONT_STYLES', family: 'Roboto', styles: ['Regular'] }),
    ).toBe(true);
    expect(
      isPluginToUIMessage({
        type: 'AVAILABLE_FONT_STYLES',
        family: 'Roboto',
        styles: Array.from({ length: 5001 }, () => 'Regular'),
      }),
    ).toBe(false);
  });
});

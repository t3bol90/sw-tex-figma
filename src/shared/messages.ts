import type { RenderedMathPayload, RenderSettings, TypographyContext } from './types';

export type UIToPluginMessage =
  | {
      readonly type: 'RENDER_DOCUMENT';
      readonly source: string;
      readonly math: readonly RenderedMathPayload[];
      readonly settings: RenderSettings;
    }
  | { readonly type: 'REQUEST_SELECTION_STYLE' }
  | { readonly type: 'CLOSE' };

export type PluginToUIMessage =
  | {
      readonly type: 'INITIALIZE';
      readonly source?: string;
      readonly typography?: TypographyContext;
      readonly width?: number;
    }
  | {
      readonly type: 'SELECTION_CHANGED';
      readonly typography?: TypographyContext;
      readonly width?: number;
    }
  | { readonly type: 'RENDER_ERROR'; readonly message: string };

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isBoundedString = (value: unknown, maximumLength = 100_000): value is string =>
  typeof value === 'string' && value.length <= maximumLength;

const isFontDescriptor = (value: unknown): boolean =>
  isRecord(value) && isBoundedString(value.family, 500) && isBoundedString(value.style, 500);

const isLineHeight = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.unit !== 'string') return false;
  if (value.unit === 'AUTO') return true;
  return (
    (value.unit === 'PIXELS' || value.unit === 'INTRINSIC_%') &&
    isFiniteNumber(value.value) &&
    value.value >= 0
  );
};

const isLetterSpacing = (value: unknown): boolean =>
  isRecord(value) &&
  (value.unit === 'PIXELS' || value.unit === 'PERCENT') &&
  isFiniteNumber(value.value);

const isRgbColor = (value: unknown): boolean =>
  isRecord(value) &&
  isFiniteNumber(value.r) &&
  isFiniteNumber(value.g) &&
  isFiniteNumber(value.b) &&
  value.r >= 0 &&
  value.r <= 1 &&
  value.g >= 0 &&
  value.g <= 1 &&
  value.b >= 0 &&
  value.b <= 1;

const isSolidFill = (value: unknown): boolean =>
  isRecord(value) &&
  value.type === 'SOLID' &&
  isRgbColor(value.color) &&
  (value.opacity === undefined ||
    (isFiniteNumber(value.opacity) && value.opacity >= 0 && value.opacity <= 1));

export const isTypographyContext = (value: unknown): value is TypographyContext =>
  isRecord(value) &&
  isFontDescriptor(value.fontName) &&
  isFiniteNumber(value.fontSize) &&
  value.fontSize > 0 &&
  isLineHeight(value.lineHeight) &&
  isLetterSpacing(value.letterSpacing) &&
  Array.isArray(value.fills) &&
  value.fills.every(isSolidFill) &&
  (value.textStyleId === undefined || isBoundedString(value.textStyleId, 1_000));

export const isRenderSettings = (value: unknown): value is RenderSettings =>
  isRecord(value) &&
  isFiniteNumber(value.width) &&
  value.width > 0 &&
  value.width <= 100_000 &&
  isFiniteNumber(value.mathScale) &&
  value.mathScale > 0 &&
  value.mathScale <= 10 &&
  typeof value.inheritTypography === 'boolean';

const isRenderedMathPayload = (value: unknown): value is RenderedMathPayload =>
  isRecord(value) &&
  isBoundedString(value.latex) &&
  isBoundedString(value.svg, 2_000_000) &&
  typeof value.display === 'boolean' &&
  isRecord(value.metrics) &&
  isFiniteNumber(value.metrics.width) &&
  value.metrics.width >= 0 &&
  isFiniteNumber(value.metrics.height) &&
  value.metrics.height >= 0 &&
  isFiniteNumber(value.metrics.ascent) &&
  value.metrics.ascent >= 0 &&
  isFiniteNumber(value.metrics.descent) &&
  value.metrics.descent >= 0 &&
  isFiniteNumber(value.metrics.baseline) &&
  value.metrics.baseline >= 0;

export const isUIToPluginMessage = (value: unknown): value is UIToPluginMessage => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'RENDER_DOCUMENT':
      return (
        isBoundedString(value.source, 1_000_000) &&
        Array.isArray(value.math) &&
        value.math.length <= 1_000 &&
        value.math.every(isRenderedMathPayload) &&
        isRenderSettings(value.settings)
      );
    case 'REQUEST_SELECTION_STYLE':
    case 'CLOSE':
      return Object.keys(value).length === 1;
    default:
      return false;
  }
};

export const isPluginToUIMessage = (value: unknown): value is PluginToUIMessage => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  const hasValidOptionalContext =
    (value.typography === undefined || isTypographyContext(value.typography)) &&
    (value.width === undefined || (isFiniteNumber(value.width) && value.width > 0));

  switch (value.type) {
    case 'INITIALIZE':
      return (
        (value.source === undefined || isBoundedString(value.source, 1_000_000)) &&
        hasValidOptionalContext
      );
    case 'SELECTION_CHANGED':
      return hasValidOptionalContext;
    case 'RENDER_ERROR':
      return isBoundedString(value.message, 10_000);
    default:
      return false;
  }
};

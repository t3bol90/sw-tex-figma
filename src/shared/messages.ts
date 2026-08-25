import type {
  FontDescriptor,
  RenderedMathPayload,
  RenderSettings,
  TypographyContext,
} from './types';

export type WorkflowMode = 'create' | 'edit' | 'reflow' | 'sync-typography';

export type UIToPluginMessage =
  | {
      readonly type: 'RENDER_DOCUMENT';
      readonly source: string;
      readonly math: readonly RenderedMathPayload[];
      readonly settings: RenderSettings;
      /** Controller-issued context generation; prevents delayed UI work using stale context. */
      readonly workflowToken: number;
    }
  | { readonly type: 'REQUEST_SELECTION_STYLE' }
  /** UI subscription acknowledgement; controller resends its current context. */
  | { readonly type: 'REQUEST_INITIALIZATION' }
  /** Request exact styles only for one family from the controller-owned inventory. */
  | { readonly type: 'REQUEST_FONT_STYLES'; readonly family: string }
  | { readonly type: 'CLOSE' };

export type PluginToUIMessage =
  | {
      readonly type: 'INITIALIZE';
      readonly source?: string;
      readonly typography?: TypographyContext;
      readonly availableFonts?: readonly FontDescriptor[];
      /** Complete controller-owned state. The UI never receives a replacement node id. */
      readonly settings?: RenderSettings;
      readonly workflow?: WorkflowMode;
      readonly workflowToken?: number;
      readonly autoApply?: boolean;
      readonly canApply?: boolean;
      readonly width?: number;
      /** A non-destructive explanation of the selection/default state. */
      readonly status?: string;
    }
  | {
      readonly type: 'SELECTION_CHANGED';
      readonly source?: string;
      readonly typography?: TypographyContext;
      readonly availableFonts?: readonly FontDescriptor[];
      /** Complete controller-owned state. The UI never receives a replacement node id. */
      readonly settings?: RenderSettings;
      readonly workflow?: WorkflowMode;
      readonly workflowToken?: number;
      readonly autoApply?: boolean;
      readonly canApply?: boolean;
      readonly width?: number;
      /** A non-destructive explanation of the selection/default state. */
      readonly status?: string;
    }
  | {
      /** Async inventory family update. It never changes workflow context. */
      readonly type: 'AVAILABLE_FONT_FAMILIES';
      readonly families: readonly string[];
      readonly status?: string;
    }
  | {
      /** Exact styles for one requested family; never a globally truncated pair list. */
      readonly type: 'AVAILABLE_FONT_STYLES';
      readonly family: string;
      readonly styles: readonly string[];
      readonly status?: string;
    }
  | { readonly type: 'RENDER_ERROR'; readonly message: string }
  | { readonly type: 'RENDER_SUCCESS'; readonly message: string };

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isBoundedString = (value: unknown, maximumLength = 100_000): value is string =>
  typeof value === 'string' && value.length <= maximumLength;

export const MAX_FONT_DESCRIPTOR_LENGTH = 500;
/** Legacy complete-pair payload bound; family/style protocol avoids sending this list. */
export const MAX_AVAILABLE_FONTS = 5000;
export const MAX_FONT_FAMILIES = 20_000;
export const MAX_FONT_STYLES = 5000;
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 512;

export const isFontDescriptor = (value: unknown): value is FontDescriptor =>
  isRecord(value) &&
  isBoundedString(value.family, MAX_FONT_DESCRIPTOR_LENGTH) &&
  value.family.length > 0 &&
  !value.family.includes('\u0000') &&
  isBoundedString(value.style, MAX_FONT_DESCRIPTOR_LENGTH) &&
  value.style.length > 0 &&
  !value.style.includes('\u0000');

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
  value.fontSize >= MIN_FONT_SIZE &&
  value.fontSize <= MAX_FONT_SIZE &&
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
  value.mathScale === 1 &&
  typeof value.inheritTypography === 'boolean' &&
  (value.textAlignment === 'left' ||
    value.textAlignment === 'center' ||
    value.textAlignment === 'right' ||
    value.textAlignment === 'justify') &&
  isTypographyContext(value.typography);

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
  value.metrics.baseline >= 0 &&
  value.metrics.baseline === value.metrics.ascent &&
  Math.abs(value.metrics.height - (value.metrics.ascent + value.metrics.descent)) <=
    1e-6 * Math.max(1, value.metrics.height);

export const isUIToPluginMessage = (value: unknown): value is UIToPluginMessage => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'RENDER_DOCUMENT':
      return (
        isBoundedString(value.source, 1_000_000) &&
        Array.isArray(value.math) &&
        value.math.length <= 1_000 &&
        value.math.every(isRenderedMathPayload) &&
        isRenderSettings(value.settings) &&
        typeof value.workflowToken === 'number' &&
        Number.isInteger(value.workflowToken) &&
        value.workflowToken >= 0
      );
    case 'REQUEST_SELECTION_STYLE':
    case 'REQUEST_INITIALIZATION':
    case 'CLOSE':
      return Object.keys(value).length === 1;
    case 'REQUEST_FONT_STYLES':
      return (
        Object.keys(value).length === 2 &&
        isFontDescriptor({ family: value.family, style: 'requested' })
      );
    default:
      return false;
  }
};

export const isPluginToUIMessage = (value: unknown): value is PluginToUIMessage => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  const hasValidOptionalContext =
    (value.typography === undefined || isTypographyContext(value.typography)) &&
    (value.availableFonts === undefined ||
      (Array.isArray(value.availableFonts) &&
        value.availableFonts.length <= MAX_AVAILABLE_FONTS &&
        value.availableFonts.every(isFontDescriptor))) &&
    (value.width === undefined || (isFiniteNumber(value.width) && value.width > 0)) &&
    (value.status === undefined || isBoundedString(value.status, 10_000)) &&
    (value.settings === undefined || isRenderSettings(value.settings)) &&
    (value.workflow === undefined ||
      value.workflow === 'create' ||
      value.workflow === 'edit' ||
      value.workflow === 'reflow' ||
      value.workflow === 'sync-typography') &&
    (value.workflowToken === undefined ||
      (typeof value.workflowToken === 'number' &&
        Number.isInteger(value.workflowToken) &&
        value.workflowToken >= 0)) &&
    (value.autoApply === undefined || typeof value.autoApply === 'boolean') &&
    (value.canApply === undefined || typeof value.canApply === 'boolean');

  switch (value.type) {
    case 'INITIALIZE':
      return (
        (value.source === undefined || isBoundedString(value.source, 1_000_000)) &&
        hasValidOptionalContext
      );
    case 'SELECTION_CHANGED':
      return (
        (value.source === undefined || isBoundedString(value.source, 1_000_000)) &&
        hasValidOptionalContext
      );
    case 'AVAILABLE_FONT_FAMILIES':
      return (
        Array.isArray(value.families) &&
        value.families.length <= MAX_FONT_FAMILIES &&
        value.families.every((family) => isFontDescriptor({ family, style: 'family' })) &&
        (value.status === undefined || isBoundedString(value.status, 10_000))
      );
    case 'AVAILABLE_FONT_STYLES':
      return (
        isFontDescriptor({ family: value.family, style: 'family' }) &&
        Array.isArray(value.styles) &&
        value.styles.length <= MAX_FONT_STYLES &&
        value.styles.every((style) => isFontDescriptor({ family: value.family, style })) &&
        (value.status === undefined || isBoundedString(value.status, 10_000))
      );
    case 'RENDER_ERROR':
    case 'RENDER_SUCCESS':
      return isBoundedString(value.message, 10_000);
    default:
      return false;
  }
};

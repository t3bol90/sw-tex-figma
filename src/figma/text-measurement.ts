import type { FontDescriptor, TypographyContext } from '../shared/types';
import { isUsableTypographyContext } from './typography';

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
}

/**
 * When a marked run resolves to a different font, supply the effective font and
 * a stable description of the resolution. The input is part of the cache key.
 */
export interface FontResolutionInput {
  readonly fontName: FontDescriptor;
  readonly marks?: readonly string[];
}

export interface TextMeasurementRequest {
  readonly text: string;
  readonly typography: TypographyContext;
  readonly fontResolution?: FontResolutionInput;
}

/** Narrow injectable view of a temporary Figma TextNode. */
export interface FigmaMeasurementTextNode {
  fontName: FontDescriptor;
  fontSize: number;
  lineHeight: TypographyContext['lineHeight'];
  letterSpacing: TypographyContext['letterSpacing'];
  fills: TypographyContext['fills'];
  textAutoResize?: 'WIDTH_AND_HEIGHT';
  characters: string;
  readonly width: number;
  readonly height: number;
  remove(): void;
}

/** Narrow injectable view of the Figma APIs required for native measurement. */
export interface FigmaTextMeasurementApi {
  loadFontAsync(fontName: FontDescriptor): Promise<void>;
  createText(): FigmaMeasurementTextNode;
}

export class TextMeasurementError extends Error {
  public constructor(
    message: string,
    public readonly code: 'INVALID_REQUEST' | 'FONT_LOAD_FAILED' | 'MEASUREMENT_FAILED',
    public readonly fontName?: FontDescriptor,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TextMeasurementError';
  }
}

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const effectiveFont = (request: TextMeasurementRequest): FontDescriptor =>
  request.fontResolution?.fontName ?? request.typography.fontName;

const fontLabel = (font: FontDescriptor): string => `"${font.family} ${font.style}"`;

/**
 * Stable key for unwrapped native Figma prose measurements. Fills and text style
 * ids are deliberately absent: this measurer applies explicit metric properties,
 * and neither paint nor an identifier changes the resulting text bounds.
 */
export function createTextMeasurementCacheKey(request: TextMeasurementRequest): string {
  const font = effectiveFont(request);
  return JSON.stringify({
    text: request.text,
    fontName: font,
    fontSize: request.typography.fontSize,
    lineHeight: request.typography.lineHeight,
    letterSpacing: request.typography.letterSpacing,
    fontResolution: request.fontResolution
      ? { fontName: request.fontResolution.fontName, marks: request.fontResolution.marks ?? [] }
      : undefined,
  });
}

/** Small LRU cache. Reads promote entries; clear is explicit for typography changes. */
export class BoundedTextMeasurementCache<T> {
  private readonly entries = new Map<string, T>();

  public constructor(private readonly maximumEntries = 256) {
    if (!Number.isInteger(maximumEntries) || maximumEntries <= 0) {
      throw new Error('maximumEntries must be a positive integer.');
    }
  }

  public get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  public set(key: string, value: T): void {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maximumEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey !== undefined) this.entries.delete(oldestKey);
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

/**
 * Measures one unwrapped prose run with Figma itself.
 *
 * Contract: width and height are the temporary native TextNode's bounds after
 * the supplied font, size, line height, letter spacing, fills, and characters
 * are set. Figma exposes no prose baseline/ascent/descent here; this function
 * intentionally returns no invented baseline metric. PR 5 owns any explicit
 * baseline calibration/compositor policy.
 */
export async function measureTextWithFigma(
  api: FigmaTextMeasurementApi,
  request: TextMeasurementRequest,
): Promise<TextMetrics> {
  if (typeof request.text !== 'string' || !isUsableTypographyContext(request.typography)) {
    throw new TextMeasurementError(
      'Text measurement received invalid typography or text.',
      'INVALID_REQUEST',
    );
  }
  if (
    request.fontResolution !== undefined &&
    (typeof request.fontResolution.fontName.family !== 'string' ||
      request.fontResolution.fontName.family.length === 0 ||
      typeof request.fontResolution.fontName.style !== 'string' ||
      request.fontResolution.fontName.style.length === 0)
  ) {
    throw new TextMeasurementError(
      'Text measurement received an invalid resolved font.',
      'INVALID_REQUEST',
    );
  }

  const font = effectiveFont(request);
  const node = api.createText();
  try {
    try {
      await api.loadFontAsync(font);
    } catch (cause: unknown) {
      throw new TextMeasurementError(
        `Figma could not load font ${fontLabel(font)} for text measurement.`,
        'FONT_LOAD_FAILED',
        font,
        cause,
      );
    }

    // The font must be loaded before any font-dependent text property or characters.
    node.fontName = font;
    node.fontSize = request.typography.fontSize;
    node.lineHeight = request.typography.lineHeight;
    node.letterSpacing = request.typography.letterSpacing;
    node.fills = request.typography.fills.map((fill) => ({
      type: 'SOLID' as const,
      color: { ...fill.color },
      ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
    }));
    if ('textAutoResize' in node) node.textAutoResize = 'WIDTH_AND_HEIGHT';
    node.characters = request.text;

    if (!isFiniteNonNegativeNumber(node.width) || !isFiniteNonNegativeNumber(node.height)) {
      throw new TextMeasurementError(
        'Figma returned non-finite text measurement bounds.',
        'MEASUREMENT_FAILED',
        font,
      );
    }
    return { width: node.width, height: node.height };
  } catch (error: unknown) {
    if (error instanceof TextMeasurementError) throw error;
    throw new TextMeasurementError(
      `Figma could not measure text with font ${fontLabel(font)}.`,
      'MEASUREMENT_FAILED',
      font,
      error,
    );
  } finally {
    node.remove();
  }
}

/**
 * Cache facade. Failures are never inserted, so a transient unavailable font can
 * be retried and no failed Promise is retained.
 */
export class FigmaTextMeasurer {
  public constructor(
    private readonly api: FigmaTextMeasurementApi,
    private readonly cache = new BoundedTextMeasurementCache<TextMetrics>(),
  ) {}

  public async measure(request: TextMeasurementRequest): Promise<TextMetrics> {
    const key = createTextMeasurementCacheKey(request);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const measured = await measureTextWithFigma(this.api, request);
    this.cache.set(key, measured);
    return measured;
  }

  public clear(): void {
    this.cache.clear();
  }

  public get cacheSize(): number {
    return this.cache.size;
  }
}

import type { ProseBaselineCalibration } from '../layout';
import type { FontDescriptor, TypographyContext } from '../shared/types';
import { BoundedTextMeasurementCache } from './text-measurement';
import type { FigmaRenderableTextNode } from './prose-renderer';

/** A deliberately narrow, injectable slice of the real Figma probe APIs. */
export type FigmaBaselineProbeTextNode = FigmaRenderableTextNode;
export interface FigmaBaselineProbeVectorNode {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  remove(): void;
}
export interface FigmaBaselineProbeApi {
  loadFontAsync(font: FontDescriptor): Promise<void>;
  createText(): FigmaBaselineProbeTextNode;
  /** Real Figma API: flatten converts the temporary text into vector geometry. */
  flatten(nodes: readonly FigmaBaselineProbeTextNode[]): FigmaBaselineProbeVectorNode;
}

/**
 * Figma does not expose a TextNode baseline. We infer an approximate baseline
 * by flattening a temporary cap-height `H` and using its ink bottom. This is
 * typography-specific and avoids a universal vertical-centering offset. It is
 * not exact for fonts whose cap bottom differs from the baseline or glyphs
 * with overshoot; failures use the documented 0.8em fallback.
 */
export async function calibrateBaselineFromReferenceGlyph(
  api: FigmaBaselineProbeApi,
  typography: TypographyContext,
  font: FontDescriptor = typography.fontName,
): Promise<ProseBaselineCalibration> {
  const text = api.createText();
  let vector: FigmaBaselineProbeVectorNode | undefined;
  try {
    await api.loadFontAsync(font);
    text.x = 0;
    text.y = 0;
    text.fontName = font;
    text.fontSize = typography.fontSize;
    text.lineHeight = typography.lineHeight;
    text.letterSpacing = typography.letterSpacing;
    text.characters = 'H';
    // Figma flatten consumes TextNode. Snapshot all TextNode geometry before it.
    const textTop = text.y;
    const textHeight = text.height;
    if (!valid(textHeight) || !valid(typography.fontSize))
      throw new Error('Invalid reference glyph bounds.');
    vector = api.flatten([text]);
    // Flattened vector coordinates are in the same parent coordinate space. H's
    // ink bottom approximates baseline = vector.y + vector.height.
    const baseline = vector.y + vector.height - textTop;
    const emHeight = Math.min(textHeight, typography.fontSize);
    const leading = Math.max(0, textHeight - typography.fontSize);
    const ratio = (baseline - leading / 2) / emHeight;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1)
      throw new Error('Reference glyph did not yield a usable baseline ratio.');
    return { emAscentRatio: ratio, source: 'reference-glyph' };
  } finally {
    try {
      vector?.remove();
    } finally {
      // Figma flatten normally already removes text. Its remove is idempotent in
      // practice; callers' mocks should allow cleanup as well.
      try {
        text.remove();
      } catch {
        /* consumed temporary text */
      }
    }
  }
}

const valid = (value: number): boolean => Number.isFinite(value) && value > 0;

const keyFor = (typography: TypographyContext, font: FontDescriptor): string =>
  JSON.stringify({
    font,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    letterSpacing: typography.letterSpacing,
  });

/** Bounded successful-probe cache. A failed calibration is never retained. */
export class FigmaProseBaselineCalibrator {
  private readonly cache: BoundedTextMeasurementCache<ProseBaselineCalibration>;
  public constructor(
    private readonly api: FigmaBaselineProbeApi | undefined,
    capacity = 64,
    private readonly fallback: ProseBaselineCalibration = {
      emAscentRatio: 0.8,
      source: 'fallback',
    },
  ) {
    this.cache = new BoundedTextMeasurementCache(capacity);
  }
  public async calibrate(
    typography: TypographyContext,
    font: FontDescriptor = typography.fontName,
  ): Promise<ProseBaselineCalibration> {
    const key = keyFor(typography, font);
    const hit = this.cache.get(key);
    if (hit) return hit;
    let result = this.fallback;
    if (this.api) {
      try {
        result = await calibrateBaselineFromReferenceGlyph(this.api, typography, font);
      } catch {
        // The plugin has no exact baseline API. Rendering remains available with
        // the explicit fallback rather than claiming a failed probe was exact.
      }
    }
    this.cache.set(key, result);
    return result;
  }
  public clear(): void {
    this.cache.clear();
  }
  public get cacheSize(): number {
    return this.cache.size;
  }
}

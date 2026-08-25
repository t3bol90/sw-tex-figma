export interface MathCacheKeyInput {
  readonly latex: string;
  readonly display: boolean;
  readonly mathScale: number;
  readonly rendererIdentity: string;
}

/**
 * A stable JSON record rather than a hash. It is inspectable in Figma metadata
 * later and separates every renderer input which can change SVG or metrics.
 */
export const createMathCacheKey = (input: MathCacheKeyInput): string =>
  JSON.stringify({
    display: input.display,
    latex: input.latex,
    mathScale: input.mathScale,
    rendererIdentity: input.rendererIdentity,
  });

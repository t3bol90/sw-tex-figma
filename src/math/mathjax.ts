import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

import type { RenderedMathPayload } from '../shared/types';
import { MATHJAX_SVG_RENDERER_IDENTITY } from '../shared/persistence';
import { BoundedMathCache } from './cache';
import { createMathCacheKey } from './cache-key';
import { installBundledFontData } from './font-data';
import { extractSvgBox, metricsFromSvgBox } from './metrics';
import { getMathJaxError, normalizeMathJaxSvg } from './svg';

/** This exact identity is deliberately part of every cache key and persisted output contract. */
export const MATHJAX_RENDERER_IDENTITY = MATHJAX_SVG_RENDERER_IDENTITY;

export interface MathRenderRequest {
  readonly latex: string;
  readonly display: boolean;
  readonly mathScale: number;
}

export interface MathRenderer {
  readonly rendererIdentity: string;
  render(request: MathRenderRequest): Promise<RenderedMathPayload>;
}

export class MathRenderError extends Error {
  public readonly name = 'MathRenderError';
  public constructor(
    message: string,
    public readonly latex?: string,
  ) {
    super(message);
  }
}

/**
 * One UI-local MathJax v4 TeX-to-SVG engine. Font cache `none` makes every
 * returned SVG self-contained, while our bounded cache avoids repeat work.
 */
export class MathJaxSvgRenderer implements MathRenderer {
  public readonly rendererIdentity = MATHJAX_RENDERER_IDENTITY;
  private readonly cache: BoundedMathCache<RenderedMathPayload>;
  private readonly adaptor = liteAdaptor();
  private readonly document: ReturnType<typeof mathjax.document>;

  public constructor(cacheCapacity = 128) {
    RegisterHTMLHandler(this.adaptor);
    const font = new MathJaxNewcmFont();
    installBundledFontData(font);
    const tex = new TeX({ packages: ['base', 'ams', 'newcommand'] });
    const svg = new SVG({ fontData: font, fontCache: 'none' });
    this.document = mathjax.document('', { InputJax: tex, OutputJax: svg });
    this.cache = new BoundedMathCache(cacheCapacity);
  }

  public async render(request: MathRenderRequest): Promise<RenderedMathPayload> {
    validateRequest(request);
    const key = createMathCacheKey({ ...request, rendererIdentity: this.rendererIdentity });
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    try {
      const converted = this.document.convert(request.latex, { display: request.display });
      const serialized = this.adaptor.outerHTML(converted);
      const texError = getMathJaxError(serialized);
      if (texError !== undefined) throw new MathRenderError(texError, request.latex);
      const svgBox = extractSvgBox(serialized);
      const svg = normalizeMathJaxSvg(serialized, request.mathScale);
      const metrics = metricsFromSvgBox(svgBox, request.mathScale);
      const payload: RenderedMathPayload = {
        latex: request.latex,
        display: request.display,
        svg,
        metrics,
      };
      this.cache.set(key, payload);
      return payload;
    } catch (error: unknown) {
      if (error instanceof MathRenderError) throw error;
      throw new MathRenderError(errorMessage(error), request.latex);
    }
  }
}

const validateRequest = (request: MathRenderRequest): void => {
  if (request.latex.length > 100_000)
    throw new MathRenderError('The TeX expression is too long.', request.latex);
  if (!Number.isFinite(request.mathScale) || request.mathScale <= 0 || request.mathScale > 10)
    throw new MathRenderError('Math scale must be a finite value between 0 and 10.', request.latex);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : 'MathJax could not render this TeX expression.';

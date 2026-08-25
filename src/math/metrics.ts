import type { MathMetrics } from '../shared/types';

/** MathJax's canonical output uses 1ex = half of its default 16px em. */
export const MATHJAX_EX_PX = 8;

export interface SvgBox {
  readonly width: number;
  readonly height: number;
  readonly viewBoxX: number;
  readonly viewBoxY: number;
  readonly viewBoxWidth: number;
  readonly viewBoxHeight: number;
}

const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?`;
const attribute = (svg: string, name: string): string | undefined =>
  new RegExp(String.raw`\s${name}=["']([^"']+)["']`, 'i').exec(svg)?.[1];

/** Read MathJax SVG geometry without browser layout or vertical centering. */
export function extractSvgBox(svg: string): SvgBox {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (root === undefined) throw new Error('MathJax did not return an SVG root.');
  const viewBox = attribute(root, 'viewBox')?.trim().split(/[ ,]+/).map(Number);
  const widthEx = parseEx(attribute(root, 'width'));
  const heightEx = parseEx(attribute(root, 'height'));
  if (
    viewBox === undefined ||
    viewBox.length !== 4 ||
    widthEx === undefined ||
    heightEx === undefined
  ) {
    throw new Error('MathJax SVG is missing finite width, height, or viewBox geometry.');
  }
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = viewBox;
  if (
    ![viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight, widthEx, heightEx].every(Number.isFinite) ||
    viewBoxWidth <= 0 ||
    viewBoxHeight <= 0 ||
    widthEx <= 0 ||
    heightEx <= 0
  ) {
    throw new Error('MathJax SVG has invalid geometry.');
  }
  return {
    width: widthEx * MATHJAX_EX_PX,
    height: heightEx * MATHJAX_EX_PX,
    viewBoxX,
    viewBoxY,
    viewBoxWidth,
    viewBoxHeight,
  };
}

/**
 * Metrics are canonical CSS-pixel layout units at MathJax's 16px em, multiplied
 * by `mathScale`. The viewBox y=0 is MathJax's real baseline. Thus baseline and
 * ascent are equal and height is always ascent + descent. Later Figma layout
 * can multiply all values uniformly when it chooses its text-size mapping.
 */
export function metricsFromSvgBox(box: SvgBox, mathScale: number): MathMetrics {
  if (!Number.isFinite(mathScale) || mathScale <= 0)
    throw new Error('Math scale must be finite and positive.');
  const pxPerSvgUnit = box.height / box.viewBoxHeight;
  const ascent = -box.viewBoxY * pxPerSvgUnit * mathScale;
  const descent = (box.viewBoxY + box.viewBoxHeight) * pxPerSvgUnit * mathScale;
  const width = box.width * mathScale;
  const height = box.height * mathScale;
  const metrics = { width, height, ascent, descent, baseline: ascent };
  if (
    !Object.values(metrics).every((value) => Number.isFinite(value) && value >= 0) ||
    !approximatelyEqual(height, ascent + descent)
  )
    throw new Error('MathJax SVG produced inconsistent baseline metrics.');
  return metrics;
}

const parseEx = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const match = new RegExp(`^(${NUMBER})ex$`, 'i').exec(value.trim());
  return match === null ? undefined : Number(match[1]);
};

const approximatelyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-8 * Math.max(1, left, right);

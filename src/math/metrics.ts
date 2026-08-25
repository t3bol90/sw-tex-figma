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

/** One MathJax SVG sibling plus its precomputed placement in a composite SVG. */
export interface MathJaxSvgFragmentLayout {
  readonly fragments: readonly string[];
  readonly boxes: readonly SvgBox[];
  /** Horizontal offset for each fragment in the composite SVG coordinate system. */
  readonly offsets: readonly number[];
  /** CSS-pixel spacer after each fragment (zero after the last). */
  readonly spacers: readonly number[];
  readonly box: SvgBox;
}

/** MathJax SVG Wrapper `mjx-break` size 0..5 maps to these em widths. */
const BREAK_EM = [0.001, 0.111, 0.167, 0.222, 0.278, 0.333] as const;
const fragmentPattern = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;

/**
 * Parse adjacent SVG siblings and their intervening MathJax `mjx-break` layout
 * marker. Forced/prebreak markers are deliberately rejected: flattening them
 * into horizontal geometry would silently alter MathJax line-break semantics.
 */
export function layoutMathJaxSvgFragments(serialized: string): MathJaxSvgFragmentLayout {
  const matches = [...serialized.matchAll(fragmentPattern)];
  if (!matches.length) throw new Error('MathJax did not return an SVG root.');
  const fragments = matches.map((match) => match[0]);
  const boxes = fragments.map(extractSvgBox);
  const scale = boxes[0]!.width / boxes[0]!.viewBoxWidth;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('MathJax SVG has invalid coordinate scale.');
  const spacers = boxes.map(() => 0);
  for (let index = 0; index + 1 < matches.length; index += 1) {
    const left = matches[index]!;
    const right = matches[index + 1]!;
    const after = (left.index ?? 0) + left[0].length;
    const between = serialized.slice(after, right.index ?? after);
    spacers[index] = spacerPx(between);
  }
  const offsets: number[] = [];
  let cursor = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index]!;
    offsets.push(cursor - box.viewBoxX);
    cursor += box.viewBoxWidth + spacers[index]! / scale;
  }
  const top = Math.min(...boxes.map((box) => box.viewBoxY));
  const bottom = Math.max(...boxes.map((box) => box.viewBoxY + box.viewBoxHeight));
  const width =
    boxes.reduce((total, box) => total + box.width, 0) +
    spacers.reduce((total, value) => total + value, 0);
  return {
    fragments,
    boxes,
    offsets,
    spacers,
    box: {
      width,
      height: (bottom - top) * scale,
      viewBoxX: 0,
      viewBoxY: top,
      viewBoxWidth: width / scale,
      viewBoxHeight: bottom - top,
    },
  };
}

/** Compatibility facade for consumers only needing aggregate geometry. */
export function extractCompositeSvgBox(serialized: string): SvgBox {
  return layoutMathJaxSvgFragments(serialized).box;
}

const spacerPx = (between: string): number => {
  if (/\b(?:prebreak|newline)\b/i.test(between))
    throw new Error('MathJax forced/prebreak SVG fragments are not supported as one inline box.');
  const breaks = [...between.matchAll(/<mjx-break\b([^>]*)>[\s\S]*?<\/mjx-break>/gi)];
  if (!breaks.length) {
    if (between.trim().length)
      throw new Error('MathJax SVG fragments contain unsupported separator markup.');
    return 0;
  }
  let remainder = between;
  let total = 0;
  for (const marker of breaks) {
    remainder = remainder.replace(marker[0], '');
    const attributes = marker[1] ?? '';
    const style = /\bstyle=["']([^"']*)["']/i.exec(attributes)?.[1];
    const letterSpacing =
      style && new RegExp(`(?:^|;)\\s*letter-spacing\\s*:\\s*(${NUMBER})em`, 'i').exec(style)?.[1];
    if (letterSpacing !== undefined) {
      const em = Number(letterSpacing);
      // MathJax addInlineBreak emits a literal 1em space then adjusts it with
      // letter-spacing LENGTHS.em(dimen - 1), so effective width is 1 + X em.
      if (!Number.isFinite(em) || 1 + em < 0)
        throw new Error('MathJax mjx-break has invalid letter-spacing.');
      total += (1 + em) * 16;
      continue;
    }
    const size = /\bsize=["']([0-5])["']/i.exec(attributes)?.[1];
    if (size === undefined) throw new Error('MathJax mjx-break has unsupported spacing metadata.');
    total += BREAK_EM[Number(size)]! * 16;
  }
  if (remainder.trim().length)
    throw new Error('MathJax SVG fragments contain unsupported separator markup.');
  return total;
};

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

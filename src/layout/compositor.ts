import { fallbackEmptyLineMetrics } from './baseline';
import { breakMeasuredTokens } from './line-break';
import type {
  ComposeParagraphOptions,
  LayoutMetrics,
  LineChild,
  LinePlan,
  MeasuredInlineToken,
  MeasuredParagraph,
  ParagraphPlan,
  ProseLineChild,
} from './types';

/** Compose a measured paragraph without any Figma, DOM, React, or renderer API. */
export function composeParagraph(
  paragraph: MeasuredParagraph,
  options: ComposeParagraphOptions,
): ParagraphPlan {
  const broken = breakMeasuredTokens(paragraph.tokens, options);
  let top = 0;
  const lines: LinePlan[] = [];
  for (let index = 0; index < broken.length; index += 1) {
    const line = broken[index]!;
    const metrics = lineMetrics(line.tokens, options.emptyLineMetrics);
    // Only soft-wrapped, non-terminal lines can justify. A hard break marks the
    // line it terminates, so it remains natural even when another line follows.
    const justified =
      options.textAlignment === 'justify' &&
      index + 1 < broken.length &&
      !line.forced &&
      metrics.width < options.width &&
      line.tokens.some((token) => token.kind === 'separator');
    const children = mergeAndPlace(line.tokens, metrics.ascent, top, justified);
    const plan: LinePlan = {
      x: 0,
      y: top,
      width: children.length === 0 ? 0 : children.at(-1)!.x + children.at(-1)!.metrics.width,
      height: metrics.height,
      ascent: metrics.ascent,
      descent: metrics.descent,
      baseline: top + metrics.ascent,
      children,
      forced: line.forced,
      ...(justified ? { justified: true as const } : {}),
    };
    lines.push(plan);
    top += metrics.height;
  }
  return { width: options.width, height: top, lines };
}

/** Convenience wrapper that derives documented fallback metrics from typography. */
export function composeMeasuredParagraph(
  paragraph: MeasuredParagraph,
  options: Omit<ComposeParagraphOptions, 'emptyLineMetrics'> & {
    readonly emptyLineMetrics?: LayoutMetrics;
    readonly typography: Parameters<typeof fallbackEmptyLineMetrics>[0];
    readonly baselineCalibration?: Parameters<typeof fallbackEmptyLineMetrics>[1];
  },
): ParagraphPlan {
  return composeParagraph(paragraph, {
    width: options.width,
    tolerance: options.tolerance,
    textAlignment: options.textAlignment,
    emptyLineMetrics:
      options.emptyLineMetrics ??
      fallbackEmptyLineMetrics(options.typography, options.baselineCalibration),
  });
}

const lineMetrics = (
  tokens: readonly Exclude<MeasuredInlineToken, { readonly kind: 'hard-break' }>[],
  fallback: LayoutMetrics,
): LayoutMetrics => {
  if (tokens.length === 0) return fallback;
  const ascent = Math.max(...tokens.map((token) => token.metrics.ascent));
  const descent = Math.max(...tokens.map((token) => token.metrics.descent));
  return {
    width: tokens.reduce((sum, token) => sum + token.metrics.width, 0),
    height: ascent + descent,
    ascent,
    descent,
  };
};

const mergeAndPlace = (
  tokens: readonly MeasuredInlineToken[],
  lineAscent: number,
  top: number,
  justify: boolean,
): readonly LineChild[] => {
  const children: LineChild[] = [];
  let x = 0;
  for (const token of tokens) {
    if (token.kind === 'hard-break') continue;
    if (token.kind === 'math') {
      children.push({
        type: 'math',
        latex: token.latex,
        rendered: token.rendered,
        svgScale: token.svgScale,
        x,
        y: top + lineAscent - token.metrics.ascent,
        metrics: token.metrics,
      });
      x += token.metrics.width;
      continue;
    }
    const previous = children.at(-1);
    if (token.kind === 'prose' || token.kind === 'separator') {
      if (previous?.type === 'prose' && proseCompatible(previous, token)) {
        children[children.length - 1] = mergeProse(previous, token, justify);
      } else {
        children.push({
          type: 'prose',
          text: token.text,
          ...(token.marks === undefined ? {} : { marks: token.marks }),
          ...(token.fontResolution === undefined ? {} : { fontResolution: token.fontResolution }),
          x,
          y: top + lineAscent - token.metrics.ascent,
          metrics: token.metrics,
          ...(token.baselineCalibration === undefined
            ? {}
            : { baselineCalibration: token.baselineCalibration }),
          ...(token.kind === 'separator'
            ? {
                endsWithSeparator: true as const,
                trailingSeparatorWidth: token.metrics.width,
                ...(justify ? { justifyGapAfter: true as const } : {}),
              }
            : {}),
          measuredParts: [token.text],
        });
      }
      x += token.metrics.width;
    }
  }
  return children;
};

const proseCompatible = (
  previous: ProseLineChild,
  token: Extract<MeasuredInlineToken, { readonly kind: 'prose' | 'separator' }>,
): boolean =>
  previous.justifyGapAfter !== true &&
  sameMarks(previous.marks, token.marks) &&
  sameFontResolution(previous.fontResolution, token.fontResolution) &&
  sameVerticalMetrics(previous.metrics, token.metrics) &&
  sameCalibration(previous.baselineCalibration, token.baselineCalibration);

const mergeProse = (
  previous: ProseLineChild,
  token: Extract<MeasuredInlineToken, { readonly kind: 'prose' | 'separator' }>,
  justify: boolean,
): ProseLineChild => ({
  ...previous,
  text: previous.text + token.text,
  // Sum individually measured widths. See docs/LAYOUT.md for kerning contract.
  metrics: {
    width: previous.metrics.width + token.metrics.width,
    height: previous.metrics.height,
    ascent: previous.metrics.ascent,
    descent: previous.metrics.descent,
  },
  ...(token.kind === 'separator'
    ? {
        endsWithSeparator: true as const,
        trailingSeparatorWidth: token.metrics.width,
        ...(justify ? { justifyGapAfter: true as const } : {}),
      }
    : {}),
  ...(token.kind === 'prose'
    ? { endsWithSeparator: undefined, trailingSeparatorWidth: undefined }
    : {}),
  measuredParts: [...previous.measuredParts, token.text],
});

const sameMarks = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((mark, index) => mark === right[index]));

const sameVerticalMetrics = (left: LayoutMetrics, right: LayoutMetrics): boolean =>
  left.height === right.height && left.ascent === right.ascent && left.descent === right.descent;

const sameFontResolution = (
  left: ProseLineChild['fontResolution'],
  right: Extract<MeasuredInlineToken, { readonly kind: 'prose' | 'separator' }>['fontResolution'],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameCalibration = (
  left: ProseLineChild['baselineCalibration'],
  right: Extract<
    MeasuredInlineToken,
    { readonly kind: 'prose' | 'separator' }
  >['baselineCalibration'],
): boolean => JSON.stringify(left) === JSON.stringify(right);

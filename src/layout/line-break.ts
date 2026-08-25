import type { MeasuredInlineToken } from './types';

export interface BrokenLine {
  readonly tokens: readonly Exclude<MeasuredInlineToken, { readonly kind: 'hard-break' }>[];
  readonly forced: boolean;
}

export interface LineBreakOptions {
  readonly width: number;
  readonly tolerance?: number;
}

/** Default tolerance only absorbs rounding noise; it is not a visual margin. */
export const DEFAULT_LAYOUT_TOLERANCE = 1e-6;

type RetainedToken = Exclude<MeasuredInlineToken, { readonly kind: 'hard-break' }>;
type ContentToken = Extract<MeasuredInlineToken, { readonly kind: 'prose' | 'math' }>;
type Separator = Extract<MeasuredInlineToken, { readonly kind: 'separator' }>;

/**
 * Greedy wrapping over actual whitespace separators. Every contiguous sequence
 * without a separator is first made into one legal group. That is what prevents
 * a math-adjacent period (or adjacent marked runs) being moved independently.
 */
export function breakMeasuredTokens(
  tokens: readonly MeasuredInlineToken[],
  options: LineBreakOptions,
): readonly BrokenLine[] {
  if (!Number.isFinite(options.width) || options.width < 0) {
    throw new Error('Paragraph width must be a finite non-negative number.');
  }
  const tolerance = options.tolerance ?? DEFAULT_LAYOUT_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error('Layout tolerance must be finite and non-negative.');
  }

  const lines: BrokenLine[] = [];
  let line: RetainedToken[] = [];
  let lineWidth = 0;
  let pending: Separator[] = [];

  const flush = (forced: boolean): void => {
    lines.push({ tokens: line, forced });
    line = [];
    lineWidth = 0;
    pending = [];
  };

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token.kind === 'hard-break') {
      // Flush even an empty current line; this preserves leading/consecutive breaks.
      flush(true);
      index += 1;
      continue;
    }
    if (token.kind === 'separator') {
      pending.push(token);
      index += 1;
      continue;
    }

    const group: ContentToken[] = [];
    while (index < tokens.length) {
      const candidate = tokens[index];
      if (
        candidate === undefined ||
        candidate.kind === 'separator' ||
        candidate.kind === 'hard-break'
      )
        break;
      group.push(candidate);
      index += 1;
    }
    const groupWidth = sumWidths(group);
    const hadLine = line.length > 0;
    const separatorWidth = hadLine ? sumWidths(pending) : 0;
    const candidateWidth = lineWidth + separatorWidth + groupWidth;

    if (hadLine && candidateWidth > options.width + tolerance) {
      // A group can only be moved at a preceding actual separator. When it is
      // moved, start the new line from exactly the group width: the separator
      // was intentionally dropped and must not become phantom line width.
      if (pending.length > 0) {
        flush(false);
        line.push(...group);
        lineWidth = groupWidth;
        continue;
      }
      // This fallback only serves manually constructed malformed token streams.
      line.push(...group);
      lineWidth += groupWidth;
      continue;
    }

    // Leading ordinary separators are collapsed away. Interior source whitespace
    // is retained exactly, then group and its over-wide overflow are added once.
    if (hadLine) line.push(...pending);
    line.push(...group);
    lineWidth += (hadLine ? separatorWidth : 0) + groupWidth;
    pending = [];
  }

  // Every paragraph has a final line. This also makes a trailing hard break intentional.
  flush(false);
  return lines;
}

const sumWidths = (tokens: readonly { readonly metrics: { readonly width: number } }[]): number =>
  tokens.reduce((total, token) => total + token.metrics.width, 0);

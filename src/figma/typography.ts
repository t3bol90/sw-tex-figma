import { MAX_FONT_DESCRIPTOR_LENGTH, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../shared/messages';
import type {
  FontDescriptor,
  LetterSpacing,
  LineHeight,
  SolidFill,
  TypographyContext,
} from '../shared/types';

/**
 * The serializable typography used when no usable Figma text selection exists.
 * It is a starting point only; Figma validates and loads the font when prose is
 * eventually measured or rendered.
 */
export const DEFAULT_TYPOGRAPHY: TypographyContext = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'AUTO' },
  letterSpacing: { unit: 'PIXELS', value: 0 },
  fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
};

/** A deliberately small structural view of the Figma TextNode fields we read. */
export interface FigmaTextTypographyNode {
  readonly fontName: unknown;
  readonly fontSize: unknown;
  readonly lineHeight: unknown;
  readonly letterSpacing: unknown;
  readonly fills: unknown;
  readonly textStyleId?: unknown;
}

export type TypographyIssueCode =
  | 'MIXED_FONT_NAME'
  | 'MIXED_FONT_SIZE'
  | 'MIXED_LINE_HEIGHT'
  | 'MIXED_LETTER_SPACING'
  | 'MIXED_FILLS'
  | 'MIXED_TEXT_STYLE_ID'
  | 'INVALID_FONT_NAME'
  | 'INVALID_FONT_SIZE'
  | 'INVALID_LINE_HEIGHT'
  | 'INVALID_LETTER_SPACING'
  | 'INVALID_FILLS'
  | 'INVALID_TEXT_STYLE_ID'
  | 'UNSUPPORTED_FILL';

export interface TypographyIssue {
  readonly code: TypographyIssueCode;
  readonly message: string;
}

export type TypographyExtraction =
  | { readonly ok: true; readonly typography: TypographyContext }
  | { readonly ok: false; readonly issue: TypographyIssue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isMixed = (value: unknown, mixed: unknown): boolean => value === mixed;

const issue = (code: TypographyIssueCode, message: string): TypographyExtraction => ({
  ok: false,
  issue: { code, message },
});

function readFontDescriptor(value: unknown): FontDescriptor | undefined {
  if (!isRecord(value) || typeof value.family !== 'string' || typeof value.style !== 'string') {
    return undefined;
  }
  if (
    value.family.length === 0 ||
    value.style.length === 0 ||
    value.family.length > MAX_FONT_DESCRIPTOR_LENGTH ||
    value.style.length > MAX_FONT_DESCRIPTOR_LENGTH ||
    value.family.includes('\u0000') ||
    value.style.includes('\u0000')
  )
    return undefined;
  return { family: value.family, style: value.style };
}

function readLineHeight(value: unknown): LineHeight | undefined {
  if (!isRecord(value) || typeof value.unit !== 'string') return undefined;
  if (value.unit === 'AUTO') return { unit: 'AUTO' };
  if (
    (value.unit === 'PIXELS' || value.unit === 'INTRINSIC_%') &&
    isFiniteNumber(value.value) &&
    value.value >= 0
  ) {
    return { unit: value.unit, value: value.value };
  }
  return undefined;
}

function readLetterSpacing(value: unknown): LetterSpacing | undefined {
  if (
    !isRecord(value) ||
    (value.unit !== 'PIXELS' && value.unit !== 'PERCENT') ||
    !isFiniteNumber(value.value)
  ) {
    return undefined;
  }
  return { unit: value.unit, value: value.value };
}

function readSolidFill(value: unknown): SolidFill | undefined {
  if (!isRecord(value) || value.type !== 'SOLID' || !isRecord(value.color)) return undefined;
  const { r, g, b } = value.color;
  if (
    !isFiniteNumber(r) ||
    !isFiniteNumber(g) ||
    !isFiniteNumber(b) ||
    r < 0 ||
    r > 1 ||
    g < 0 ||
    g > 1 ||
    b < 0 ||
    b > 1
  ) {
    return undefined;
  }
  const opacity = value.opacity;
  if (opacity !== undefined && (!isFiniteNumber(opacity) || opacity < 0 || opacity > 1)) {
    return undefined;
  }
  return opacity === undefined
    ? { type: 'SOLID', color: { r, g, b } }
    : { type: 'SOLID', color: { r, g, b }, opacity };
}

/**
 * Copies only Figma values that can safely cross the controller/UI boundary.
 * `mixed` must be the exact `figma.mixed` value supplied by the caller.
 */
export function extractTypography(
  node: FigmaTextTypographyNode,
  mixed: unknown,
): TypographyExtraction {
  if (!isRecord(node))
    return issue('INVALID_FONT_NAME', 'The selected typography is not available.');
  if (isMixed(node.fontName, mixed))
    return issue('MIXED_FONT_NAME', 'The selected text uses mixed fonts.');
  if (isMixed(node.fontSize, mixed))
    return issue('MIXED_FONT_SIZE', 'The selected text uses mixed font sizes.');
  if (isMixed(node.lineHeight, mixed))
    return issue('MIXED_LINE_HEIGHT', 'The selected text uses mixed line heights.');
  if (isMixed(node.letterSpacing, mixed)) {
    return issue('MIXED_LETTER_SPACING', 'The selected text uses mixed letter spacing.');
  }
  if (isMixed(node.fills, mixed))
    return issue('MIXED_FILLS', 'The selected text uses mixed fills.');
  if (isMixed(node.textStyleId, mixed)) {
    return issue('MIXED_TEXT_STYLE_ID', 'The selected text uses mixed text styles.');
  }

  const fontName = readFontDescriptor(node.fontName);
  if (fontName === undefined) return issue('INVALID_FONT_NAME', 'The selected font is not usable.');
  if (
    !isFiniteNumber(node.fontSize) ||
    node.fontSize < MIN_FONT_SIZE ||
    node.fontSize > MAX_FONT_SIZE
  ) {
    return issue(
      'INVALID_FONT_SIZE',
      `The selected font size must be between ${MIN_FONT_SIZE} and ${MAX_FONT_SIZE}.`,
    );
  }
  const lineHeight = readLineHeight(node.lineHeight);
  if (lineHeight === undefined)
    return issue('INVALID_LINE_HEIGHT', 'The selected line height is not supported.');
  const letterSpacing = readLetterSpacing(node.letterSpacing);
  if (letterSpacing === undefined) {
    return issue('INVALID_LETTER_SPACING', 'The selected letter spacing is not supported.');
  }
  if (!Array.isArray(node.fills))
    return issue('INVALID_FILLS', 'The selected fills are not available.');

  const fills: SolidFill[] = [];
  for (const fill of node.fills) {
    if (!isRecord(fill) || fill.type !== 'SOLID') {
      return issue('UNSUPPORTED_FILL', 'Only solid text fills can be inherited.');
    }
    const solidFill = readSolidFill(fill);
    if (solidFill === undefined)
      return issue('INVALID_FILLS', 'The selected solid fill is invalid.');
    fills.push(solidFill);
  }

  let textStyleId: string | undefined;
  if (node.textStyleId !== undefined && node.textStyleId !== '') {
    if (typeof node.textStyleId !== 'string') {
      return issue('INVALID_TEXT_STYLE_ID', 'The selected text style id is invalid.');
    }
    textStyleId = node.textStyleId;
  }

  return {
    ok: true,
    typography: {
      fontName,
      fontSize: node.fontSize,
      lineHeight,
      letterSpacing,
      fills,
      ...(textStyleId === undefined ? {} : { textStyleId }),
    },
  };
}

/** Validates a context before passing it to a Figma text node. */
export function isUsableTypographyContext(value: unknown): value is TypographyContext {
  return extractTypography(value as FigmaTextTypographyNode, Symbol('not-figma-mixed')).ok;
}

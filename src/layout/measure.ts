import type { MathTextDocument, ParagraphNode, TextMark } from '../shared/document-model';
import type { RenderedMathPayload } from '../shared/types';

import { calibrateProseMetrics, DEFAULT_PROSE_BASELINE_CALIBRATION } from './baseline';
import { tokenizeParagraph } from './tokenizer';
import type {
  DisplayMathPlan,
  FontResolution,
  MeasureDocumentOptions,
  MeasureParagraphOptions,
  MeasuredDocument,
  MeasuredDocumentBlock,
  MeasuredInlineToken,
  MeasuredParagraph,
} from './types';

export class MathPayloadValidationError extends Error {
  public readonly name = 'MathPayloadValidationError';
  public constructor(
    public readonly code: 'MISSING' | 'EXTRA' | 'MISMATCH' | 'INVALID_METRICS',
    message: string,
    public readonly occurrence?: number,
  ) {
    super(message);
  }
}

interface ExpectedMath {
  readonly latex: string;
  readonly display: boolean;
}

/**
 * Payloads are occurrence ordered, not merely set-matched. This prevents a
 * repeated formula or a display/inline swap from silently rendering wrong TeX.
 */
export function validateRenderedMathPayloads(
  document: MathTextDocument,
  payloads: readonly RenderedMathPayload[],
): void {
  const expected = expectedMath(document);
  for (let index = 0; index < expected.length; index += 1) {
    const wanted = expected[index];
    const actual = payloads[index];
    if (actual === undefined) {
      throw new MathPayloadValidationError(
        'MISSING',
        `Missing rendered math payload at occurrence ${index}.`,
        index,
      );
    }
    if (actual.latex !== wanted.latex || actual.display !== wanted.display) {
      throw new MathPayloadValidationError(
        'MISMATCH',
        `Rendered math payload ${index} does not match AST latex/display identity.`,
        index,
      );
    }
    validateMathMetrics(actual, index);
  }
  if (payloads.length > expected.length) {
    throw new MathPayloadValidationError(
      'EXTRA',
      `Received ${payloads.length - expected.length} extra rendered math payload(s).`,
      expected.length,
    );
  }
}

/** Converts PR 3's 16px-em payload into the selected prose coordinate system. */
export function scaleMathPayloadForTypography(rendered: RenderedMathPayload, fontSize: number) {
  validateMathMetrics(rendered);
  if (!Number.isFinite(fontSize) || fontSize <= 0)
    throw new Error('Typography fontSize must be finite and positive.');
  const svgScale = fontSize / 16;
  const { metrics } = rendered;
  return {
    metrics: {
      width: metrics.width * svgScale,
      height: metrics.height * svgScale,
      ascent: metrics.ascent * svgScale,
      descent: metrics.descent * svgScale,
    },
    svgScale,
  };
}

export async function measureParagraph(
  paragraph: ParagraphNode,
  options: MeasureParagraphOptions,
): Promise<MeasuredParagraph> {
  const expected = expectedMath([paragraph]);
  // This local validation makes standalone paragraph use safe too.
  validateExpectedPayloads(expected, options.renderedMath);
  let mathIndex = 0;
  const calibration = options.baselineCalibration ?? DEFAULT_PROSE_BASELINE_CALIBRATION;
  const tokens: MeasuredInlineToken[] = [];
  for (const token of tokenizeParagraph(paragraph)) {
    if (token.kind === 'hard-break') {
      tokens.push(token);
      continue;
    }
    if (token.kind === 'math') {
      const rendered = options.renderedMath[mathIndex++];
      if (rendered === undefined)
        throw new Error('Validated math payload unexpectedly disappeared.');
      const scaled = scaleMathPayloadForTypography(rendered, options.typography.fontSize);
      tokens.push({ ...token, rendered, ...scaled });
      continue;
    }
    const fontResolution = resolveFont(options, token.marks);
    const native = await options.measureText({
      text: token.text,
      typography: options.typography,
      ...(token.marks === undefined ? {} : { marks: token.marks }),
      ...(fontResolution === undefined ? {} : { fontResolution }),
    });
    const tokenCalibration = options.baselineCalibrationProvider
      ? await options.baselineCalibrationProvider(options.typography, fontResolution)
      : calibration;
    const calibrated = calibrateProseMetrics(native, options.typography, tokenCalibration);
    // Figma can report zero ink width for terminal ordinary spaces. For U+0020
    // only, use a host probe that preserves its advance. The probe is per-space
    // and replaces (rather than adds to) the native separator width, so letter
    // spacing is applied once. Tabs/other breakable whitespace retain native
    // measurement; NBSP is prose content and never reaches this branch.
    const ordinarySpaces =
      token.kind === 'separator'
        ? [...token.text].filter((character) => character === ' ').length
        : 0;
    const separatorAdvance =
      ordinarySpaces && options.measureSeparatorAdvance
        ? await options.measureSeparatorAdvance({
            text: token.text,
            typography: options.typography,
            ...(token.marks === undefined ? {} : { marks: token.marks }),
            ...(fontResolution === undefined ? {} : { fontResolution }),
          })
        : undefined;
    const width =
      separatorAdvance === undefined
        ? calibrated.width
        : Math.max(calibrated.width, ordinarySpaces * separatorAdvance);
    tokens.push({
      ...token,
      metrics: { ...calibrated, width },
      baselineCalibration: tokenCalibration,
      ...(fontResolution === undefined ? {} : { fontResolution }),
    });
  }
  return { paragraph, tokens };
}

/** Asynchronously measures prose only through the injected native callback. */
export async function measureDocument(
  document: MathTextDocument,
  options: MeasureDocumentOptions,
): Promise<MeasuredDocument> {
  validateRenderedMathPayloads(document, options.renderedMath);
  let offset = 0;
  const blocks: MeasuredDocumentBlock[] = [];
  const paragraphs: MeasuredParagraph[] = [];
  const displayMath: DisplayMathPlan[] = [];
  for (const node of document) {
    if (node.type === 'paragraph') {
      const count = node.children.filter((child) => child.type === 'math').length;
      const measured = await measureParagraph(node, {
        ...options,
        renderedMath: options.renderedMath.slice(offset, offset + count),
      });
      paragraphs.push(measured);
      blocks.push({ type: 'paragraph', measured });
      offset += count;
      continue;
    }
    const rendered = options.renderedMath[offset++];
    if (rendered === undefined)
      throw new Error('Validated display math payload unexpectedly disappeared.');
    const scaled = scaleMathPayloadForTypography(rendered, options.typography.fontSize);
    const plan: DisplayMathPlan = { type: 'display-math', latex: node.latex, rendered, ...scaled };
    displayMath.push(plan);
    blocks.push(plan);
  }
  return { blocks, paragraphs, displayMath };
}

const resolveFont = (
  options: MeasureParagraphOptions,
  marks: readonly TextMark[] | undefined,
): FontResolution | undefined => options.fontResolver?.(marks, options.typography);

const expectedMath = (
  document: readonly (MathTextDocument[number] | ParagraphNode)[],
): ExpectedMath[] => {
  const found: ExpectedMath[] = [];
  for (const node of document) {
    if (node.type === 'display-math') found.push({ latex: node.latex, display: true });
    if (node.type === 'paragraph') {
      for (const child of node.children) {
        if (child.type === 'math') found.push({ latex: child.latex, display: false });
      }
    }
  }
  return found;
};

const validateExpectedPayloads = (
  expected: readonly ExpectedMath[],
  payloads: readonly RenderedMathPayload[],
): void => {
  // A small synthetic document avoids changing the public standalone API.
  if (expected.length !== payloads.length) {
    throw new MathPayloadValidationError(
      expected.length > payloads.length ? 'MISSING' : 'EXTRA',
      expected.length > payloads.length
        ? 'Missing rendered math payload.'
        : 'Received extra rendered math payload.',
    );
  }
  expected.forEach((wanted, index) => {
    const actual = payloads[index];
    if (
      actual === undefined ||
      actual.latex !== wanted.latex ||
      actual.display !== wanted.display
    ) {
      throw new MathPayloadValidationError(
        'MISMATCH',
        'Rendered math payload does not match AST latex/display identity.',
        index,
      );
    }
    validateMathMetrics(actual, index);
  });
};

const validateMathMetrics = (payload: RenderedMathPayload, occurrence?: number): void => {
  const m = payload.metrics;
  if (
    ![m.width, m.height, m.ascent, m.descent, m.baseline].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    Math.abs(m.height - (m.ascent + m.descent)) > 1e-6 * Math.max(1, m.height) ||
    m.baseline !== m.ascent
  ) {
    throw new MathPayloadValidationError(
      'INVALID_METRICS',
      'Rendered math metrics are inconsistent.',
      occurrence,
    );
  }
};

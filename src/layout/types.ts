import type { InlineRun, ParagraphNode, TextMark } from '../shared/document-model';
import type { RenderedMathPayload, TypographyContext } from '../shared/types';

/** A native-text metric callback. It is deliberately independent of Figma. */
export interface NativeTextMeasurementRequest {
  readonly text: string;
  readonly typography: TypographyContext;
  readonly marks?: readonly TextMark[];
  /** Optional effective-font information produced by the host, never guessed here. */
  readonly fontResolution?: FontResolution;
}

export interface NativeTextMetrics {
  readonly width: number;
  readonly height: number;
}

export type NativeTextMeasurer = (
  request: NativeTextMeasurementRequest,
) => Promise<NativeTextMetrics>;

/** Matches PR 4's resolved-font input while avoiding a dependency on Figma modules. */
export interface FontResolution {
  readonly fontName: { readonly family: string; readonly style: string };
  readonly marks?: readonly string[];
  /** Stable host identifier, useful if one resolver has several equivalent fonts. */
  readonly key?: string;
}

export type FontResolver = (
  marks: readonly TextMark[] | undefined,
  typography: TypographyContext,
) => FontResolution | undefined;

export interface ProseBaselineCalibration {
  /** Fraction of an em assigned above the baseline before leading is distributed. */
  readonly emAscentRatio: number;
}

export interface LayoutMetrics {
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
}

export interface ProseToken {
  readonly kind: 'prose';
  readonly text: string;
  readonly marks?: readonly TextMark[];
  readonly sourceRunIndex: number;
}

/** A breakable run of ordinary whitespace. It is never emitted at a line edge. */
export interface SeparatorToken {
  readonly kind: 'separator';
  readonly text: string;
  readonly marks?: readonly TextMark[];
  readonly sourceRunIndex: number;
}

export interface MathToken {
  readonly kind: 'math';
  readonly latex: string;
  readonly display: false;
  readonly sourceRunIndex: number;
}

export interface HardBreakToken {
  readonly kind: 'hard-break';
  readonly sourceRunIndex: number;
}

export type InlineToken = ProseToken | SeparatorToken | MathToken | HardBreakToken;

export interface MeasuredProseToken extends ProseToken {
  readonly metrics: LayoutMetrics;
  readonly fontResolution?: FontResolution;
}

export interface MeasuredSeparatorToken extends SeparatorToken {
  readonly metrics: LayoutMetrics;
  readonly fontResolution?: FontResolution;
}

export interface MeasuredMathToken extends MathToken {
  readonly metrics: LayoutMetrics;
  readonly rendered: RenderedMathPayload;
  /** Multiply the already mathScale-sized SVG by this value when importing it. */
  readonly svgScale: number;
}

export type MeasuredInlineToken =
  MeasuredProseToken | MeasuredSeparatorToken | MeasuredMathToken | HardBreakToken;

export interface MeasuredParagraph {
  readonly paragraph: ParagraphNode;
  readonly tokens: readonly MeasuredInlineToken[];
}

export interface ProseLineChild {
  readonly type: 'prose';
  readonly text: string;
  readonly marks?: readonly TextMark[];
  readonly fontResolution?: FontResolution;
  readonly x: number;
  readonly y: number;
  readonly metrics: LayoutMetrics;
  /** The measured fragments used to make this merged renderer segment. */
  readonly measuredParts: readonly string[];
}

export interface MathLineChild {
  readonly type: 'math';
  readonly latex: string;
  readonly rendered: RenderedMathPayload;
  readonly svgScale: number;
  readonly x: number;
  readonly y: number;
  readonly metrics: LayoutMetrics;
}

export type LineChild = ProseLineChild | MathLineChild;

export interface LinePlan {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
  readonly baseline: number;
  readonly children: readonly LineChild[];
  /** True when emitted by a CommonMark hard break, including an empty line. */
  readonly forced: boolean;
}

export interface ParagraphPlan {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly LinePlan[];
}

export interface DisplayMathPlan {
  readonly type: 'display-math';
  readonly latex: string;
  readonly rendered: RenderedMathPayload;
  readonly metrics: LayoutMetrics;
  readonly svgScale: number;
}

/** A paragraph block retains its measured token plan in document source order. */
export interface MeasuredParagraphBlock {
  readonly type: 'paragraph';
  readonly measured: MeasuredParagraph;
}

/** Ordered document blocks for renderer traversal; convenience arrays are secondary. */
export type MeasuredDocumentBlock = MeasuredParagraphBlock | DisplayMathPlan;

export interface MeasuredDocument {
  /** Every block in application-AST order, including interleaved display math. */
  readonly blocks: readonly MeasuredDocumentBlock[];
  /** Convenience filtered view of paragraph blocks. */
  readonly paragraphs: readonly MeasuredParagraph[];
  /** Convenience filtered view of display-math blocks. */
  readonly displayMath: readonly DisplayMathPlan[];
}

export interface MeasureParagraphOptions {
  readonly typography: TypographyContext;
  readonly measureText: NativeTextMeasurer;
  readonly renderedMath: readonly RenderedMathPayload[];
  readonly fontResolver?: FontResolver;
  readonly baselineCalibration?: ProseBaselineCalibration;
}

export interface ComposeParagraphOptions {
  readonly width: number;
  readonly emptyLineMetrics: LayoutMetrics;
  /** Width comparisons accept this small absolute amount to avoid float noise. */
  readonly tolerance?: number;
}

export interface MeasureDocumentOptions {
  readonly typography: TypographyContext;
  readonly measureText: NativeTextMeasurer;
  readonly renderedMath: readonly RenderedMathPayload[];
  readonly fontResolver?: FontResolver;
  readonly baselineCalibration?: ProseBaselineCalibration;
}

export type SourceInlineRun = InlineRun;

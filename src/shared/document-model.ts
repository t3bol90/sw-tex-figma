export type TextMark = 'bold' | 'italic';

export interface TextRun {
  readonly type: 'text';
  readonly value: string;
  readonly marks?: readonly TextMark[];
}

/** A hard Markdown break (`\\` or two trailing spaces) inside a paragraph. */
export interface LineBreakRun {
  readonly type: 'break';
}

export interface MathRun {
  readonly type: 'math';
  readonly latex: string;
  readonly display: false;
}

export interface ParagraphNode {
  readonly type: 'paragraph';
  readonly children: readonly InlineRun[];
}

export interface DisplayMathNode {
  readonly type: 'display-math';
  readonly latex: string;
}

export type InlineRun = TextRun | LineBreakRun | MathRun;
export type DocumentNode = ParagraphNode | DisplayMathNode;
export type MathTextDocument = readonly DocumentNode[];

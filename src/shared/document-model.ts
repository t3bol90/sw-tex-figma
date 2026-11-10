/** `code` selects a monospace face for inline code and code blocks. */
export type TextMark = 'bold' | 'italic' | 'code';

export interface TextRun {
  readonly type: 'text';
  readonly value: string;
  readonly marks?: readonly TextMark[];
  /** Absolute `http:`, `https:`, or `mailto:` target of a Markdown link. */
  readonly link?: string;
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

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * One enclosing list item or block quote, outermost first. Nested containers
 * are flattened into blocks in source order; each block records its full
 * container path so the renderer can indent it and draw markers and bars.
 */
export type BlockContainer = ListItemContainer | QuoteContainer;

export interface ListItemContainer {
  readonly kind: 'list-item';
  /** Present only on the first block of the item, for example `•` or `3.`. */
  readonly marker?: string;
}

export interface QuoteContainer {
  readonly kind: 'quote';
  /** Distinguishes adjacent block quotes; unique within one parsed document. */
  readonly id: number;
}

export interface ParagraphNode {
  readonly type: 'paragraph';
  readonly children: readonly InlineRun[];
  /** ATX or setext heading level. Heading text is bold and scaled. */
  readonly heading?: HeadingLevel;
  /** A fenced or indented code block: monospace runs with preserved spaces. */
  readonly code?: true;
  readonly containers?: readonly BlockContainer[];
}

export interface DisplayMathNode {
  readonly type: 'display-math';
  readonly latex: string;
  readonly containers?: readonly BlockContainer[];
}

/** A Markdown thematic break (`---`, `***`, `___`). */
export interface RuleNode {
  readonly type: 'rule';
  readonly containers?: readonly BlockContainer[];
}

export type InlineRun = TextRun | LineBreakRun | MathRun;
export type DocumentNode = ParagraphNode | DisplayMathNode | RuleNode;
export type MathTextDocument = readonly DocumentNode[];

import type {
  DocumentNode,
  InlineRun,
  MathTextDocument,
  ParagraphNode,
  TextMark,
  TextRun,
} from '../shared/document-model';
import { MarkdownParserError, type MarkdownSourcePosition } from './errors';
import { canonicalizeMarks, haveEqualMarks, withMark } from './marks';

interface MdastPoint {
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
}

interface MdastNode {
  readonly type: string;
  readonly position?: { readonly start: MdastPoint; readonly end: MdastPoint };
}

interface MdastRoot extends MdastNode {
  readonly type: 'root';
  readonly children: readonly MdastBlockNode[];
}

interface MdastParagraph extends MdastNode {
  readonly type: 'paragraph';
  readonly children: readonly MdastInlineNode[];
}

interface MdastMath extends MdastNode {
  readonly type: 'math';
  readonly value: string;
}

interface MdastText extends MdastNode {
  readonly type: 'text';
  readonly value: string;
}

interface MdastInlineMath extends MdastNode {
  readonly type: 'inlineMath';
  readonly value: string;
}

interface MdastBreak extends MdastNode {
  readonly type: 'break';
}

interface MdastStrong extends MdastNode {
  readonly type: 'strong';
  readonly children: readonly MdastInlineNode[];
}

interface MdastEmphasis extends MdastNode {
  readonly type: 'emphasis';
  readonly children: readonly MdastInlineNode[];
}

interface MdastUnsupportedNode extends MdastNode {
  readonly type: string;
}

type MdastBlockNode = MdastParagraph | MdastMath | MdastUnsupportedNode;
type MdastInlineNode =
  MdastText | MdastInlineMath | MdastBreak | MdastStrong | MdastEmphasis | MdastUnsupportedNode;

/**
 * Converts an mdast root into the small renderer-independent document model.
 *
 * A soft line ending in ordinary paragraph text is normalized to one U+0020
 * space. A CommonMark hard break stays a distinct `break` run, so it cannot be
 * merged with text on either side.
 */
export const mdastToDocument = (root: MdastRoot, source?: string): MathTextDocument =>
  root.children.map((node) => convertBlock(node, source));

const convertBlock = (node: MdastBlockNode, source: string | undefined): DocumentNode => {
  switch (node.type) {
    case 'paragraph': {
      const children = (node as MdastParagraph).children;
      const oneLineDisplayMath = standaloneDoubleDollarMath(children, source);
      return oneLineDisplayMath === undefined
        ? convertParagraph(children)
        : { type: 'display-math', latex: oneLineDisplayMath.value };
    }
    case 'math':
      return { type: 'display-math', latex: (node as MdastMath).value };
    default:
      throw unsupportedNode('UNSUPPORTED_BLOCK_NODE', node);
  }
};

/**
 * remark-math represents a one-line, otherwise empty `$$...$$` line as
 * inlineMath. Treat that unambiguous standalone form as display math too.
 */
const standaloneDoubleDollarMath = (
  children: readonly MdastInlineNode[],
  source: string | undefined,
): MdastInlineMath | undefined => {
  if (source === undefined || children.length !== 1 || children[0]?.type !== 'inlineMath') {
    return undefined;
  }

  const node = children[0] as MdastInlineMath;
  const position = node.position;
  if (position?.start.offset === undefined || position.end.offset === undefined) return undefined;

  const raw = source.slice(position.start.offset, position.end.offset);
  return /^\$\$[^\r\n]*\$\$$/.test(raw) ? node : undefined;
};

const convertParagraph = (children: readonly MdastInlineNode[]): ParagraphNode => {
  const runs: InlineRun[] = [];

  for (const child of children) {
    appendInline(child, [], runs);
  }

  return { type: 'paragraph', children: runs };
};

const appendInline = (
  node: MdastInlineNode,
  marks: readonly TextMark[],
  runs: InlineRun[],
): void => {
  switch (node.type) {
    case 'text':
      appendText(runs, (node as MdastText).value, marks);
      return;
    case 'inlineMath':
      appendMath(runs, (node as MdastInlineMath).value);
      return;
    case 'break':
      runs.push({ type: 'break' });
      return;
    case 'strong':
      for (const child of (node as MdastStrong).children) {
        appendInline(child, withMark(marks, 'bold'), runs);
      }
      return;
    case 'emphasis':
      for (const child of (node as MdastEmphasis).children) {
        appendInline(child, withMark(marks, 'italic'), runs);
      }
      return;
    default:
      throw unsupportedNode('UNSUPPORTED_INLINE_NODE', node);
  }
};

const appendText = (runs: InlineRun[], sourceValue: string, marks: readonly TextMark[]): void => {
  const value = sourceValue.replace(/\r\n?|\n/g, ' ');
  if (value.length === 0) return;

  const canonicalMarks = canonicalizeMarks(marks);
  const previous = runs.at(-1);
  if (previous?.type === 'text' && haveEqualMarks(previous.marks, canonicalMarks)) {
    const merged: TextRun = {
      type: 'text',
      value: previous.value + value,
      ...(canonicalMarks === undefined ? {} : { marks: canonicalMarks }),
    };
    runs[runs.length - 1] = merged;
    return;
  }

  runs.push({
    type: 'text',
    value,
    ...(canonicalMarks === undefined ? {} : { marks: canonicalMarks }),
  });
};

const appendMath = (runs: InlineRun[], latex: string): void => {
  runs.push({ type: 'math', latex, display: false });
};

const unsupportedNode = (code: MarkdownParserError['code'], node: MdastNode): MarkdownParserError =>
  new MarkdownParserError(code, node.type, copyPosition(node.position));

const copyPosition = (position: MdastNode['position']): MarkdownSourcePosition | undefined => {
  if (position === undefined) return undefined;

  return {
    start: copyPoint(position.start),
    end: copyPoint(position.end),
  };
};

const copyPoint = (point: MdastPoint): MarkdownSourcePosition['start'] => ({
  line: point.line,
  column: point.column,
  ...(point.offset === undefined ? {} : { offset: point.offset }),
});

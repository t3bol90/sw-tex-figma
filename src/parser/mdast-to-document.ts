import type {
  BlockContainer,
  DocumentNode,
  HeadingLevel,
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

interface MdastParent extends MdastNode {
  readonly children: readonly MdastNode[];
}

interface MdastRoot extends MdastNode {
  readonly type: 'root';
  readonly children: readonly MdastNode[];
}

interface MdastLiteral extends MdastNode {
  readonly value: string;
}

interface MdastHeading extends MdastParent {
  readonly type: 'heading';
  readonly depth: HeadingLevel;
}

interface MdastList extends MdastParent {
  readonly type: 'list';
  readonly ordered?: boolean | null;
  readonly start?: number | null;
}

interface MdastLink extends MdastParent {
  readonly type: 'link';
  readonly url: string;
}

interface MdastLinkReference extends MdastParent {
  readonly type: 'linkReference';
  readonly identifier: string;
}

interface MdastDefinition extends MdastNode {
  readonly type: 'definition';
  readonly identifier: string;
  readonly url: string;
}

/** Per-document conversion state. */
interface ConversionContext {
  readonly source: string | undefined;
  readonly definitions: ReadonlyMap<string, string>;
  nextQuoteId: number;
}

/** Inline state inherited by nested emphasis, strong, and link nodes. */
interface InlineStyle {
  readonly marks: readonly TextMark[];
  readonly link?: string;
}

/** Unordered markers cycle by list nesting depth, as in common Markdown renderers. */
const BULLET_MARKERS = ['•', '◦', '▪'] as const;

/** Only these link targets become Figma hyperlinks; other links keep their text only. */
const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

const CODE_TAB_SIZE = 4;

/**
 * Converts an mdast root into the small renderer-independent document model.
 *
 * A soft line ending in ordinary paragraph text is normalized to one U+0020
 * space. A CommonMark hard break stays a distinct `break` run, so it cannot be
 * merged with text on either side. List items and block quotes are flattened:
 * every block records its enclosing containers, outermost first.
 */
export const mdastToDocument = (root: MdastRoot, source?: string): MathTextDocument => {
  const definitions = new Map<string, string>();
  collectDefinitions(root, definitions);
  return convertBlocks(root.children, { source, definitions, nextQuoteId: 1 }, []);
};

const collectDefinitions = (node: MdastNode, definitions: Map<string, string>): void => {
  if (node.type === 'definition') {
    const definition = node as MdastDefinition;
    // CommonMark: the first definition of a normalized label wins.
    if (!definitions.has(definition.identifier))
      definitions.set(definition.identifier, definition.url);
    return;
  }
  for (const child of (node as Partial<MdastParent>).children ?? [])
    collectDefinitions(child, definitions);
};

const convertBlocks = (
  nodes: readonly MdastNode[],
  context: ConversionContext,
  containers: readonly BlockContainer[],
): DocumentNode[] => nodes.flatMap((node) => convertBlock(node, context, containers));

const convertBlock = (
  node: MdastNode,
  context: ConversionContext,
  containers: readonly BlockContainer[],
): DocumentNode[] => {
  switch (node.type) {
    case 'paragraph': {
      const children = (node as MdastParent).children;
      const oneLineDisplayMath = standaloneDoubleDollarMath(children, context.source);
      return [
        within(
          oneLineDisplayMath === undefined
            ? convertParagraph(children, { marks: [] }, context)
            : { type: 'display-math', latex: oneLineDisplayMath.value },
          containers,
        ),
      ];
    }
    case 'math':
      return [within({ type: 'display-math', latex: (node as MdastLiteral).value }, containers)];
    case 'heading': {
      const heading = node as MdastHeading;
      return [
        within(
          {
            ...convertParagraph(heading.children, { marks: ['bold'] }, context),
            heading: heading.depth,
          },
          containers,
        ),
      ];
    }
    case 'code':
      return [within(convertCodeBlock((node as MdastLiteral).value), containers)];
    case 'thematicBreak':
      return [within({ type: 'rule' }, containers)];
    case 'list':
      return convertList(node as MdastList, context, containers);
    case 'blockquote': {
      const quote: BlockContainer = { kind: 'quote', id: context.nextQuoteId++ };
      const blocks = convertBlocks((node as MdastParent).children, context, [...containers, quote]);
      // An empty quote (`>` alone) still draws its bar beside an empty line.
      return blocks.length > 0
        ? blocks
        : [{ type: 'paragraph', children: [], containers: [...containers, quote] }];
    }
    case 'definition':
      // Definitions only supply targets for reference links; they render nothing.
      return [];
    default:
      throw unsupportedNode('UNSUPPORTED_BLOCK_NODE', node);
  }
};

const convertList = (
  list: MdastList,
  context: ConversionContext,
  containers: readonly BlockContainer[],
): DocumentNode[] => {
  const depth = containers.filter((container) => container.kind === 'list-item').length + 1;
  return list.children.flatMap((item, index) => {
    if (item.type !== 'listItem') throw unsupportedNode('UNSUPPORTED_BLOCK_NODE', item);
    const marker = list.ordered
      ? `${(list.start ?? 1) + index}.`
      : BULLET_MARKERS[(depth - 1) % BULLET_MARKERS.length]!;
    const own = containers.length;
    const blocks = convertBlocks((item as MdastParent).children, context, [
      ...containers,
      { kind: 'list-item' },
    ]);
    // An empty item (`-` alone) still renders its marker beside an empty line.
    const first: DocumentNode = blocks[0] ?? {
      type: 'paragraph',
      children: [],
      containers: [...containers, { kind: 'list-item' }],
    };
    // The item marker belongs to the first block, even when that block is in a
    // nested list or quote: `- - x` shows both markers on one line.
    const path = [...(first.containers ?? [])];
    path[own] = { kind: 'list-item', marker };
    return [{ ...first, containers: path }, ...blocks.slice(1)];
  });
};

const within = <T extends DocumentNode>(node: T, containers: readonly BlockContainer[]): T =>
  containers.length === 0 ? node : { ...node, containers };

/**
 * A code block keeps its exact lines. Spaces become no-break spaces, which the
 * layout treats as content, so indentation survives and lines never soft-wrap.
 */
const convertCodeBlock = (value: string): ParagraphNode => {
  const children: InlineRun[] = [];
  value.split(/\r\n?|\n/).forEach((line, index) => {
    if (index > 0) children.push({ type: 'break' });
    const text = preserveCodeWhitespace(line);
    if (text.length > 0) children.push({ type: 'text', value: text, marks: ['code'] });
  });
  return { type: 'paragraph', children, code: true };
};

const preserveCodeWhitespace = (line: string): string => {
  let column = 0;
  let result = '';
  for (const character of line) {
    if (character === '\t') {
      const width = CODE_TAB_SIZE - (column % CODE_TAB_SIZE);
      result += ' '.repeat(width);
      column += width;
    } else {
      result += character === ' ' ? ' ' : character;
      column += 1;
    }
  }
  return result;
};

/**
 * remark-math represents a one-line, otherwise empty `$$...$$` line as
 * inlineMath. Treat that unambiguous standalone form as display math too.
 */
const standaloneDoubleDollarMath = (
  children: readonly MdastNode[],
  source: string | undefined,
): MdastLiteral | undefined => {
  if (source === undefined || children.length !== 1 || children[0]?.type !== 'inlineMath') {
    return undefined;
  }

  const node = children[0] as MdastLiteral;
  const position = node.position;
  if (position?.start.offset === undefined || position.end.offset === undefined) return undefined;

  const raw = source.slice(position.start.offset, position.end.offset);
  return /^\$\$[^\r\n]*\$\$$/.test(raw) ? node : undefined;
};

const convertParagraph = (
  children: readonly MdastNode[],
  style: InlineStyle,
  context: ConversionContext,
): ParagraphNode => {
  const runs: InlineRun[] = [];

  for (const child of children) {
    appendInline(child, style, runs, context);
  }

  return { type: 'paragraph', children: runs };
};

const appendInline = (
  node: MdastNode,
  style: InlineStyle,
  runs: InlineRun[],
  context: ConversionContext,
): void => {
  const appendChildren = (next: InlineStyle): void => {
    for (const child of (node as MdastParent).children) appendInline(child, next, runs, context);
  };
  switch (node.type) {
    case 'text':
      appendText(runs, (node as MdastLiteral).value, style);
      return;
    case 'inlineCode':
      appendText(runs, (node as MdastLiteral).value, {
        ...style,
        marks: withMark(style.marks, 'code'),
      });
      return;
    case 'inlineMath':
      appendMath(runs, (node as MdastLiteral).value);
      return;
    case 'break':
      runs.push({ type: 'break' });
      return;
    case 'strong':
      appendChildren({ ...style, marks: withMark(style.marks, 'bold') });
      return;
    case 'emphasis':
      appendChildren({ ...style, marks: withMark(style.marks, 'italic') });
      return;
    case 'link':
      appendChildren(linked(style, (node as MdastLink).url));
      return;
    case 'linkReference':
      appendChildren(
        linked(style, context.definitions.get((node as MdastLinkReference).identifier)),
      );
      return;
    default:
      throw unsupportedNode('UNSUPPORTED_INLINE_NODE', node);
  }
};

const linked = (style: InlineStyle, url: string | undefined): InlineStyle => {
  const { marks } = style;
  return url !== undefined && SAFE_LINK.test(url) ? { marks, link: url } : { marks };
};

const appendText = (runs: InlineRun[], sourceValue: string, style: InlineStyle): void => {
  const value = sourceValue.replace(/\r\n?|\n/g, ' ');
  if (value.length === 0) return;

  const canonicalMarks = canonicalizeMarks(style.marks);
  const previous = runs.at(-1);
  if (
    previous?.type === 'text' &&
    haveEqualMarks(previous.marks, canonicalMarks) &&
    previous.link === style.link
  ) {
    runs[runs.length - 1] = textRun(previous.value + value, canonicalMarks, style.link);
    return;
  }

  runs.push(textRun(value, canonicalMarks, style.link));
};

const textRun = (
  value: string,
  marks: readonly TextMark[] | undefined,
  link: string | undefined,
): TextRun => ({
  type: 'text',
  value,
  ...(marks === undefined ? {} : { marks }),
  ...(link === undefined ? {} : { link }),
});

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

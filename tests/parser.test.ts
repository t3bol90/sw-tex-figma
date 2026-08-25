import { describe, expect, it } from 'vitest';

import type { MathTextDocument } from '../src/shared/document-model';
import { MarkdownParserError, mdastToDocument, parseMarkdown } from '../src/parser';

const document = (children: MathTextDocument): MathTextDocument => children;

describe('parseMarkdown', () => {
  it('converts the architecture mixed prose example into renderer-independent runs', () => {
    expect(parseMarkdown(String.raw`The value $\alpha + \beta$ is **important**.`)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'The value ' },
            { type: 'math', latex: String.raw`\alpha + \beta`, display: false },
            { type: 'text', value: ' is ' },
            { type: 'text', value: 'important', marks: ['bold'] },
            { type: 'text', value: '.' },
          ],
        },
      ]),
    );
  });

  it('keeps every contiguous inline expression as one atomic math run', () => {
    expect(parseMarkdown(String.raw`The result is $y = \alpha x^2 + \beta$.`)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'The result is ' },
            { type: 'math', latex: String.raw`y = \alpha x^2 + \beta`, display: false },
            { type: 'text', value: '.' },
          ],
        },
      ]),
    );
  });

  it('converts display math into a separate block between paragraphs', () => {
    expect(
      parseMarkdown(String.raw`The loss is

$$
L = \frac{1}{N}\sum_{i=1}^{N}(y_i-\hat y_i)^2
$$

and is minimized.`),
    ).toEqual(
      document([
        { type: 'paragraph', children: [{ type: 'text', value: 'The loss is' }] },
        {
          type: 'display-math',
          latex: String.raw`L = \frac{1}{N}\sum_{i=1}^{N}(y_i-\hat y_i)^2`,
        },
        { type: 'paragraph', children: [{ type: 'text', value: 'and is minimized.' }] },
      ]),
    );
  });

  it('also recognizes a standalone one-line $$...$$ expression as display math', () => {
    expect(parseMarkdown('$$x^2$$')).toEqual(document([{ type: 'display-math', latex: 'x^2' }]));
  });

  it('keeps escaped delimiters as prose while parsing unescaped math delimiters', () => {
    expect(parseMarkdown(String.raw`Cost: \$5; math: $x$.`)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Cost: $5; math: ' },
            { type: 'math', latex: 'x', display: false },
            { type: 'text', value: '.' },
          ],
        },
      ]),
    );
    expect(parseMarkdown(String.raw`\*literal\* and \$not math$`)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [{ type: 'text', value: '*literal* and $not math$' }],
        },
      ]),
    );
  });

  it('maps bold, italic, and nested marks to canonical ordered marks', () => {
    expect(parseMarkdown('**bold** *italic* ***both***')).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'bold', marks: ['bold'] },
            { type: 'text', value: ' ' },
            { type: 'text', value: 'italic', marks: ['italic'] },
            { type: 'text', value: ' ' },
            { type: 'text', value: 'both', marks: ['bold', 'italic'] },
          ],
        },
      ]),
    );
  });

  it('defines soft paragraph line endings as one space', () => {
    expect(parseMarkdown('first\r\nsecond\nthird')).toEqual(
      document([
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'first second third' }],
        },
      ]),
    );
  });

  it('preserves backslash and two-space Markdown hard breaks as distinct runs', () => {
    expect(parseMarkdown('first\\\nsecond  \nthird')).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'first' },
            { type: 'break' },
            { type: 'text', value: 'second' },
            { type: 'break' },
            { type: 'text', value: 'third' },
          ],
        },
      ]),
    );
  });

  it('normalizes only adjacent text with equal canonical marks and never across hard breaks', () => {
    const root = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: '' },
            { type: 'text', value: 'plain ' },
            { type: 'text', value: 'text' },
            { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
            { type: 'strong', children: [{ type: 'text', value: ' text' }] },
            {
              type: 'strong',
              children: [{ type: 'emphasis', children: [{ type: 'text', value: 'both' }] }],
            },
            {
              type: 'emphasis',
              children: [{ type: 'strong', children: [{ type: 'text', value: ' marks' }] }],
            },
            { type: 'break' },
            { type: 'text', value: 'after' },
            { type: 'text', value: ' break' },
          ],
        },
      ],
    } as const;

    expect(mdastToDocument(root)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'plain text' },
            { type: 'text', value: 'bold text', marks: ['bold'] },
            { type: 'text', value: 'both marks', marks: ['bold', 'italic'] },
            { type: 'break' },
            { type: 'text', value: 'after break' },
          ],
        },
      ]),
    );
  });

  it('returns an empty document for empty or whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual(document([]));
    expect(parseMarkdown('\n \n')).toEqual(document([]));
  });

  it('throws structured errors for unsupported block and inline nodes with positions', () => {
    expectParserError('# Unsupported', 'UNSUPPORTED_BLOCK_NODE', 'heading', { line: 1, column: 1 });
    expectParserError(
      '[Unsupported link](https://example.com)',
      'UNSUPPORTED_INLINE_NODE',
      'link',
      {
        line: 1,
        column: 1,
      },
    );
  });

  it('keeps malformed but recoverable Markdown as prose rather than discarding it', () => {
    expect(parseMarkdown('The $x and **bold')).toEqual(
      document([
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'The $x and **bold' }],
        },
      ]),
    );
  });
});

const expectParserError = (
  source: string,
  code: MarkdownParserError['code'],
  nodeType: string,
  start: { readonly line: number; readonly column: number },
): void => {
  try {
    parseMarkdown(source);
    throw new Error('Expected parseMarkdown to throw.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(MarkdownParserError);
    expect(error).toMatchObject({ code, nodeType, position: { start } });
  }
};

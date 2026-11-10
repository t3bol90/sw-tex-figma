import { describe, expect, it } from 'vitest';

import type { MathTextDocument, TextMark } from '../src/shared/document-model';
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

  it('decodes named character entities with the worker-safe parser dependency export', () => {
    expect(parseMarkdown('A &copy; B &amp; C')).toEqual(
      document([{ type: 'paragraph', children: [{ type: 'text', value: 'A © B & C' }] }]),
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
    expectParserError('<div>html</div>', 'UNSUPPORTED_BLOCK_NODE', 'html', {
      line: 1,
      column: 1,
    });
    expectParserError('- > <div>nested html</div>', 'UNSUPPORTED_BLOCK_NODE', 'html', {
      line: 1,
      column: 5,
    });
    expectParserError(
      'An ![image](https://example.com/i.png)',
      'UNSUPPORTED_INLINE_NODE',
      'image',
      {
        line: 1,
        column: 4,
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

describe('parseMarkdown block structure', () => {
  const bullet = '•';
  const item = (marker?: string) =>
    marker === undefined ? { kind: 'list-item' as const } : { kind: 'list-item' as const, marker };
  const quote = (id: number) => ({ kind: 'quote' as const, id });
  const text = (value: string, marks?: TextMark[]) => ({
    type: 'text' as const,
    value,
    ...(marks === undefined ? {} : { marks }),
  });

  it('converts ATX and setext headings into bold paragraphs that keep inline math', () => {
    expect(parseMarkdown('### Online regression interpretation')).toEqual(
      document([
        {
          type: 'paragraph',
          heading: 3,
          children: [text('Online regression interpretation', ['bold'])],
        },
      ]),
    );
    expect(parseMarkdown('# A *b* $x$')).toEqual(
      document([
        {
          type: 'paragraph',
          heading: 1,
          children: [
            text('A ', ['bold']),
            text('b', ['bold', 'italic']),
            text(' ', ['bold']),
            { type: 'math', latex: 'x', display: false },
          ],
        },
      ]),
    );
    expect(parseMarkdown('Title\n=====')).toEqual(
      document([{ type: 'paragraph', heading: 1, children: [text('Title', ['bold'])] }]),
    );
  });

  it('parses a heading followed by prose and display math', () => {
    const source = [
      '### Online regression interpretation',
      '',
      'Define the current key-value regression loss',
      '',
      '$$',
      String.raw`\ell_t(S)=\frac12\|Sk_t-v_t\|_2^2.`,
      '$$',
    ].join('\n');
    expect(
      parseMarkdown(source).map((node) => [
        node.type,
        'heading' in node ? node.heading : undefined,
      ]),
    ).toEqual([
      ['paragraph', 3],
      ['paragraph', undefined],
      ['display-math', undefined],
    ]);
  });

  it('converts bullet list items with leading inline math into marked list paragraphs', () => {
    const source = [
      'Allowing endpoint values gives useful special cases:',
      '',
      String.raw`- $\alpha_t=1$: the ordinary DeltaNet update.`,
      String.raw`- $\beta_t=0$: pure memory decay.`,
    ].join('\n');
    expect(parseMarkdown(source)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [text('Allowing endpoint values gives useful special cases:')],
        },
        {
          type: 'paragraph',
          containers: [item(bullet)],
          children: [
            { type: 'math', latex: String.raw`\alpha_t=1`, display: false },
            text(': the ordinary DeltaNet update.'),
          ],
        },
        {
          type: 'paragraph',
          containers: [item(bullet)],
          children: [
            { type: 'math', latex: String.raw`\beta_t=0`, display: false },
            text(': pure memory decay.'),
          ],
        },
      ]),
    );
  });

  it('numbers ordered lists from their start and flattens nested items in source order', () => {
    const source = [
      '3. one',
      '   - nested',
      '     * deeper',
      '   continued',
      '',
      '   $$x$$',
      '4.',
    ].join('\n');
    expect(parseMarkdown(source)).toEqual(
      document([
        { type: 'paragraph', containers: [item('3.')], children: [text('one')] },
        {
          type: 'paragraph',
          containers: [item(), item('◦')],
          children: [text('nested')],
        },
        {
          type: 'paragraph',
          containers: [item(), item(), item('▪')],
          children: [text('deeper continued')],
        },
        { type: 'display-math', latex: 'x', containers: [item()] },
        { type: 'paragraph', containers: [item('4.')], children: [] },
      ]),
    );
  });

  it('puts every marker on the first line when an item starts with a nested list', () => {
    expect(parseMarkdown('- - inner')).toEqual(
      document([
        {
          type: 'paragraph',
          containers: [item(bullet), item('◦')],
          children: [text('inner')],
        },
      ]),
    );
  });

  it('flattens block quotes, including quotes in lists and lists in quotes', () => {
    expect(parseMarkdown('> quoted\n>\n> - item\n\n> second')).toEqual(
      document([
        { type: 'paragraph', containers: [quote(1)], children: [text('quoted')] },
        {
          type: 'paragraph',
          containers: [quote(1), item(bullet)],
          children: [text('item')],
        },
        { type: 'paragraph', containers: [quote(2)], children: [text('second')] },
      ]),
    );
    expect(parseMarkdown('- > $$y$$\n>')).toEqual(
      document([
        { type: 'display-math', latex: 'y', containers: [item(bullet), quote(1)] },
        { type: 'paragraph', containers: [quote(2)], children: [] },
      ]),
    );
  });

  it('keeps code exact: monospace runs, preserved indentation, and one line per source line', () => {
    expect(parseMarkdown('```py\ndef f(x):\n\treturn  x\n\n```')).toEqual(
      document([
        {
          type: 'paragraph',
          code: true,
          children: [
            text('def f(x):', ['code']),
            { type: 'break' },
            text('    return  x', ['code']),
            { type: 'break' },
          ],
        },
      ]),
    );
    expect(parseMarkdown('    indented')).toEqual(
      document([{ type: 'paragraph', code: true, children: [text('indented', ['code'])] }]),
    );
    expect(parseMarkdown('Use `f(x)` and **`g`**.')).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            text('Use '),
            text('f(x)', ['code']),
            text(' and '),
            text('g', ['bold', 'code']),
            text('.'),
          ],
        },
      ]),
    );
  });

  it('keeps safe link targets, resolves references, and renders unsafe targets as plain text', () => {
    const source = [
      'See [the *paper*](https://example.com/p), <mailto:a@b.c>, [ref][R], and [x](javascript:alert(1)).',
      '',
      '[r]: https://example.com/r',
    ].join('\n');
    expect(parseMarkdown(source)).toEqual(
      document([
        {
          type: 'paragraph',
          children: [
            text('See '),
            { type: 'text', value: 'the ', link: 'https://example.com/p' },
            { type: 'text', value: 'paper', marks: ['italic'], link: 'https://example.com/p' },
            text(', '),
            { type: 'text', value: 'mailto:a@b.c', link: 'mailto:a@b.c' },
            text(', '),
            { type: 'text', value: 'ref', link: 'https://example.com/r' },
            text(', and x.'),
          ],
        },
      ]),
    );
  });

  it('converts thematic breaks to rules', () => {
    expect(parseMarkdown('a\n\n***\n\n- ***')).toEqual(
      document([
        { type: 'paragraph', children: [text('a')] },
        { type: 'rule' },
        { type: 'rule', containers: [item(bullet)] },
      ]),
    );
  });
});

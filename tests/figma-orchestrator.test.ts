import { describe, expect, it } from 'vite-plus/test';
import { FigmaRenderOrchestrator } from '../src/figma/render-orchestrator';
import { MathJaxSvgRenderer, renderDocumentMath } from '../src/math';
import { parseMarkdown } from '../src/parser';
import type { RenderedMathPayload } from '../src/shared/types';

const settings = {
  width: 100,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left' as const,
  typography: {
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' as const },
    letterSpacing: { unit: 'PIXELS' as const, value: 0 },
    fills: [],
  },
};
class MockNode {
  public name = '';
  public fontName: unknown;
  public fontSize: unknown;
  public lineHeight: unknown;
  public letterSpacing: unknown;
  public textAutoResize: unknown;
  public x = 0;
  public y = 0;
  public rotation = 0;
  public width = 10;
  public height = 10;
  public fills: unknown = [];
  public layoutMode?: string;
  public clipsContent?: boolean;
  public children: MockNode[] = [];
  public removed = false;
  public characters = '';
  public textDecoration?: unknown;
  public hyperlink?: unknown;
  public plugin = new Map<string, string>();
  public constructor(private readonly failRelaunch = false) {}
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  public resizeWithoutConstraints(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  public remove(): void {
    this.removed = true;
  }
  public setPluginData(key: string, value: string): void {
    this.plugin.set(key, value);
  }
  public setRelaunchData(): void {
    if (this.failRelaunch) throw new Error('relaunch failed');
  }
}
const payload = (latex: string, display = false): RenderedMathPayload => ({
  latex,
  display,
  svg: '<svg width="10" height="10"></svg>',
  metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
});
function mock(
  options: {
    svgWidth?: number;
    relaunchFails?: boolean;
    appendFails?: boolean;
    appendFailsAt?: number;
    regularOnly?: boolean;
    monospace?: boolean;
  } = {},
) {
  const nodes: MockNode[] = [];
  let appends = 0;
  let frames = 0;
  const old = new MockNode();
  const page: { selection: unknown[] } = { selection: [old] };
  let reveals = 0;
  const frame = () => {
    const node = new MockNode(options.relaunchFails && frames++ === 0);
    nodes.push(node);
    return node;
  };
  const api = {
    loadFontAsync: async () => undefined,
    createText: () => {
      const node = new MockNode();
      node.height = 16;
      nodes.push(node);
      return node;
    },
    createFrame: frame,
    createNodeFromSvg: () => {
      const node = new MockNode();
      node.width = options.svgWidth ?? 10;
      nodes.push(node);
      return node;
    },
    appendChild: (parent: MockNode, child: MockNode) => {
      appends += 1;
      if (options.appendFails || appends === options.appendFailsAt)
        throw new Error('append failed');
      parent.children.push(child);
    },
    listAvailableFontsAsync: async () =>
      options.regularOnly
        ? [{ family: 'Inter', style: 'Regular' }]
        : [
            { family: 'Inter', style: 'Regular' },
            { family: 'Inter', style: 'Bold' },
            { family: 'Inter', style: 'Italic' },
            { family: 'Inter', style: 'Bold Italic' },
            ...(options.monospace
              ? [
                  { family: 'Roboto Mono', style: 'Light' },
                  { family: 'Roboto Mono', style: 'Regular' },
                  { family: 'Roboto Mono', style: 'Bold' },
                ]
              : []),
          ],
    currentPage: page,
    viewport: {
      center: { x: 200, y: 100 },
      scrollAndZoomIntoView: () => {
        reveals += 1;
      },
    },
  };
  return { api, nodes, old, page, reveals: () => reveals };
}
describe('FigmaRenderOrchestrator transaction', () => {
  it('renders native prose, inline/display SVG in order, scales once, and selects only after success', async () => {
    const m = mock();
    const doc = parseMarkdown('hello $x$\n\n$$y$$');
    const result = await new FigmaRenderOrchestrator(m.api).render({
      source: 'hello $x$\n\n$$y$$',
      document: doc,
      math: [payload('x'), payload('y', true)],
      settings,
    });
    const root = result.root as unknown as MockNode;
    expect(root.name).toBe('Math Document');
    expect(root.children.map((node) => node.name)).toEqual(['Paragraph', 'Display Math']);
    expect(root.children[0]!.children[0]!.children.map((node) => node.name)).toEqual([
      'Text: hello ',
      'Math: x',
    ]);
    expect(m.page.selection).toEqual([result.root]);
    expect(m.reveals()).toBe(1);
    expect(result.placement).toEqual({ x: 150, y: 83, rotation: 0 });
  });
  it('keeps prior selection and leaks no render nodes on invalid metrics, SVG dimensions, append, or relaunch failure', async () => {
    const badPayload = {
      ...payload('x'),
      metrics: { width: 10, height: 9, ascent: 8, descent: 2, baseline: 8 },
    };
    const invalid = mock();
    await expect(
      new FigmaRenderOrchestrator(invalid.api).render({
        source: '$x$',
        document: parseMarkdown('$x$'),
        math: [badPayload],
        settings,
      }),
    ).rejects.toThrow();
    expect(invalid.nodes).toHaveLength(0);
    expect(invalid.page.selection).toEqual([invalid.old]);
    for (const options of [
      { svgWidth: 0 },
      { svgWidth: 11 },
      { appendFailsAt: 4 },
      { relaunchFails: true },
    ]) {
      const m = mock(options);
      await expect(
        new FigmaRenderOrchestrator(m.api).render({
          source: 'text $x$',
          document: parseMarkdown('text $x$'),
          math: [payload('x')],
          settings,
        }),
      ).rejects.toThrow();
      expect(m.nodes).not.toHaveLength(0);
      expect(m.nodes.every((node) => node.removed)).toBe(true);
      expect(m.page.selection).toEqual([m.old]);
      expect(m.reveals()).toBe(0);
    }
  });
  it('fails unavailable marked fonts before creating any scene node', async () => {
    const m = mock({ regularOnly: true });
    await expect(
      new FigmaRenderOrchestrator(m.api).render({
        source: '*italic*',
        document: parseMarkdown('*italic*'),
        math: [],
        settings,
      }),
    ).rejects.toThrow('No available italic');
    expect(m.nodes).toHaveLength(0);
    expect(m.page.selection).toEqual([m.old]);
  });
  it('supports empty source and retained x/y/rotation placement without touching selected text', async () => {
    const m = mock();
    const snapshot = {
      source: 'old',
      width: 20,
      typography: settings.typography,
      placement: { x: 4, y: 8, rotation: 30 },
    };
    const result = await new FigmaRenderOrchestrator(m.api).render({
      source: '',
      document: [],
      math: [],
      settings,
      selectedSnapshot: snapshot,
    });
    const root = result.root as unknown as MockNode;
    expect(root.width).toBe(100);
    expect(root.height).toBeGreaterThan(0);
    expect(result.placement).toEqual({ x: 4, y: 8, rotation: 30 });
    expect(root.rotation).toBe(30);
    expect(m.old.removed).toBe(false);
  });
});

describe('FigmaRenderOrchestrator headings and lists', () => {
  it('renders a bold, scaled heading paragraph', async () => {
    const m = mock();
    const source = '### Online regression interpretation\n\nDefine the loss\n\n$$\\ell$$';
    const result = await new FigmaRenderOrchestrator(m.api).render({
      source,
      document: parseMarkdown(source),
      math: [payload('\\ell', true)],
      settings,
    });
    const root = result.root as unknown as MockNode;
    expect(root.children.map((node) => node.name)).toEqual([
      'Heading 3',
      'Paragraph',
      'Display Math',
    ]);
    const headingText = root.children[0]!.children[0]!.children[0]!;
    expect(headingText.characters).toBe('Online regression interpretation');
    expect(headingText.fontSize).toBeCloseTo(16 * 1.15);
    expect(headingText.fontName).toEqual({ family: 'Inter', style: 'Bold' });
    expect(root.children[1]!.children[0]!.children[0]!.fontSize).toBe(16);
  });

  it('indents list items, draws a marker per item, and keeps every item inside the root', async () => {
    const m = mock();
    const source = 'Cases:\n\n- $a$: first.\n- $b$: second.\n  - nested';
    const result = await new FigmaRenderOrchestrator(m.api).render({
      source,
      document: parseMarkdown(source),
      math: [payload('a'), payload('b')],
      settings: { ...settings, width: 300 },
    });
    const root = result.root as unknown as MockNode;
    expect(root.children.map((node) => node.name)).toEqual([
      'Paragraph',
      'List Item',
      'Text: •',
      'List Item',
      'Text: •',
      'List Item',
      'Text: ◦',
    ]);
    const [intro, first, firstMarker, second, , nested, nestedMarker] = root.children;
    expect(first!.x).toBe(24);
    expect(nested!.x).toBe(48);
    expect(first!.children[0]!.children.map((node) => node.name)).toEqual([
      'Math: a',
      'Text: : first.',
    ]);
    // Markers end a fixed gap before the content and share the first line's baseline.
    expect(firstMarker!.x + firstMarker!.width).toBeCloseTo(24 - 16 * 0.4);
    expect(nestedMarker!.x + nestedMarker!.width).toBeCloseTo(48 - 16 * 0.4);
    expect(firstMarker!.y).toBeCloseTo(first!.y);
    // Consecutive items use the tighter list gap; prose before the list keeps the block gap.
    expect(first!.y - (intro!.y + intro!.height)).toBeCloseTo(8);
    expect(second!.y - (first!.y + first!.height)).toBeCloseTo(4);
    expect(root.height).toBeCloseTo(nested!.y + nested!.height);
    for (const node of root.children) expect(node.x).toBeGreaterThanOrEqual(0);
  });

  it('removes list markers with the rest of the scene when construction fails', async () => {
    const m = mock({ relaunchFails: true });
    await expect(
      new FigmaRenderOrchestrator(m.api).render({
        source: '- one\n- two',
        document: parseMarkdown('- one\n- two'),
        math: [],
        settings,
      }),
    ).rejects.toThrow();
    expect(m.nodes.some((node) => node.characters === '•')).toBe(true);
    expect(m.nodes.every((node) => node.removed)).toBe(true);
  });
});

describe('FigmaRenderOrchestrator quotes, code, links, and rules', () => {
  const render = async (source: string, m = mock({ monospace: true }), width = 300) =>
    (
      await new FigmaRenderOrchestrator(m.api).render({
        source,
        document: parseMarkdown(source),
        math: [],
        settings: {
          ...settings,
          width,
          typography: {
            ...settings.typography,
            fills: [{ type: 'SOLID' as const, color: { r: 0.1, g: 0.2, b: 0.3 } }],
          },
        },
      })
    ).root as unknown as MockNode;

  it('indents block quotes and draws one bar per quote across all of its blocks', async () => {
    const root = await render('> first\n>\n> - item\n\nafter');
    expect(root.children.map((node) => node.name)).toEqual([
      'Quote',
      'List Item',
      'Text: \u2022',
      'Paragraph',
      'Quote Bar',
    ]);
    const [first, item, marker, after, bar] = root.children;
    expect(first!.x).toBe(16);
    expect(item!.x).toBe(16 + 24);
    expect(marker!.x + marker!.width).toBeCloseTo(40 - 6.4);
    expect(after!.x).toBe(0);
    expect(bar!.x).toBe(0);
    expect(bar!.y).toBe(first!.y);
    expect(bar!.y + bar!.height).toBeCloseTo(item!.y + item!.height);
    expect(bar!.width).toBeCloseTo(16 * 0.15);
    expect(bar!.fills).toEqual([
      { type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.3 },
    ]);
  });

  it('places a quote nested in a list after the list indent', async () => {
    const root = await render('- > quoted');
    const bar = root.children.find((node) => node.name === 'Quote Bar')!;
    const quoted = root.children.find((node) => node.name === 'List Item')!;
    expect(bar.x).toBe(24);
    expect(quoted.x).toBe(24 + 16);
  });

  it('renders code blocks line by line in a monospace face with preserved indentation', async () => {
    const root = await render('```\nif x:\n    y\n```');
    const code = root.children[0]!;
    expect(code.name).toBe('Code Block');
    const lines = code.children.map((line) => line.children.map((node) => node.characters));
    expect(lines).toEqual([['if\u00A0x:'], ['\u00A0\u00A0\u00A0\u00A0y']]);
    expect(code.children[0]!.children[0]!.fontName).toEqual({
      family: 'Roboto Mono',
      style: 'Regular',
    });
  });

  it('falls back to the body font for code when no monospace family is installed', async () => {
    const root = await render('Use `f`.', mock());
    const texts = root.children[0]!.children[0]!.children;
    expect(texts.map((node) => node.characters)).toEqual(['Use ', 'f', '.']);
    expect(texts[1]!.fontName).toEqual({ family: 'Inter', style: 'Regular' });
  });

  it('underlines link text and sets a Figma hyperlink only on linked nodes', async () => {
    const root = await render('See [docs](https://example.com) now.');
    const texts = root.children[0]!.children[0]!.children;
    expect(texts.map((node) => node.characters)).toEqual(['See ', 'docs', ' now.']);
    expect(texts[1]!.textDecoration).toBe('UNDERLINE');
    expect(texts[1]!.hyperlink).toEqual({ type: 'URL', value: 'https://example.com' });
    expect(texts[0]!.hyperlink).toBeUndefined();
    expect(texts[2]!.textDecoration).toBeUndefined();
  });

  it('draws a thematic break as a centered full-width line', async () => {
    const root = await render('above\n\n---\n\nbelow', undefined, 200);
    const [above, rule, below] = root.children;
    expect(rule!.name).toBe('Horizontal Rule');
    expect(rule!.width).toBe(200);
    expect(rule!.height).toBe(1);
    const ruleTop = above!.y + above!.height + 8;
    expect(rule!.y).toBeCloseTo(ruleTop + (16 - 1) / 2);
    expect(below!.y).toBeCloseTo(ruleTop + 16 + 8);
  });
});

describe('FigmaRenderOrchestrator real-MathJax Markdown documents', () => {
  it.each([
    [
      'bullet list with leading inline math',
      [
        'Allowing endpoint values gives useful special cases:',
        '',
        String.raw`- $\alpha_t=1$: the ordinary DeltaNet update.`,
        String.raw`- $\beta_t=0$: pure memory decay.`,
        String.raw`- $\alpha_t=0$: discard the previous memory, leaving only the current write.`,
      ].join('\n'),
      ['Paragraph', 'List Item', 'Text: •', 'List Item', 'Text: •', 'List Item', 'Text: •'],
    ],
    [
      'heading with prose and display math',
      [
        '### Online regression interpretation',
        '',
        'Define the current key-value regression loss',
        '',
        '$$',
        String.raw`\ell_t(S)=\frac12\|Sk_t-v_t\|_2^2.`,
        '$$',
        '',
        'Its gradient with respect to the memory matrix is',
        '',
        '$$',
        String.raw`\nabla_S\ell_t(S)=(Sk_t-v_t)k_t^\top.`,
        '$$',
      ].join('\n'),
      ['Heading 3', 'Paragraph', 'Display Math', 'Paragraph', 'Display Math'],
    ],
  ])('renders a %s', async (_name, source, layers) => {
    const document = parseMarkdown(source);
    const math = await renderDocumentMath(document, 1, new MathJaxSvgRenderer());
    const m = mock();
    // MathJax SVG import is mocked; give each imported node its payload's normalized size.
    let svg = 0;
    m.api.createNodeFromSvg = () => {
      const node = new MockNode();
      node.width = math[svg]!.metrics.width;
      node.height = math[svg]!.metrics.height;
      svg += 1;
      m.nodes.push(node);
      return node;
    };
    const result = await new FigmaRenderOrchestrator(m.api).render({
      source,
      document,
      math,
      settings: { ...settings, width: 360 },
    });
    expect((result.root as unknown as MockNode).children.map((node) => node.name)).toEqual(layers);
    expect(svg).toBe(math.length);
  });
});

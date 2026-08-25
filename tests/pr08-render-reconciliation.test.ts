import { describe, expect, it } from 'vitest';

import { tokenizeParagraph, type ParagraphPlan } from '../src/layout';
import { renderDocumentLayers } from '../src/figma/document-renderer';
import { parsePersistedDocumentState } from '../src/figma/persistence';

const typography = {
  fontName: { family: 'Inter', style: 'Regular' },
  fontSize: 16,
  lineHeight: { unit: 'AUTO' as const },
  letterSpacing: { unit: 'PIXELS' as const, value: 0 },
  fills: [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 0 } }],
};
class Node {
  public name = '';
  public x = 0;
  public y = 0;
  public width = 10;
  public height = 10;
  public layoutMode?: string;
  public clipsContent?: boolean;
  public fills: unknown = [];
  public rotation = 0;
  public fontName: unknown;
  public fontSize: unknown;
  public lineHeight: unknown;
  public letterSpacing: unknown;
  public textAutoResize: unknown;
  public readonly children: Node[] = [];
  public readonly plugin = new Map<string, string>();
  public removed = false;
  public constructor(
    private readonly widths: Record<string, number>,
    private readonly heights: Record<string, number>,
  ) {}
  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  public appendChild(child: Node): void {
    this.children.push(child);
  }
  public remove(): void {
    this.removed = true;
  }
  public setPluginData(key: string, value: string): void {
    this.plugin.set(key, value);
  }
  public getPluginData(key: string): string {
    return this.plugin.get(key) ?? '';
  }
  public setRelaunchData(): void {}
  public get characters(): string {
    return this._characters;
  }
  public set characters(value: string) {
    this._characters = value;
    this.width = this.widths[value] ?? this.width;
    this.height = this.heights[value] ?? this.height;
  }
  private _characters = '';
}
const prose = (
  text: string,
  x: number,
  y: number,
  calibration: number,
  marks?: readonly ('bold' | 'italic')[],
) => ({
  type: 'prose' as const,
  text,
  x,
  y,
  marks,
  baselineCalibration: { emAscentRatio: calibration, source: 'reference-glyph' as const },
  metrics: { width: 10, height: 16, ascent: 12, descent: 4 },
  measuredParts: [text],
});
const math = {
  type: 'math' as const,
  latex: 'x',
  x: 10,
  y: 0,
  svgScale: 1,
  rendered: {
    latex: 'x',
    display: false,
    svg: '<svg width="10" height="10"></svg>',
    metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
  },
  metrics: { width: 10, height: 10, ascent: 8, descent: 2 },
};

describe('final native-width reconciliation', () => {
  it('uses actual smaller/larger prose widths, preserves marked/math barriers, punctuation, root extent and actual next-line y', async () => {
    const nodes: Node[] = [];
    const widths = { a: 8, '.': 15, c: 5 };
    const heights = { a: 20, '.': 20, c: 10 };
    const make = () => {
      const node = new Node(widths, heights);
      nodes.push(node);
      return node;
    };
    const plan: ParagraphPlan = {
      width: 20,
      height: 32,
      lines: [
        {
          x: 0,
          y: 0,
          width: 30,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 12,
          forced: false,
          children: [prose('a', 0, 0, 0.5, ['bold']), math, prose('.', 20, 0, 0.75, ['italic'])],
        },
        {
          x: 0,
          y: 16,
          width: 10,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 28,
          forced: false,
          children: [prose('c', 0, 16, 0.5)],
        },
      ],
    };
    const api = {
      createFrame: make,
      createText: make,
      createNodeFromSvg: make,
      loadFontAsync: async () => undefined,
      appendChild: (parent: Node, child: Node) => parent.appendChild(child),
    };
    const root = (await renderDocumentLayers(
      api,
      {
        source: 'a$x$.\nc',
        settings: {
          width: 20,
          mathScale: 1,
          inheritTypography: true,
          textAlignment: 'left',
          typography,
        },
        blocks: [{ type: 'paragraph', plan }],
        x: 0,
        y: 0,
        baselineCalibration: { emAscentRatio: 0.8 },
      },
      () => undefined,
    )) as unknown as Node;
    const paragraph = root.children[0]!;
    const first = paragraph.children[0]!;
    const second = paragraph.children[1]!;
    // Actual a width is 8 (smaller than planned); punctuation is 15 (larger), so cursor is 0,8,18 and root is 33.
    expect(first.children.map((child) => [child.name, child.x])).toEqual([
      ['Text: a', 0],
      ['Math: x', 8],
      ['Text: .', 18],
    ]);
    expect(first.width).toBe(33);
    expect(paragraph.width).toBe(33);
    expect(root.width).toBe(33);
    expect(
      parsePersistedDocumentState(root.getPluginData('math-text-document'))?.compiledWidth,
    ).toBe(33);
    // First actual line has max ascent 14 and descent 10 = 24, not planned 16; line two follows it.
    expect(first.height).toBe(24);
    expect(second.y).toBe(24);
    // The two marked prose segments did not merge across the SVG and retain distinct calibration ascent positions.
    expect(first.children[0]!.y).not.toBe(first.children[2]!.y);
  });
  it('keeps a measured trailing native space before math when Figma trims its ink bounds', async () => {
    const widths = { 'as ': 12 };
    const heights = { 'as ': 16 };
    const make = () => new Node(widths, heights);
    const plan: ParagraphPlan = {
      width: 20,
      height: 16,
      lines: [
        {
          x: 0,
          y: 0,
          width: 22,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 12,
          forced: false,
          children: [
            {
              ...prose('as ', 0, 0, 0.8),
              endsWithSeparator: true,
              trailingSeparatorWidth: 6,
              metrics: { width: 99, height: 16, ascent: 12, descent: 4 },
            },
            { ...math, x: 18 },
          ],
        },
      ],
    };
    const api = {
      createFrame: make,
      createText: make,
      createNodeFromSvg: make,
      loadFontAsync: async () => undefined,
      appendChild: (parent: Node, child: Node) => parent.appendChild(child),
    };
    const root = (await renderDocumentLayers(
      api,
      {
        source: 'as $x$',
        settings: {
          width: 20,
          mathScale: 1,
          inheritTypography: true,
          textAlignment: 'left',
          typography,
        },
        blocks: [{ type: 'paragraph', plan }],
        x: 0,
        y: 0,
        baselineCalibration: { emAscentRatio: 0.8 },
      },
      () => undefined,
    )) as unknown as Node;
    expect(root.children[0]!.children[0]!.children.map((child) => child.x)).toEqual([0, 18]);
  });
  it('recognizes tabs as source separators but keeps NBSP as content', () => {
    const tab = tokenizeParagraph({
      type: 'paragraph',
      children: [{ type: 'text', value: 'a\t' }],
    });
    const nbsp = tokenizeParagraph({
      type: 'paragraph',
      children: [{ type: 'text', value: 'a\u00a0' }],
    });
    expect(tab.map((token) => token.kind)).toEqual(['prose', 'separator']);
    expect(nbsp.map((token) => token.kind)).toEqual(['prose']);
  });
  it('aligns every final line and display against final expanded root width, clamping over-wide content', async () => {
    const plan: ParagraphPlan = {
      width: 20,
      height: 32,
      lines: [
        {
          x: 0,
          y: 0,
          width: 40,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 12,
          forced: false,
          children: [prose('wide', 0, 0, 0.8)],
        },
        {
          x: 0,
          y: 16,
          width: 10,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 28,
          forced: false,
          children: [prose('small', 0, 16, 0.8)],
        },
      ],
    };
    for (const textAlignment of ['left', 'center', 'right', 'justify'] as const) {
      const widths = { wide: 40, small: 10 };
      const make = () => new Node(widths, { wide: 16, small: 16 });
      const api = {
        createFrame: make,
        createText: make,
        createNodeFromSvg: make,
        loadFontAsync: async () => undefined,
        appendChild: (parent: Node, child: Node) => parent.appendChild(child),
      };
      const root = (await renderDocumentLayers(
        api,
        {
          source: 'x',
          settings: { width: 20, mathScale: 1, inheritTypography: true, textAlignment, typography },
          blocks: [
            { type: 'paragraph', plan },
            {
              type: 'display-math',
              plan: {
                type: 'display-math',
                latex: 'x',
                svgScale: 1,
                rendered: {
                  latex: 'x',
                  display: true,
                  svg: '<svg width="10" height="10"/>',
                  metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
                },
                metrics: { width: 10, height: 10, ascent: 8, descent: 2 },
              },
            },
          ],
          x: 0,
          y: 0,
        },
        () => undefined,
      )) as unknown as Node;
      const [paragraph, display] = root.children;
      const [wide, small] = paragraph!.children;
      expect(root.width).toBe(40);
      expect(wide!.x).toBe(0);
      expect(small!.x).toBe(textAlignment === 'center' ? 15 : textAlignment === 'right' ? 30 : 0);
      expect(display!.children[0]!.x).toBe(
        textAlignment === 'center' ? 15 : textAlignment === 'right' ? 30 : 0,
      );
    }
  });

  it('distributes actual positive remainder equally across planned source gaps without stretching text or math', async () => {
    const nodes: Node[] = [];
    const make = () => {
      const node = new Node({ 'a ': 10, 'b ': 10, c: 10 }, {});
      nodes.push(node);
      return node;
    };
    const line = {
      x: 0,
      y: 0,
      width: 30,
      height: 16,
      ascent: 12,
      descent: 4,
      baseline: 12,
      forced: false,
      justified: true as const,
      children: [
        { ...prose('a ', 0, 0, 0.8), justifyGapAfter: true as const },
        { ...math, x: 10 },
        { ...prose('b ', 20, 0, 0.8), justifyGapAfter: true as const },
        prose('c', 30, 0, 0.8),
      ],
    };
    const api = {
      createFrame: make,
      createText: make,
      createNodeFromSvg: make,
      loadFontAsync: async () => undefined,
      appendChild: (parent: Node, child: Node) => parent.appendChild(child),
    };
    const root = (await renderDocumentLayers(
      api,
      {
        source: 'a $x$ b c d',
        settings: {
          width: 100,
          mathScale: 1,
          inheritTypography: true,
          textAlignment: 'justify',
          typography,
        },
        blocks: [{ type: 'paragraph', plan: { width: 100, height: 16, lines: [line] } }],
        x: 0,
        y: 0,
      },
      () => undefined,
    )) as unknown as Node;
    const renderedLine = root.children[0]!.children[0]!;
    // Four actual 10px boxes leave 60px; each source space beside the SVG gets 30px.
    expect(renderedLine.children.map((child) => child.x)).toEqual([0, 40, 50, 90]);
    expect(renderedLine.children[1]!.name).toBe('Math: x');
    expect(renderedLine.width).toBe(100);
  });
});

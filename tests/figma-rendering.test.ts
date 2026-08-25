import { describe, expect, it } from 'vitest';

import type { DisplayMathPlan, ParagraphPlan } from '../src/layout';
import { renderDocumentLayers } from '../src/figma/document-renderer';
import { parsePersistedDocumentState } from '../src/figma/persistence';
import { truncateCodePoints } from '../src/figma/layer-names';

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
  public layoutMode?: string;
  public clipsContent?: boolean;
  public width = 10;
  public height = 10;
  public fills: unknown = ['WHITE'];
  public rotation = 0;
  public children: Node[] = [];
  public removed = false;
  public plugin = new Map<string, string>();
  public relaunch: Record<string, string> = {};
  public readonly events: string[];
  public constructor(events: string[]) {
    this.events = events;
  }
  public resize(width: number, height: number): void {
    this.events.push(`resize:${width}/${height}`);
    this.width = width;
    this.height = height;
  }
  public appendChild(node: Node): void {
    this.children.push(node);
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
  public setRelaunchData(data: Record<string, string>): void {
    this.relaunch = data;
  }
}
const prose = {
  type: 'prose' as const,
  text: 'hello',
  x: 0,
  y: 1,
  metrics: { width: 20, height: 16, ascent: 12, descent: 4 },
  measuredParts: ['hello'],
};
const math = {
  type: 'math' as const,
  latex: 'x',
  x: 20,
  y: 0,
  svgScale: 2,
  rendered: {
    latex: 'x',
    display: false,
    svg: '<svg width="10" height="10"></svg>',
    metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
  },
  metrics: { width: 20, height: 20, ascent: 16, descent: 4 },
};
const paragraph: ParagraphPlan = {
  width: 100,
  height: 16,
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
      children: [prose, math],
    },
  ],
};
const display: DisplayMathPlan = {
  type: 'display-math',
  latex: 'y',
  svgScale: 1,
  rendered: {
    latex: 'y',
    display: true,
    svg: '<svg width="10" height="10"></svg>',
    metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
  },
  metrics: { width: 10, height: 10, ascent: 8, descent: 2 },
};

describe('Figma document rendering', () => {
  it('makes native prose, atomic SVGs, ordered blocks, and canonical state', async () => {
    const events: string[] = [];
    const nodes: Node[] = [];
    const api = {
      createFrame: () => {
        const node = new Node(events);
        nodes.push(node);
        return node;
      },
      createText: () => {
        const node = new Node(events);
        nodes.push(node);
        return node as never;
      },
      appendChild: (parent: Node, child: Node) => parent.appendChild(child),
      createNodeFromSvg: () => {
        const node = new Node(events);
        nodes.push(node);
        return node;
      },
      loadFontAsync: async () => {
        events.push('load-font');
      },
    };
    const root = (await renderDocumentLayers(
      api,
      {
        source: 'hello $x$',
        settings: { width: 100, mathScale: 1, inheritTypography: true, typography },
        blocks: [
          { type: 'paragraph', plan: paragraph },
          { type: 'display-math', plan: display },
        ],
        x: 3,
        y: 4,
      },
      () => undefined,
    )) as unknown as Node;
    expect(root.name).toBe('Math Document');
    expect(root.children.map((node) => node.name)).toEqual(['Paragraph', 'Display Math']);
    expect(root.children[0]?.children[0]?.children.map((node) => node.name)).toEqual([
      'Text: hello',
      'Math: x',
    ]);
    expect(root.children[1]?.children[0]?.name).toBe('Display Math: y');
    expect(
      [root, ...root.children, ...root.children[0]!.children].every(
        (node) => Array.isArray(node.fills) && node.fills.length === 0,
      ),
    ).toBe(true);
    expect(events.filter((event) => event === 'resize:20/20')).toHaveLength(1);
    expect(events.filter((event) => event === 'resize:10/10')).toHaveLength(1);
    expect(parsePersistedDocumentState(root.getPluginData('math-text-document'))?.source).toBe(
      'hello $x$',
    );
    expect(root.getPluginData('math-text-version')).toBe('1');
    expect(root.relaunch).toEqual({ edit: 'Edit Math Text' });
  });
  it('uses line-relative child coordinates so second-line absolute baselines stay correct', async () => {
    const events: string[] = [];
    const nodes: Node[] = [];
    const api = {
      createFrame: () => {
        const node = new Node(events);
        nodes.push(node);
        return node;
      },
      createText: () => new Node(events) as never,
      createNodeFromSvg: () => new Node(events),
      loadFontAsync: async () => undefined,
      appendChild: (parent: Node, child: Node) => parent.appendChild(child),
    };
    const twoLines: ParagraphPlan = {
      width: 100,
      height: 40,
      lines: [
        {
          x: 0,
          y: 0,
          width: 20,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 12,
          forced: false,
          children: [prose],
        },
        {
          x: 2,
          y: 20,
          width: 30,
          height: 16,
          ascent: 12,
          descent: 4,
          baseline: 32,
          forced: false,
          children: [
            { ...prose, x: 3, y: 25 },
            { ...math, x: 13, y: 22 },
          ],
        },
      ],
    };
    const root = (await renderDocumentLayers(
      api,
      {
        source: 'two',
        settings: { width: 100, mathScale: 1, inheritTypography: true, typography },
        blocks: [{ type: 'paragraph', plan: twoLines }],
        x: 0,
        y: 0,
      },
      () => undefined,
    )) as unknown as Node;
    const line2 = root.children[0]!.children[1]!;
    expect(line2.x).toBe(2);
    expect(line2.y).toBe(20);
    expect(line2.children.map((child) => [child.x, child.y])).toEqual([
      [1, 5],
      [11, 2],
    ]);
    expect(line2.children.map((child) => [line2.x + child.x, line2.y + child.y])).toEqual([
      [3, 25],
      [13, 22],
    ]);
  });
  it('uses code point safe visible formula names', () =>
    expect(truncateCodePoints('😀😀😀😀', 3)).toBe('😀😀…'));
});

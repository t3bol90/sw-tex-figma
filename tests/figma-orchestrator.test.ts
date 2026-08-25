import { describe, expect, it } from 'vitest';
import { FigmaRenderOrchestrator } from '../src/figma/render-orchestrator';
import { parseMarkdown } from '../src/parser';
import type { RenderedMathPayload } from '../src/shared/types';

const settings = {
  width: 100,
  mathScale: 1,
  inheritTypography: true,
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
  public plugin = new Map<string, string>();
  public constructor(private readonly failRelaunch = false) {}
  public resize(width: number, height: number): void {
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

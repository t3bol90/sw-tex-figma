import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginToUIMessage } from '../src/shared/messages';
import { readPersistedDocumentState } from '../src/figma/persistence';
import type { RenderedMathPayload } from '../src/shared/types';

class Node {
  parent: Node | null = null;
  children: Node[] = [];
  removed = false;
  x = 0;
  y = 0;
  rotation = 0;
  width = 10;
  height = 16;
  name = '';
  characters = '';
  fontName = { family: 'Inter', style: 'Regular' };
  fontSize = 16;
  lineHeight = { unit: 'AUTO' };
  letterSpacing = { unit: 'PIXELS', value: 0 };
  fills: unknown[] = [];
  textAutoResize = 'WIDTH_AND_HEIGHT';
  private data = new Map<string, string>();
  constructor(readonly type: string) {}
  appendChild(child: Node): void {
    this.insertChild(this.children.length, child);
  }
  insertChild(index: number, child: Node): void {
    if (child.parent)
      child.parent.children = child.parent.children.filter((node) => node !== child);
    this.children.splice(index, 0, child);
    child.parent = this;
  }
  remove(): void {
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
  }
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  resizeWithoutConstraints(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  setPluginData(key: string, value: string): void {
    this.data.set(key, value);
  }
  getPluginData(key: string): string {
    return this.data.get(key) ?? '';
  }
  setRelaunchData(): void {}
}

class Page extends Node {
  selection: Node[] = [];
  focusedSlide: Node | null = null;
  constructor() {
    super('PAGE');
  }
}

const settings = {
  width: 100,
  mathScale: 1,
  inheritTypography: true,
  textAlignment: 'left',
  typography: {
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' },
    letterSpacing: { unit: 'PIXELS', value: 0 },
    fills: [],
  },
};

async function setup(editorType = 'slides', slidesView = 'single-slide', nativeTextLayout = false) {
  vi.resetModules();
  const page = new Page();
  const grid = new Node('SLIDE_GRID');
  const row = new Node('SLIDE_ROW');
  page.appendChild(grid);
  grid.appendChild(row);
  const slide = new Node('SLIDE');
  slide.resize(1920, 1080);
  row.appendChild(slide);
  const other = new Node('SLIDE');
  other.resize(1920, 1080);
  row.appendChild(other);
  page.focusedSlide = slide;
  const nodes: Node[] = [];
  const messages: PluginToUIMessage[] = [];
  const create = (type: string) => {
    const node = new Node(type);
    nodes.push(node);
    (api.editorType === 'slides' && api.viewport.slidesView === 'single-slide'
      ? (api.currentPage.focusedSlide ?? api.currentPage)
      : api.currentPage
    ).appendChild(node);
    return node;
  };
  const api = {
    editorType,
    command: 'create',
    mixed: Symbol('mixed'),
    currentPage: page,
    viewport: {
      slidesView,
      center: { x: 5000, y: 3000 },
      scrollAndZoomIntoView: vi.fn(),
    },
    ui: {
      postMessage: (message: PluginToUIMessage) => messages.push(message),
      onmessage: vi.fn<(message: unknown) => void>(),
    },
    showUI: vi.fn(),
    closePlugin: vi.fn(),
    loadFontAsync: vi.fn(async () => {
      if (!nativeTextLayout || api.editorType !== 'slides') return;
      for (const node of nodes) {
        if (
          node.removed ||
          node.type !== 'TEXT' ||
          !node.characters ||
          node.textAutoResize !== 'WIDTH_AND_HEIGHT'
        )
          continue;
        let ancestor = node.parent;
        let x = node.x;
        while (ancestor && ancestor.type !== 'SLIDE') {
          x += ancestor.x;
          ancestor = ancestor.parent;
        }
        if (ancestor && x + node.width > ancestor.width) {
          node.textAutoResize = 'HEIGHT';
          node.width = ancestor.width - x - 16;
          node.height *= node.characters.length;
        }
      }
    }),
    listAvailableFontsAsync: async () => [
      { fontName: settings.typography.fontName },
      { fontName: { family: 'Inter', style: 'Bold' } },
    ],
    createFrame: () => create('FRAME'),
    createText: vi.fn(() => create('TEXT')),
    createNodeFromSvg: () => {
      const node = create('FRAME');
      node.resize(10, 10);
      return node;
    },
    flatten: () => create('VECTOR'),
  };
  vi.stubGlobal('figma', api);
  vi.stubGlobal('__html__', '<html></html>');
  const open = async () => {
    await import('../src/code');
    await vi.waitFor(() =>
      expect(messages.some((message) => message.type === 'INITIALIZE')).toBe(true),
    );
  };
  const apply = async (source = '$x$', math?: readonly RenderedMathPayload[]) => {
    const initialized = messages.find((message) => message.type === 'INITIALIZE');
    if (initialized?.type !== 'INITIALIZE') throw new Error('Controller did not initialize.');
    api.ui.onmessage({
      type: 'RENDER_DOCUMENT',
      source,
      math:
        math ??
        (source === '$x$'
          ? [
              {
                latex: 'x',
                display: false,
                svg: '<svg width="10" height="10"></svg>',
                metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
              },
            ]
          : []),
      settings,
      workflowToken: initialized.workflowToken,
    });
    await vi.waitFor(() =>
      expect(
        messages.some(
          (message) => message.type === 'RENDER_SUCCESS' || message.type === 'RENDER_ERROR',
        ),
      ).toBe(true),
    );
  };
  return { api, page, row, slide, other, nodes, messages, open, apply };
}

afterEach(() => vi.unstubAllGlobals());

describe('Slides native controller', () => {
  it.each(['create', 'edit'])(
    'keeps auto-width prose during %s on an off-origin slide',
    async (workflow) => {
      const m = await setup('slides', 'single-slide', true);
      await m.open();
      if (workflow === 'edit') {
        await m.apply('original');
        m.messages.length = 0;
        m.api.command = 'edit';
        vi.resetModules();
        await m.open();
      }
      await m.apply('**Proof:**\n\nBy the law of cosines $x$', [
        {
          latex: 'x',
          display: false,
          svg: '<svg width="10" height="10"></svg>',
          metrics: { width: 10, height: 10, ascent: 8, descent: 2, baseline: 8 },
        },
      ]);
      expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
      const proof = m.nodes.find((node) => !node.removed && node.characters === 'Proof:');
      expect(proof).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', width: 10, height: 16 });
      expect(m.page.selection[0]?.parent).toBe(m.slide);
    },
  );

  it('inserts centered math on the focused slide using local coordinates', async () => {
    const m = await setup();
    await m.open();
    await m.apply();
    expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
    const root = m.page.selection[0];
    if (!root) throw new Error('No result was selected.');
    expect(root?.parent).toBe(m.slide);
    expect(root?.x).toBe(910);
    expect(root.y).toBe((1080 - root.height) / 2);
    expect(readPersistedDocumentState(root)).toMatchObject({ source: '$x$' });
  });

  it('keeps its captured slide when focus changes during font loading', async () => {
    const m = await setup();
    await m.open();
    m.api.loadFontAsync.mockImplementation(async () => {
      m.page.focusedSlide = m.other;
    });
    await m.apply();
    expect(m.page.selection[0]?.parent).toBe(m.slide);
    expect(m.other.children.filter((node) => !node.removed)).toEqual([]);
  });

  it('targets the selected slide or selected descendants in grid view', async () => {
    for (const descendant of [false, true]) {
      const m = await setup('slides', 'grid');
      const selected = descendant ? new Node('RECTANGLE') : m.other;
      if (descendant) m.other.appendChild(selected);
      m.page.selection = [selected];
      await m.open();
      await m.apply();
      expect(m.page.selection[0]?.parent).toBe(m.other);
      expect(m.page.selection[0]?.x).toBe(910);
    }
  });

  it('rejects missing or ambiguous target slides before creating nodes', async () => {
    for (const selection of ['empty', 'multiple', 'outside']) {
      const m = await setup('slides', 'grid');
      m.page.selection =
        selection === 'empty'
          ? []
          : selection === 'multiple'
            ? [m.slide, m.other]
            : [m.slide, new Node('RECTANGLE')];
      await m.open();
      await m.apply();
      expect(m.messages.at(-1)).toMatchObject({
        type: 'RENDER_ERROR',
        message: expect.stringContaining('slide'),
      });
      expect(m.nodes).toEqual([]);
    }
  });

  it('rolls back if its slide is removed or moved to another page during rendering', async () => {
    for (const remove of [true, false]) {
      const m = await setup();
      await m.open();
      m.api.loadFontAsync.mockImplementation(async () => {
        if (remove) m.slide.removed = true;
        else new Node('PAGE').appendChild(m.row);
      });
      await m.apply();
      expect(m.messages.at(-1)?.type).toBe('RENDER_ERROR');
      expect(m.nodes.length).toBeGreaterThan(0);
      expect(m.nodes.every((node) => node.removed)).toBe(true);
      expect(m.page.selection).toEqual([]);
    }
  });

  it('rolls back insertion failures without changing selection', async () => {
    const m = await setup('slides', 'grid');
    m.page.selection = [m.slide];
    await m.open();
    m.slide.appendChild = () => {
      throw new Error('Cannot attach to slide');
    };
    await m.apply();
    expect(m.messages.at(-1)?.type).toBe('RENDER_ERROR');
    expect(m.nodes.every((node) => node.removed)).toBe(true);
    expect(m.page.selection).toEqual([m.slide]);
  });

  it('preserves Design canvas placement', async () => {
    const m = await setup('figma');
    await m.open();
    await m.apply();
    expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
    expect(m.page.selection[0]?.parent).toBe(m.page);
    expect(m.page.selection[0]?.x).toBe(4950);
  });

  it('centers using final native dimensions after text expands beyond its measured plan', async () => {
    const m = await setup();
    const createText = m.api.createText.getMockImplementation();
    if (!createText) throw new Error('Missing native text factory.');
    m.api.createText.mockImplementation(() => {
      const node = createText();
      if (m.nodes.some((candidate) => candidate.name === 'Paragraph')) node.width = 250;
      return node;
    });
    await m.open();
    await m.apply('hello');
    expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
    expect(m.page.selection[0]).toMatchObject({ width: 250, x: 835 });
  });

  it('converts selected text in its original slide even without a focused slide', async () => {
    const m = await setup('slides', 'grid');
    const selected = new Node('TEXT');
    selected.characters = 'hello';
    selected.x = 80;
    selected.y = 90;
    selected.rotation = 15;
    selected.width = 100;
    m.other.appendChild(selected);
    m.page.selection = [selected];
    m.page.focusedSlide = null;
    await m.open();
    await m.apply('hello');
    expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
    expect(m.page.selection[0]?.parent).toBe(m.other);
    expect(m.page.selection[0]).toMatchObject({ x: 80, y: 90, rotation: 15 });
    expect(selected.removed).toBe(true);

    const firstRoot = m.page.selection[0];
    m.messages.length = 0;
    m.api.command = 'edit';
    vi.resetModules();
    await m.open();
    await m.apply('updated');
    expect(m.messages.at(-1)?.type).toBe('RENDER_SUCCESS');
    expect(m.page.selection[0]?.parent).toBe(m.other);
    expect(m.page.selection[0]).toMatchObject({ x: 80, y: 90, rotation: 15 });
    expect(firstRoot?.removed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  captureReplacement,
  replaceWithRenderedDocument,
  replacementNodeFor,
} from '../src/figma/replacement';

class Node {
  parent: Parent | null = null;
  removed = false;
  x = 1;
  y = 2;
  rotation = 3;
  layoutAlign = 'INHERIT';
  layoutGrow = 1;
  constructor(
    private readonly events: string[],
    readonly name: string,
  ) {}
  remove(): void {
    this.events.push(`remove:${this.name}`);
    this.removed = true;
    if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this);
  }
}
class Parent {
  children: Node[] = [];
  constructor(private readonly events: string[]) {}
  insertChild(index: number, node: Node): void {
    this.events.push(`insert:${node.name}:${index}`);
    node.parent = this;
    this.children.splice(index, 0, node);
  }
}
const request = {
  source: '',
  document: [],
  math: [],
  settings: {
    width: 1,
    mathScale: 1,
    inheritTypography: true,
    textAlignment: 'left' as const,
    typography: {
      fontName: { family: 'I', style: 'R' },
      fontSize: 1,
      lineHeight: { unit: 'AUTO' as const },
      letterSpacing: { unit: 'PIXELS' as const, value: 0 },
      fills: [],
    },
  },
};
describe('replacement transaction', () => {
  it('inserts persisted replacement before removing old and preserves parent placement properties', async () => {
    const events: string[] = [];
    const parent = new Parent(events);
    const old = new Node(events, 'old');
    parent.insertChild(0, old);
    events.length = 0;
    const root = new Node(events, 'new');
    root.parent = parent;
    await replaceWithRenderedDocument(
      { render: async () => ({ root, placement: { x: 0, y: 0, rotation: 0 } }) } as never,
      { currentPage: { selection: [] }, viewport: { center: { x: 0, y: 0 } } } as never,
      request as never,
      captureReplacement(replacementNodeFor(old)!)!,
    );
    expect(events).toEqual(['insert:new:0', 'remove:old']);
    expect(parent.children).toEqual([root]);
    expect(root).toMatchObject({ x: 1, y: 2, rotation: 3, layoutAlign: 'INHERIT', layoutGrow: 1 });
  });
  it('rolls back only new root when old removal fails', async () => {
    const events: string[] = [];
    const parent = new Parent(events);
    const old = new Node(events, 'old');
    parent.insertChild(0, old);
    old.remove = () => {
      events.push('remove-fails');
      throw new Error('no');
    };
    events.length = 0;
    const root = new Node(events, 'new');
    root.parent = parent;
    await expect(
      replaceWithRenderedDocument(
        { render: async () => ({ root, placement: { x: 0, y: 0, rotation: 0 } }) } as never,
        { currentPage: { selection: [] }, viewport: { center: { x: 0, y: 0 } } } as never,
        request as never,
        captureReplacement(replacementNodeFor(old)!)!,
      ),
    ).rejects.toThrow('no');
    expect(old.removed).toBe(false);
    expect(root.removed).toBe(true);
  });
  it('removes the new root when insertion fails and leaves old selection/order intact', async () => {
    const events: string[] = [];
    const parent = new Parent(events);
    const old = new Node(events, 'old');
    parent.insertChild(0, old);
    parent.insertChild = () => {
      events.push('insert-fails');
      throw new Error('insert');
    };
    const root = new Node(events, 'new');
    root.parent = parent;
    const page = { selection: [old] };
    await expect(
      replaceWithRenderedDocument(
        { render: async () => ({ root, placement: { x: 0, y: 0, rotation: 0 } }) } as never,
        { currentPage: page, viewport: { center: { x: 0, y: 0 } } } as never,
        request as never,
        captureReplacement(replacementNodeFor(old)!)!,
      ),
    ).rejects.toThrow('insert');
    expect(old.removed).toBe(false);
    expect(parent.children).toEqual([old]);
    expect(page.selection).toEqual([old]);
    expect(root.removed).toBe(true);
  });
  it('fails before rendering when the captured target disappears', async () => {
    const events: string[] = [];
    const parent = new Parent(events);
    const old = new Node(events, 'old');
    parent.insertChild(0, old);
    const captured = captureReplacement(replacementNodeFor(old)!)!;
    old.removed = true;
    await expect(
      replaceWithRenderedDocument(
        {
          render: async () => {
            throw new Error('renderer should not run');
          },
        } as never,
        { currentPage: { selection: [old] }, viewport: { center: { x: 0, y: 0 } } } as never,
        request as never,
        captured,
      ),
    ).rejects.toThrow('changed before Apply');
  });
  it('requires rendering/persistence to finish before the old target is removed', async () => {
    const events: string[] = [];
    const parent = new Parent(events);
    const old = new Node(events, 'old');
    parent.insertChild(0, old);
    events.length = 0;
    const root = new Node(events, 'new');
    root.parent = parent;
    await replaceWithRenderedDocument(
      {
        render: async () => {
          events.push('persisted');
          return { root, placement: { x: 0, y: 0, rotation: 0 } };
        },
      } as never,
      { currentPage: { selection: [] }, viewport: { center: { x: 0, y: 0 } } } as never,
      request as never,
      captureReplacement(replacementNodeFor(old)!)!,
    );
    expect(events).toEqual(['persisted', 'insert:new:0', 'remove:old']);
  });
});

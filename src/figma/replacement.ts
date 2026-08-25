import type {
  FigmaRenderApi,
  FigmaRenderOrchestrator,
  RenderRequest,
  RenderResult,
} from './render-orchestrator';

export interface ReplaceableNode {
  readonly parent: ReplaceableParent | null;
  readonly removed?: boolean;
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  layoutAlign?: string;
  layoutGrow?: number;
  remove(): void;
}
export interface ReplaceableParent {
  readonly children: readonly ReplaceableNode[];
  insertChild(index: number, child: ReplaceableNode): void;
}
export interface ReplacementSnapshot {
  readonly target: ReplaceableNode;
  readonly parent: ReplaceableParent;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly layoutAlign?: string;
  readonly layoutGrow?: number;
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const rawNodes = new WeakMap<ReplaceableNode, Record<string, unknown>>();
const nodeAdapters = new WeakMap<Record<string, unknown>, ReplaceableNode>();
const parentAdapters = new WeakMap<Record<string, unknown>, ReplaceableParent>();
const rawFor = (node: ReplaceableNode): unknown => rawNodes.get(node) ?? node;
interface RawParent extends Record<string, unknown> {
  readonly children: readonly unknown[];
  insertChild(index: number, child: unknown): void;
}
const isRawParent = (value: unknown): value is RawParent =>
  isRecord(value) && Array.isArray(value.children) && typeof value.insertChild === 'function';
const parentFor = (raw: unknown): ReplaceableParent | undefined => {
  if (!isRawParent(raw)) return undefined;
  const cached = parentAdapters.get(raw);
  if (cached) return cached;
  const parent: ReplaceableParent = {
    get children() {
      return raw.children
        .map((child) => replacementNodeFor(child))
        .filter((child): child is ReplaceableNode => child !== undefined);
    },
    insertChild(index: number, child: ReplaceableNode) {
      if (typeof raw.insertChild !== 'function') throw new Error('Replacement parent changed.');
      raw.insertChild(index, rawFor(child));
    },
  };
  parentAdapters.set(raw, parent);
  return parent;
};
/** Narrow runtime adapter for Figma SceneNode/TextNode without unchecked production casts. */
export function replacementNodeFor(value: unknown): ReplaceableNode | undefined {
  if (!isRecord(value) || typeof value.remove !== 'function' || !parentFor(value.parent))
    return undefined;
  if (!finite(value.x) || !finite(value.y)) return undefined;
  const cached = nodeAdapters.get(value);
  if (cached) return cached;
  const node: ReplaceableNode = {
    get parent() {
      return parentFor(value.parent) ?? null;
    },
    get removed() {
      return value.removed === true;
    },
    get x() {
      return finite(value.x) ? value.x : 0;
    },
    set x(next: number) {
      value.x = next;
    },
    get y() {
      return finite(value.y) ? value.y : 0;
    },
    set y(next: number) {
      value.y = next;
    },
    get rotation() {
      return finite(value.rotation) ? value.rotation : undefined;
    },
    set rotation(next: number | undefined) {
      if (next !== undefined) value.rotation = next;
    },
    get width() {
      return finite(value.width) ? value.width : undefined;
    },
    get layoutAlign() {
      return typeof value.layoutAlign === 'string' ? value.layoutAlign : undefined;
    },
    set layoutAlign(next: string | undefined) {
      if (next !== undefined) value.layoutAlign = next;
    },
    get layoutGrow() {
      return finite(value.layoutGrow) ? value.layoutGrow : undefined;
    },
    set layoutGrow(next: number | undefined) {
      if (next !== undefined) value.layoutGrow = next;
    },
    remove: () => {
      if (typeof value.remove === 'function') value.remove();
    },
  };
  rawNodes.set(node, value);
  nodeAdapters.set(value, node);
  return node;
}
/** Capture before async MathJax/measurement work and verify again immediately before commit. */
export function captureReplacement(target: ReplaceableNode): ReplacementSnapshot | undefined {
  const parent = target.parent;
  const index = parent?.children.indexOf(target) ?? -1;
  if (!parent || index < 0 || target.removed || !finite(target.x) || !finite(target.y))
    return undefined;
  return {
    target,
    parent,
    index,
    x: target.x,
    y: target.y,
    rotation: finite(target.rotation) ? target.rotation : 0,
    ...(target.layoutAlign === undefined ? {} : { layoutAlign: target.layoutAlign }),
    ...(target.layoutGrow === undefined ? {} : { layoutGrow: target.layoutGrow }),
  };
}
const stillCurrent = (snapshot: ReplacementSnapshot): boolean =>
  !snapshot.target.removed &&
  snapshot.target.parent === snapshot.parent &&
  snapshot.parent.children.indexOf(snapshot.target) === snapshot.index;
const removeQuietly = (node: { remove(): void }): void => {
  try {
    node.remove();
  } catch {
    /* rollback */
  }
};

/**
 * Build/persist a complete root before changing document order. Any pre-commit failure removes
 * only the new root. The old target is never patched or removed until the final commit step.
 */
export async function replaceWithRenderedDocument(
  renderer: FigmaRenderOrchestrator,
  api: Pick<FigmaRenderApi, 'currentPage' | 'viewport'>,
  request: RenderRequest,
  replacement: ReplacementSnapshot,
): Promise<RenderResult> {
  if (!stillCurrent(replacement)) throw new Error('The selected target changed before Apply.');
  const result = await renderer.render({ ...request, finalizeSelection: false });
  const root = replacementNodeFor(result.root);
  if (!root) throw new Error('Figma created an invalid replacement root.');
  try {
    if (!stillCurrent(replacement)) throw new Error('The selected target changed before Apply.');
    replacement.parent.insertChild(replacement.index, root);
    root.x = replacement.x;
    root.y = replacement.y;
    root.rotation = replacement.rotation;
    if (replacement.layoutAlign !== undefined) root.layoutAlign = replacement.layoutAlign;
    if (replacement.layoutGrow !== undefined) root.layoutGrow = replacement.layoutGrow;
    // Removal is the commit point. Do not turn a later selection/reveal error into a render error.
    replacement.target.remove();
  } catch (error) {
    removeQuietly(root);
    throw error;
  }
  try {
    api.currentPage.selection = [result.root] as unknown as readonly unknown[];
    api.viewport.scrollAndZoomIntoView?.([result.root]);
  } catch {
    /* committed replacement remains a success */
  }
  return result;
}

import { readPersistedDocumentState, type ReadablePluginDataNode } from './persistence';
import { extractTypography, type FigmaTextTypographyNode } from './typography';
import type { PersistedDocumentState } from '../shared/persistence';
import type { TypographyContext } from '../shared/types';

/** Narrow scene graph view used for safe generated-document discovery. */
export interface GeneratedSceneNode extends ReadablePluginDataNode {
  readonly id?: string;
  readonly type: string;
  readonly name?: string;
  readonly parent?: GeneratedSceneNode | null;
  readonly children?: readonly GeneratedSceneNode[];
  readonly width?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly rotation?: unknown;
  readonly removed?: boolean;
}
export interface GeneratedDocumentTarget {
  readonly root: GeneratedSceneNode;
  readonly state: PersistedDocumentState;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
/** Runtime adapter for scene nodes received from Figma's broad selection/parent APIs. */
export const isGeneratedSceneNode = (value: unknown): value is GeneratedSceneNode =>
  isRecord(value) && typeof value.type === 'string' && typeof value.getPluginData === 'function';
const finitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
/** Walks ancestors only. It never reads compiled children to reconstruct source. */
export function findGeneratedDocumentTarget(
  selection: readonly GeneratedSceneNode[],
): GeneratedDocumentTarget | undefined {
  if (selection.length !== 1) return undefined;
  const visited = new Set<GeneratedSceneNode>();
  let node: GeneratedSceneNode | null | undefined = selection[0];
  while (node && !visited.has(node)) {
    visited.add(node);
    const state = readPersistedDocumentState(
      node,
      finitePositive(node.width) ? node.width : undefined,
    );
    if (state) return { root: node, state };
    node = node.parent;
  }
  return undefined;
}
// Root names are Math Paragraph/Math Document. Only generated formula containers are excluded.
const mathContainer = (node: GeneratedSceneNode): boolean =>
  /^(?:Math:|Display Math(?:$|:))/.test(node.name ?? '');
const isNativeTextTypographyNode = (
  node: GeneratedSceneNode,
): node is GeneratedSceneNode & FigmaTextTypographyNode =>
  node.type === 'TEXT' &&
  'fontName' in node &&
  'fontSize' in node &&
  'lineHeight' in node &&
  'letterSpacing' in node &&
  'fills' in node;
/** Deterministic typography policy: first depth-first native prose TextNode, never a math subtree. */
export function firstNativeProseTypography(
  root: GeneratedSceneNode,
  mixed: unknown,
): TypographyContext | undefined {
  const walk = (node: GeneratedSceneNode, insideMath: boolean): TypographyContext | undefined => {
    const math = insideMath || mathContainer(node);
    if (!math && isNativeTextTypographyNode(node)) {
      const typography = extractTypography(node, mixed);
      return typography.ok ? typography.typography : undefined;
    }
    for (const child of node.children ?? []) {
      const found = walk(child, math);
      if (found) return found;
    }
    return undefined;
  };
  return walk(root, false);
}

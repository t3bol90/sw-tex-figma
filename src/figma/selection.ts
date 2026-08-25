import type { FontDescriptor, TypographyContext } from '../shared/types';
import {
  extractTypography,
  type FigmaTextTypographyNode,
  type TypographyIssue,
} from './typography';

export const DEFAULT_PARAGRAPH_WIDTH = 480;

export interface TextPlacement {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

/** Data retained only after every source, geometry, and typography field is valid. */
export interface TextSelectionSnapshot {
  readonly source: string;
  readonly width: number;
  readonly typography: TypographyContext;
  readonly placement: TextPlacement;
}

export interface FigmaSceneNodeLike {
  readonly type: string;
}

export interface FigmaSelectedTextNode extends FigmaSceneNodeLike, FigmaTextTypographyNode {
  readonly type: 'TEXT';
  readonly characters: unknown;
  readonly width: unknown;
  readonly x: unknown;
  readonly y: unknown;
  readonly rotation: unknown;
}

/** The narrow portion of PluginAPI selection/font APIs used by this module. */
export interface FigmaSelectionApi {
  readonly mixed: unknown;
  readonly currentPage: { readonly selection: readonly FigmaSceneNodeLike[] };
  loadFontAsync(fontName: FontDescriptor): Promise<void>;
}

export type SelectionIssueCode =
  | 'INVALID_SOURCE'
  | 'INVALID_WIDTH'
  | 'INVALID_POSITION'
  | 'INVALID_ROTATION'
  | 'TYPOGRAPHY'
  | 'FONT_UNAVAILABLE';

export interface SelectionIssue {
  readonly code: SelectionIssueCode;
  readonly message: string;
  readonly typographyIssue?: TypographyIssue;
  readonly fontName?: FontDescriptor;
  readonly cause?: unknown;
}

export type SelectionSnapshotOutcome =
  | { readonly kind: 'selected'; readonly snapshot: TextSelectionSnapshot }
  | { readonly kind: 'no-selection' }
  | { readonly kind: 'multiple-selection'; readonly count: number }
  | { readonly kind: 'non-text-selection'; readonly nodeType: string }
  | { readonly kind: 'invalid-text-selection'; readonly issue: SelectionIssue };

const snapshots = new WeakMap<TextSelectionSnapshot, FigmaSelectedTextNode>();
/** Controller-only target identity; it is deliberately not enumerable or sent to the iframe. */
export const selectedSnapshotNode = (
  snapshot: TextSelectionSnapshot,
): FigmaSelectedTextNode | undefined => snapshots.get(snapshot);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const fontLabel = (fontName: FontDescriptor): string => `"${fontName.family} ${fontName.style}"`;

/**
 * Reads exactly one text node. Font loading confirms that its requested font is
 * actually available before the snapshot is offered to the UI.
 */
export async function readSelectionSnapshot(
  api: FigmaSelectionApi,
): Promise<SelectionSnapshotOutcome> {
  const selection = api.currentPage.selection;
  if (selection.length === 0) return { kind: 'no-selection' };
  if (selection.length !== 1) return { kind: 'multiple-selection', count: selection.length };

  const candidate = selection[0];
  if (candidate.type !== 'TEXT') return { kind: 'non-text-selection', nodeType: candidate.type };
  const node = candidate as FigmaSelectedTextNode;

  if (typeof node.characters !== 'string') {
    return {
      kind: 'invalid-text-selection',
      issue: { code: 'INVALID_SOURCE', message: 'The selected text source is not available.' },
    };
  }
  if (!isFiniteNumber(node.width) || node.width <= 0) {
    return {
      kind: 'invalid-text-selection',
      issue: {
        code: 'INVALID_WIDTH',
        message: 'The selected text width must be a positive finite number.',
      },
    };
  }
  if (!isFiniteNumber(node.x) || !isFiniteNumber(node.y)) {
    return {
      kind: 'invalid-text-selection',
      issue: { code: 'INVALID_POSITION', message: 'The selected text position is not finite.' },
    };
  }
  if (!isFiniteNumber(node.rotation)) {
    return {
      kind: 'invalid-text-selection',
      issue: { code: 'INVALID_ROTATION', message: 'The selected text rotation is not finite.' },
    };
  }

  const typographyResult = extractTypography(node, api.mixed);
  if (!typographyResult.ok) {
    return {
      kind: 'invalid-text-selection',
      issue: {
        code: 'TYPOGRAPHY',
        message: typographyResult.issue.message,
        typographyIssue: typographyResult.issue,
      },
    };
  }

  try {
    await api.loadFontAsync(typographyResult.typography.fontName);
  } catch (cause: unknown) {
    return {
      kind: 'invalid-text-selection',
      issue: {
        code: 'FONT_UNAVAILABLE',
        fontName: typographyResult.typography.fontName,
        message: `Figma could not load font ${fontLabel(typographyResult.typography.fontName)}.`,
        cause,
      },
    };
  }

  const snapshot: TextSelectionSnapshot = {
    source: node.characters,
    width: node.width,
    typography: typographyResult.typography,
    placement: { x: node.x, y: node.y, rotation: node.rotation },
  };
  snapshots.set(snapshot, node);
  return { kind: 'selected', snapshot };
}

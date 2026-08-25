import {
  calibrateProseMetrics,
  type DisplayMathPlan,
  type ParagraphPlan,
  type ProseBaselineCalibration,
} from '../layout';
import type { RenderSettings, SolidFill } from '../shared/types';
import { importMathSvg, type FigmaSvgApi, type FigmaSvgNode } from './math-svg-import';
import { persistDocumentState, type PluginDataNode } from './persistence';
import { renderProse, type FigmaProseApi, type FigmaRenderableTextNode } from './prose-renderer';

export interface FigmaFrameNode extends PluginDataNode {
  name: string;
  x: number;
  y: number;
  layoutMode?: string;
  clipsContent?: boolean;
  fills?: unknown;
  rotation?: number;
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): void;
  remove(): void;
}
export interface FigmaDocumentRendererApi extends FigmaProseApi, FigmaSvgApi {
  createFrame(): FigmaFrameNode;
  appendChild(
    parent: FigmaFrameNode,
    child: FigmaFrameNode | FigmaRenderableTextNode | FigmaSvgNode,
  ): void;
}
export interface RenderParagraphBlock {
  readonly type: 'paragraph';
  readonly plan: ParagraphPlan;
}
export interface RenderDisplayBlock {
  readonly type: 'display-math';
  readonly plan: DisplayMathPlan;
}
export type RenderBlock = RenderParagraphBlock | RenderDisplayBlock;
export interface DocumentRenderPolicy {
  readonly blockGap: number;
}
export const documentRenderPolicy = (fontSize: number): DocumentRenderPolicy => ({
  blockGap: fontSize * 0.5,
});
export interface RenderDocumentLayersInput {
  readonly source: string;
  readonly settings: RenderSettings;
  readonly blocks: readonly RenderBlock[];
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  /** Probe-derived calibration, or an explicitly documented fallback. */
  readonly baselineCalibration?: ProseBaselineCalibration;
}
export interface DocumentBounds {
  readonly width: number;
  readonly height: number;
}
export function calculateDocumentBounds(
  blocks: readonly RenderBlock[],
  settings: RenderSettings,
): DocumentBounds {
  const policy = documentRenderPolicy(settings.typography.fontSize);
  const widths = blocks.map((block) =>
    block.type === 'paragraph'
      ? Math.max(settings.width, ...block.plan.lines.map((line) => line.width))
      : Math.max(settings.width, block.plan.metrics.width),
  );
  const heights = blocks.map((block) =>
    block.type === 'paragraph' ? block.plan.height : block.plan.metrics.height,
  );
  return {
    width: Math.max(settings.width, ...widths, 1),
    height: Math.max(
      1,
      heights.reduce((total, height) => total + height, 0) +
        Math.max(0, blocks.length - 1) * policy.blockGap,
    ),
  };
}
const alignmentFor = (settings: RenderSettings): 'left' | 'center' | 'right' =>
  settings.textAlignment === 'justify' ? 'left' : settings.textAlignment;
const alignedX = (
  alignment: 'left' | 'center' | 'right',
  available: number,
  content: number,
): number =>
  content >= available
    ? 0
    : alignment === 'center'
      ? (available - content) / 2
      : alignment === 'right'
        ? available - content
        : 0;
const positive = (value: number): number => (Number.isFinite(value) ? Math.max(1, value) : 1);
type Tracked = FigmaFrameNode | FigmaRenderableTextNode | FigmaSvgNode;
type ActualBlock = {
  readonly frame: FigmaFrameNode;
  readonly width: number;
  readonly height: number;
  readonly displayMath?: FigmaSvgNode;
  readonly displayMetricsWidth?: number;
  /** Repositioned only after final root width is known. */
  readonly lines?: readonly {
    readonly frame: FigmaFrameNode;
    readonly width: number;
    readonly plannedX: number;
  }[];
};

/**
 * Creates the scene tree transactionally. Text is emitted as a single native
 * node per merged segment, then its actual Figma bounds replace planned sums.
 * We intentionally keep compositor break decisions stable; reconciliation only
 * moves later siblings on the same line and expands actual overflow bounds.
 */
export async function renderDocumentLayers(
  api: FigmaDocumentRendererApi,
  input: RenderDocumentLayersInput,
  track: (node: Tracked) => void,
): Promise<FigmaFrameNode> {
  const policy = documentRenderPolicy(input.settings.typography.fontSize);
  const initial = calculateDocumentBounds(input.blocks, input.settings);
  const root = api.createFrame();
  track(root);
  root.name =
    input.blocks.length === 1 && input.blocks[0]?.type === 'paragraph'
      ? 'Math Paragraph'
      : 'Math Document';
  root.layoutMode = 'NONE';
  root.clipsContent = false;
  root.fills = [];
  root.resize(positive(initial.width), positive(initial.height));
  root.x = input.x;
  root.y = input.y;
  root.rotation = input.rotation ?? 0;
  let top = 0;
  let actualWidth = input.settings.width;
  const actual: ActualBlock[] = [];
  for (const block of input.blocks) {
    const rendered =
      block.type === 'paragraph'
        ? await renderParagraph(
            api,
            root,
            block.plan,
            input.settings,
            top,
            input.baselineCalibration,
            track,
          )
        : renderDisplay(
            api,
            root,
            block.plan,
            input.settings.width,
            top,
            input.settings.typography.fills,
            track,
          );
    actual.push(rendered);
    actualWidth = Math.max(actualWidth, rendered.width);
    top += rendered.height + policy.blockGap;
  }
  const actualHeight = Math.max(1, top - (input.blocks.length ? policy.blockGap : 0));
  // Use the final non-clipping root width for all geometry. This includes a root
  // widened by an actual native TextNode, so paragraphs and displays agree.
  for (const block of actual) {
    for (const line of block.lines ?? [])
      line.frame.x =
        alignmentFor(input.settings) === 'left'
          ? line.plannedX
          : alignedX(alignmentFor(input.settings), actualWidth, line.width);
    if (block.displayMath && block.displayMetricsWidth !== undefined)
      block.displayMath.x = alignedX(
        alignmentFor(input.settings),
        actualWidth,
        block.displayMetricsWidth,
      );
  }
  root.resize(positive(actualWidth), positive(actualHeight));
  // Persist actual compiled width, not requested width or fragment-sum width.
  persistDocumentState(root, input.source, input.settings, root.width);
  return root;
}

async function renderParagraph(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  plan: ParagraphPlan,
  settings: RenderSettings,
  top: number,
  calibration: ProseBaselineCalibration | undefined,
  track: (node: Tracked) => void,
): Promise<ActualBlock> {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Paragraph';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  frame.x = 0;
  frame.y = top;
  api.appendChild(root, frame);
  let lineTop = 0;
  let width = settings.width;
  const renderedLines: Array<{ frame: FigmaFrameNode; width: number; plannedX: number }> = [];
  for (let i = 0; i < plan.lines.length; i += 1) {
    const line = plan.lines[i]!;
    const result = await renderLine(api, frame, line, settings, calibration, i, track);
    result.frame.y = lineTop;
    renderedLines.push({ ...result, plannedX: line.x });
    const plannedGap =
      i + 1 < plan.lines.length ? Math.max(0, plan.lines[i + 1]!.y - (line.y + line.height)) : 0;
    lineTop += result.height + plannedGap;
    width = Math.max(width, result.width);
  }
  // The root may expand after later blocks are reconciled. Final x positions are
  // assigned by renderDocumentLayers against that final root width.
  frame.resize(positive(width), positive(lineTop));
  return { frame, width, height: lineTop, lines: renderedLines };
}

async function renderLine(
  api: FigmaDocumentRendererApi,
  paragraph: FigmaFrameNode,
  line: ParagraphPlan['lines'][number],
  settings: RenderSettings,
  calibration: ProseBaselineCalibration | undefined,
  index: number,
  track: (node: Tracked) => void,
): Promise<{ frame: FigmaFrameNode; width: number; height: number }> {
  const frame = api.createFrame();
  track(frame);
  frame.name = `Line ${index + 1}`;
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  api.appendChild(paragraph, frame);
  const children: Array<{
    node: FigmaRenderableTextNode | FigmaSvgNode;
    metrics: { width: number; height: number; ascent: number; descent: number };
    plannedX: number;
    plannedY: number;
    readonly justifyGapAfter: boolean;
  }> = [];
  for (const child of line.children) {
    if (child.type === 'math')
      children.push({
        node: importMathSvg(api, child, track, settings.typography.fills),
        metrics: child.metrics,
        plannedX: child.x,
        plannedY: child.y,
        justifyGapAfter: false,
      });
    else {
      const text = await renderProse(api, child, settings.typography, track);
      // Actual final merged-node bounds contain cross-fragment kerning and letter spacing.
      const actual = calibration
        ? calibrateProseMetrics(
            { width: text.width, height: text.height },
            settings.typography,
            child.baselineCalibration ?? calibration,
          )
        : { ...child.metrics, width: text.width };
      // Figma may report an auto-width TextNode's trailing ordinary whitespace
      // as no ink bounds. Preserve that measured source separator advance so an
      // inline math SVG starts after a natural native-text space, while all
      // non-trailing kerning/letter-spacing uses the final actual width.
      const separatorWidth = child.trailingSeparatorWidth ?? Number.NaN;
      if (child.endsWithSeparator && (!Number.isFinite(separatorWidth) || separatorWidth < 0))
        throw new Error('Trailing separator measurement must be finite and non-negative.');
      // Assumption, verified against Figma auto-width behavior: the final ink
      // bound omits a terminal separator. Retain only that separately measured
      // separator advance, never the whole planned prose segment.
      const metrics = child.endsWithSeparator
        ? { ...actual, width: actual.width + separatorWidth }
        : actual;
      children.push({
        node: text,
        metrics,
        plannedX: child.x,
        plannedY: child.y,
        justifyGapAfter: child.justifyGapAfter === true,
      });
    }
  }
  const ascent = children.length
    ? Math.max(...children.map((child) => child.metrics.ascent))
    : line.ascent;
  const descent = children.length
    ? Math.max(...children.map((child) => child.metrics.descent))
    : line.descent;
  // TextNode widths are authoritative. Only after all final native widths are
  // known can a justified line share its positive remainder across source gaps.
  const naturalWidth = children.reduce((total, child) => total + child.metrics.width, 0);
  const gaps = line.justified ? children.filter((child) => child.justifyGapAfter) : [];
  const extraPerGap =
    gaps.length > 0 && naturalWidth < settings.width
      ? (settings.width - naturalWidth) / gaps.length
      : 0;
  let cursor = children.length ? children[0]!.plannedX - line.x : 0;
  for (const child of children) {
    api.appendChild(frame, child.node);
    child.node.x = cursor;
    // Direct renderer callers without a calibration preserve legacy plan y;
    // production passes a calibration and uses actual baseline alignment.
    child.node.y = calibration ? ascent - child.metrics.ascent : child.plannedY - line.y;
    cursor += child.metrics.width + (child.justifyGapAfter ? extraPerGap : 0);
  }
  const height = ascent + descent;
  frame.resize(positive(cursor), positive(height));
  return { frame, width: cursor, height };
}

function renderDisplay(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  plan: DisplayMathPlan,
  width: number,
  top: number,
  fills: readonly SolidFill[],
  track: (node: Tracked) => void,
): ActualBlock {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Display Math';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  frame.resize(positive(width), positive(plan.metrics.height));
  frame.x = 0;
  frame.y = top;
  api.appendChild(root, frame);
  const math = importMathSvg(api, plan, track, fills);
  api.appendChild(frame, math);
  math.x = 0;
  math.y = 0;
  return {
    frame,
    width: Math.max(width, plan.metrics.width),
    height: plan.metrics.height,
    displayMath: math,
    displayMetricsWidth: plan.metrics.width,
  };
}

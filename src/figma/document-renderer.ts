import {
  calibrateProseMetrics,
  DEFAULT_PROSE_BASELINE_CALIBRATION,
  type DisplayMathPlan,
  type ParagraphPlan,
  type ProseBaselineCalibration,
  type RulePlan,
} from '../layout';
import type { BlockContainer, HeadingLevel } from '../shared/document-model';
import type { RenderSettings, SolidFill, TypographyContext } from '../shared/types';
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
  resizeWithoutConstraints(width: number, height: number): void;
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
  /** Block typography when it differs from the settings, as for headings. */
  readonly typography?: TypographyContext;
  readonly heading?: HeadingLevel;
  readonly code?: true;
  readonly containers?: readonly BlockContainer[];
}
export interface RenderDisplayBlock {
  readonly type: 'display-math';
  readonly plan: DisplayMathPlan;
}
export interface RenderRuleBlock {
  readonly type: 'rule';
  readonly plan: RulePlan;
}
export type RenderBlock = RenderParagraphBlock | RenderDisplayBlock | RenderRuleBlock;
export interface DocumentRenderPolicy {
  readonly blockGap: number;
  /** Gap between consecutive blocks that both belong to a list item. */
  readonly listItemGap: number;
  /** Horizontal indent added by each enclosing list item. */
  readonly listIndent: number;
  /** Horizontal indent added by each enclosing block quote. */
  readonly quoteIndent: number;
  /** Width of the vertical bar drawn at the left edge of a block quote. */
  readonly quoteBarWidth: number;
  /** Space between a list marker's right edge and the item content. */
  readonly markerGap: number;
  /** Minimum content width kept for a deeply nested block. */
  readonly minContentWidth: number;
  /** Height of a thematic-break block; its line is centered inside it. */
  readonly ruleHeight: number;
  readonly ruleThickness: number;
  /** Opacity applied to the text fill for quote bars and rules. */
  readonly decorationOpacity: number;
}
export const documentRenderPolicy = (fontSize: number): DocumentRenderPolicy => ({
  blockGap: fontSize * 0.5,
  listItemGap: fontSize * 0.25,
  listIndent: fontSize * 1.5,
  quoteIndent: fontSize,
  quoteBarWidth: Math.max(1, fontSize * 0.15),
  markerGap: fontSize * 0.4,
  minContentWidth: fontSize * 4,
  ruleHeight: fontSize,
  ruleThickness: Math.max(1, fontSize / 16),
  decorationOpacity: 0.3,
});

const blockContainers = (block: RenderBlock): readonly BlockContainer[] =>
  (block.type === 'paragraph' ? block.containers : block.plan.containers) ?? [];

const containerIndent = (container: BlockContainer, policy: DocumentRenderPolicy): number =>
  container.kind === 'list-item' ? policy.listIndent : policy.quoteIndent;

/** Left offset of a block's content inside the document root. */
export const containerOffset = (
  containers: readonly BlockContainer[],
  policy: DocumentRenderPolicy,
): number => containers.reduce((total, container) => total + containerIndent(container, policy), 0);

/** Width available to a block's content after its list and quote indents. */
export function blockContentWidth(
  settings: RenderSettings,
  containers: readonly BlockContainer[] | undefined,
): number {
  if (containers === undefined || containers.length === 0) return settings.width;
  const policy = documentRenderPolicy(settings.typography.fontSize);
  return Math.max(policy.minContentWidth, settings.width - containerOffset(containers, policy));
}

const inListItem = (block: RenderBlock): boolean =>
  blockContainers(block).some((container) => container.kind === 'list-item');

const gapBefore = (
  previous: RenderBlock,
  next: RenderBlock,
  policy: DocumentRenderPolicy,
): number => (inListItem(previous) && inListItem(next) ? policy.listItemGap : policy.blockGap);

const blockHeight = (block: RenderBlock, policy: DocumentRenderPolicy): number =>
  block.type === 'paragraph'
    ? block.plan.height
    : block.type === 'rule'
      ? policy.ruleHeight
      : block.plan.metrics.height;

const naturalBlockWidth = (block: RenderBlock): number =>
  block.type === 'paragraph'
    ? Math.max(0, ...block.plan.lines.map((line) => line.width))
    : block.type === 'rule'
      ? 0
      : block.plan.metrics.width;

/** Quote bars and rules use the text color at reduced opacity. */
const decorationFills = (
  fills: readonly SolidFill[],
  policy: DocumentRenderPolicy,
): readonly SolidFill[] => {
  const base = fills[0];
  return [
    {
      type: 'SOLID',
      color: base === undefined ? { r: 0.5, g: 0.5, b: 0.5 } : { ...base.color },
      opacity: (base?.opacity ?? 1) * policy.decorationOpacity,
    },
  ];
};

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
  const widths = blocks.map((block) => {
    const containers = blockContainers(block);
    return (
      containerOffset(containers, policy) +
      Math.max(blockContentWidth(settings, containers), naturalBlockWidth(block))
    );
  });
  const heights = blocks.map((block) => blockHeight(block, policy));
  const gaps = blocks.reduce(
    (total, block, index) =>
      index === 0 ? 0 : total + gapBefore(blocks[index - 1]!, block, policy),
    0,
  );
  return {
    width: Math.max(settings.width, ...widths, 1),
    height: Math.max(1, heights.reduce((total, height) => total + height, 0) + gaps),
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
  /** First line baseline relative to the block top, used to place a list marker. */
  readonly firstBaseline?: number;
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
interface QuoteBar {
  readonly x: number;
  readonly top: number;
  bottom: number;
}

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
  root.resizeWithoutConstraints(positive(initial.width), positive(initial.height));
  root.x = input.x;
  root.y = input.y;
  root.rotation = input.rotation ?? 0;
  const decoration = decorationFills(input.settings.typography.fills, policy);
  let top = 0;
  let actualWidth = input.settings.width;
  const actual: Array<{ readonly block: ActualBlock; readonly offset?: number }> = [];
  const quoteBars = new Map<number, QuoteBar>();
  for (let index = 0; index < input.blocks.length; index += 1) {
    const block = input.blocks[index]!;
    if (index > 0) top += gapBefore(input.blocks[index - 1]!, block, policy);
    const containers = blockContainers(block);
    const offset = containerOffset(containers, policy);
    const blockSettings: RenderSettings = {
      ...input.settings,
      width: blockContentWidth(input.settings, containers),
      typography:
        block.type === 'paragraph' && block.typography !== undefined
          ? block.typography
          : input.settings.typography,
    };
    const rendered =
      block.type === 'paragraph'
        ? await renderParagraph(
            api,
            root,
            block,
            blockSettings,
            top,
            offset,
            input.baselineCalibration,
            track,
          )
        : block.type === 'rule'
          ? renderRule(api, root, blockSettings.width, top, offset, policy, decoration, track)
          : renderDisplay(
              api,
              root,
              block.plan,
              blockSettings.width,
              top,
              offset,
              input.settings.typography.fills,
              track,
            );
    let left = 0;
    for (const container of containers) {
      if (container.kind === 'quote') {
        // Blocks of one quote are contiguous, so its bar spans first top to last bottom.
        const bar = quoteBars.get(container.id);
        if (bar === undefined)
          quoteBars.set(container.id, { x: left, top, bottom: top + rendered.height });
        else bar.bottom = top + rendered.height;
      }
      left += containerIndent(container, policy);
      if (container.kind === 'list-item' && container.marker !== undefined)
        await renderListMarker(
          api,
          root,
          container.marker,
          blockSettings.typography,
          left - policy.markerGap,
          top + (rendered.firstBaseline ?? 0),
          input.baselineCalibration,
          track,
        );
    }
    actual.push(containers.length === 0 ? { block: rendered } : { block: rendered, offset });
    actualWidth = Math.max(actualWidth, rendered.width);
    top += rendered.height;
  }
  for (const bar of quoteBars.values())
    renderQuoteBar(api, root, bar, policy.quoteBarWidth, decoration, track);
  const actualHeight = Math.max(1, top);
  // Use the final non-clipping root width for all geometry. This includes a root
  // widened by an actual native TextNode, so paragraphs and displays agree.
  // Nested blocks stay left aligned so their content lines up with markers and bars.
  for (const { block, offset } of actual) {
    const alignment = offset === undefined ? alignmentFor(input.settings) : 'left';
    const available = actualWidth - (offset ?? 0);
    for (const line of block.lines ?? [])
      line.frame.x =
        alignment === 'left' ? line.plannedX : alignedX(alignment, available, line.width);
    if (block.displayMath && block.displayMetricsWidth !== undefined)
      block.displayMath.x = alignedX(alignment, available, block.displayMetricsWidth);
  }
  root.resizeWithoutConstraints(positive(actualWidth), positive(actualHeight));
  // Persist actual compiled width, not requested width or fragment-sum width.
  persistDocumentState(root, input.source, input.settings, root.width);
  return root;
}

const paragraphName = (block: RenderParagraphBlock): string =>
  block.heading !== undefined
    ? `Heading ${block.heading}`
    : block.code
      ? 'Code Block'
      : block.containers?.some((container) => container.kind === 'list-item')
        ? 'List Item'
        : block.containers !== undefined
          ? 'Quote'
          : 'Paragraph';

async function renderParagraph(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  block: RenderParagraphBlock,
  settings: RenderSettings,
  top: number,
  indent: number,
  calibration: ProseBaselineCalibration | undefined,
  track: (node: Tracked) => void,
): Promise<ActualBlock> {
  const { plan } = block;
  const frame = api.createFrame();
  track(frame);
  frame.name = paragraphName(block);
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  frame.x = indent;
  frame.y = top;
  api.appendChild(root, frame);
  let lineTop = 0;
  let width = settings.width;
  let firstBaseline: number | undefined;
  const renderedLines: Array<{ frame: FigmaFrameNode; width: number; plannedX: number }> = [];
  for (let i = 0; i < plan.lines.length; i += 1) {
    const line = plan.lines[i]!;
    const result = await renderLine(api, frame, line, settings, calibration, i, track);
    result.frame.y = lineTop;
    firstBaseline ??= lineTop + result.ascent;
    renderedLines.push({ ...result, plannedX: line.x });
    const plannedGap =
      i + 1 < plan.lines.length ? Math.max(0, plan.lines[i + 1]!.y - (line.y + line.height)) : 0;
    lineTop += result.height + plannedGap;
    width = Math.max(width, result.width);
  }
  // The root may expand after later blocks are reconciled. Final x positions are
  // assigned by renderDocumentLayers against that final root width.
  frame.resizeWithoutConstraints(positive(width), positive(lineTop));
  return {
    frame,
    width: indent + width,
    height: lineTop,
    lines: renderedLines,
    ...(firstBaseline === undefined ? {} : { firstBaseline }),
  };
}

async function renderLine(
  api: FigmaDocumentRendererApi,
  paragraph: FigmaFrameNode,
  line: ParagraphPlan['lines'][number],
  settings: RenderSettings,
  calibration: ProseBaselineCalibration | undefined,
  index: number,
  track: (node: Tracked) => void,
): Promise<{ frame: FigmaFrameNode; width: number; height: number; ascent: number }> {
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
  frame.resizeWithoutConstraints(positive(cursor), positive(height));
  return { frame, width: cursor, height, ascent };
}

function renderDisplay(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  plan: DisplayMathPlan,
  width: number,
  top: number,
  indent: number,
  fills: readonly SolidFill[],
  track: (node: Tracked) => void,
): ActualBlock {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Display Math';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  frame.resizeWithoutConstraints(positive(width), positive(plan.metrics.height));
  frame.x = indent;
  frame.y = top;
  api.appendChild(root, frame);
  const math = importMathSvg(api, plan, track, fills);
  api.appendChild(frame, math);
  math.x = 0;
  math.y = 0;
  return {
    frame,
    width: indent + Math.max(width, plan.metrics.width),
    height: plan.metrics.height,
    displayMath: math,
    displayMetricsWidth: plan.metrics.width,
    firstBaseline: plan.metrics.ascent,
  };
}

/**
 * Creates a native list marker whose right edge sits at `right` and whose
 * calibrated baseline matches the item's first line (or display math) baseline.
 */
async function renderListMarker(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  marker: string,
  typography: TypographyContext,
  right: number,
  baseline: number,
  calibration: ProseBaselineCalibration | undefined,
  track: (node: Tracked) => void,
): Promise<void> {
  const node = await renderProse(
    api,
    {
      type: 'prose',
      text: marker,
      x: 0,
      y: 0,
      metrics: { width: 0, height: 0, ascent: 0, descent: 0 },
      measuredParts: [marker],
    },
    typography,
    track,
  );
  const metrics = calibrateProseMetrics(
    { width: node.width, height: node.height },
    typography,
    calibration ?? DEFAULT_PROSE_BASELINE_CALIBRATION,
  );
  api.appendChild(root, node);
  node.x = Math.max(0, right - metrics.width);
  node.y = baseline - metrics.ascent;
}

function renderRule(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  width: number,
  top: number,
  indent: number,
  policy: DocumentRenderPolicy,
  fills: readonly SolidFill[],
  track: (node: Tracked) => void,
): ActualBlock {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Horizontal Rule';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = fills.map((fill) => ({ ...fill, color: { ...fill.color } }));
  frame.resizeWithoutConstraints(positive(width), positive(policy.ruleThickness));
  frame.x = indent;
  frame.y = top + (policy.ruleHeight - policy.ruleThickness) / 2;
  api.appendChild(root, frame);
  return {
    frame,
    width: indent + width,
    height: policy.ruleHeight,
    // A list marker beside a rule sits on a body-text baseline in the rule's box.
    firstBaseline: policy.ruleHeight * DEFAULT_PROSE_BASELINE_CALIBRATION.emAscentRatio,
  };
}

function renderQuoteBar(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  bar: QuoteBar,
  width: number,
  fills: readonly SolidFill[],
  track: (node: Tracked) => void,
): void {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Quote Bar';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = fills.map((fill) => ({ ...fill, color: { ...fill.color } }));
  frame.resizeWithoutConstraints(positive(width), positive(bar.bottom - bar.top));
  frame.x = bar.x;
  frame.y = bar.top;
  api.appendChild(root, frame);
}

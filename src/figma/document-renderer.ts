import type { DisplayMathPlan, ParagraphPlan } from '../layout';
import type { RenderSettings } from '../shared/types';
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
  readonly displayAlignment: 'center';
}
/** MVP policy: blocks retain source order, have half-an-em gaps, and displays are centered. */
export const documentRenderPolicy = (fontSize: number): DocumentRenderPolicy => ({
  blockGap: fontSize * 0.5,
  displayAlignment: 'center',
});
export interface RenderDocumentLayersInput {
  readonly source: string;
  readonly settings: RenderSettings;
  readonly blocks: readonly RenderBlock[];
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
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
const positive = (value: number): number => (Number.isFinite(value) ? Math.max(1, value) : 1);

/** Creates the complete readable layer tree. Caller owns transaction cleanup and final selection. */
export async function renderDocumentLayers(
  api: FigmaDocumentRendererApi,
  input: RenderDocumentLayersInput,
  track: (node: FigmaFrameNode | FigmaRenderableTextNode | FigmaSvgNode) => void,
): Promise<FigmaFrameNode> {
  const policy = documentRenderPolicy(input.settings.typography.fontSize);
  const { width: contentWidth, height: contentHeight } = calculateDocumentBounds(
    input.blocks,
    input.settings,
  );
  const heights = input.blocks.map((block) =>
    block.type === 'paragraph' ? block.plan.height : block.plan.metrics.height,
  );
  const root = api.createFrame();
  track(root);
  root.name =
    input.blocks.length === 1 && input.blocks[0]?.type === 'paragraph'
      ? 'Math Paragraph'
      : 'Math Document';
  root.layoutMode = 'NONE';
  root.clipsContent = false;
  root.fills = [];
  root.resize(positive(contentWidth), positive(contentHeight));
  root.x = input.x;
  root.y = input.y;
  root.rotation = input.rotation ?? 0;
  let top = 0;
  for (let index = 0; index < input.blocks.length; index += 1) {
    const block = input.blocks[index]!;
    if (block.type === 'paragraph')
      await renderParagraph(api, root, block.plan, contentWidth, top, input.settings, track);
    else renderDisplay(api, root, block.plan, contentWidth, top, track);
    top += heights[index]! + (index + 1 < input.blocks.length ? policy.blockGap : 0);
  }
  persistDocumentState(root, input.source, input.settings, root.width);
  return root;
}
async function renderParagraph(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  plan: ParagraphPlan,
  width: number,
  top: number,
  settings: RenderSettings,
  track: (node: FigmaFrameNode | FigmaRenderableTextNode | FigmaSvgNode) => void,
): Promise<void> {
  const frame = api.createFrame();
  track(frame);
  frame.name = 'Paragraph';
  frame.layoutMode = 'NONE';
  frame.clipsContent = false;
  frame.fills = [];
  frame.resize(positive(width), positive(plan.height));
  frame.x = 0;
  frame.y = top;
  api.appendChild(root, frame);
  for (let i = 0; i < plan.lines.length; i += 1) {
    const line = plan.lines[i]!;
    const lineFrame = api.createFrame();
    track(lineFrame);
    lineFrame.name = `Line ${i + 1}`;
    lineFrame.layoutMode = 'NONE';
    lineFrame.clipsContent = false;
    lineFrame.fills = [];
    lineFrame.resize(positive(line.width), positive(line.height));
    lineFrame.x = line.x;
    lineFrame.y = line.y;
    api.appendChild(frame, lineFrame);
    for (const child of line.children) {
      if (child.type === 'prose') {
        const text = await renderProse(api, child, settings.typography, track);
        api.appendChild(lineFrame, text);
        text.x = child.x - line.x;
        text.y = child.y - line.y;
      } else {
        const math = importMathSvg(api, child, track);
        api.appendChild(lineFrame, math);
        math.x = child.x - line.x;
        math.y = child.y - line.y;
      }
    }
  }
}
function renderDisplay(
  api: FigmaDocumentRendererApi,
  root: FigmaFrameNode,
  plan: DisplayMathPlan,
  width: number,
  top: number,
  track: (node: FigmaFrameNode | FigmaRenderableTextNode | FigmaSvgNode) => void,
): void {
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
  const x = Math.max(0, (width - plan.metrics.width) / 2);
  const math = importMathSvg(api, plan, track);
  api.appendChild(frame, math);
  math.x = x;
  math.y = 0;
}

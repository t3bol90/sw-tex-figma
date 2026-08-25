import {
  composeMeasuredParagraph,
  measureDocument,
  validateRenderedMathPayloads,
  type FontResolution,
  type MeasuredDocument,
} from '../layout';
import type { MathTextDocument } from '../shared/document-model';
import type { RenderSettings, RenderedMathPayload } from '../shared/types';
import type { TextSelectionSnapshot } from './selection';
import { FigmaFontResolver } from './font-resolution';
import {
  calculateDocumentBounds,
  renderDocumentLayers,
  type FigmaDocumentRendererApi,
  type RenderBlock,
  type FigmaFrameNode,
} from './document-renderer';
import { FigmaTextMeasurer } from './text-measurement';

export interface RenderViewport {
  readonly center: { readonly x: number; readonly y: number };
  scrollAndZoomIntoView?(nodes: readonly unknown[]): void;
}
export interface FigmaRenderApi extends FigmaDocumentRendererApi {
  listAvailableFontsAsync(): Promise<
    readonly { readonly family: string; readonly style: string }[]
  >;
  readonly currentPage: { selection: readonly unknown[] | unknown[] };
  readonly viewport: RenderViewport;
}
export interface RenderRequest {
  readonly source: string;
  readonly document: MathTextDocument;
  readonly math: readonly RenderedMathPayload[];
  readonly settings: RenderSettings;
  readonly selectedSnapshot?: TextSelectionSnapshot;
}
export interface RenderResult {
  readonly root: FigmaFrameNode;
  readonly placement: { readonly x: number; readonly y: number; readonly rotation: number };
}

/** Safe create-only placement. PR 6 does not replace, remove, or reorder selection. */
export function resolveCreationPlacement(
  snapshot: TextSelectionSnapshot | undefined,
  viewport: RenderViewport,
  width: number,
  height: number,
): { x: number; y: number; rotation: number } {
  if (
    snapshot &&
    Number.isFinite(snapshot.placement.x) &&
    Number.isFinite(snapshot.placement.y) &&
    Number.isFinite(snapshot.placement.rotation)
  )
    return {
      x: snapshot.placement.x,
      y: snapshot.placement.y,
      rotation: snapshot.placement.rotation,
    };
  return { x: viewport.center.x - width / 2, y: viewport.center.y - height / 2, rotation: 0 };
}

/** Controller-side compile path: validate, measure native prose, compose, then create atomically. */
export class FigmaRenderOrchestrator {
  private readonly measurer: FigmaTextMeasurer;
  private readonly fonts: FigmaFontResolver;
  public constructor(private readonly api: FigmaRenderApi) {
    this.measurer = new FigmaTextMeasurer(api);
    this.fonts = new FigmaFontResolver(api);
  }
  public async render(request: RenderRequest): Promise<RenderResult> {
    validateRenderedMathPayloads(request.document, request.math);
    const resolutions = new Map<string, FontResolution | undefined>();
    const keyFor = (marks: readonly string[] | undefined) => marks?.join(',') ?? '';
    // Resolve all marked variants before scene mutation. This makes errors transactional by construction.
    for (const node of request.document)
      if (node.type === 'paragraph')
        for (const child of node.children)
          if (child.type === 'text' && child.marks?.length) {
            const key = keyFor(child.marks);
            if (!resolutions.has(key))
              resolutions.set(
                key,
                await this.fonts.resolve(child.marks, request.settings.typography),
              );
          }
    const measured = await measureDocument(request.document, {
      typography: request.settings.typography,
      renderedMath: request.math,
      fontResolver: (marks) => resolutions.get(keyFor(marks)),
      measureText: async (input) =>
        this.measurer.measure({
          text: input.text,
          typography: input.typography,
          ...(input.fontResolution === undefined
            ? {}
            : {
                fontResolution: {
                  fontName: input.fontResolution.fontName,
                  marks: input.fontResolution.marks,
                },
              }),
        }),
    });
    const blocks = toRenderBlocks(measured, request.settings);
    const bounds = calculateDocumentBounds(blocks, request.settings);
    const placement = resolveCreationPlacement(
      request.selectedSnapshot,
      this.api.viewport,
      bounds.width,
      bounds.height,
    );
    const created: Array<{ remove(): void }> = [];
    try {
      const root = await renderDocumentLayers(
        this.api,
        { source: request.source, settings: request.settings, blocks, ...placement },
        (node) => created.push(node),
      );
      // Selection/reveal happens only after all construction, persistence, and appends succeeded.
      this.api.viewport.scrollAndZoomIntoView?.([root]);
      this.api.currentPage.selection = [root] as unknown as readonly unknown[];
      return { root, placement };
    } catch (error) {
      for (const node of [...created].reverse()) {
        try {
          node.remove();
        } catch {
          /* best-effort rollback */
        }
      }
      throw error;
    }
  }
}
const toRenderBlocks = (
  measured: MeasuredDocument,
  settings: RenderSettings,
): readonly RenderBlock[] =>
  measured.blocks.map((block) =>
    block.type === 'paragraph'
      ? {
          type: 'paragraph',
          plan: composeMeasuredParagraph(block.measured, {
            width: settings.width,
            typography: settings.typography,
          }),
        }
      : { type: 'display-math', plan: block },
  );

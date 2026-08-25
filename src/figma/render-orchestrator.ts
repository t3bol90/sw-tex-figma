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
import {
  FigmaProseBaselineCalibrator,
  type FigmaBaselineProbeTextNode,
  type FigmaBaselineProbeVectorNode,
} from './baseline-calibration';
import { FigmaTextMeasurer } from './text-measurement';

export interface RenderViewport {
  readonly center: { readonly x: number; readonly y: number };
  scrollAndZoomIntoView?(nodes: readonly unknown[]): void;
}
export interface FigmaRenderApi extends FigmaDocumentRendererApi {
  listAvailableFontsAsync(): Promise<
    readonly { readonly family: string; readonly style: string }[]
  >;
  flatten?(nodes: readonly FigmaBaselineProbeTextNode[]): FigmaBaselineProbeVectorNode;
  readonly currentPage: { selection: readonly unknown[] | unknown[] };
  readonly viewport: RenderViewport;
}
export interface RenderRequest {
  readonly source: string;
  readonly document: MathTextDocument;
  readonly math: readonly RenderedMathPayload[];
  readonly settings: RenderSettings;
  readonly selectedSnapshot?: TextSelectionSnapshot;
  /** Replacement flows defer selection/reveal until the old node is removed. */
  readonly finalizeSelection?: boolean;
}
export interface RenderResult {
  readonly root: FigmaFrameNode;
  readonly placement: { readonly x: number; readonly y: number; readonly rotation: number };
}

/** Safe create-only placement; replacement owns its separate commit flow. */
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
  private readonly baselines: FigmaProseBaselineCalibrator;
  public constructor(private readonly api: FigmaRenderApi) {
    this.measurer = new FigmaTextMeasurer(api);
    this.fonts = new FigmaFontResolver(api);
    const probe =
      typeof api.flatten === 'function'
        ? {
            loadFontAsync: api.loadFontAsync.bind(api),
            createText: api.createText.bind(api),
            flatten: api.flatten.bind(api),
          }
        : undefined;
    this.baselines = new FigmaProseBaselineCalibrator(probe);
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
    const baseCalibration = await this.baselines.calibrate(request.settings.typography);
    const measured = await measureDocument(request.document, {
      typography: request.settings.typography,
      renderedMath: request.math,
      fontResolver: (marks) => resolutions.get(keyFor(marks)),
      baselineCalibration: baseCalibration,
      baselineCalibrationProvider: async (typography, resolution) =>
        this.baselines.calibrate(typography, resolution?.fontName),
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
      measureSeparatorAdvance: async (input) =>
        this.measurer.measureOrdinarySpaceAdvance({
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
        {
          source: request.source,
          settings: request.settings,
          blocks,
          baselineCalibration: baseCalibration,
          ...placement,
        },
        (node) => created.push(node),
      );
      // Construction has committed. Viewport/selection are deliberately best effort.
      if (request.finalizeSelection !== false) {
        try {
          this.api.viewport.scrollAndZoomIntoView?.([root]);
          this.api.currentPage.selection = [root] as unknown as readonly unknown[];
        } catch {
          /* A completed document must not be reported as failed because reveal failed. */
        }
      }
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
            textAlignment: settings.textAlignment,
          }),
        }
      : { type: 'display-math', plan: block },
  );

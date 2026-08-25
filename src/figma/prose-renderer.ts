import type { ProseLineChild } from '../layout';
import type { FontDescriptor, TypographyContext } from '../shared/types';
import { textLayerName } from './layer-names';

export interface FigmaRenderableTextNode {
  name: string;
  x: number;
  y: number;
  fontName: unknown;
  fontSize: unknown;
  lineHeight: unknown;
  letterSpacing: unknown;
  fills: unknown;
  textAutoResize?: unknown;
  characters: string;
  readonly width: number;
  readonly height: number;
  remove(): void;
}
export interface FigmaProseApi {
  loadFontAsync(font: FontDescriptor): Promise<void>;
  createText(): FigmaRenderableTextNode;
}
const finite = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** Creates one native TextNode for a compositor-merged prose child. */
export async function renderProse(
  api: FigmaProseApi,
  child: ProseLineChild,
  typography: TypographyContext,
  track: (node: FigmaRenderableTextNode) => void,
): Promise<FigmaRenderableTextNode> {
  const node = api.createText();
  track(node);
  const font = child.fontResolution?.fontName ?? typography.fontName;
  await api.loadFontAsync(font);
  node.fontName = font;
  node.fontSize = typography.fontSize;
  node.lineHeight = typography.lineHeight;
  node.letterSpacing = typography.letterSpacing;
  node.fills = typography.fills.map((fill) => ({
    type: 'SOLID' as const,
    color: { ...fill.color },
    ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
  }));
  if ('textAutoResize' in node) node.textAutoResize = 'WIDTH_AND_HEIGHT';
  node.characters = child.text;
  if (!finite(node.width) || !finite(node.height))
    throw new Error('Figma returned invalid native text dimensions.');
  node.name = textLayerName(child.text);
  return node;
}

import type { MathLineChild, DisplayMathPlan } from '../layout';
import type { SolidFill } from '../shared/types';
import { displayMathLayerName, mathLayerName } from './layer-names';

type MathPlan = MathLineChild | DisplayMathPlan;
export interface FigmaSvgNode {
  name: string;
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  resize(width: number, height: number): void;
  remove(): void;
}
export interface FigmaSvgApi {
  createNodeFromSvg(svg: string): FigmaSvgNode;
}
const valid = (value: number): boolean => Number.isFinite(value) && value > 0;

/** Imports a self-contained SVG and applies the compositor scale exactly once. */
export function importMathSvg(
  api: FigmaSvgApi,
  plan: MathPlan,
  track: (node: FigmaSvgNode) => void,
  fills?: readonly SolidFill[],
): FigmaSvgNode {
  if (
    typeof plan.rendered.svg !== 'string' ||
    plan.rendered.svg.length === 0 ||
    !/<svg\b/i.test(plan.rendered.svg)
  )
    throw new Error('Math SVG is missing or invalid.');
  if (
    /<(?:image|foreignObject)\b/i.test(plan.rendered.svg) ||
    /\b(?:href|xlink:href)=["'](?:https?:|data:)/i.test(plan.rendered.svg)
  )
    throw new Error('Math SVG must be self-contained.');
  if (!valid(plan.svgScale)) throw new Error('Math SVG scale must be finite and positive.');
  const node = api.createNodeFromSvg(withExplicitMathPaint(plan.rendered.svg, fills));
  track(node);
  if (!valid(node.width) || !valid(node.height))
    throw new Error('Figma imported invalid SVG dimensions.');
  const expectedWidth = plan.metrics.width / plan.svgScale;
  const expectedHeight = plan.metrics.height / plan.svgScale;
  const close = (actual: number, expected: number): boolean =>
    Math.abs(actual - expected) <= 1e-4 * Math.max(1, Math.abs(expected));
  if (
    !valid(expectedWidth) ||
    !valid(expectedHeight) ||
    !close(node.width, expectedWidth) ||
    !close(node.height, expectedHeight)
  )
    throw new Error('Figma SVG dimensions do not match the normalized math metrics.');
  // This is deliberately the only resize. mathScale was baked into the SVG by PR 3.
  node.resize(plan.metrics.width, plan.metrics.height);
  if (!valid(node.width) || !valid(node.height))
    throw new Error('Figma resized SVG to invalid dimensions.');
  node.name =
    plan.type === 'display-math' ? displayMathLayerName(plan.latex) : mathLayerName(plan.latex);
  return node;
}

const hex = (value: number): string =>
  Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * Figma SVG import does not reliably resolve CSS `currentColor`. MathJax paths
 * inherit paint from the root, so set a concrete root fill and only replace the
 * paint token (never geometry, defs, or URL data). The first native prose fill
 * is the documented math colour; its opacity is retained on the root.
 */
export function withExplicitMathPaint(svg: string, fills: readonly SolidFill[] = []): string {
  const fill = fills[0];
  const color = fill ? `#${hex(fill.color.r)}${hex(fill.color.g)}${hex(fill.color.b)}` : '#000000';
  const opacity = fill?.opacity;
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) throw new Error('Math SVG is missing an SVG root.');
  const paintedRoot = root.replace(
    />$/,
    ` fill="${color}"${opacity === undefined ? '' : ` fill-opacity="${opacity}"`}>`,
  );
  return svg.replace(root, paintedRoot).replace(/\bcurrentColor\b/g, color);
}

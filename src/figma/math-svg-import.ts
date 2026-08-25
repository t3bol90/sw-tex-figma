import type { MathLineChild, DisplayMathPlan } from '../layout';
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
  const node = api.createNodeFromSvg(plan.rendered.svg);
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

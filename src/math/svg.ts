import { layoutMathJaxSvgFragments } from './metrics';

const decimal = (value: number): string => Number(value.toFixed(6)).toString();
const rootOf = (svg: string): string => {
  const root = /<svg\b[^>]*>/i.exec(svg)?.[0];
  if (!root) throw new Error('MathJax did not serialize an SVG root.');
  return root;
};
const inner = (svg: string): string => svg.replace(/^<svg\b[^>]*>/i, '').replace(/<\/svg>$/i, '');

/** Return one self-contained SVG. Adjacent MathJax SVG fragments are composed atomically. */
export function normalizeMathJaxSvg(serialized: string, mathScale: number): string {
  const layout = layoutMathJaxSvgFragments(serialized);
  const { fragments, box } = layout;
  const firstRoot = rootOf(fragments[0]!);
  const attributes = firstRoot
    .replace(/\s(?:width|height|style|xmlns|role|focusable|viewBox)=['"][^'"]*['"]/gi, '')
    .replace(/>$/, '');
  const contents = fragments
    .map(
      (fragment, index) =>
        `<g transform="translate(${decimal(layout.offsets[index]!)},0)">${inner(fragment)}</g>`,
    )
    .join('');
  const normalized = `${attributes} xmlns="http://www.w3.org/2000/svg" viewBox="${decimal(box.viewBoxX)} ${decimal(box.viewBoxY)} ${decimal(box.viewBoxWidth)} ${decimal(box.viewBoxHeight)}" width="${decimal(box.width * mathScale)}" height="${decimal(box.height * mathScale)}" role="img">${contents}</svg>`;
  if (
    /<(?:image|foreignObject)\b/i.test(normalized) ||
    /\b(?:href|xlink:href)=['"](?:https?:|data:)/i.test(normalized) ||
    /url\s*\(\s*(?!['"]?#)/i.test(normalized)
  )
    throw new Error('MathJax SVG unexpectedly references an external asset.');
  return normalized;
}
export const getMathJaxError = (serialized: string): string | undefined =>
  /data-mjx-error=['"]([^'"]+)['"]/i.exec(serialized)?.[1];

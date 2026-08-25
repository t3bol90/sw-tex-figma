import { extractSvgBox } from './metrics';

const decimal = (value: number): string => Number(value.toFixed(6)).toString();

/**
 * Return a standalone SVG rather than MathJax's surrounding mjx-container.
 * It has explicit pixel dimensions, its original coordinate system, inline
 * paths/defs, and no stylesheet, URL, remote font, or external asset.
 */
export function normalizeMathJaxSvg(serialized: string, mathScale: number): string {
  const svgMatch = /<svg\b[^>]*>[\s\S]*<\/svg>/i.exec(serialized);
  if (svgMatch === null) throw new Error('MathJax did not serialize an SVG.');
  const box = extractSvgBox(svgMatch[0]);
  const root = /<svg\b[^>]*>/i.exec(svgMatch[0]);
  if (root === null) throw new Error('MathJax did not serialize an SVG root.');
  const attributes = root[0]
    .replace(/\s(?:width|height|style|xmlns|role|focusable)=["'][^"']*["']/gi, '')
    .replace(/>$/, '');
  const normalizedRoot = `${attributes} xmlns="http://www.w3.org/2000/svg" width="${decimal(box.width * mathScale)}" height="${decimal(box.height * mathScale)}" role="img">`;
  const normalized = svgMatch[0].replace(root[0], normalizedRoot);
  if (
    /<(?:image|foreignObject)\b/i.test(normalized) ||
    /\b(?:href|xlink:href)=["'](?:https?:|data:)/i.test(normalized) ||
    /url\s*\(\s*(?!['"]?#)/i.test(normalized)
  ) {
    throw new Error('MathJax SVG unexpectedly references an external asset.');
  }
  return normalized;
}

export const getMathJaxError = (serialized: string): string | undefined => {
  const match = /data-mjx-error=["']([^"']+)["']/i.exec(serialized);
  return match?.[1];
};

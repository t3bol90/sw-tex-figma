/** Truncate by Unicode code points, never UTF-16 halves. */
export function truncateCodePoints(value: string, maximum = 72): string {
  if (!Number.isInteger(maximum) || maximum < 1)
    throw new Error('maximum must be a positive integer.');
  const points = Array.from(value);
  return points.length <= maximum
    ? value
    : `${points.slice(0, Math.max(1, maximum - 1)).join('')}…`;
}

export const textLayerName = (text: string): string => `Text: ${truncateCodePoints(text, 56)}`;
export const mathLayerName = (latex: string): string => `Math: ${truncateCodePoints(latex, 56)}`;
export const displayMathLayerName = (latex: string): string =>
  `Display Math: ${truncateCodePoints(latex, 56)}`;

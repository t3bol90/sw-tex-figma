import type { HeadingLevel, ParagraphNode } from '../shared/document-model';
import { MAX_FONT_SIZE } from '../shared/messages';
import type { TypographyContext } from '../shared/types';

/** Heading size relative to body text. Levels 4–6 differ from body text only by weight. */
export const HEADING_SCALE: Readonly<Record<HeadingLevel, number>> = {
  1: 1.5,
  2: 1.3,
  3: 1.15,
  4: 1,
  5: 1,
  6: 1,
};

/**
 * Effective typography for one block. Headings scale font size and any absolute
 * line height or letter spacing together, so their line boxes and inline math
 * keep body-text proportions. The size is clamped to the measurable maximum.
 */
export function blockTypography(
  typography: TypographyContext,
  node: Pick<ParagraphNode, 'heading'>,
): TypographyContext {
  if (node.heading === undefined) return typography;
  const fontSize = Math.min(MAX_FONT_SIZE, typography.fontSize * HEADING_SCALE[node.heading]);
  const factor = fontSize / typography.fontSize;
  if (factor === 1) return typography;
  return {
    ...typography,
    fontSize,
    lineHeight:
      typography.lineHeight.unit === 'PIXELS'
        ? { unit: 'PIXELS', value: typography.lineHeight.value * factor }
        : typography.lineHeight,
    letterSpacing:
      typography.letterSpacing.unit === 'PIXELS'
        ? { unit: 'PIXELS', value: typography.letterSpacing.value * factor }
        : typography.letterSpacing,
  };
}

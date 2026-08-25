/** Convert expected parsing/rendering failures into safe, concise UI text. */
export const formatMathErrorForUi = (error: unknown): string => {
  const raw =
    error instanceof Error && error.message ? error.message : 'Could not render the source.';
  const withoutControls = Array.from(raw, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint === 127 || codePoint < 32 ? ' ' : character;
  }).join('');
  const cleaned = withoutControls.replace(/\s+/g, ' ').trim();
  return `Could not apply: ${cleaned.slice(0, 700) || 'Could not render the source.'}`;
};

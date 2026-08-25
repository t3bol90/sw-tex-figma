import type { TextMark } from '../shared/document-model';

const MARK_ORDER: readonly TextMark[] = ['bold', 'italic'];

/**
 * Marks have one canonical order, regardless of their nesting order in Markdown.
 * Unmarked text uses `undefined` rather than an empty array.
 */
export const canonicalizeMarks = (marks: readonly TextMark[]): readonly TextMark[] | undefined => {
  const present = new Set(marks);
  const canonical = MARK_ORDER.filter((mark) => present.has(mark));

  return canonical.length === 0 ? undefined : canonical;
};

export const haveEqualMarks = (
  left: readonly TextMark[] | undefined,
  right: readonly TextMark[] | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((mark, index) => mark === right[index]));

export const withMark = (marks: readonly TextMark[], mark: TextMark): readonly TextMark[] =>
  canonicalizeMarks([...marks, mark]) ?? [];

import type { ParagraphNode, TextRun } from '../shared/document-model';

import type { InlineToken, ProseToken, SeparatorToken } from './types';

/**
 * Breakable separators are ordinary spaces, tabs, CR/LF, and these Unicode
 * whitespace code points: U+1680, U+2000..U+200A, U+2028, U+2029, U+205F, U+3000.
 * NBSP (U+00A0), narrow NBSP (U+202F), and word joiner remain content.
 */
const BREAKABLE_WHITESPACE_CODE_POINTS = new Set<number>([
  0x0009,
  0x000a,
  0x000b,
  0x000c,
  0x000d,
  0x0020,
  0x1680,
  0x2028,
  0x2029,
  0x205f,
  0x3000,
  ...Array.from({ length: 0x200a - 0x2000 + 1 }, (_, offset) => 0x2000 + offset),
]);

export const isBreakableWhitespace = (character: string): boolean =>
  Array.from(character).length === 1 &&
  BREAKABLE_WHITESPACE_CODE_POINTS.has(character.codePointAt(0) ?? -1);

/**
 * Splits a text run only at real whitespace. Non-whitespace portions retain
 * their source order and marks. Adjacent non-separator tokens are intentionally
 * glued by the line breaker, including text/math punctuation boundaries.
 */
export function tokenizeTextRun(
  run: TextRun,
  sourceRunIndex: number,
): readonly (ProseToken | SeparatorToken)[] {
  const tokens: (ProseToken | SeparatorToken)[] = [];
  let value = '';
  let separatorValue: boolean | undefined;
  for (const character of run.value) {
    const separatorCharacter = isBreakableWhitespace(character);
    if (separatorValue !== undefined && separatorValue !== separatorCharacter) {
      tokens.push(
        separatorValue ? separator(run, value, sourceRunIndex) : prose(run, value, sourceRunIndex),
      );
      value = '';
    }
    value += character;
    separatorValue = separatorCharacter;
  }
  if (value.length > 0) {
    tokens.push(
      separatorValue ? separator(run, value, sourceRunIndex) : prose(run, value, sourceRunIndex),
    );
  }
  return tokens;
}

export function tokenizeParagraph(paragraph: ParagraphNode): readonly InlineToken[] {
  const tokens: InlineToken[] = [];
  paragraph.children.forEach((run, sourceRunIndex) => {
    switch (run.type) {
      case 'text':
        tokens.push(...tokenizeTextRun(run, sourceRunIndex));
        return;
      case 'math':
        tokens.push({ kind: 'math', latex: run.latex, display: false, sourceRunIndex });
        return;
      case 'break':
        tokens.push({ kind: 'hard-break', sourceRunIndex });
    }
  });
  return tokens;
}

const prose = (run: TextRun, text: string, sourceRunIndex: number): ProseToken => ({
  kind: 'prose',
  text,
  ...(run.marks === undefined ? {} : { marks: run.marks }),
  sourceRunIndex,
});

const separator = (run: TextRun, text: string, sourceRunIndex: number): SeparatorToken => ({
  kind: 'separator',
  text,
  ...(run.marks === undefined ? {} : { marks: run.marks }),
  sourceRunIndex,
});

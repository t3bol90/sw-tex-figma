export type MarkdownParserErrorCode = 'UNSUPPORTED_BLOCK_NODE' | 'UNSUPPORTED_INLINE_NODE';

export interface MarkdownSourcePoint {
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
}

export interface MarkdownSourcePosition {
  readonly start: MarkdownSourcePoint;
  readonly end: MarkdownSourcePoint;
}

/** A structured error for Markdown syntax that this application model cannot represent. */
export class MarkdownParserError extends Error {
  public readonly name = 'MarkdownParserError';

  public constructor(
    public readonly code: MarkdownParserErrorCode,
    public readonly nodeType: string,
    public readonly position?: MarkdownSourcePosition,
  ) {
    super(
      `Unsupported ${code === 'UNSUPPORTED_BLOCK_NODE' ? 'block' : 'inline'} Markdown node ` +
        `"${nodeType}"${formatPosition(position)}.`,
    );
  }
}

const formatPosition = (position: MarkdownSourcePosition | undefined): string =>
  position === undefined ? '' : ` at ${position.start.line}:${position.start.column}`;

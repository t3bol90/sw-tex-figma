import type { MathTextDocument } from '../shared/document-model';
import type { RenderedMathPayload } from '../shared/types';
import { createMathCacheKey } from './cache-key';
import type { MathRenderer } from './mathjax';

export interface MathExpression {
  readonly latex: string;
  readonly display: boolean;
}

/** Walk the application AST in source order; each delimiter span remains atomic. */
export const collectMathExpressions = (document: MathTextDocument): readonly MathExpression[] => {
  const expressions: MathExpression[] = [];
  for (const node of document) {
    if (node.type === 'display-math') expressions.push({ latex: node.latex, display: true });
    if (node.type === 'paragraph') {
      for (const child of node.children) {
        if (child.type === 'math') expressions.push({ latex: child.latex, display: child.display });
      }
    }
  }
  return expressions;
};

/**
 * Render distinct renderer inputs once, then expand back to AST order. This
 * preserves a payload for each source expression, including repeated spans.
 */
export async function renderDocumentMath(
  document: MathTextDocument,
  mathScale: number,
  renderer: MathRenderer,
): Promise<readonly RenderedMathPayload[]> {
  const expressions = collectMathExpressions(document);
  const unique = new Map<string, MathExpression>();
  for (const expression of expressions) {
    const key = createMathCacheKey({
      ...expression,
      mathScale,
      rendererIdentity: renderer.rendererIdentity,
    });
    if (!unique.has(key)) unique.set(key, expression);
  }
  const rendered = new Map<string, RenderedMathPayload>();
  for (const [key, expression] of unique) {
    rendered.set(key, await renderer.render({ ...expression, mathScale }));
  }
  return expressions.map((expression) => {
    const key = createMathCacheKey({
      ...expression,
      mathScale,
      rendererIdentity: renderer.rendererIdentity,
    });
    const payload = rendered.get(key);
    if (payload === undefined) throw new Error('Missing rendered math payload.');
    return payload;
  });
}

import { describe, expect, it } from 'vitest';
import { FigmaRenderOrchestrator } from '../src/figma/render-orchestrator';
import { MathJaxSvgRenderer, renderDocumentMath } from '../src/math';
import { parseMarkdown } from '../src/parser';
import type { RenderSettings } from '../src/shared/types';

const source = String.raw`**Theorem:** For a right triangle with legs $a$, $b$
and hypotenuse $c$,

$$
\boxed{a^2+b^2=c^2}
$$

**Proof:**

By the law of cosines,

$$
c^2=a^2+b^2-2ab\cos(90^\circ)
$$

Since $\cos(90^\circ)=0$,

$$
\begin{aligned}
c^2 &= a^2+b^2-2ab(0)\\
&=a^2+b^2
\end{aligned}
$$

Therefore,

$$
\boxed{a^2+b^2=c^2}
$$

$$
\blacksquare
$$`;

class NativeNode {
  name = '';
  x = 0;
  y = 0;
  rotation = 0;
  width = 100;
  height = 100;
  fontName: unknown;
  fontSize = 16;
  lineHeight: unknown;
  letterSpacing: unknown;
  textAutoResize: unknown;
  fills: unknown;
  layoutMode?: string;
  clipsContent?: boolean;
  children: NativeNode[] = [];
  removed = false;
  private content = '';

  constructor(readonly constraint: 'MIN' | 'SCALE') {}

  get characters(): string {
    return this.content;
  }
  set characters(value: string) {
    this.content = value;
    this.width = (value.trimEnd().length * this.fontSize) / 2;
    this.height = this.fontSize;
  }
  resize(width: number, height: number): void {
    const horizontal = width / this.width;
    const vertical = height / this.height;
    for (const child of this.children) {
      if (child.constraint !== 'SCALE') continue;
      child.x *= horizontal;
      child.y *= vertical;
      child.resize(child.width * horizontal, child.height * vertical);
    }
    this.resizeWithoutConstraints(width, height);
  }
  resizeWithoutConstraints(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
  remove(): void {
    this.removed = true;
  }
  setPluginData(): void {}
  setRelaunchData(): void {}
}

const svgDimension = (svg: string, dimension: 'width' | 'height'): number => {
  const value = new RegExp(`\\b${dimension}="([^"]+)"`).exec(svg)?.[1];
  if (!value) throw new Error(`Missing SVG ${dimension}.`);
  return Number(value);
};

describe('layout with native child constraints', () => {
  it.each([
    { fontSize: 16, textAlignment: 'center' },
    { fontSize: 32, textAlignment: 'right' },
  ] as const)(
    'preserves theorem geometry at $fontSize px with $textAlignment alignment',
    async ({ fontSize, textAlignment }) => {
      const document = parseMarkdown(source);
      const math = await renderDocumentMath(document, 1, new MathJaxSvgRenderer());
      const settings: RenderSettings = {
        width: 480,
        mathScale: 1,
        inheritTypography: true,
        textAlignment,
        typography: {
          fontName: { family: 'Inter', style: 'Regular' },
          fontSize,
          lineHeight: { unit: 'AUTO' },
          letterSpacing: { unit: 'PIXELS', value: 0 },
          fills: [],
        },
      };
      for (const constraint of ['MIN', 'SCALE'] as const) {
        const nodes: NativeNode[] = [];
        const imported: Array<{ node: NativeNode; width: number; height: number }> = [];
        const make = () => {
          const node = new NativeNode(constraint);
          nodes.push(node);
          return node;
        };
        const api = {
          loadFontAsync: async () => undefined,
          listAvailableFontsAsync: async () => [
            { family: 'Inter', style: 'Regular' },
            { family: 'Inter', style: 'Bold' },
          ],
          createFrame: make,
          createText: make,
          createNodeFromSvg: (svg: string) => {
            const node = make();
            const width = svgDimension(svg, 'width');
            const height = svgDimension(svg, 'height');
            node.resizeWithoutConstraints(width, height);
            const vector = new NativeNode('SCALE');
            vector.resizeWithoutConstraints(width, height);
            node.children.push(vector);
            imported.push({ node, width, height });
            return node;
          },
          appendChild: (parent: NativeNode, child: NativeNode) => parent.children.push(child),
          currentPage: { selection: [] },
          viewport: { center: { x: 0, y: 0 } },
        };
        await new FigmaRenderOrchestrator(api).render({ source, document, math, settings });
        const root = nodes.find((node) => node.name === 'Math Document');
        const proof = nodes.find((node) => node.name === 'Text: Proof:');
        if (!root || !proof) throw new Error('The theorem or proof label was not rendered.');
        expect(proof.characters).toBe('Proof:');
        expect(proof.fontName).toEqual({ family: 'Inter', style: 'Bold' });
        expect({ constraint, width: proof.width, height: proof.height }).toEqual({
          constraint,
          width: 3 * fontSize,
          height: fontSize,
        });
        expect(imported).toHaveLength(math.length);
        for (const formula of imported) {
          const scale = fontSize / 16;
          expect(formula.node.width).toBeCloseTo(formula.width * scale, 4);
          expect(formula.node.height).toBeCloseTo(formula.height * scale, 4);
          expect(formula.node.children[0]?.width).toBeCloseTo(formula.width * scale, 4);
          expect(formula.node.children[0]?.height).toBeCloseTo(formula.height * scale, 4);
        }
        for (let index = 1; index < root.children.length; index += 1) {
          const previous = root.children[index - 1];
          const current = root.children[index];
          if (!previous || !current) throw new Error('Missing theorem block.');
          expect(current.y).toBeGreaterThanOrEqual(previous.y + previous.height);
        }
      }
    },
  );
});

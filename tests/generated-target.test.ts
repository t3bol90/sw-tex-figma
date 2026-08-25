import { describe, expect, it } from 'vitest';
import {
  findGeneratedDocumentTarget,
  firstNativeProseTypography,
  type GeneratedSceneNode,
} from '../src/figma/generated-target';
import {
  createPersistedDocumentState,
  serializePersistedDocumentState,
} from '../src/figma/persistence';

const settings = {
  width: 100,
  mathScale: 1,
  inheritTypography: true,
  typography: {
    fontName: { family: 'Inter', style: 'Regular' },
    fontSize: 16,
    lineHeight: { unit: 'AUTO' as const },
    letterSpacing: { unit: 'PIXELS' as const, value: 0 },
    fills: [],
  },
};
const data = createPersistedDocumentState('canonical', settings, 100);
interface TestNode extends GeneratedSceneNode {
  children: TestNode[];
  parent: TestNode | null;
  values: Map<string, string>;
  fontName?: unknown;
  fontSize?: unknown;
  lineHeight?: unknown;
  letterSpacing?: unknown;
  fills?: unknown;
}
const node = (type: string, parent: TestNode | null = null, name = ''): TestNode => {
  const values = new Map<string, string>();
  return {
    type,
    parent,
    name,
    width: 100,
    children: [],
    values,
    getPluginData: (key: string) => values.get(key) ?? '',
  };
};
describe('generated document discovery', () => {
  it('finds only a canonical ancestor and migrates v1 with root geometry fallback', () => {
    const root = node('FRAME');
    root.values.set('math-text-version', '2');
    root.values.set('math-text-document', serializePersistedDocumentState(data));
    const child = node('FRAME', root);
    root.children.push(child);
    expect(findGeneratedDocumentTarget([child])).toMatchObject({
      root,
      state: { source: 'canonical', compiledWidth: 100 },
    });
    root.values.set('math-text-version', '99');
    expect(findGeneratedDocumentTarget([child])).toBeUndefined();
    expect(findGeneratedDocumentTarget([child, root])).toBeUndefined();
  });
  it('uses first native prose and never SVG/math internals for typography', () => {
    const root = node('FRAME', null, 'Math Paragraph');
    const paragraph = node('FRAME', root, 'Paragraph');
    const line = node('FRAME', paragraph, 'Line 1');
    const math = node('VECTOR', line, 'Math: x');
    const fakeText = node('TEXT', math, 'text in svg');
    const prose = node('TEXT', line, 'Text: prose');
    Object.assign(prose, {
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 20,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      fills: [],
    });
    const display = node('FRAME', root, 'Display Math');
    const displayText = node('TEXT', display, 'ignored display internals');
    math.children.push(fakeText);
    display.children.push(displayText);
    line.children.push(math, prose);
    paragraph.children.push(line);
    root.children.push(paragraph, display);
    expect(firstNativeProseTypography(root, Symbol('mixed'))).toMatchObject({ fontSize: 20 });
    prose.fontSize = 'unsupported';
    expect(firstNativeProseTypography(root, Symbol('mixed'))).toBeUndefined();
  });
});

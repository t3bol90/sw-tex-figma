import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import console from 'node:console';
import { setTimeout, clearTimeout } from 'node:timers';

const bundle = readFileSync(resolve('dist/code.js'), 'utf8');
/** Remove JS string literals before checking executable controller code. */
function withoutStrings(input) {
  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== '"' && character !== "'" && character !== '`') {
      output += character;
      continue;
    }
    const quote = character;
    output += ' ';
    index += 1;
    for (; index < input.length; index += 1) {
      if (input[index] === '\\') {
        output += '  ';
        index += 1;
      } else if (input[index] === quote) {
        output += ' ';
        break;
      } else output += input[index] === '\n' ? '\n' : ' ';
    }
  }
  return output;
}
const executable = withoutStrings(bundle);
if (/document\s*\.\s*createElement/.test(executable)) {
  throw new Error('Controller bundle contains executable document.createElement code.');
}
if (/\bTextEncoder\b/.test(executable)) {
  throw new Error('Controller bundle contains executable TextEncoder dependency.');
}
let shown = false;
const figma = {
  // A manifest without `menu` invokes Run without a command; code.ts must default to create.
  command: undefined,
  mixed: Symbol('mixed'),
  currentPage: { selection: [] },
  viewport: { center: { x: 0, y: 0 } },
  ui: { postMessage() {}, onmessage: undefined },
  showUI(html) {
    if (typeof html !== 'string' || html.length === 0) throw new Error('Missing UI HTML.');
    shown = true;
  },
  on(name, handler) {
    if (name !== 'selectionchange' || typeof handler !== 'function')
      throw new Error('Invalid Figma event registration.');
  },
  closePlugin() {},
  loadFontAsync: async () => undefined,
  listAvailableFontsAsync: async () => [],
  createText() {
    throw new Error('Rendering must not happen during startup.');
  },
  createNodeFromSvg() {
    throw new Error('Rendering must not happen during startup.');
  },
  createFrame() {
    throw new Error('Rendering must not happen during startup.');
  },
};
const context = vm.createContext({
  figma,
  console,
  Uint8Array,
  setTimeout,
  clearTimeout,
});
vm.runInContext(bundle, context, { filename: 'dist/code.js', timeout: 5_000 });
if (!shown) throw new Error('Controller did not reach figma.showUI.');
console.log('Controller DOM-less smoke passed.');

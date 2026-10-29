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
for (const editorType of ['figma', 'slides']) {
  let shown = false;
  let resolveInitialization;
  const initialization = new Promise((resolve) => {
    resolveInitialization = resolve;
  });
  const rememberedSettings = {
    width: 820,
    mathScale: 1,
    inheritTypography: true,
    textAlignment: 'right',
    typography: {
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 24,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.3, b: 0.4 } }],
    },
  };
  const figma = {
    editorType,
    // A manifest without `menu` invokes Run without a command; code.ts must default to create.
    command: undefined,
    mixed: Symbol('mixed'),
    currentPage: { selection: [], focusedSlide: null },
    viewport: { center: { x: 0, y: 0 }, slidesView: 'single-slide' },
    clientStorage: {
      getAsync: async () => ({ version: 1, settings: rememberedSettings }),
      setAsync: async () => undefined,
    },
    ui: {
      postMessage(message) {
        if (message.type === 'INITIALIZE') resolveInitialization(message);
      },
      onmessage: undefined,
    },
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
    // Figma injects this special global from manifest.ui for plugin controllers.
    __html__: '<!doctype html><title>Math Text smoke UI</title>',
    console,
    Uint8Array,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(bundle, context, { filename: 'dist/code.js', timeout: 5_000 });
  if (!shown) throw new Error(`${editorType} controller did not reach figma.showUI.`);
  let initializationTimeout;
  try {
    const initialized = await Promise.race([
      initialization,
      new Promise((_, reject) => {
        initializationTimeout = setTimeout(
          () => reject(new Error(`${editorType} controller did not initialize.`)),
          5_000,
        );
      }),
    ]);
    if (JSON.stringify(initialized.settings) !== JSON.stringify(rememberedSettings)) {
      throw new Error(`${editorType} controller did not restore remembered settings.`);
    }
  } finally {
    clearTimeout(initializationTimeout);
  }
  console.log(`${editorType} controller DOM-less smoke passed.`);
}

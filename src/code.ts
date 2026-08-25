import {
  createSelectionController,
  FigmaRenderOrchestrator,
  readSelectionSnapshot,
  type FigmaRenderApi,
} from './figma';
import {
  isUIToPluginMessage,
  type PluginToUIMessage,
  type UIToPluginMessage,
} from './shared/messages';

declare const __html__: string;
const UI_SIZE = { width: 440, height: 560 };
function postToUi(message: PluginToUIMessage): void {
  figma.ui.postMessage(message);
}

// Narrow adapter keeps controller modules mockable and avoids spreading PluginAPI throughout them.
const renderApi: FigmaRenderApi = {
  loadFontAsync: (font: FontName) => figma.loadFontAsync(font),
  createText: () => figma.createText(),
  createNodeFromSvg: (svg: string) => figma.createNodeFromSvg(svg),
  createFrame: () => figma.createFrame(),
  appendChild: (parent, child) => (parent as FrameNode).appendChild(child as SceneNode),
  listAvailableFontsAsync: async () =>
    (await figma.listAvailableFontsAsync()).map((font) => font.fontName),
  get currentPage() {
    return figma.currentPage;
  },
  viewport: figma.viewport,
};
const renderer = new FigmaRenderOrchestrator(renderApi);
const controller = createSelectionController({
  readSelection: () =>
    readSelectionSnapshot({
      mixed: figma.mixed,
      get currentPage() {
        return figma.currentPage;
      },
      loadFontAsync: (fontName) => figma.loadFontAsync(fontName),
    }),
  postToUi,
  closePlugin: () => figma.closePlugin(),
  renderDocument: async (request) => {
    const result = await renderer.render(request);
    return { rootName: result.root.name };
  },
});
function handleMessage(message: UIToPluginMessage): void {
  controller.handleMessage(message);
}
figma.showUI(__html__, { ...UI_SIZE, themeColors: true });
figma.ui.onmessage = (message: unknown) => {
  if (!isUIToPluginMessage(message)) {
    postToUi({ type: 'RENDER_ERROR', message: 'Ignored an invalid message from the plugin UI.' });
    return;
  }
  handleMessage(message);
};
figma.on('selectionchange', () => {
  void controller.selectionChanged();
});
void controller.initialize();

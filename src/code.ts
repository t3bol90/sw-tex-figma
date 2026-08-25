import { createSelectionController, readSelectionSnapshot } from './figma';
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

const controller = createSelectionController({
  readSelection: () =>
    readSelectionSnapshot({
      mixed: figma.mixed,
      currentPage: figma.currentPage,
      loadFontAsync: (fontName) => figma.loadFontAsync(fontName),
    }),
  postToUi,
  closePlugin: () => figma.closePlugin(),
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

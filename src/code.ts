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

function handleMessage(message: UIToPluginMessage): void {
  switch (message.type) {
    case 'REQUEST_SELECTION_STYLE':
      // Selection-derived typography is intentionally added in PR 4.
      postToUi({ type: 'SELECTION_CHANGED' });
      return;
    case 'RENDER_DOCUMENT':
      // Rendering is intentionally added after the parser and MathJax pipeline exist.
      postToUi({
        type: 'RENDER_ERROR',
        message: 'Document rendering is not available in the plugin foundation.',
      });
      return;
    case 'CLOSE':
      figma.closePlugin();
      return;
  }
}

figma.showUI(__html__, { ...UI_SIZE, themeColors: true });
figma.ui.onmessage = (message: unknown) => {
  if (!isUIToPluginMessage(message)) {
    postToUi({ type: 'RENDER_ERROR', message: 'Ignored an invalid message from the plugin UI.' });
    return;
  }

  handleMessage(message);
};

postToUi({ type: 'INITIALIZE' });

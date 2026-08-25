import type { UIToPluginMessage } from '../shared/messages';

export function postToPlugin(message: UIToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, '*');
}

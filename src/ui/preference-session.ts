import {
  isRenderSettings,
  type PluginToUIMessage,
  type UIToPluginMessage,
} from '../shared/messages';
import type { RenderSettings } from '../shared/types';

export class PreferenceSession {
  private token = 0;
  private revision = 0;

  initialize(token: number): boolean {
    if (token <= this.token) return false;
    this.token = token;
    return true;
  }

  change(
    settings: RenderSettings,
  ): Extract<UIToPluginMessage, { type: 'SAVE_PREFERENCES' }> | undefined {
    if (this.token < 1 || !isRenderSettings(settings)) return undefined;
    return {
      type: 'SAVE_PREFERENCES',
      settings,
      workflowToken: this.token,
      revision: ++this.revision,
    };
  }

  accepts(
    message: Extract<PluginToUIMessage, { type: 'PREFERENCES_SAVED' | 'PREFERENCES_ERROR' }>,
  ): boolean {
    return message.workflowToken === this.token && message.revision === this.revision;
  }
}

import type { RenderSettings } from './types';

export const PERSISTENCE_VERSION = 1;
export const DOCUMENT_PLUGIN_DATA_KEY = 'math-text-document';

export interface PersistedDocumentState extends RenderSettings {
  readonly version: typeof PERSISTENCE_VERSION;
  readonly source: string;
  readonly renderer: 'mathjax-svg';
}

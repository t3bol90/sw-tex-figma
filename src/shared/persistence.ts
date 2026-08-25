import type { RenderSettings } from './types';

export const PERSISTENCE_VERSION = 1;
export const DOCUMENT_PLUGIN_DATA_KEY = 'math-text-document';
export const DOCUMENT_VERSION_PLUGIN_DATA_KEY = 'math-text-version';
/** Shared identity only; importing it never loads the MathJax engine. */
export const MATHJAX_SVG_RENDERER_IDENTITY =
  'mathjax-svg@4.1.3:newcm@4.1.3:tex-base-ams-newcommand:font-cache-none:em16';

export interface PersistedDocumentState extends RenderSettings {
  readonly version: typeof PERSISTENCE_VERSION;
  readonly source: string;
  readonly renderer: typeof MATHJAX_SVG_RENDERER_IDENTITY;
}

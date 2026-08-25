import type { RenderSettings, TypographyContext } from './types';

/** v3 adds required explicit text alignment. */
export const PERSISTENCE_VERSION = 3;
export const LEGACY_PERSISTENCE_VERSION = 1;
export const LEGACY_PERSISTENCE_VERSION_V2 = 2;
export const DOCUMENT_PLUGIN_DATA_KEY = 'math-text-document';
export const DOCUMENT_VERSION_PLUGIN_DATA_KEY = 'math-text-version';
/** Shared identity only; importing it never loads the MathJax engine. */
export const MATHJAX_SVG_RENDERER_IDENTITY =
  'mathjax-svg@4.1.3:newcm@4.1.3:tex-base-ams-newcommand:font-cache-none:em16';

/** Exact v1 wire shape. It deliberately does not inherit current settings. */
export interface PersistedDocumentStateV1 {
  readonly version: typeof LEGACY_PERSISTENCE_VERSION;
  readonly source: string;
  readonly width: number;
  readonly mathScale: number;
  readonly inheritTypography: boolean;
  readonly typography: TypographyContext;
  readonly renderer: typeof MATHJAX_SVG_RENDERER_IDENTITY;
}
/** Exact v2 wire shape. It deliberately has no textAlignment field. */
export interface PersistedDocumentStateV2 {
  readonly version: typeof LEGACY_PERSISTENCE_VERSION_V2;
  readonly source: string;
  readonly width: number;
  readonly mathScale: number;
  readonly inheritTypography: boolean;
  readonly typography: TypographyContext;
  readonly renderer: typeof MATHJAX_SVG_RENDERER_IDENTITY;
  readonly compiledWidth: number;
}
/** Canonical v3 state. compiledWidth is the actual compiled root width. */
export interface PersistedDocumentState extends RenderSettings {
  readonly version: typeof PERSISTENCE_VERSION;
  readonly source: string;
  readonly renderer: typeof MATHJAX_SVG_RENDERER_IDENTITY;
  readonly compiledWidth: number;
}

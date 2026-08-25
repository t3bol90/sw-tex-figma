import { isRenderSettings } from '../shared/messages';
import {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  LEGACY_PERSISTENCE_VERSION,
  MATHJAX_SVG_RENDERER_IDENTITY,
  PERSISTENCE_VERSION,
  type PersistedDocumentState,
  type PersistedDocumentStateV1,
} from '../shared/persistence';
import type { RenderSettings } from '../shared/types';

export {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  LEGACY_PERSISTENCE_VERSION,
  PERSISTENCE_VERSION,
} from '../shared/persistence';
/** Conservative UTF-8 byte budget, below Figma's per-pluginData-entry limit. */
export const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
/**
 * UTF-8 size without Web APIs. Lone UTF-16 surrogates encode as U+FFFD, matching TextEncoder.
 * Figma controller sandboxes do not expose TextEncoder.
 */
export function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        index += 1;
      } else length += 3;
    } else length += 3;
  }
  return length;
}
const byteLength = utf8ByteLength;
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000;

export interface PluginDataNode {
  setPluginData(key: string, value: string): void;
  getPluginData?(key: string): string;
  setRelaunchData(data: Record<string, string>): void;
}

/** New output is always v2. compiledWidth must be the actual rendered root width. */
export function createPersistedDocumentState(
  source: string,
  settings: RenderSettings,
  compiledWidth = settings.width,
): PersistedDocumentState {
  if (
    typeof source !== 'string' ||
    source.length > 1_000_000 ||
    !isRenderSettings(settings) ||
    !positive(compiledWidth)
  )
    throw new Error('Cannot persist invalid document state.');
  return {
    version: PERSISTENCE_VERSION,
    source,
    width: settings.width,
    inheritTypography: settings.inheritTypography,
    typography: settings.typography,
    mathScale: settings.mathScale,
    renderer: MATHJAX_SVG_RENDERER_IDENTITY,
    compiledWidth,
  };
}
export function serializePersistedDocumentState(state: PersistedDocumentState): string {
  if (!isPersistedDocumentState(state)) throw new Error('Cannot serialize invalid document state.');
  const serialized = JSON.stringify(state);
  if (byteLength(serialized) > MAX_PERSISTED_DOCUMENT_BYTES)
    throw new Error('Document state is too large to persist safely.');
  return serialized;
}

const baseStateIsValid = (state: Record<string, unknown>): boolean =>
  state.renderer === MATHJAX_SVG_RENDERER_IDENTITY &&
  typeof state.source === 'string' &&
  state.source.length <= 1_000_000 &&
  isRenderSettings({
    width: state.width,
    inheritTypography: state.inheritTypography,
    mathScale: state.mathScale,
    typography: state.typography,
  });
const exactKeys = (state: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(state).sort();
  return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
};
export function isPersistedDocumentStateV1(value: unknown): value is PersistedDocumentStateV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    exactKeys(state, [
      'inheritTypography',
      'mathScale',
      'renderer',
      'source',
      'typography',
      'version',
      'width',
    ]) &&
    state.version === LEGACY_PERSISTENCE_VERSION &&
    baseStateIsValid(state)
  );
}
export function isPersistedDocumentState(value: unknown): value is PersistedDocumentState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    exactKeys(state, [
      'compiledWidth',
      'inheritTypography',
      'mathScale',
      'renderer',
      'source',
      'typography',
      'version',
      'width',
    ]) &&
    state.version === PERSISTENCE_VERSION &&
    positive(state.compiledWidth) &&
    baseStateIsValid(state)
  );
}
type StoredState = PersistedDocumentState | PersistedDocumentStateV1;
/** Strict parser for each recognised version. Unknown versions are rejected. */
export function parseStoredDocumentState(value: string): StoredState | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    byteLength(value) > MAX_PERSISTED_DOCUMENT_BYTES
  )
    return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (isPersistedDocumentState(parsed) || isPersistedDocumentStateV1(parsed)) return parsed;
  } catch {
    /* invalid JSON */
  }
  return undefined;
}
/** Kept as the public canonical parser: it accepts only current v2 state. */
export function parsePersistedDocumentState(value: string): PersistedDocumentState | undefined {
  const state = parseStoredDocumentState(value);
  return state?.version === PERSISTENCE_VERSION ? state : undefined;
}
/** Migration is pure. The caller must not write it to an old node before commit. */
export function migratePersistedDocumentState(
  state: StoredState,
  compiledWidthFallback: number,
): PersistedDocumentState | undefined {
  if (state.version === PERSISTENCE_VERSION) return state;
  if (!positive(compiledWidthFallback)) return undefined;
  return createPersistedDocumentState(
    state.source,
    {
      width: state.width,
      mathScale: state.mathScale,
      inheritTypography: state.inheritTypography,
      typography: state.typography,
    },
    compiledWidthFallback,
  );
}
export interface ReadablePluginDataNode {
  getPluginData(key: string): string;
}
/** Reads and cross-checks separate metadata. v1 is migrated in memory only. */
export function readPersistedDocumentState(
  node: ReadablePluginDataNode,
  compiledWidthFallback?: number,
): PersistedDocumentState | undefined {
  const version = node.getPluginData(DOCUMENT_VERSION_PLUGIN_DATA_KEY);
  if (!/^(?:0|[1-9]\d*)$/.test(version)) return undefined;
  const state = parseStoredDocumentState(node.getPluginData(DOCUMENT_PLUGIN_DATA_KEY));
  if (!state || String(state.version) !== version) return undefined;
  return state.version === PERSISTENCE_VERSION
    ? state
    : compiledWidthFallback === undefined
      ? undefined
      : migratePersistedDocumentState(state, compiledWidthFallback);
}
export function persistDocumentState(
  node: PluginDataNode,
  source: string,
  settings: RenderSettings,
  compiledWidth = settings.width,
): PersistedDocumentState {
  const state = createPersistedDocumentState(source, settings, compiledWidth);
  node.setPluginData(DOCUMENT_PLUGIN_DATA_KEY, serializePersistedDocumentState(state));
  node.setPluginData(DOCUMENT_VERSION_PLUGIN_DATA_KEY, String(PERSISTENCE_VERSION));
  node.setRelaunchData({ edit: 'Edit Math Text' });
  return state;
}

import { isRenderSettings } from '../shared/messages';
import {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  MATHJAX_SVG_RENDERER_IDENTITY,
  PERSISTENCE_VERSION,
  type PersistedDocumentState,
} from '../shared/persistence';
import type { RenderSettings } from '../shared/types';

export {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  PERSISTENCE_VERSION,
} from '../shared/persistence';
/** Conservative UTF-8 byte budget, below Figma's per-pluginData-entry limit. */
export const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
export interface PluginDataNode {
  setPluginData(key: string, value: string): void;
  getPluginData?(key: string): string;
  setRelaunchData(data: Record<string, string>): void;
}

export function createPersistedDocumentState(
  source: string,
  settings: RenderSettings,
): PersistedDocumentState {
  if (typeof source !== 'string' || source.length > 1_000_000 || !isRenderSettings(settings))
    throw new Error('Cannot persist invalid document state.');
  return {
    version: PERSISTENCE_VERSION,
    source,
    width: settings.width,
    inheritTypography: settings.inheritTypography,
    typography: settings.typography,
    mathScale: settings.mathScale,
    renderer: MATHJAX_SVG_RENDERER_IDENTITY,
  };
}
export function serializePersistedDocumentState(state: PersistedDocumentState): string {
  if (!isPersistedDocumentState(state)) throw new Error('Cannot serialize invalid document state.');
  const serialized = JSON.stringify(state);
  if (byteLength(serialized) > MAX_PERSISTED_DOCUMENT_BYTES)
    throw new Error('Document state is too large to persist safely.');
  return serialized;
}
/** Strict v1 parser. Never infer source from children and never migrate unknown versions. */
export function parsePersistedDocumentState(value: string): PersistedDocumentState | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    byteLength(value) > MAX_PERSISTED_DOCUMENT_BYTES
  )
    return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPersistedDocumentState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
export function isPersistedDocumentState(value: unknown): value is PersistedDocumentState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const keys = Object.keys(state).sort();
  const expected = [
    'inheritTypography',
    'mathScale',
    'renderer',
    'source',
    'typography',
    'version',
    'width',
  ];
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) return false;
  if (
    state.version !== PERSISTENCE_VERSION ||
    state.renderer !== MATHJAX_SVG_RENDERER_IDENTITY ||
    typeof state.source !== 'string' ||
    state.source.length > 1_000_000
  )
    return false;
  return isRenderSettings({
    width: state.width,
    inheritTypography: state.inheritTypography,
    mathScale: state.mathScale,
    typography: state.typography,
  });
}
export interface ReadablePluginDataNode {
  getPluginData(key: string): string;
}
/** Reads both independent v1 metadata keys; neither is inferred from layers. */
export function readPersistedDocumentState(
  node: ReadablePluginDataNode,
): PersistedDocumentState | undefined {
  const version = node.getPluginData(DOCUMENT_VERSION_PLUGIN_DATA_KEY);
  if (!/^(?:0|[1-9]\d*)$/.test(version) || Number(version) !== PERSISTENCE_VERSION)
    return undefined;
  return parsePersistedDocumentState(node.getPluginData(DOCUMENT_PLUGIN_DATA_KEY));
}

export function persistDocumentState(
  node: PluginDataNode,
  source: string,
  settings: RenderSettings,
): PersistedDocumentState {
  const state = createPersistedDocumentState(source, settings);
  node.setPluginData(DOCUMENT_PLUGIN_DATA_KEY, serializePersistedDocumentState(state));
  node.setPluginData(DOCUMENT_VERSION_PLUGIN_DATA_KEY, String(PERSISTENCE_VERSION));
  node.setRelaunchData({ edit: 'Edit Math Text' });
  return state;
}

import { isTypographyContext } from '../shared/messages';
import type { RenderSettings, TypographyContext } from '../shared/types';
import {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  LEGACY_PERSISTENCE_VERSION,
  LEGACY_PERSISTENCE_VERSION_V2,
  MATHJAX_SVG_RENDERER_IDENTITY,
  PERSISTENCE_VERSION,
  type PersistedDocumentState,
  type PersistedDocumentStateV1,
  type PersistedDocumentStateV2,
} from '../shared/persistence';

export {
  DOCUMENT_PLUGIN_DATA_KEY,
  DOCUMENT_VERSION_PLUGIN_DATA_KEY,
  LEGACY_PERSISTENCE_VERSION,
  LEGACY_PERSISTENCE_VERSION_V2,
  PERSISTENCE_VERSION,
} from '../shared/persistence';
/** Conservative UTF-8 byte budget, below Figma's per-pluginData-entry limit. */
export const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
const MAX_SOURCE_LENGTH = 800_000;
/** UTF-8 size without Web APIs. Lone UTF-16 surrogates encode as U+FFFD. */
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
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000;
const validSource = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAX_SOURCE_LENGTH &&
  utf8ByteLength(value) <= MAX_PERSISTED_DOCUMENT_BYTES;
const validLegacySettings = (state: Record<string, unknown>): boolean =>
  positive(state.width) &&
  typeof state.inheritTypography === 'boolean' &&
  typeof state.mathScale === 'number' &&
  Number.isFinite(state.mathScale) &&
  state.mathScale > 0 &&
  state.mathScale <= 10 &&
  isTypographyContext(state.typography);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exactOptionalKeys = (
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.includes(key)) &&
    keys.length >= required.length
  );
};
/** Persisted v3 records are a closed wire format; UI messages remain structural. */
const isStrictPersistedTypography = (value: unknown): boolean => {
  if (
    !exactOptionalKeys(
      value,
      ['fills', 'fontName', 'fontSize', 'letterSpacing', 'lineHeight'],
      ['textStyleId'],
    ) ||
    !isTypographyContext(value)
  )
    return false;
  if (!exactOptionalKeys(value.fontName, ['family', 'style'])) return false;
  if (!isRecord(value.lineHeight)) return false;
  const lineHeightKeys = value.lineHeight.unit === 'AUTO' ? ['unit'] : ['unit', 'value'];
  if (!exactOptionalKeys(value.lineHeight, lineHeightKeys)) return false;
  if (!exactOptionalKeys(value.letterSpacing, ['unit', 'value'])) return false;
  return value.fills.every(
    (fill) =>
      exactOptionalKeys(fill, ['color', 'type'], ['opacity']) &&
      isRecord(fill) &&
      exactOptionalKeys(fill.color, ['b', 'g', 'r']),
  );
};
const validCurrentSettings = (state: Record<string, unknown>): boolean =>
  validLegacySettings(state) &&
  isStrictPersistedTypography(state.typography) &&
  state.mathScale === 1 &&
  (state.textAlignment === 'left' ||
    state.textAlignment === 'center' ||
    state.textAlignment === 'right' ||
    state.textAlignment === 'justify');
const baseStateIsValid = (state: Record<string, unknown>, current: boolean): boolean =>
  state.renderer === MATHJAX_SVG_RENDERER_IDENTITY &&
  validSource(state.source) &&
  (current ? validCurrentSettings(state) : validLegacySettings(state));
const exactKeys = (state: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(state).sort();
  return keys.length === expected.length && keys.every((key, i) => key === expected[i]);
};

export interface PluginDataNode {
  setPluginData(key: string, value: string): void;
  getPluginData?(key: string): string;
  setRelaunchData(data: Record<string, string>): void;
}
/** New output is always v3, with math size tied to fontSize (scale exactly one). */
export function createPersistedDocumentState(
  source: string,
  settings: RenderSettings,
  compiledWidth = settings.width,
): PersistedDocumentState {
  if (
    !validSource(source) ||
    !validCurrentSettings(settings as unknown as Record<string, unknown>) ||
    !positive(compiledWidth)
  )
    throw new Error('Cannot persist invalid document state.');
  return {
    version: PERSISTENCE_VERSION,
    source,
    width: settings.width,
    inheritTypography: settings.inheritTypography,
    typography: settings.typography,
    mathScale: 1,
    textAlignment: settings.textAlignment,
    renderer: MATHJAX_SVG_RENDERER_IDENTITY,
    compiledWidth,
  };
}
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
    baseStateIsValid(state, false)
  );
}
export function isPersistedDocumentStateV2(value: unknown): value is PersistedDocumentStateV2 {
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
    state.version === LEGACY_PERSISTENCE_VERSION_V2 &&
    positive(state.compiledWidth) &&
    baseStateIsValid(state, false)
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
      'textAlignment',
      'typography',
      'version',
      'width',
    ]) &&
    state.version === PERSISTENCE_VERSION &&
    positive(state.compiledWidth) &&
    baseStateIsValid(state, true)
  );
}
type StoredState = PersistedDocumentState | PersistedDocumentStateV1 | PersistedDocumentStateV2;
/** Strict parser for each recognised wire version. Unknown versions are rejected. */
export function parseStoredDocumentState(value: string): StoredState | undefined {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    utf8ByteLength(value) > MAX_PERSISTED_DOCUMENT_BYTES
  )
    return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isPersistedDocumentState(parsed) ||
      isPersistedDocumentStateV2(parsed) ||
      isPersistedDocumentStateV1(parsed)
    )
      return parsed;
  } catch {
    /* invalid JSON */
  }
  return undefined;
}
/** Current parser accepts only exact v3 wire records. */
export function parsePersistedDocumentState(value: string): PersistedDocumentState | undefined {
  const state = parseStoredDocumentState(value);
  return state?.version === PERSISTENCE_VERSION ? state : undefined;
}
/** Strip legacy structural extras while retaining every serializable Figma field. */
const canonicalizeLegacyTypography = (typography: TypographyContext): TypographyContext => ({
  fontName: { family: typography.fontName.family, style: typography.fontName.style },
  fontSize: typography.fontSize,
  lineHeight:
    typography.lineHeight.unit === 'AUTO'
      ? { unit: 'AUTO' }
      : { unit: typography.lineHeight.unit, value: typography.lineHeight.value },
  letterSpacing: {
    unit: typography.letterSpacing.unit,
    value: typography.letterSpacing.value,
  },
  fills: typography.fills.map((fill) => ({
    type: 'SOLID',
    color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
    ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
  })),
  ...(typography.textStyleId === undefined ? {} : { textStyleId: typography.textStyleId }),
});
/** Migration is pure; callers write only the replacement root at commit time. */
export function migratePersistedDocumentState(
  state: StoredState,
  compiledWidthFallback: number,
): PersistedDocumentState | undefined {
  if (state.version === PERSISTENCE_VERSION) return state;
  const compiledWidth =
    state.version === LEGACY_PERSISTENCE_VERSION_V2 ? state.compiledWidth : compiledWidthFallback;
  if (!positive(compiledWidth)) return undefined;
  return createPersistedDocumentState(
    state.source,
    {
      width: state.width,
      inheritTypography: state.inheritTypography,
      typography: canonicalizeLegacyTypography(state.typography),
      mathScale: 1,
      textAlignment: 'left',
    },
    compiledWidth,
  );
}
export interface ReadablePluginDataNode {
  getPluginData(key: string): string;
}
/** Reads and cross-checks metadata. Legacy data is migrated only in memory. */
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
    : migratePersistedDocumentState(state, compiledWidthFallback ?? Number.NaN);
}
export function serializePersistedDocumentState(state: PersistedDocumentState): string {
  if (!isPersistedDocumentState(state)) throw new Error('Cannot serialize invalid document state.');
  const serialized = JSON.stringify(state);
  if (utf8ByteLength(serialized) > MAX_PERSISTED_DOCUMENT_BYTES)
    throw new Error('Document state is too large to persist safely.');
  return serialized;
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

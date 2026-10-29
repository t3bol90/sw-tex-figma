import { isRenderSettings } from '../shared/messages';
import type { RenderSettings } from '../shared/types';

export const SETTINGS_PREFERENCES_KEY = 'math-text:settings:v1';
export interface PreferencesStorage {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
}
export interface SettingsPreferences {
  read(): Promise<RenderSettings | undefined>;
  save(settings: RenderSettings): Promise<void>;
  flush(): Promise<void>;
}

const copySettings = (settings: RenderSettings): RenderSettings => ({
  width: settings.width,
  mathScale: 1,
  inheritTypography: settings.inheritTypography,
  textAlignment: settings.textAlignment,
  typography: {
    fontName: {
      family: settings.typography.fontName.family,
      style: settings.typography.fontName.style,
    },
    fontSize: settings.typography.fontSize,
    lineHeight:
      settings.typography.lineHeight.unit === 'AUTO'
        ? { unit: 'AUTO' }
        : {
            unit: settings.typography.lineHeight.unit,
            value: settings.typography.lineHeight.value,
          },
    letterSpacing: {
      unit: settings.typography.letterSpacing.unit,
      value: settings.typography.letterSpacing.value,
    },
    fills: settings.typography.fills.map((fill) => ({
      type: 'SOLID',
      color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
      ...(fill.opacity === undefined ? {} : { opacity: fill.opacity }),
    })),
    ...(settings.typography.textStyleId === undefined
      ? {}
      : { textStyleId: settings.typography.textStyleId }),
  },
});

export function createSettingsPreferences(storage: PreferencesStorage): SettingsPreferences {
  let pending = Promise.resolve();
  let read: Promise<RenderSettings | undefined> | undefined;
  return {
    read: () =>
      (read ??= Promise.resolve()
        .then(() => storage.getAsync(SETTINGS_PREFERENCES_KEY))
        .then((value) => {
          if (
            typeof value !== 'object' ||
            value === null ||
            !('version' in value) ||
            value.version !== 1 ||
            !('settings' in value) ||
            !isRenderSettings(value.settings)
          )
            return undefined;
          return copySettings(value.settings);
        })
        .catch(() => undefined)),
    save: (settings) => {
      if (!isRenderSettings(settings)) return Promise.reject(new Error('Invalid preferences.'));
      const snapshot = copySettings(settings);
      const write = pending.then(() =>
        storage.setAsync(SETTINGS_PREFERENCES_KEY, { version: 1, settings: snapshot }),
      );
      pending = write.catch(() => undefined);
      return write;
    },
    flush: () => pending,
  };
}

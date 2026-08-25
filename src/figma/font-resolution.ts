import type { TextMark } from '../shared/document-model';
import type { FontDescriptor, TypographyContext } from '../shared/types';
import type { FontResolution } from '../layout';

export interface FigmaFontInventoryApi {
  listAvailableFontsAsync(): Promise<readonly FontDescriptor[]>;
}
export class FontResolutionError extends Error {
  public constructor(
    public readonly marks: readonly TextMark[],
    public readonly base: FontDescriptor,
  ) {
    super(`No available ${marks.join('+')} font variant exists for "${base.family}".`);
    this.name = 'FontResolutionError';
  }
}

const normalized = (value: string): string => value.toLocaleLowerCase('en-US');
const hasBold = (style: string): boolean => /\bbold\b/.test(normalized(style));
const hasItalic = (style: string): boolean => /\b(?:italic|oblique)\b/.test(normalized(style));

/** Resolves marked prose to a real Figma font. It never pretends Regular is bold/italic. */
export class FigmaFontResolver {
  private inventory: Promise<readonly FontDescriptor[]> | undefined;
  private readonly resolutions = new Map<string, FontResolution>();
  public constructor(private readonly api: FigmaFontInventoryApi) {}
  public clear(): void {
    this.inventory = undefined;
    this.resolutions.clear();
  }
  public async resolve(
    marks: readonly TextMark[] | undefined,
    typography: TypographyContext,
  ): Promise<FontResolution | undefined> {
    if (marks === undefined || marks.length === 0) return undefined;
    const unique = [...new Set(marks)].sort();
    const key = `${typography.fontName.family}\u0000${typography.fontName.style}\u0000${unique.join(',')}`;
    const cached = this.resolutions.get(key);
    if (cached) return cached;
    const fonts = await (this.inventory ??= this.api.listAvailableFontsAsync());
    // Markdown adds traits; it must never erase an italic/bold trait selected in Figma.
    const wantBold = hasBold(typography.fontName.style) || unique.includes('bold');
    const wantItalic = hasItalic(typography.fontName.style) || unique.includes('italic');
    const candidates = fonts.filter(
      (font) =>
        font.family === typography.fontName.family &&
        hasBold(font.style) === wantBold &&
        hasItalic(font.style) === wantItalic,
    );
    candidates.sort((a, b) => a.style.localeCompare(b.style) || a.family.localeCompare(b.family));
    const font = candidates[0];
    if (!font) throw new FontResolutionError(unique, typography.fontName);
    const result: FontResolution = {
      fontName: { family: font.family, style: font.style },
      marks: unique,
      key,
    };
    this.resolutions.set(key, result);
    return result;
  }
}

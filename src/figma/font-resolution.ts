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

/**
 * Monospace families tried for `code` marks, in order. Figma lists Google Fonts
 * such as Roboto Mono in every editor; the rest cover common local installs.
 */
export const MONOSPACE_FAMILIES: readonly string[] = [
  'Roboto Mono',
  'JetBrains Mono',
  'Source Code Pro',
  'IBM Plex Mono',
  'Fira Code',
  'Fira Mono',
  'Inconsolata',
  'Ubuntu Mono',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Courier New',
  'Courier',
];
const looksMonospace = (family: string): boolean =>
  MONOSPACE_FAMILIES.includes(family) || /\b(?:mono|code|courier|consol)/i.test(family);

interface Traits {
  readonly bold: boolean;
  readonly italic: boolean;
}

const canonicalStyle = ({ bold, italic }: Traits): string =>
  bold && italic ? 'bold italic' : bold ? 'bold' : italic ? 'italic' : 'regular';

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
    const traits: Traits = {
      bold: hasBold(typography.fontName.style) || unique.includes('bold'),
      italic: hasItalic(typography.fontName.style) || unique.includes('italic'),
    };
    const font = unique.includes('code')
      ? resolveCodeFont(fonts, typography.fontName, traits)
      : resolveTraitFont(fonts, typography.fontName.family, traits);
    if (font === undefined) {
      const traitMarks = unique.filter((mark) => mark !== 'code');
      if (traitMarks.length === unique.length)
        throw new FontResolutionError(unique, typography.fontName);
      // No monospace face is installed: code keeps the body family and its other marks.
      return this.resolve(traitMarks, typography);
    }
    const result: FontResolution = {
      fontName: { family: font.family, style: font.style },
      marks: unique,
      key,
    };
    this.resolutions.set(key, result);
    return result;
  }
}

const resolveTraitFont = (
  fonts: readonly FontDescriptor[],
  family: string,
  traits: Traits,
): FontDescriptor | undefined => {
  const candidates = fonts.filter(
    (font) =>
      font.family === family &&
      hasBold(font.style) === traits.bold &&
      hasItalic(font.style) === traits.italic,
  );
  candidates.sort((a, b) => a.style.localeCompare(b.style) || a.family.localeCompare(b.family));
  return candidates[0];
};

/**
 * Picks a monospace face for code: the body family when it is already
 * monospace, otherwise the first installed preferred family. Within that family
 * it keeps the requested weight and slant when available, then drops italic,
 * then bold, because a substituted code face is better than a failed render.
 */
const resolveCodeFont = (
  fonts: readonly FontDescriptor[],
  base: FontDescriptor,
  traits: Traits,
): FontDescriptor | undefined => {
  const installed = new Set(fonts.map((font) => font.family));
  const family = looksMonospace(base.family)
    ? base.family
    : MONOSPACE_FAMILIES.find((candidate) => installed.has(candidate));
  if (family === undefined) return undefined;
  const faces = fonts.filter((font) => font.family === family);
  for (const wanted of [
    traits,
    { bold: traits.bold, italic: false },
    { bold: false, italic: false },
  ]) {
    const matching = faces.filter(
      (font) => hasBold(font.style) === wanted.bold && hasItalic(font.style) === wanted.italic,
    );
    // Prefer the plain style name ("Regular", "Bold") over weights such as "Light".
    const exact = matching.find((font) => normalized(font.style) === canonicalStyle(wanted));
    const fallback = [...matching].sort((a, b) => a.style.localeCompare(b.style))[0];
    if (exact ?? fallback) return exact ?? fallback;
  }
  return [...faces].sort((a, b) => a.style.localeCompare(b.style))[0];
};

export interface FontDescriptor {
  readonly family: string;
  readonly style: string;
}

export type LineHeight =
  | { readonly unit: 'AUTO' }
  | { readonly unit: 'PIXELS'; readonly value: number }
  | { readonly unit: 'INTRINSIC_%'; readonly value: number };

export type LetterSpacing =
  | { readonly unit: 'PIXELS'; readonly value: number }
  | { readonly unit: 'PERCENT'; readonly value: number };

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SolidFill {
  readonly type: 'SOLID';
  readonly color: RgbColor;
  readonly opacity?: number;
}

/** The serializable subset of Figma typography that the UI can safely receive. */
export interface TypographyContext {
  readonly fontName: FontDescriptor;
  readonly fontSize: number;
  readonly lineHeight: LineHeight;
  readonly letterSpacing: LetterSpacing;
  readonly fills: readonly SolidFill[];
  readonly textStyleId?: string;
}

export type TextAlignment = 'left' | 'center' | 'right' | 'justify';

export interface RenderSettings {
  readonly width: number;
  readonly mathScale: number;
  readonly inheritTypography: boolean;
  /** Explicit geometric alignment for every current render. */
  readonly textAlignment: TextAlignment;
  /** Typography selected by the user or the safe create-flow default. */
  readonly typography: TypographyContext;
}

export interface MathMetrics {
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
  readonly descent: number;
  readonly baseline: number;
}

export interface RenderedMathPayload {
  readonly latex: string;
  readonly svg: string;
  readonly display: boolean;
  readonly metrics: MathMetrics;
}

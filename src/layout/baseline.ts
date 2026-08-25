import type { TypographyContext } from '../shared/types';

import type { LayoutMetrics, NativeTextMetrics, ProseBaselineCalibration } from './types';

/**
 * This is an estimate, not a Figma-measured baseline. PR 4 exposes only text
 * bounds. The default assumes a 0.8em ascent and distributes line-box leading
 * equally above and below that em. Replace it with visual calibration later.
 */
export const DEFAULT_PROSE_BASELINE_CALIBRATION: ProseBaselineCalibration = {
  emAscentRatio: 0.8,
};

export function validateProseBaselineCalibration(
  calibration: ProseBaselineCalibration,
): ProseBaselineCalibration {
  if (
    !Number.isFinite(calibration.emAscentRatio) ||
    calibration.emAscentRatio <= 0 ||
    calibration.emAscentRatio >= 1
  ) {
    throw new Error('Prose baseline calibration emAscentRatio must be finite and between 0 and 1.');
  }
  return calibration;
}

export function calibrateProseMetrics(
  measured: NativeTextMetrics,
  typography: TypographyContext,
  calibration: ProseBaselineCalibration = DEFAULT_PROSE_BASELINE_CALIBRATION,
): LayoutMetrics {
  validateProseBaselineCalibration(calibration);
  if (
    !Number.isFinite(measured.width) ||
    measured.width < 0 ||
    !Number.isFinite(measured.height) ||
    measured.height < 0
  ) {
    throw new Error('Native text measurement must have finite non-negative width and height.');
  }
  if (!Number.isFinite(typography.fontSize) || typography.fontSize <= 0) {
    throw new Error('Typography fontSize must be finite and positive.');
  }

  // A native line box may be taller than the em due to explicit leading.
  const emHeight = Math.min(measured.height, typography.fontSize);
  const leading = Math.max(0, measured.height - typography.fontSize);
  const ascent = emHeight * calibration.emAscentRatio + leading / 2;
  const descent = measured.height - ascent;
  return { width: measured.width, height: measured.height, ascent, descent };
}

/** Deterministic fallback used for empty lines caused by CommonMark hard breaks. */
export function fallbackEmptyLineMetrics(
  typography: TypographyContext,
  calibration: ProseBaselineCalibration = DEFAULT_PROSE_BASELINE_CALIBRATION,
): LayoutMetrics {
  return calibrateProseMetrics(
    { width: 0, height: lineBoxHeight(typography) },
    typography,
    calibration,
  );
}

const lineBoxHeight = (typography: TypographyContext): number => {
  switch (typography.lineHeight.unit) {
    case 'PIXELS':
      return typography.lineHeight.value;
    case 'INTRINSIC_%':
      return (typography.fontSize * typography.lineHeight.value) / 100;
    case 'AUTO':
      // This is only a fallback for empty lines; real nonempty lines use Figma's height.
      return typography.fontSize * 1.2;
  }
};

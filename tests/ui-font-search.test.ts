import { describe, expect, it } from 'vitest';
import { filterFontFamilies } from '../src/ui/App';

describe('font family search state', () => {
  const families = ['Inter', 'Mukta Vaani', 'Roboto', 'Roboto Mono'];
  it('uses a trimmed case-insensitive substring filter', () => {
    expect(filterFontFamilies(families, 'Inter', '  robOtO ')).toEqual([
      'Inter',
      'Roboto',
      'Roboto Mono',
    ]);
  });
  it('keeps the exact selected family and gives a safe empty-match choice', () => {
    expect(filterFontFamilies(families, 'Roboto', 'mukta')).toEqual(['Roboto', 'Mukta Vaani']);
    expect(filterFontFamilies(families, 'Roboto', 'no such font')).toEqual(['Roboto']);
  });
});

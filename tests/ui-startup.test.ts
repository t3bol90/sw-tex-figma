import { describe, expect, it } from 'vitest';
import { contextFromInitialization, INITIAL_CONTEXT } from '../src/ui/App';

describe('UI startup guard', () => {
  it('keeps Apply disabled until controller initialization supplies a token', () => {
    expect(INITIAL_CONTEXT).toMatchObject({ token: 0, canApply: false });
    expect(contextFromInitialization({ type: 'INITIALIZE' })).toMatchObject({
      token: 0,
      canApply: false,
    });
    expect(
      contextFromInitialization({ type: 'INITIALIZE', workflowToken: 0, canApply: true }),
    ).toMatchObject({ token: 0, canApply: false });
    expect(
      contextFromInitialization({
        type: 'INITIALIZE',
        workflowToken: 1,
        canApply: true,
        workflow: 'create',
        settings: {
          width: 1,
          mathScale: 1,
          inheritTypography: true,
          textAlignment: 'left',
          typography: {
            fontName: { family: 'Inter', style: 'Regular' },
            fontSize: 16,
            lineHeight: { unit: 'AUTO' },
            letterSpacing: { unit: 'PIXELS', value: 0 },
            fills: [],
          },
        },
      }),
    ).toMatchObject({ token: 1, canApply: true });
  });
});

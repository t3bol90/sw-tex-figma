import { describe, expect, it } from 'vitest';
import { AutoApplyGate } from '../src/ui/auto-apply-gate';

describe('auto apply gate', () => {
  it('claims a workflow token once across repeated initialization/resume messages', () => {
    const gate = new AutoApplyGate();
    expect(gate.claim(7)).toBe(true);
    expect(gate.claim(7)).toBe(false);
    expect(gate.claim(8)).toBe(true);
  });
});

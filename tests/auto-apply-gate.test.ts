import { describe, expect, it } from 'vitest';
import { AutoApplyGate } from '../src/ui/auto-apply-gate';
import { ApplyEpochGate } from '../src/ui/apply-epoch';

describe('auto apply gate', () => {
  it('claims a workflow token once across repeated initialization/resume messages', () => {
    const gate = new AutoApplyGate();
    expect(gate.claim(7)).toBe(true);
    expect(gate.claim(7)).toBe(false);
    expect(gate.claim(8)).toBe(true);
  });
});

it('invalidates an old async Apply after a source edit before it can post or change newer state', () => {
  const gate = new ApplyEpochGate();
  const old = gate.begin();
  gate.invalidate(); // SourceEditor change
  const next = gate.begin();
  expect(gate.isCurrent(old)).toBe(false);
  expect(gate.isCurrent(next)).toBe(true);
});

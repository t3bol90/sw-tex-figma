import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest entry points', () => {
  it('runs the default create workflow directly and keeps the edit relaunch', () => {
    expect(manifest).not.toHaveProperty('menu');
    expect(manifest.relaunchButtons).toEqual([{ command: 'edit', name: 'Edit Math Text' }]);
  });
});

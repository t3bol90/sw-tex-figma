import { describe, expect, it } from 'vitest';
import manifest from '../manifest.json';

describe('plugin manifest entry points', () => {
  it('supports Design and Slides under the existing Community plugin ID', () => {
    expect(manifest.editorType).toEqual(['figma', 'slides']);
    expect(manifest.id).toBe('1673896435619981207');
  });
  it('runs the default create workflow directly and keeps the edit relaunch', () => {
    expect(manifest).not.toHaveProperty('menu');
    expect(manifest.relaunchButtons).toEqual([{ command: 'edit', name: 'Edit Math Text' }]);
  });
});

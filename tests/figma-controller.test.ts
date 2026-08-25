import { describe, expect, it } from 'vitest';

import { createSelectionController } from '../src/figma/controller';
import type { SelectionSnapshotOutcome } from '../src/figma/selection';

const snapshot = (source: string, width: number): SelectionSnapshotOutcome => ({
  kind: 'selected',
  snapshot: {
    source,
    width,
    typography: {
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      lineHeight: { unit: 'AUTO' },
      letterSpacing: { unit: 'PIXELS', value: 0 },
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    },
    placement: { x: 1, y: 2, rotation: 0 },
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('selection controller', () => {
  it('initializes Apply state from the selected source, width, and typography', async () => {
    const messages: unknown[] = [];
    const controller = createSelectionController({
      readSelection: async () => snapshot('Inherited text', 777),
      postToUi: (message) => messages.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(messages).toEqual([
      expect.objectContaining({
        type: 'INITIALIZE',
        source: 'Inherited text',
        width: 777,
        typography: expect.objectContaining({ fontSize: 16 }),
      }),
    ]);
    expect(controller.selectedSnapshot?.placement).toEqual({ x: 1, y: 2, rotation: 0 });
  });

  it('keeps create usable with defaults and a useful status for invalid selection', async () => {
    const messages: unknown[] = [];
    const controller = createSelectionController({
      readSelection: async () => ({ kind: 'non-text-selection', nodeType: 'RECTANGLE' }),
      postToUi: (message) => messages.push(message),
      closePlugin: () => undefined,
    });
    await controller.initialize();
    expect(messages[0]).toMatchObject({
      type: 'INITIALIZE',
      width: 480,
      typography: expect.any(Object),
      status: expect.stringContaining('text layer'),
    });
  });

  it('suppresses a stale async selection read when selection changes', async () => {
    const first = deferred<SelectionSnapshotOutcome>();
    const second = deferred<SelectionSnapshotOutcome>();
    const reads = [first.promise, second.promise];
    const messages: unknown[] = [];
    const controller = createSelectionController({
      readSelection: () => reads.shift() as Promise<SelectionSnapshotOutcome>,
      postToUi: (message) => messages.push(message),
      closePlugin: () => undefined,
    });

    const oldRead = controller.initialize();
    const newRead = controller.selectionChanged();
    second.resolve(snapshot('New selection', 200));
    await newRead;
    first.resolve(snapshot('Old selection', 100));
    await oldRead;

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: 'SELECTION_CHANGED',
      source: 'New selection',
      width: 200,
    });
  });
});

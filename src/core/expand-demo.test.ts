import { describe, expect, it } from 'vitest';
import { clearFor } from './expand';
import { footprint } from './geometry';
import { demoLayout } from './demoLayout';
import { fillBlock } from './rows';

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('clearFor with the demo store', () => {
  it('stamping a block over aisles does not cross an earlier block below', () => {
    let layout = structuredClone(demoLayout);
    const block1 = fillBlock(layout, { x: 10, y: 32, w: 37, h: 7 }, {
      orientation: 'horizontal', double: false, lane: 2, open: true, overlap: true,
    });
    const c1 = clearFor(layout, block1.map((s) => footprint(s)), { preferAcross: 'y' });
    layout = {
      ...c1.layout,
      places: [
        ...c1.layout.places,
        ...block1.map((s, i) => ({
          ...s, id: `B${i + 1}`, label: `B${i + 1}`,
          x: s.x + c1.shift.x, y: s.y + c1.shift.y, categories: [] as string[],
        })),
      ],
    };

    const block2 = fillBlock(layout, { x: 10, y: 4, w: 37, h: 7 }, {
      orientation: 'horizontal', double: false, lane: 2, open: true, overlap: true,
    });
    const c2 = clearFor(layout, block2.map((s) => footprint(s)), { preferAcross: 'y' });
    layout = {
      ...c2.layout,
      places: [
        ...c2.layout.places,
        ...block2.map((s, i) => ({
          ...s, id: `N${i + 1}`, label: `B${i + 4}`,
          x: s.x + c2.shift.x, y: s.y + c2.shift.y, categories: [] as string[],
        })),
      ],
    };

    for (let i = 0; i < layout.places.length; i++) {
      for (let j = i + 1; j < layout.places.length; j++) {
        expect(
          overlaps(footprint(layout.places[i]), footprint(layout.places[j])),
          `${layout.places[i].label}×${layout.places[j].label}`,
        ).toBe(false);
      }
    }
  });
});

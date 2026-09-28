import { describe, expect, it } from 'vitest';
import {
  NO_CLIFFS,
  SEA_CLIFF,
  createSeaCliffs,
  type BaseHeight,
  type SeaCliffForm,
} from '../../src/engine/terrain/SeaCliffs';

/** Every coast is cut, at one width, with no wander: the shape alone. */
const EVERYWHERE: SeaCliffForm = { ...SEA_CLIFF, cover: [-3, -2], width: [120, 120], jag: 0 };
/** No coast is cut. */
const NOWHERE: SeaCliffForm = { ...SEA_CLIFF, cover: [2, 3] };

/** A straight coast along z: the sea for x < 0 down to the shelf, land rising `rise` a metre for x > 0. */
const coast =
  (rise: number): BaseHeight =>
  (x, _z, out) => {
    out[0] = x < 0 ? Math.max(-46, x * 0.08) : x * rise;
  };
/** A pond three metres deep in land twenty metres up. */
const pond: BaseHeight = (x, z, out) => {
  const r = Math.hypot(x, z);
  out[0] = r < 60 ? -3 + (r / 60) * 23 : 20;
};
const heightOn = (base: BaseHeight, form: SeaCliffForm) => {
  const cliffs = createSeaCliffs(base, 7, form);
  const out = new Float64Array(5);
  return (x: number, z = 0) => {
    base(x, z, out);
    const b = out[0]!;
    return b + cliffs.at(x, z, b, 1);
  };
};

describe('createSeaCliffs', () => {
  it('cuts the land in the band down to the floor and leaves what is behind the front alone', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    expect(h(40)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    expect(h(60)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    // behind the front: to the bit
    for (const x of [130, 200, 300]) expect(h(x)).toBe(x * 0.4);
  });
  it('stands the face over no more than two cells', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    let low = Number.NaN,
      high = Number.NaN;
    for (let x = 40; x <= 180; x += 0.5) {
      const share = (h(x) + SEA_CLIFF.floor) / (x * 0.4 + SEA_CLIFF.floor);
      if (share <= 0.2) low = x;
      if (Number.isNaN(high) && share >= 0.8) high = x;
    }
    expect(high - low).toBeGreaterThan(0);
    expect(high - low).toBeLessThanOrEqual(32);
  });
  it('deepens the sea at the foot and gives the shelf back further out', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    expect(h(-20)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    for (const x of [-170, -300, -600]) expect(h(x)).toBe(Math.max(-46, x * 0.08));
  });
  it('leaves a low coast a beach and a mountain a mountain', () => {
    const beach = heightOn(coast(0.1), EVERYWHERE);
    for (let x = 0; x <= 300; x += 8) expect(beach(x)).toBe(x * 0.1);
    const steep = heightOn(coast(2), EVERYWHERE);
    for (let x = 0; x <= 300; x += 8) expect(steep(x)).toBe(x * 2);
  });
  it('never cuts round a pond', () => {
    const h = heightOn(pond, EVERYWHERE);
    const out = new Float64Array(5);
    for (let r = 8; r <= 200; r += 4) {
      pond(r, 0, out);
      expect(h(r)).toBe(out[0]);
    }
  });
  it('cuts nothing where the mask is off, where a settlement stands, or with no cliffs at all', () => {
    const cliffs = createSeaCliffs(coast(0.4), 7, EVERYWHERE);
    expect(cliffs.at(60, 0, 24, 0)).toBe(0);
    expect(cliffs.at(60, 0, 24, 0.5)).toBeCloseTo(cliffs.at(60, 0, 24, 1) / 2, 9);
    expect(createSeaCliffs(coast(0.4), 7, NOWHERE).at(60, 0, 24, 1)).toBe(0);
    expect(NO_CLIFFS.at(60, 0, 24, 1)).toBe(0);
  });
  it('answers the same whatever the order of the questions and whatever the cache forgot', () => {
    const base = coast(0.4);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 3000; i++) points.push([((i * 37) % 500) - 200, ((i * 91) % 4000) - 2000]);
    const ask = (order: Array<[number, number]>, thrash: boolean) => {
      const cliffs = createSeaCliffs(base, 7, SEA_CLIFF);
      const out = new Float64Array(5);
      const answers = new Map<string, number>();
      for (const [x, z] of order) {
        // a far point between two near ones evicts what the near ones cached
        if (thrash) cliffs.at(x + 1e6, z - 1e6, 10, 1);
        base(x, z, out);
        answers.set(`${x},${z}`, cliffs.at(x, z, out[0]!, 1));
      }
      return points.map(([x, z]) => answers.get(`${x},${z}`)!);
    };
    const forward = ask(points, false);
    expect(ask([...points].reverse(), true)).toEqual(forward);
  });
});

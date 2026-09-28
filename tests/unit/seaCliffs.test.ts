import { describe, expect, it } from 'vitest';
import {
  COAST_NODE,
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
  it('reads a node before asking for the next, so two corners in one cache slot never mix up', () => {
    // A straight coast along z: every node row is identical, so at() must
    // answer the same for every z. Two of the four corners a lookup asks for
    // can hash into the same CACHE slot; if a value is read only after all
    // four corners are asked for, the later corner's node() overwrites the
    // earlier corner's slot first, and the mix reads the wrong node's answer.
    //
    // `coast(0.4)` puts the shoreline at x = 0, where every ix a lookup near
    // it asks for (0, 1, 2) happens to be a pair the CACHE (4096 slots, a
    // fixed hash of ix and iz) never collides on, for any iz -- checked
    // exhaustively up to 5e7 rows, so the brief's own x = 40 never hits the
    // bug. `shiftedCoast` is the same shape moved out five COAST_NODE cells,
    // to the nearest column (ix = 5, paired with 6) the CACHE does collide
    // on -- at iz = 592, found the same way. Once there, the default face
    // (32 m) keeps the cut saturated at "fully cut" on both sides of that
    // collision, so a wrong node still reads back the same saturated answer;
    // `face: 150` widens the cut's own fade so the two nodes' true distances
    // (0 m for the node sitting on the shoreline, 64 m for the one a cell
    // over) land on different parts of the fade, and the swap is a visibly
    // different number, not just a differently-computed nought.
    const shiftedCoast =
      (rise: number): BaseHeight =>
      (x, _z, out) => {
        const xr = x - 5 * COAST_NODE;
        out[0] = xr < 0 ? Math.max(-46, xr * 0.08) : xr * rise;
      };
    const wideFace: SeaCliffForm = { ...EVERYWHERE, face: 150 };
    const cliffs = createSeaCliffs(shiftedCoast(0.4), 7, wideFace);
    const x = 5 * COAST_NODE + 40;
    const first = cliffs.at(x, 32, 16, 1);
    expect(first).toBeLessThan(-1); // the point still has its cut, or the test proves nothing
    for (let iz = 0; iz <= 20000; iz++) {
      const z = iz * COAST_NODE + 32;
      expect(cliffs.at(x, z, 16, 1)).toBe(first);
    }
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

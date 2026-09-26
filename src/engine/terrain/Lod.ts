// The far terrain's arithmetic: a second, coarse window under a grid that
// reaches twice as far as the near one, with a hole where the near one lies.
// Both grids and the water stand on one anchor, snapped to the far cell, so the
// near grid always ends on a far grid line and the hole never moves inside the
// far grid; the near grid's last `MORPH` metres go over into the far surface,
// so on the edge the two are one surface. What is drawn past the near window is
// for looking at: nothing on the CPU reads the far window, and `heightAt` does
// not know the rim is bent -- it starts 3.9 km out, past everything that asks.
import { sstep } from './noise';
import { CELL } from './WorldSampler';

/** Near grid, cells a side: ±4.2 km. */
export const NEAR_CELLS = 528;
/** Metres from the anchor to the near grid's edge. */
export const NEAR_REACH = (NEAR_CELLS * CELL) / 2;
/** The far window's cell, m: four near ones, so its samples are the near window's own. */
export const FAR_CELL = 64;
/** Far grid, cells a side: ±8.2 km. */
export const FAR_CELLS = 256;
/** Far window, texels a side: the grid and a central difference either side of it, and a little. */
export const FAR_WINDOW = 264;
/** Far cells either side of the far grid's middle left out: the near grid's square. */
export const HOLE = NEAR_REACH / FAR_CELL;
/** Metres of the near grid's rim that go over into the far surface. */
export const MORPH = 320;

/** The anchor both grids and the water stand on, m: a whole number of far cells. */
export const anchorOf = (v: number) => Math.round(v / FAR_CELL) * FAR_CELL;

/** How far the near surface has gone over into the far one, 0..1, at (dx, dz) m from the anchor. */
export const morphWeight = (dx: number, dz: number) =>
  sstep(NEAR_REACH - MORPH, NEAR_REACH, Math.max(Math.abs(dx), Math.abs(dz)));

/**
 * A grid's triangles, `cells` a side, with the diagonal `Heightfield.heightAt`
 * interpolates on, leaving out `hole` cells either side of the middle.
 */
export function gridIndices(cells: number, hole = 0): Uint32Array {
  const side = cells + 1,
    lo = cells / 2 - hole,
    hi = cells / 2 + hole;
  const out = new Uint32Array((cells * cells - 4 * hole * hole) * 6);
  let i = 0;
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      if (hole > 0 && x >= lo && x < hi && z >= lo && z < hi) continue;
      const v = z * side + x;
      out.set([v, v + side, v + 1, v + side + 1, v + 1, v + side], i);
      i += 6;
    }
  return out;
}

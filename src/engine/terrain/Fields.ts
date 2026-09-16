// What a biome's CPU hooks see. The sampler fills one of these per texel and
// hands the same object to every hook, so a hook may read it but never keep
// it: there is exactly one, rewritten in place, because a full window is
// 313 600 texels and an object per texel would be 313 600 objects. Pure CPU:
// base fields, noise and hashes, no three, no DOM.
import type { Fields, LatticeHit } from '../../../library/contract';
import { fbm, hash2, sstep } from './noise';
import { CELL, type WorldSampler } from './WorldSampler';

/**
 * How far from the water line a place still counts as a shore, m. The shelf in
 * sampleWorld bottoms the sea floor out at about -46 m, so a reach of 60 would
 * have made a shore of the whole sea; 25 covers the beach (sand runs 1.5..7.5 m)
 * and the dune band behind it, and nothing else.
 */
export const SHORE_REACH = 25;
/** How far a lattice centre may wander inside its own cell, as a share of the cell. */
const LATTICE_JITTER = 0.3;

export interface FieldsReader {
  /** The fields at a world point. The same object every time -- read it, do not keep it. */
  at(x: number, z: number): Fields;
}

export function createFields(sampler: WorldSampler): FieldsReader {
  const base = new Float64Array(5);
  const u32 = 4294967296;
  // A hook's own noise and hashes carry the world seed too. The base fields get
  // theirs through fieldSeeds, but a hook that asks for noise(370, 1) would
  // otherwise read the same pattern in every world, and every seed would grow
  // its groves in the same places.
  const salted = (salt: number) => (salt ^ Math.imul(sampler.seed, 0x9e3779b1)) >>> 0;
  let ix = 0,
    iz = 0;
  // The centre's own height and temperature, sampled once per lattice cell
  // rather than once per texel. A lattice cell is kilometres wide and the window
  // is filled row by row, so a remembered answer covers almost every query;
  // without one, a presence hook that asks for a lattice doubles the cost of a
  // fill.
  //
  // There are SEATS of them, not one, because the registry carries more than one
  // lattice: a village on six kilometres and a town on twenty are two different
  // centres asked for the same texel, and a single slot is thrashed by the pair.
  // Measured on a full 560x560 window of seed 42: 783 ms with one lattice and
  // 1810 ms with two, which is the whole saving handed back. The slots are
  // scanned rather than hashed because there are four of them.
  const centre = new Float64Array(5);
  const SEATS = 4;
  const seatX = new Float64Array(SEATS).fill(NaN),
    seatZ = new Float64Array(SEATS).fill(NaN),
    seatH = new Float64Array(SEATS),
    seatT = new Float64Array(SEATS);
  let nextSeat = 0;
  const hit: LatticeHit & { cell: number; salt: number; ix: number; iz: number } = {
    cx: 0,
    cz: 0,
    d: 0,
    h: 0,
    t: 0,
    cell: 0,
    salt: 0,
    ix: 0,
    iz: 0,
    // Keyed on the cell's own index, never on the jittered centre. Rounding the
    // centre back to an index looks equivalent and is not: the centre is the
    // index plus a half plus a jitter of up to a third, so it rounds to this
    // cell or the next one depending on the *sign of the jitter* -- which is
    // the very hash the stream then reads. Measured on seed 42 before the fix:
    // a third of cells shared their whole stream with a neighbour, and u(0) came
    // up below a half 63 % of the time.
    u(k: number) {
      return hash2(this.ix, this.iz, this.salt + k * 977) / u32;
    },
  };
  const fields: Fields = {
    x: 0,
    z: 0,
    cont: 0,
    temp: 0,
    baseTemp: 0,
    moist: 0,
    region: 0,
    baseHeight: 0,
    shore: 0,
    hash: (salt) => hash2(ix, iz, salted(salt)) / u32,
    noise: (scale, salt, octaves = 3) => fbm(fields.x / scale, fields.z / scale, salted(salt), octaves),
    lattice(cell, salt) {
      // One hash per query: the nearest centre of a lattice whose cells each
      // hold one centre, jittered inside the cell so the grid never shows. The
      // neighbours are not searched -- this is the contract's lattice, not a
      // Voronoi diagram, and at a third of a cell of jitter they agree almost
      // everywhere for a ninth of the cost.
      const cx = Math.floor(fields.x / cell),
        cz = Math.floor(fields.z / cell);
      const jx = (hash2(cx, cz, salted(salt)) / u32 - 0.5) * LATTICE_JITTER * 2,
        jz = (hash2(cx, cz, salted(salt + 31)) / u32 - 0.5) * LATTICE_JITTER * 2;
      hit.ix = cx;
      hit.iz = cz;
      hit.cx = (cx + 0.5 + jx) * cell;
      hit.cz = (cz + 0.5 + jz) * cell;
      hit.d = Math.hypot(hit.cx - fields.x, hit.cz - fields.z);
      let seat = -1;
      for (let k = 0; k < SEATS; k++)
        if (seatX[k] === hit.cx && seatZ[k] === hit.cz) {
          seat = k;
          break;
        }
      if (seat < 0) {
        sampler.baseFields(hit.cx, hit.cz, centre);
        // Round robin, because the lattices take turns by texel: whatever is
        // evicted is the one asked longest ago, which with one slot per lattice
        // is never the one about to be asked.
        seat = nextSeat;
        nextSeat = (nextSeat + 1) % SEATS;
        seatX[seat] = hit.cx;
        seatZ[seat] = hit.cz;
        seatH[seat] = centre[0]!;
        seatT[seat] = centre[1]!;
      }
      hit.h = seatH[seat]!;
      hit.t = seatT[seat]!;
      hit.cell = cell;
      // The stream the hit hands out is salted too: the sites of M4 stand on
      // this lattice, and two worlds whose villages sit on the same grid are
      // one world with two palettes.
      hit.salt = salted(salt);
      return hit;
    },
  };
  return {
    at(x, z) {
      sampler.baseFields(x, z, base);
      ix = Math.floor(x / CELL);
      iz = Math.floor(z / CELL);
      fields.x = x;
      fields.z = z;
      fields.baseHeight = base[0]!;
      fields.temp = base[1]!;
      fields.moist = base[2]!;
      fields.region = base[3]!;
      fields.cont = base[4]!;
      // the cooling the sampler already applied, taken back off: the snow line
      // is drawn on the climate, not on the height it produced
      fields.baseTemp = fields.temp + Math.max(0, fields.baseHeight) / 2600;
      fields.shore = 1 - sstep(0, SHORE_REACH, Math.abs(fields.baseHeight));
      return fields;
    },
  };
}

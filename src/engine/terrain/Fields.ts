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
  const hit: LatticeHit & { cell: number; salt: number } = {
    cx: 0,
    cz: 0,
    d: 0,
    cell: 0,
    salt: 0,
    u(k: number) {
      return (
        hash2(Math.round(this.cx / this.cell), Math.round(this.cz / this.cell), this.salt + k * 977) / u32
      );
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
      const jx = (hash2(cx, cz, salt) / u32 - 0.5) * LATTICE_JITTER * 2,
        jz = (hash2(cx, cz, salt + 31) / u32 - 0.5) * LATTICE_JITTER * 2;
      hit.cx = (cx + 0.5 + jx) * cell;
      hit.cz = (cz + 0.5 + jz) * cell;
      hit.d = Math.hypot(hit.cx - fields.x, hit.cz - fields.z);
      hit.cell = cell;
      hit.salt = salt;
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

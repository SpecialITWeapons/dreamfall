/**
 * The standard placement hook: what grows in a biome and how thickly. It sows
 * trees and nothing else. The prop weights a biome names are read by that
 * prop's own place(), and the grass is data the grass window folds by weight --
 * two placement models on purpose, because a biome knows how much it wants and
 * a prop knows how it stands.
 *
 * The engine runs this once per biome whose share of a cell is worth the visit,
 * so the density is scaled by that share and the cap on trees per cell belongs
 * to the kit, not to the arithmetic here: three biomes may not put up nine
 * trees between them.
 */
import { sstep } from './math.js';
import { snowLineAt } from './snowLine.js';

/** Trees one cell may hold, however many biomes claim it. The kit enforces it again. */
export const CELL_TREES = 3;
/** The last trees stand this far above the snow line, thinning out over the metres below it. */
const TREE_LINE = { above: 60, thin: 120 };
/** Groves: one noise field decides which parts of a climate grow thick and which stand open. */
const GROVE = { scale: 370, salt: 0xc071, from: -0.25, to: 0.3, base: 2, span: 4 };
/** Ground a tree refuses: the sea, the surf line, and anything steeper than this. */
const FOOTING = { cell: 3, tree: 4, slope: 0.6 };

/**
 * Sow a cell with the species of one biome.
 *
 * @param {{ species: Record<string, number>; density: number }} spec
 * @returns {import('../contract').PopulateHook & ((cell: import('../contract').Cell, kit: import('../contract').SceneryKit) => void)}
 */
export function scatter(spec) {
  const species = Object.entries(spec.species ?? {}).filter(([, weight]) => weight > 0);
  const total = species.reduce((sum, [, weight]) => sum + weight, 0);
  const density = spec.density ?? 0;
  return (cell, kit) => {
    if (total <= 0 || density <= 0 || cell.share <= 0) return;
    const ground = cell.height(cell.center.x, cell.center.z);
    if (ground < FOOTING.cell) return;
    const f = cell.fields;
    const grove = GROVE.base + GROVE.span * sstep(GROVE.from, GROVE.to, f.noise(GROVE.scale, GROVE.salt, 1));
    // The tree line follows the snow line, which is the climate's own and not
    // the height's, so cold country loses its trees low and a desert keeps them
    // to the summit.
    const line = snowLineAt(f.baseTemp) + TREE_LINE.above;
    const thin = 1 - sstep(line - TREE_LINE.thin, line, ground);
    const count = Math.min(CELL_TREES, Math.floor(density * cell.share * grove * thin));
    for (let k = 0; k < count; k++) {
      // Every tree draws the same four numbers whether it stands or not, so the
      // ground may refuse one without moving the others.
      const x = cell.corner.x + cell.roll() * cell.size,
        z = cell.corner.z + cell.roll() * cell.size,
        pick = cell.roll() * total,
        yaw = cell.roll() * Math.PI * 2;
      if (cell.height(x, z) < FOOTING.tree || cell.slope(x, z) > FOOTING.slope) continue;
      if (cell.occupied(x, z)) continue;
      let acc = 0,
        chosen = '';
      for (const [id, weight] of species) {
        acc += weight;
        chosen = id;
        if (pick <= acc) break;
      }
      if (chosen) kit.tree(chosen, x, z, { yaw });
    }
  };
}

/**
 * A hook or a descriptor, as a hook -- and the descriptor itself when there was
 * one. The engine needs both: the hook sows the trees, and the data behind it
 * carries the prop weights and the grass, which nothing calls and everything
 * reads. A biome written as code therefore has neither.
 *
 * @param {import('../contract').PopulateHook} hook
 * @returns {{ hook: (cell: import('../contract').Cell, kit: import('../contract').SceneryKit) => void, scatter: import('../contract').ScatterSpec | null }}
 */
export function resolve(hook) {
  if (typeof hook === 'function') return { hook, scatter: null };
  switch (hook?.type) {
    case 'scatter':
      return { hook: scatter(hook), scatter: hook };
    default: {
      const odd = /** @type {{ type?: string }} */ (hook);
      throw new Error(`unknown hook type "${odd?.type}"`);
    }
  }
}

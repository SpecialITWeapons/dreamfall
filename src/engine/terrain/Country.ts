// What stands in a country rather than being one. A settlement is an entry of
// the registry -- it has a presence, a plateau and a plan -- but the ground it
// stands on, what grows there, its sound and its air belong to the country
// around it. Its weight in the window is what the plateau is weighed by, and
// for everything else that weight is handed to the slots beside it.
//
// This is the arithmetic every CPU reader of the window's three slots shares:
// the ring sows by it and the grass grows by it. The ground shader writes the
// same sums in nodes (TerrainMesh), because a shader cannot call this. Pure
// CPU: no three, no DOM.
import { SLOTS } from './WorldSampler';

export interface Standing {
  /** 1 where the registry entry stands in a country, by registry index. */
  inherit: Uint8Array;
  /** The share of the country's trees and props that stands on it; 1 for a country. */
  trees: Float32Array;
}

/** Who stands in a country, read once off the registry. */
export function standingOf(biomes: ReadonlyArray<{ inherit?: { trees: number } }>): Standing {
  const inherit = new Uint8Array(biomes.length),
    trees = new Float32Array(biomes.length).fill(1);
  biomes.forEach((biome, i) => {
    if (!biome.inherit) return;
    inherit[i] = 1;
    trees[i] = biome.inherit.trees;
  });
  return { inherit, trees };
}

/**
 * The country under three slots: the slots that are a country, renormalised
 * to one, and the others zeroed. Returns how much of the country's scatter
 * stands here -- 1 in open country, the settlement's own `trees` in the middle
 * of one, and between the two across its feather, so a village fades into the
 * wood around it instead of stopping at a line.
 *
 * With no country in any slot -- three settlements, or one with nothing beside
 * it in the window -- the first biome of the registry takes it all, which is
 * the sampler's own rule for ground nobody claims.
 */
export function countryOf(
  ids: ArrayLike<number>,
  weights: ArrayLike<number>,
  standing: Standing,
  outIds: Uint8Array,
  outWeights: Float32Array,
): number {
  let country = 0,
    clearing = 1;
  for (let s = 0; s < SLOTS; s++) {
    const weight = weights[s]!,
      id = ids[s]!;
    if (!(weight > 0)) continue;
    if (standing.inherit[id]) clearing -= weight * (1 - standing.trees[id]!);
    else country += weight;
  }
  for (let s = 0; s < SLOTS; s++) {
    const weight = weights[s]!,
      id = ids[s]!;
    outIds[s] = id;
    outWeights[s] = country > 0 && weight > 0 && !standing.inherit[id] ? weight / country : 0;
  }
  if (!(country > 0)) {
    outIds.fill(0, 0, SLOTS);
    outWeights.fill(0, 0, SLOTS);
    outWeights[0] = 1;
  }
  return Math.max(0, Math.min(1, clearing));
}

/**
 * The registry. To add to the world, add a file under biomes/ and one line
 * here. The order of the biomes is theirs to keep -- it is not a priority --
 * with one exception: the first of them takes any texel no biome claims, so it
 * should be the one that reads as ordinary ground.
 *
 * The macro blotches of every biome share one noise field (scale 0.012, salt 1),
 * exactly as they did in the original, so the ground reads as one world rather
 * than as ten palettes laid over each other.
 */
import wildsong from './biomes/wildsong.js';
import elderwood from './biomes/elderwood.js';
import steppe from './biomes/steppe.js';
import badlands from './biomes/badlands.js';
import dunes from './biomes/dunes.js';
import frostpines from './biomes/frostpines.js';
import moor from './biomes/moor.js';
import autumn from './biomes/autumn.js';
import jungle from './biomes/jungle.js';
import blossom from './biomes/blossom.js';

/** @returns {import('./contract').Library} */
export function createLibrary() {
  return {
    biomes: [wildsong, elderwood, steppe, badlands, dunes, frostpines, moor, autumn, jungle, blossom],
    species: [],
    props: [],
    structures: [],
  };
}

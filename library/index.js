/**
 * The registry. To add to the world, add a file under biomes/ and one line
 * here. The order of the biomes is theirs to keep -- it is not a priority --
 * with one exception: the first of them takes any texel no biome claims, so it
 * should be the one that reads as ordinary ground.
 *
 * The macro blotches of every biome share one noise field (scale 0.012, salt 1),
 * exactly as they did in the original, so the ground reads as one world rather
 * than as ten palettes laid over each other.
 *
 * Species and props are the same kind of entry, listed once here and named by
 * the biomes that want them: a biome says how much of what grows in it, and the
 * validator refuses an id nobody baked.
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
import acacia from './species/acacia.js';
import birch from './species/birch.js';
import blossomTree from './species/blossom.js';
import cypress from './species/cypress.js';
import deadwood from './species/deadwood.js';
import elder from './species/elder.js';
import oak from './species/oak.js';
import palm from './species/palm.js';
import pine from './species/pine.js';
import boulders from './props/boulders.js';
import cairns from './props/cairns.js';

/** @returns {import('./contract').Library} */
export function createLibrary() {
  return {
    biomes: [wildsong, elderwood, steppe, badlands, dunes, frostpines, moor, autumn, jungle, blossom],
    species: [acacia, birch, blossomTree, cypress, deadwood, elder, oak, palm, pine],
    props: [boulders, cairns],
    structures: [],
  };
}

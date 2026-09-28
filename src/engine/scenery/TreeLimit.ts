// Where a full tree hands over to its card, by how high the eye is over the
// land under it: the ring's own band near the ground, drawing in as the flight
// climbs, and nothing at all high up, where every tree is a card. A pure
// function, read once a frame into the uniform the trees and the cards share.
import { sstep } from '../terrain/noise';
import { treeLimitOf } from './cardPack';

/**
 * Where a thing standing on the ground fades out, m. It ends just inside
 * TREE_RADIUS: past that the ring has nothing to show anyway. The original
 * folded a tree into its own base across this band, which is cheap and reads
 * as a tree sprouting out of the ground in front of the flight -- two and a
 * half to four seconds of it, at the speeds this world flies. A tree stands at
 * its own height here and dissolves instead -- into its card, since the cards.
 */
export const RING_FADE = [2300, 2560] as const;

/** Metres over the land under the eye. */
export interface TreeLimitForm {
  /** Where the band starts drawing in. */
  from: number;
  /** Where every tree is a card: the nearest is some twenty-five pixels tall from here. */
  to: number;
}
export const TREE_LIMIT: Readonly<TreeLimitForm> = { from: 700, to: 1100 };

/** The band a full tree dissolves in and its card comes up in, m, `alt` metres over the land. */
export function treeBandAt(alt: number, form: TreeLimitForm = TREE_LIMIT): [number, number] {
  // a form set the wrong way round, or to one height, is still a climb
  const lo = Math.min(form.from, form.to),
    hi = Math.max(lo + 1, form.from, form.to);
  return treeLimitOf(RING_FADE[0], RING_FADE[1], 1 - sstep(lo, hi, alt));
}

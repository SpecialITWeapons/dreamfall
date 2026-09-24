/**
 * The village: the small settlement of spec section 8. Thirty to a hundred and
 * fifty houses along one street that follows the hillside, side paths off it,
 * and a plateau weak enough that the ground still reads as ground.
 *
 * These are numbers, not code. The plan that reads them is `plan.js`; the biome
 * entry that carries them into the world is `settlement.js`.
 */
export const VILLAGE = {
  /** Its own name in the registry, and the name a site's plan is keyed by. */
  id: 'village',
  name: 'Village',
  /** The lattice the presence hook, the plateau and the site finder all share. */
  lattice: { cell: 6000, salt: 0x5117 },
  /**
   * Three in four cells of the lattice that can seat one carry a village: one
   * per 60 km2 of land, about 7.7 km apart -- the owner asked for more of them
   * than one per 90 km2 at 9.4 km. The carry draw is one number per cell, so
   * raising the odds only adds villages; every village that stood at 0.5 still
   * stands.
   */
  odds: 0.75,
  /** @type {[number, number]} */
  radius: [120, 250],
  /** Weak on purpose: a village sits on its hill, it does not cut it flat. */
  plateau: { strength: 0.3, feather: 170 },
  /**
   * What ground a village will stand on. These numbers are read twice --
   * by the presence hook, which flattens, and by the site finder,
   * which seats the village -- and they must be the same numbers both times.
   *
   * No `minTemp`: a village stands in any country, the frozen ones included,
   * on the country's own snow.
   */
  ground: { land: 10, maxSlope: 0.45 },
  roads: {
    /** Metres between side paths along the main street. */
    spacing: 70,
    width: 6,
    /** How far a path may run off the street before the slope ends it. */
    reach: 90,
    /** A path stops where the ground tilts more than this. */
    maxSlope: 0.5,
  },
  lots: {
    /** Front to back, m: also the space one house takes along the street. */
    depth: 24,
    /** From the axis of the street to the front of the house, m. */
    setback: 14,
    /** Houses thin out toward the edge; this is the share kept at the centre. */
    density: 0.9,
  },
  /** Relative weights by structure id; the validator checks them against the registry. */
  buildings: { cottage: 1, barn: 0.3, mill: 0.05 },
  /**
   * Hedgerows: a hedge behind the houses, following the lane they stand on.
   *
   * This started as orchards -- a hedge squared off around a plot on the fringe,
   * with the village's own scatter left to fill it, since a line claims no
   * ground. The picture killed it: at a village's tree density the plot comes
   * out empty, and an empty hedge square on bare clay reads as a green picture
   * frame dropped in a field. A hedge beside a lane needs nothing inside it.
   *
   * `offset` clears the gardens: a house sits `lots.setback` from the axis and
   * is about 7 m deep, so 34 m is behind it with room for a garden.
   * `clear` is how near another lane a hedge may come before it gives way --
   * a hedge laid across a road is the one thing this must not do.
   */
  hedges: { offset: 34, clear: 13, maxSlope: 0.35 },
  /**
   * The share of the country's trees and props that stands on a village's
   * ground: a clearing. It used to sow its own oaks and blossoms at 0.3, and
   * measured that was 0.5 trees a hectare inside against 1.4 outside; the
   * country's own density times 0.4 keeps about the same ratio in a wood, and
   * a steppe village has its handful of acacias rather than somebody's orchard.
   */
  clearing: 0.4,
  /**
   * What a house is tinted with. A tint multiplies the colours its recipe
   * painted, so these are pale and warm on purpose: a village of three recipes
   * needs to read as a village of houses rather than three houses repeated, and
   * this costs nothing -- no second bake, no second pool, one instance colour.
   * `white` is in twice so that a plain house stays the commonest.
   */
  palette: ['white', 'white', 'barkPale', 'canopyDry', 'grassGold'],
};

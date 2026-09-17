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
  odds: 0.5,
  /** @type {[number, number]} */
  radius: [120, 250],
  /** Weak on purpose: a village sits on its hill, it does not cut it flat. */
  plateau: { strength: 0.3, feather: 170 },
  /**
   * What ground a village will stand on. These numbers are read twice --
   * by the presence hook, which paints and flattens, and by the site finder,
   * which seats the village -- and they must be the same numbers both times.
   */
  ground: { land: 10, minTemp: 0.2, maxSlope: 0.45 },
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
    depth: 18,
    /** From the axis of the street to the front of the house, m. */
    setback: 9,
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
   * `offset` clears the lots: a house sits `lots.setback` from the axis and
   * reserves `lots.depth * 0.7` around itself, so 27 m is behind the gardens.
   * `clear` is how near another lane a hedge may come before it gives way --
   * a hedge laid across a road is the one thing this must not do.
   */
  hedges: { offset: 27, clear: 11, maxSlope: 0.35 },
  /**
   * What grows on the ground a village claims. Without it the village is a
   * disc of painted clay 420 m across -- radius plus feather -- with two
   * hundred metres of houses in the middle of it and nothing at all around
   * them, because a settlement's own weight crowds the country's biomes out of
   * the fragment and then sows nothing in their place. The owner's words for
   * it were that the ground around the houses is empty and looks odd.
   *
   * The density is a fraction of the wood's and it has to be, because the
   * reservations alone do far less than they look: they cover about a fifth of
   * the disc, and the scatter's own `floor(density * share * grove)` swallows
   * most of the rest. Measured over the real ring at seed 42's village, 0.55
   * put 1.7 trees a hectare inside the village against 1.7 outside it -- the
   * same wood, with houses in it. At 0.3 it is 0.5 against 1.4, which is a
   * clearing with trees in it, which is what a village is.
   *
   * No thinning toward the middle beyond that: the reservations do refuse a
   * tree where the houses are, and one density over the whole disc is enough
   * once it is the right one. The grass is the bigger half of the fix anyway --
   * a village had strictly less grass than the meadow around it, which is
   * exactly backwards for trodden ground with gardens on it.
   */
  scenery: {
    species: { oak: 1, blossom: 0.7, birch: 0.4 },
    density: 0.3,
    props: { cairns: 0.25 },
    grass: { tint: 'grassGold', density: 0.85 },
  },
  /**
   * What a house is tinted with. A tint multiplies the colours its recipe
   * painted, so these are pale and warm on purpose: a village of three recipes
   * needs to read as a village of houses rather than three houses repeated, and
   * this costs nothing -- no second bake, no second pool, one instance colour.
   * `white` is in twice so that a plain house stays the commonest.
   */
  palette: ['white', 'white', 'barkPale', 'canopyDry', 'grassGold'],
};

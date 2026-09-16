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
   * What ground a village will stand on. These three numbers are read twice --
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
   * Orchards: a hedge around a plot out on the fringe, with nothing inside it.
   * A line claims no ground by contract, so the village's own trees grow in
   * there on their own -- the hedge says which trees were planted on purpose,
   * and costs a ribbon rather than a scatter of its own.
   *
   * `tries` and not `count`: a plot that lands on the houses or on a slope is
   * dropped, and a village crowded to its edge simply has fewer orchards. They
   * are drawn last of everything, so adding them moved not one house.
   */
  /** @type {{ tries: number, band: [number, number], size: [number, number], maxSlope: number }} */
  orchards: { tries: 5, band: [0.55, 0.92], size: [34, 26], maxSlope: 0.32 },
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

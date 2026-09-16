/**
 * The village: the small settlement of spec section 8. Thirty to a hundred and
 * fifty houses along one street that follows the hillside, side paths off it,
 * and a plateau weak enough that the ground still reads as ground.
 *
 * These are numbers, not code. The plan that reads them is `plan.js`; the biome
 * entry that carries them into the world is `settlement.js`.
 */
export const VILLAGE = {
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
  ground: { land: 10, minTemp: 0.2, maxSlope: 0.25 },
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
};

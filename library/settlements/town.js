/**
 * The town: the large settlement of spec section 8. Five hundred to two
 * thousand buildings on a jittered grid inside a ring road, a plaza with a
 * landmark at the middle of it, and a plateau strong enough that the ground
 * under it reads as a floor rather than as a hillside.
 *
 * These are numbers, not code. The plan that reads them is `plan-town.js`; the
 * biome entry that carries them into the world is `settlement.js`, which is the
 * same entry the village uses -- a settlement is its parameters plus its plan,
 * and nothing else.
 *
 * Why the town is not the village with bigger numbers: measured, the village
 * generator stretched to a 900 m radius lays 147 lots, because its layout is
 * one street along a contour with paths off it. That fills a ribbon. A town
 * fills a disc, and only a grid does.
 */
export const TOWN = {
  id: 'town',
  name: 'Town',
  /**
   * The lattice the presence hook, the plateau and the site finder all share.
   * Twenty kilometres is the specification's, and at 40..62 m/s it is five to
   * eight minutes of flying between one cell and the next.
   *
   * The salt is not the village's. Both lattices are read at every texel of
   * every fill, and a shared salt would stand every town on a village: measured
   * over 65 536 seed masks, this pair of salts never once put the two centres
   * in the same place (`docs/superpowers/notes/2026-09-16-m4b-dwie-kraty.md`).
   */
  lattice: { cell: 20000, salt: 0x7011 },
  odds: 0.6,
  /** @type {[number, number]} */
  radius: [400, 900],
  /**
   * Full strength, as the specification asks: a town levels its ground. The
   * feather is wide because of what it has to let down -- `ground.maxCut`
   * metres, and up to twice that where the town is already fading -- and 120 m
   * over 300 is a shoulder where 120 over 170 would be a scarp.
   */
  plateau: { strength: 1, feather: 300 },
  /**
   * What ground a town will stand on, read twice -- by the presence hook, which
   * paints and flattens, and by the site finder, which seats the town -- and
   * the same numbers both times.
   *
   * `maxSlope` is the village's, and deliberately: measured on seed 42 over the
   * 895 cells of a 20 km lattice that can seat a town at all, tightening it
   * from 0.45 to 0.06 moves the median departure of the ground from the centre
   * inside 900 m from 167 m to 146 m, and refuses two seats in three doing it.
   * Over hundreds of metres the ground's departure is the terrain's relief, not
   * the slope of the one point at the middle of it, and the slope rule was
   * written for a hillside 125 m across. Kept at 0.45 it still refuses that
   * hillside; taken lower it only makes towns rare -- 41 km apart at 0.45,
   * 78 km at 0.12 -- and a town nobody flies over is not a feature.
   *
   * `maxCut` is what actually shapes a town, and it is the cut said in metres:
   * the ground may be 120 m off the centre's height before the town begins to
   * fade, and is none of the town's by 240. The plateau follows, because the
   * engine weighs every height change by the biome's own share. The median
   * departure at the rim being 148 m is why 120 is the number: a town on rolling
   * ground keeps the part of it that is flat and lets the rest go, instead of
   * cutting a table out of a hillside.
   */
  ground: { land: 12, minTemp: 0.25, maxSlope: 0.45, maxCut: 120 },
  roads: {
    /**
     * The ring road: a closed walk at this share of the radius, in this many
     * steps. At 900 m that is 106 m a step, whose sagitta is 1.9 m -- a circle,
     * not a polygon. Everything the grid lays is cut off at it.
     */
    ring: { at: 0.9, width: 9, steps: 48 },
    /** Metres between one street of the grid and the next, both ways. */
    spacing: 64,
    width: 7,
    /**
     * How far a street may wander off its ruled line, m. A grid with none of
     * this is graph paper; the wander is a slow curve along the street rather
     * than noise at every step, or the ribbon reads as a rope.
     */
    jitter: 11,
    /** Metres between the points a street is walked in. */
    step: 32,
    /**
     * A street stops where the ground tilts more than this. Inside the plateau
     * it never fires -- that is the point of the plateau -- but a town's
     * presence is normalised against every other biome's, so its flattening is
     * its share of the fragment and not a promise, and the outskirts of a wide
     * town reach past the feather. There the rule is all that keeps a street
     * off the hillside.
     */
    maxSlope: 0.3,
  },
  /**
   * The plaza: ground kept clear at the centre, with the landmark standing at
   * its edge.
   */
  plaza: { radius: 46 },
  /**
   * The one building placed by name rather than drawn by weight: there is
   * exactly one of it, and a weight cannot say "one". It stands at the edge of
   * the plaza and the biome entry hands it to the validator so the registry is
   * still asked whether the recipe exists.
   */
  landmark: 'tower',
  lots: {
    /** Front to back, m: also the space one building takes along the street. */
    depth: 18,
    /** From the axis of the street to the front of the building, m. */
    setback: 10,
    /**
     * How many buildings a town has, from its narrowest to its widest. The
     * specification's 500..2000, and the plan hits it by construction: it walks
     * every lot the grid offers, then accepts a share of them chosen so the
     * count comes out here. A cap would have done it too, and would have built
     * a town with one side missing -- the same fault the ring's tree ceiling
     * has, and it is a fault there as well.
     *
     * @type {[number, number]}
     */
    count: [560, 1900],
  },
  /**
   * How tall, by distance from the centre. `bias` above 1 keeps the tall
   * buildings near the middle: the wanted count is `min + (max - min) *
   * (1 - out) ** bias`, jittered, rounded, and then clamped into whatever
   * range the drawn structure actually has a bake at.
   */
  floors: { min: 1, max: 4, bias: 2, jitter: 1.4 },
  /**
   * Relative weights by structure id; the validator checks them against the
   * registry. The tower is not here: it is the landmark, placed once by name.
   */
  buildings: { cottage: 1, barn: 0.2, mill: 0.02 },
  /**
   * The floors the town is willing to ask each kind for. It has to be written
   * down rather than asked, because the plan is a pure function of its site and
   * the kit does not tell it what is baked -- and asking a kind for a storey it
   * has no bake at throws in the queue rather than shrugging. These must stay
   * inside the ranges the recipes declare; a test holds them together.
   *
   * @type {Record<string, [number, number]>}
   */
  storeys: { cottage: [1, 3], barn: [1, 2], mill: [3, 4] },
  /**
   * A town's whitewash. Paler and more uniform than the village's on purpose:
   * the village is a handful of farms that painted themselves, the town is a
   * street that agreed. Three whites in six means half its buildings are
   * exactly what their recipe painted.
   */
  palette: ['white', 'white', 'white', 'barkPale', 'canopyCold', 'grassCool'],
  /**
   * Its ground: paler and stonier than the village's clay, because a town paves
   * what it walks on. It costs nothing -- the same three-layer painter, three
   * different swatches -- and it is most of what tells the two apart from the
   * air before a single roof is legible.
   */
  paint: { base: 'stoneWarm', alt: 'clay', rock: 'rockPale' },
};

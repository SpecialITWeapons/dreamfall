// What makes a lake look like a lake and the sea like the sea. The water is one
// sheet at sea level, and a lake is only ground that dips under it, so the one
// thing a fragment knows -- the depth under it -- is the same at a lake's shore
// as at the sea's. What differs is what lies around: a sea's shore has the
// shelf's floor, forty-odd metres down, within a few hundred metres, and a lake
// has land. The water's vertex shader reads the window at the taps below and
// this module is the same sum on the CPU, so a test can ask the world whether
// the pattern tells the two apart. Every number of the look lives here too, as
// the dev panel's sliders. Pure CPU: no three, no DOM.

/**
 * Where the water looks for open water: eight taps on each of two rings round
 * the point, the outer turned half a step so the sixteen face sixteen ways,
 * and depth counted up to `full` metres. The mean of the taps and not the
 * deepest one: a lagoon beside the sea reaches it with a tap or two, and a
 * single tap that crosses a spit would draw a seam across the water. Measured
 * on the shores of seeds 42 and 7 against a flood fill, the mean, the deepest
 * and the second to fourth deepest all tell a lake from the sea about five
 * times in six, and so did rings of 200 to 600 m: that is what a look round a
 * point can know, and the rest is the size of the body, which it cannot.
 */
export const OPENNESS = { rings: [250, 500], taps: 8, full: 40 } as const;

/** The taps as offsets from the point, m, inner ring first. */
export const OPENNESS_TAPS: ReadonlyArray<readonly [number, number]> = OPENNESS.rings.flatMap((r, ring) =>
  Array.from({ length: OPENNESS.taps }, (_, i) => {
    const a = ((i + ring * 0.5) / OPENNESS.taps) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  }),
);

/**
 * How much deep water there is round a point, 0..1: the mean over the taps of
 * each one's depth as a share of `full`. `depthAt` answers in metres under sea
 * level, and may answer negative on land, which counts as none.
 */
export function reachAt(depthAt: (x: number, z: number) => number, x: number, z: number): number {
  let sum = 0;
  for (const [dx, dz] of OPENNESS_TAPS) sum += Math.min(OPENNESS.full, Math.max(0, depthAt(x + dx, z + dz)));
  return sum / (OPENNESS.full * OPENNESS_TAPS.length);
}

/** How much of the sea's look a point wears, 0 a lake and 1 the sea: the reach through the look's two thresholds. */
export function opennessOf(reach: number, from: number, to: number): number {
  if (!(to > from)) return reach >= from ? 1 : 0;
  const t = Math.min(1, Math.max(0, (reach - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * The look, as `[min, max, start]`, each number once for a lake and once for
 * the sea; the shader mixes the pair by the openness. `deepAt` is the depth the
 * deep colour is whole at, m; `surf` how much foam the wash carries, `surfSpeed`
 * its pulse, `surfReach` the depth it runs out to, m; `breakers` a second line
 * further out, torn by noise; `ripple` how strong the small waves are and
 * `gloss` how much sky the water gives back. The sea starts near the look the
 * water had before it knew a lake, a little livelier on its shore.
 */
export const WATER_LOOK = {
  openFrom: [0, 0.6, 0.08],
  openTo: [0, 0.6, 0.24],
  lakeDeepAt: [1, 40, 12],
  seaDeepAt: [1, 40, 34],
  lakeSurf: [0, 1, 0.12],
  seaSurf: [0, 1, 0.55],
  lakeSurfSpeed: [0, 2, 0.35],
  seaSurfSpeed: [0, 2, 0.8],
  lakeSurfReach: [0.2, 4, 0.6],
  seaSurfReach: [0.2, 4, 1.3],
  lakeBreakers: [0, 1, 0],
  seaBreakers: [0, 1, 0.45],
  lakeRipple: [0, 2, 0.5],
  seaRipple: [0, 2, 1.1],
  lakeGloss: [0, 2, 1.25],
  seaGloss: [0, 2, 1],
} as const satisfies Record<string, readonly [min: number, max: number, start: number]>;
export type WaterLook = { -readonly [K in keyof typeof WATER_LOOK]: number };

/**
 * The water's colours before the grade: a lake is a dark olive green going
 * brown over its shallows, the sea a lighter turquoise than the water had. The
 * world grades them as it grades the ground (`LOOK.terrain`).
 */
export const WATER_COLORS = {
  lakeShallow: 0x8c875a,
  lakeDeep: 0x33503a,
  seaShallow: 0x80cbb8,
  seaDeep: 0x2c7f8e,
} as const;
export type WaterColors = { -readonly [K in keyof typeof WATER_COLORS]: number };

/** The look's starting numbers. */
export const waterLookStart = (): WaterLook =>
  Object.fromEntries(Object.entries(WATER_LOOK).map(([key, range]) => [key, range[2]])) as WaterLook;

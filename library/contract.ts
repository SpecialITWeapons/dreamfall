// The library contract. Everything a contributed file may say, and the rules
// that keep the world one world. Entries are plain objects returned by the
// define* helpers below; the engine samples, bakes and places them, and owns
// light, sky, fog, streaming, shadows and budgets. Contributions never make
// materials, lights or shaders: a ground hook returns nodes the engine hangs
// on its own material, colors go through the swatch book, and validateLibrary
// refuses anything outside the contract by entry name when the page loads.
//
// This is the only TypeScript file under library/; the entries themselves are
// JavaScript with JSDoc, checked against these types by checkJs. It runs on
// the CPU: the Node type comes in as a type only, so nothing here pulls the
// renderer into a Node test.
import { Color, LinearSRGBColorSpace, SRGBColorSpace } from 'three';
import type { BufferGeometry, CatmullRomCurve3, Euler, Matrix4, Vector3 } from 'three';
import type { Node } from 'three/webgpu';

// ---------------------------------------------------------------------------
// The swatch book. Every color in the world is one of these, or a hex value
// inside their envelope: no neon, no pitch black, no pure white ground.
// ---------------------------------------------------------------------------
export const SWATCH = {
  // ground
  meadow: 0x7caa48,
  forest: 0x618a43,
  mossDeep: 0x4f7a3e,
  steppe: 0x9aa658,
  gold: 0xb9a95a,
  ochre: 0xb4aa6b,
  sandPale: 0xd2c99a,
  terracotta: 0xb07a5c,
  clay: 0xc19a72,
  moor: 0x7f8a6a,
  heather: 0x8f7d86,
  tundra: 0x90997a,
  frost: 0xbcc6bf,
  snow: 0xf6f4ee,
  jungle: 0x5e8d49,
  jungleDeep: 0x4c7d44,
  amber: 0xb8a457,
  leafLitter: 0xa58f55,
  paleGreen: 0x9db668,
  // rock and stone
  rock: 0x8a9179,
  rockCold: 0x7b8a88,
  rockRed: 0x9a6f5a,
  rockPale: 0xa8a48e,
  stoneWarm: 0xa59c86,
  stoneCool: 0x8f948c,
  stoneDark: 0x6f6e64,
  moss: 0x6c8a4a,
  // bark and canopy tints (multiplied over the painted textures)
  white: 0xffffff,
  canopyCold: 0xd0dfce,
  canopyDry: 0xe7dbac,
  canopyDusk: 0xb9c6b0,
  barkPale: 0xd8d3c4,
  barkDark: 0x8a7a68,
  barkWarm: 0xb39a74,
  grassCool: 0xd6e2cc,
  grassGold: 0xe3d9a6,
} as const;

// Painted leaves: three dark, three mid and one light tone per palette, and
// the form the card is painted in: broad leaves, needle bundles, palm fronds
// or blossom petals. Nothing reads these until the tree kit arrives; they are
// here so a species does not have to invent its own foliage.
export const LEAVES = {
  broad: {
    form: 'broad',
    dark: ['#477335', '#527c32', '#65853d'],
    mid: ['#7ca343', '#8aae51', '#719943'],
    light: '#acc76b',
  },
  elder: {
    form: 'broad',
    dark: ['#2f5a33', '#3a6539', '#345f38'],
    mid: ['#4f7d42', '#5a8a4b', '#4a7a44'],
    light: '#7fa564',
  },
  needle: {
    form: 'needle',
    dark: ['#2f5a45', '#35624a', '#3d6b4e'],
    mid: ['#4d7d5e', '#5a8a68', '#527f5c'],
    light: '#7fa889',
  },
  acacia: {
    form: 'broad',
    dark: ['#5f7a3a', '#687f3c', '#5a7538'],
    mid: ['#8a9a4a', '#9aa452', '#8f9d4c'],
    light: '#b8b86a',
  },
  autumn: {
    form: 'broad',
    dark: ['#9a5a2a', '#a8642c', '#a05e2c'],
    mid: ['#c88a3a', '#d29a42', '#c4903a'],
    light: '#e6c06a',
  },
  frond: {
    form: 'frond',
    dark: ['#3f7a3f', '#467f44', '#3c7440'],
    mid: ['#5c9a4c', '#6aa653', '#609e4e'],
    light: '#9cc66a',
  },
  blossom: {
    form: 'petal',
    dark: ['#d99aa8', '#d492a2', '#dba0ad'],
    mid: ['#ecb9c2', '#f0c6cd', '#e9b4be'],
    light: '#f7e0e4',
  },
} as const;

/** The envelope of the soft illustrated family, in HSL. */
export const ENVELOPE = { maxSaturation: 0.62, minLightness: 0.18, maxLightness: 0.93 } as const;

/** Budgets the engine enforces per entry; the scenery ones bite when the scenery lands. */
export const BUDGET = {
  /** Meters a biome's height hook may move the ground, either way. */
  heightDelta: 300,
  crownCards: 200,
  propTriangles: 6000,
  propInstances: 2000,
  /**
   * Settlements of one biome the streamed ring is sized to hold at once, and
   * the reach it holds them over. A lattice fine enough to put more than this
   * in front of the flight is refused: the ring would be raising villages
   * shoulder to shoulder, which is a town, and a town is its own entry.
   *
   * `siteReach` is the ring's `TREE_RADIUS`, written here a second time because
   * the contract may not import the engine -- the library is the contributed
   * side and the dependency does not run that way. A test holds the two
   * together and goes red the moment they disagree, which is the only thing
   * that makes a copied constant safe: this one was 1900 for as long as it took
   * to move the ring to 2600, and for all that time it measured a world that
   * was no longer there.
   */
  siteInstances: 4,
  siteReach: 2600,
  /**
   * Distinct floor counts one structure may be baked at. A building is
   * instanced whole, so every count in `floors` gets its own bake and its own
   * pool: a recipe spanning twenty storeys would bake twenty buildings at load.
   */
  floorSpan: 4,
  speciesScale: 3,
} as const;

/** A swatch name, a `#rrggbb` string, or a hex number inside the envelope. */
export type SceneryColor = string | number;

/** A swatch name or hex string resolved to a hex color; a number passes through. */
export function swatchColor(value: SceneryColor): number {
  if (typeof value !== 'string') return value;
  if (value in SWATCH) return SWATCH[value as keyof typeof SWATCH];
  return Number.parseInt(value.slice(1), 16);
}

const hsl = { h: 0, s: 0, l: 0 };
const HEX = /^#[0-9a-f]{6}$/i;
/** Why a color is refused, or null when it is inside the envelope. */
export function colorProblem(value: unknown): string | null {
  if (typeof value === 'string') {
    if (value in SWATCH) return null;
    if (!HEX.test(value)) return `unknown swatch "${value}"`;
    return hexProblem(Number.parseInt(value.slice(1), 16));
  }
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 0xffffff) return 'not a color';
  return hexProblem(value as number);
}
function hexProblem(value: number): string | null {
  // measured as a person sees it, in sRGB, whatever the working color space
  new Color(value).getHSL(hsl, SRGBColorSpace);
  if (hsl.s > ENVELOPE.maxSaturation || hsl.l < ENVELOPE.minLightness || hsl.l > ENVELOPE.maxLightness)
    return `#${value.toString(16).padStart(6, '0')} is outside the palette envelope`;
  return null;
}

// ---------------------------------------------------------------------------
// What a hook sees. The CPU hooks read fields; the ground hook builds nodes.
// ---------------------------------------------------------------------------

/** The nearest centre of a lattice, and that cell's own random stream. */
export interface LatticeHit {
  cx: number;
  cz: number;
  /** Distance to the centre, m. */
  d: number;
  /** Base height at the centre, m: what a plateau flattens its ground toward. */
  h: number;
  /**
   * Temperature at the centre, 0..1. Like `h`, it is the cell's own answer
   * rather than this texel's, so a hook can refuse a whole cell on climate
   * without its edge disagreeing with its middle.
   */
  t: number;
  /**
   * How steep the ground is at the centre: rise over run, measured across
   * `LATTICE_SLOPE_PROBE` metres, which is the scale a settlement is built at
   * rather than the scale one terrain cell is. A hook's own `maxSlope` compares
   * against this to refuse a cell outright -- the rise it measures from the
   * centre outward is zero at the centre and so can only ever fade an edge.
   */
  s: number;
  u(k: number): number;
}
/**
 * Metres the lattice measures a centre's slope across. A settlement is hundreds
 * of metres wide, so what matters is whether the hillside it sits on is steep,
 * not whether one sixteen-metre span of it is; the owner picked the threshold
 * from pictures framed at this distance, so the number and the pictures mean
 * the same thing only while this does not move.
 */
export const LATTICE_SLOPE_PROBE = 125;

/** What a biome's CPU hooks see, per texel of the height window. */
export interface Fields {
  x: number;
  z: number;
  /** Continentalness, 0..1. */
  cont: number;
  /** Temperature with the altitude cooling already in it, 0..1. */
  temp: number;
  /** Temperature before the cooling: the snow line reads this one. */
  baseTemp: number;
  moist: number;
  region: number;
  /** Height before any biome moved it, m. */
  baseHeight: number;
  /** Nearness to a coast, from the base height, 0..1. */
  shore: number;
  hash(salt: number): number;
  /** Fractal noise, -1..1. */
  noise(scale: number, salt: number, octaves?: number): number;
  lattice(cell: number, salt: number): LatticeHit;
}

export type PresenceDescriptor =
  | { type: 'climatePoint'; point: [number, number, number]; radius?: number }
  | { type: 'heightBand'; from: number; to: number; feather?: number }
  | {
      type: 'lattice';
      cell: number;
      /**
       * How wide, m. A pair is a range the cell draws its own width from, out
       * of `SITE_STREAM.radius` -- the same draw the site finder makes, so the
       * ground painted and flattened is the ground the settlement covers. A
       * single number is that width everywhere, which is what a settlement of
       * one size wants.
       *
       * The pair matters more the wider the settlement: a town drawn at 400 m
       * whose hook was given 900 stands in five hundred metres of painted,
       * levelled nothing, and from the air that reads as a bald dune with a
       * town on top of it.
       */
      radius?: number | [number, number];
      feather?: number;
      odds?: number;
      salt?: number;
      /** Metres of height the centre must have; the sea claims nothing. */
      land?: number;
      /** Temperature the centre must have, 0..1; nobody settles a glacier. */
      minTemp?: number;
      maxSlope?: number;
      /**
       * Metres the ground may depart from the centre before the settlement
       * fades, in place of `maxSlope` times the radius.
       *
       * They are two different questions and one number answered both until a
       * town asked. `maxSlope` refuses a centre whose own ground is steep,
       * measured across `LATTICE_SLOPE_PROBE`; the fade asks how far the ground
       * has run away from the centre by the time it reaches here, which over
       * hundreds of metres is a matter of the terrain's relief and not of the
       * slope at one point in it. Measured on seed 42 over 895 seats: tightening
       * a town's `maxSlope` from 0.45 to 0.06 moved the median departure inside
       * 900 m from 167 m to 146 m -- that is to say, not at all -- while
       * refusing two seats in three. A settlement wide enough for the two to
       * come apart says how deep a cut it will take and leaves the slope to
       * refuse the hillside it was written for.
       */
      maxCut?: number;
      shoreBonus?: number;
    }
  | { type: 'mul'; of: PresenceDescriptor[] }
  | { type: 'max'; of: PresenceDescriptor[] };
/** How much of this place is this biome's, 0..1. The engine normalises across the registry. */
export type Presence = ((f: Fields) => number) | PresenceDescriptor;

export type HeightDescriptor =
  | { type: 'offset'; meters: number }
  | { type: 'terraces'; step: number; sharpness?: number }
  /** The same lattice the presence hook reads, or the village sits beside its own square. */
  | {
      type: 'plateau';
      cell: number;
      salt?: number;
      /** As the lattice hook's: a pair is drawn per cell, and must be the hook's own pair. */
      radius?: number | [number, number];
      feather?: number;
      strength?: number;
    };
/** The new height in meters; the engine clips the change to BUDGET.heightDelta. */
export type HeightHook = ((f: Fields, base: number) => number) | HeightDescriptor;

/** One coat of paint and the mask it comes in by. */
export interface GroundLayer {
  color: SceneryColor;
  mask?: 'base' | 'slope' | 'height' | 'noise';
  from?: number;
  to?: number;
  scale?: number;
  salt?: number;
}
export type GroundDescriptor = { type: 'layers'; layers: GroundLayer[] };

/**
 * The ground hook's world, in nodes. color, mix and ramp are the engine's own,
 * so a hook -- the standard layer painter included -- never imports TSL and can
 * be read by a test in Node with numbers in place of nodes.
 */
export interface GroundCtx {
  worldXZ: Node<'vec2'>;
  height: Node<'float'>;
  slope: Node<'float'>;
  normal: Node<'vec3'>;
  sunDir: Node<'vec3'>;
  /** This biome's share of the fragment, 0..1. */
  weight: Node<'float'>;
  params: Record<string, Node<'float'> | Node<'vec3'>>;
  noise(scale: number, salt: number): Node<'float'>;
  hash(salt: number): Node<'float'>;
  color(value: SceneryColor): Node<'vec3'>;
  /** t may be a plain number: a mask that is always one costs nothing that way. */
  mix(a: Node<'vec3'>, b: Node<'vec3'>, t: Node<'float'> | number): Node<'vec3'>;
  ramp(v: Node<'float'>, from: number, to: number): Node<'float'>;
}
export interface GroundOut {
  albedo: Node<'vec3'>;
  normalTilt?: Node<'vec3'>;
  emissive?: Node<'vec3'>;
}
export type GroundHook = ((g: GroundCtx) => GroundOut) | GroundDescriptor;

// Scenery: the shapes the streaming ring will hand a biome. Nothing calls
// these yet; they are here so the entries that arrive with the ring do not
// have to invent them, and so a biome written today still type-checks then.
export interface Cell {
  size: number;
  corner: { x: number; z: number };
  center: { x: number; z: number };
  /**
   * How much of this cell belongs to the biome whose hook is running, 0..1.
   * A hook asks about itself with this and about its neighbours with weight().
   */
  readonly share: number;
  weight(biomeId: string): number;
  /**
   * The base fields in the cell's centre. The tree line reads baseTemp, a
   * species' tint reads temp and moist, a grove reads noise. One object,
   * rewritten per cell -- read it, do not keep it.
   */
  readonly fields: Fields;
  /** How much this cell wants that prop: the biome weights folded over their scatter weights. */
  mix(id: string): number;
  /** A colour from the biomes' params, blended by weight, e.g. blend('rock'). One Color, rewritten per call. */
  blend(param: string): Color;
  height(x: number, z: number): number;
  slope(x: number, z: number): number;
  land(x: number, z: number): boolean;
  roll(): number;
  occupied(x: number, z: number): boolean;
}
export interface SceneryKit {
  tree(
    speciesId: string,
    x: number,
    z: number,
    opts?: { scale?: number; yaw?: number; tint?: SceneryColor },
  ): void;
  prop(
    propId: string,
    x: number,
    z: number,
    opts?: { scale?: number; yaw?: number; sink?: number; tint?: SceneryColor },
  ): void;
  structure(
    kindId: string,
    x: number,
    z: number,
    opts?: { yaw?: number; floors?: number; tint?: SceneryColor },
  ): void;
  color(value: SceneryColor): Color;
}
/**
 * What a biome sows. It places trees only: the prop weights are read by that
 * prop's own place(), and the grass is data the grass window folds by weight.
 * A biome whose populate is a function has neither -- both are descriptor data.
 */
export interface ScatterSpec {
  type: 'scatter';
  /** Relative weights by species id. */
  species: Record<string, number>;
  /** Trees per cell before the grove noise and the biome's own weight. */
  density: number;
  /** Relative weights by prop id, read through Cell.mix. */
  props?: Record<string, number>;
  grass?: { tint: SceneryColor; density: number };
}
export type PopulateDescriptor = ScatterSpec;
export type PopulateHook = ((cell: Cell, kit: SceneryKit) => void) | PopulateDescriptor;

export interface Site {
  id: string;
  x: number;
  z: number;
  radius: number;
  yaw: number;
  random(): number;
  fields: Fields;
}
export interface SiteKit extends SceneryKit {
  /**
   * The ground the site stands on. A plan needs it -- a street that ignores the
   * slope is a street up a cliff -- and taking it through the kit is what keeps
   * the plan a pure function: a test in Node hands it a stub and reads the
   * answer, with no window of terrain anywhere.
   */
  height(x: number, z: number): number;
  slope(x: number, z: number): number;
  road(points: Array<[number, number]>, width: number, opts?: { color?: SceneryColor }): void;
  /**
   * Anything else that runs in a line: a fence across a field, a wall, a hedge.
   * It is a ribbon along a polyline, the same mechanism as a road, which is why
   * it lives here and not in a thin scatter of props -- and the same walk, so a
   * corner is mitred once for both.
   *
   * A line claims no ground: the tallest kind stands 1.4 m, far under the
   * clearance the flight keeps, so nothing is reserved and no obstacle is
   * recorded. Fence a square and the trees still grow inside it; `reserve` is
   * what keeps them out.
   */
  line(points: Array<[number, number]>, kind: string, opts?: { height?: number }): void;
  reserve(x: number, z: number, radius: number): void;
}
/** One ribbon of road along a polyline, in world metres. */
export interface RoadSpec {
  points: Array<[number, number]>;
  width: number;
  color?: SceneryColor;
}
/** One plot: what stands there, turned how, how many floors of it. */
export interface LotSpec {
  x: number;
  z: number;
  yaw: number;
  structure: string;
  floors: number;
  tint?: SceneryColor;
}
/** Ground spoken for: no tree, no prop, nothing scattered. */
export interface Reservation {
  x: number;
  z: number;
  radius: number;
}
/**
 * What a site's build hook produces. Data, never geometry: the pools make the
 * geometry out of this, which is what lets a plan be a pure function with a
 * test in Node -- and what will let the editor of M6 change one.
 */
/** One run of fence, wall or hedge, in world metres. */
export interface LineSpec {
  points: Array<[number, number]>;
  /** A kind the line kit bakes: `fence`, `wall`, `hedge`. Anything else is refused by name. */
  kind: string;
  /** Metres above the ground; the kind's own height by default. */
  height?: number;
}
export interface SitePlan {
  id: string;
  x: number;
  z: number;
  radius: number;
  roads: RoadSpec[];
  lines: LineSpec[];
  lots: LotSpec[];
  reservations: Reservation[];
}

/**
 * Where a settlement stands and what it puts there.
 *
 * It carries no odds and no land line of its own: the biome's presence hook
 * decides whether a lattice cell carries a site, and the site is seated at the
 * centre that hook believes in. That is not tidiness -- it is the only way the
 * ground that is painted and flattened for a village is the ground the village
 * stands on. Two draws on one cell agree about half the time, which is what two
 * coins do.
 */
export interface SitesSpec {
  /** The lattice, m: the same cell the presence hook is given. */
  cell: number;
  /** The lattice's salt: again the hook's. Defaults to the hook's own default. */
  salt?: number;
  radius: [number, number];
  /** Relative weights by structure id; the validator checks them against the registry. */
  structures?: Record<string, number>;
  /**
   * Tints a lot is drawn from, in the order the plan draws them. A lot's tint
   * reaches the pools as the instance colour, which **multiplies** the colours
   * the recipe baked -- so these are tints and not colours: `white` leaves a
   * house exactly as its recipe painted it and anything darker shades the whole
   * of it, walls, roof and all. The swatch book's own tint group is the one to
   * pick from.
   *
   * This is where a town may differ from a village while both are built out of
   * the same three recipes, which is cheaper by a whole bake than giving the
   * town recipes of its own.
   */
  palette?: SceneryColor[];
  /**
   * The settlement's own last word, asked at the centre the hook chose. It can
   * only refuse what the hook allowed, so a `fits` narrower than the presence
   * hook leaves ground painted for a village that never comes: keep the two
   * saying the same thing, as `library/settlements/settlement.js` does.
   */
  fits(f: Fields): boolean;
  build(site: Site, kit: SiteKit): void;
}

/**
 * The sounds the engine can make for a country. It synthesises these five and
 * no others; a biome says how much of each is its own, 0..1, and the flyer
 * hears them weighed by which biomes are actually under it.
 */
export const AMBIENCE_LAYERS = ['crickets', 'birds', 'surf', 'bells', 'wind-high'] as const;
export type AmbienceLayer = (typeof AMBIENCE_LAYERS)[number];

export interface AmbienceSpec {
  /** How much of each layer belongs here; a layer left unsaid is none of it. */
  layers?: Partial<Record<AmbienceLayer, number>>;
  /** The colour of the air over this country, and how much of the horizon it may take. */
  fogTint?: SceneryColor;
  fogTintAmount?: number;
  /**
   * This entry stands **in** a country rather than being one: its weight under
   * the flyer goes to the biomes beside it, and what it names here is added on
   * top. A settlement says this, because a village in a jungle sounds like the
   * jungle with a bell in it, and its air is the jungle's air -- without it the
   * settlement's own weight crowds the country out of the mix, and the village
   * is a hole in the sound and the haze exactly where the church is.
   */
  inherit?: boolean;
}

/**
 * What an entry that stands **in** a country rather than being one keeps for
 * itself. Its ground, its snow, its grass, its trees and props, its sound and
 * its air are the country's around it: its weight in the window still carries
 * its presence and its height hook -- a settlement's plateau -- and for all the
 * rest it is handed to the slots beside it. A settlement says this, because a
 * village painted its own disc of clay and sowed its own trees, and from the
 * air that read as a patch cut out of the jungle rather than a village in it.
 */
export interface InheritSpec {
  /**
   * The share of the country's trees and props that stands on this entry's
   * ground, 0..1: a settlement is a clearing, not a wood and not a bald patch.
   */
  trees: number;
}

export interface Biome {
  kind?: 'biome';
  id: string;
  name: string;
  /** JSON: colors as swatch names or #rrggbb, plus whatever the hooks read. */
  params: Record<string, string | number>;
  presence: Presence;
  height?: HeightHook;
  /** Required, unless the entry stands in a country (`inherit`); then it has none. */
  ground?: GroundHook;
  populate?: PopulateHook;
  sites?: SitesSpec;
  ambience?: AmbienceSpec;
  /** This entry stands in a country: see `InheritSpec`. */
  inherit?: InheritSpec;
  /** Default true: the world's snow layer. */
  snow?: boolean;
  /** Default true: sand at sea level. */
  shore?: boolean;
}

export interface TrunkSpec {
  height: number;
  radius: number;
  /** How far the top leans off the root, m. */
  lean: number;
  tint: SceneryColor;
}
export interface LimbsSpec {
  count: number;
  spread?: number;
  rise?: number;
  /** Where on the trunk the first limb leaves it, 0..1. */
  from?: number;
}
export interface CrownSpec {
  shape: 'dome' | 'cone' | 'fan' | 'bare';
  cards?: number;
  size?: number;
  radius?: number;
  height?: number;
  from?: number;
}
/** The two verbs a tree grows through: lay wood, hang a painted card. */
export interface TreeKit {
  THREE: typeof import('three');
  random(): number;
  branch(a: Vector3, b: Vector3, r1: number, r2: number): CatmullRomCurve3;
  card(p: Vector3, normal: Vector3, rotation: Euler | Matrix4, size: number): void;
  matrix(
    x: number,
    y: number,
    z: number,
    sx?: number,
    sy?: number,
    sz?: number,
    rx?: number,
    ry?: number,
    rz?: number,
  ): Matrix4;
  spec: Species;
}
export interface Species {
  kind?: 'species';
  id: string;
  name: string;
  trunk?: TrunkSpec;
  limbs?: LimbsSpec;
  crown?: CrownSpec;
  leaf?: keyof typeof LEAVES;
  /** Climate tints; the engine lerps by temperature and moisture per instance. */
  tint: { cold: SceneryColor; warm: SceneryColor; dry: SceneryColor };
  /** [min, max] scale; the max is capped by BUDGET.speciesScale. */
  scale: [number, number];
  /** A species that grows its own way, through the same kit the built-in generator uses. */
  bake?(kit: TreeKit): void;
}

/** One instance a hook asks for: where it stands, how it is turned, how big, how deep. */
export interface Placement {
  x: number;
  z: number;
  yaw?: number;
  scale?: number | [number, number, number];
  /** Metres to sink into the ground, so a boulder sits rather than balances. */
  sink?: number;
  tint?: SceneryColor | Color;
}
/** What a prop bakes and places with; merge returns one geometry with vertex colors. */
export interface PropKit {
  THREE: typeof import('three');
  random(name: string): () => number;
  merge(parts: Array<{ geometry: BufferGeometry; matrix?: Matrix4; color?: Color | number }>): BufferGeometry;
  matrix(
    x: number,
    y: number,
    z: number,
    sx?: number,
    sy?: number,
    sz?: number,
    rx?: number,
    ry?: number,
    rz?: number,
  ): Matrix4;
  sstep(a: number, b: number, x: number): number;
  color(value: SceneryColor): Color;
}
export interface Prop {
  kind?: 'prop';
  id: string;
  name: string;
  budget?: { instances?: number; triangles?: number };
  /** Set when the flight and the camera must clear it. */
  obstacle?: { radius: number; height: number };
  bake(kit: PropKit): BufferGeometry;
  place(cell: Cell, kit: PropKit): Placement[] | void;
}
/**
 * What a building recipe is baked through: the prop kit, plus what a wall needs,
 * plus the two things that vary per bake. A recipe that bakes itself reads
 * `floors` here -- it is the one number that changes between two bakes of the
 * same entry, and `library/` cannot name a type that lives in `src/`.
 */
export interface StructureKit extends PropKit {
  spec: Structure;
  floors: number;
  box(w: number, h: number, d: number, color: SceneryColor): BufferGeometry;
  roof(kind: Structure['roof'], w: number, d: number, rise: number, color: SceneryColor): BufferGeometry;
  /**
   * The windows of one floor: panes along every wall at that height, painted
   * the window colour and carrying a `glow` of 1 -- what the night reads --
   * and a `pane` of their own, a number per window that lets the night light
   * one and leave the next dark.
   *
   * It **cuts** the windows into the geometry rather than painting whatever
   * vertices happen to be near them: a box has no vertices where its windows
   * go, so painting alone would either miss them or smear them up the whole
   * storey. The band is cut at its two heights and then sliced along the wall's
   * own length, into panes with piers between them and a pier in each corner.
   * It used to stop at the two heights, which painted a belt round the whole
   * house: from the air that reads as a stripe, not as windows.
   *
   * Call it after merging, never before: a merge carries position, normal,
   * colour and uv across, and would drop the glow.
   */
  windows(geometry: BufferGeometry, y: number, height: number, color: SceneryColor): void;
}
export interface Structure {
  kind?: 'structure';
  id: string;
  name: string;
  /** Plan at ground level, m. */
  footprint: [number, number];
  floors: [number, number];
  floorHeight?: number;
  roof: 'gable' | 'hip' | 'flat';
  roofPitch?: number;
  chimney?: boolean;
  palette: { wall: SceneryColor; roof: SceneryColor; trim?: SceneryColor; window?: SceneryColor };
  budget?: { triangles?: number };
  /**
   * How much sky it takes. The bake measures the shape it built and the larger
   * of the two wins: an entry may ask the flight for more room than it fills,
   * never for less.
   */
  obstacle?: { radius: number; height: number };
  bake?(kit: StructureKit): BufferGeometry;
}

export interface Library {
  biomes: Biome[];
  species?: Species[];
  props?: Prop[];
  structures?: Structure[];
}

// ---------------------------------------------------------------------------
// The define* helpers only tag the object; they exist so a file reads as what
// it is, and so editors can show these shapes.
// ---------------------------------------------------------------------------
export const defineBiome = (biome: Biome): Biome => ({ kind: 'biome', ...biome });
export const defineSpecies = (species: Species): Species => ({ kind: 'species', ...species });
export const defineProp = (prop: Prop): Prop => ({ kind: 'prop', ...prop });
export const defineStructure = (structure: Structure): Structure => ({ kind: 'structure', ...structure });

// ---------------------------------------------------------------------------
// Validation. Static shape here; baked geometry is measured by the engine with
// validateBaked as each entry is built. Both name the entry, and the page does
// not start on a library that fails either.
// ---------------------------------------------------------------------------

const PRESENCE_TYPES = new Set(['climatePoint', 'heightBand', 'lattice', 'mul', 'max']);
const HEIGHT_TYPES = new Set(['offset', 'plateau', 'terraces']);
const GROUND_TYPES = new Set(['layers']);
const POPULATE_TYPES = new Set(['scatter']);
const ROOFS = new Set(['gable', 'hip', 'flat']);
/** The widest a site may be, m (spec 5.5): past this the ring cannot hold one. */
const SITE_RADIUS = 900;

/** Everything wrong with a library, by entry name; empty when it may load. */
export function validateLibrary({ biomes, species = [], props = [], structures = [] }: Library): string[] {
  const errors: string[] = [];
  const idsOf = (list: Array<{ id?: unknown }>, what: string) => {
    const seen = new Set<string>();
    for (const entry of list) {
      const id = entry?.id;
      if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id))
        errors.push(`${what}: id must be lowercase letters, digits and dashes`);
      else if (seen.has(id)) errors.push(`${what} ${id}: duplicate id`);
      else seen.add(id);
    }
    return seen;
  };
  idsOf(biomes, 'biome');
  const speciesIds = idsOf(species, 'species');
  const propIds = idsOf(props, 'prop');
  const structureIds = idsOf(structures, 'structure');

  const colorAt = (where: string, value: unknown) => {
    const problem = colorProblem(value);
    if (problem) errors.push(`${where}: ${problem}`);
  };

  const hookType = (where: string, hook: unknown, known: Set<string>) => {
    if (typeof hook === 'function') return;
    const type = (hook as { type?: unknown })?.type;
    if (typeof type !== 'string' || !known.has(type))
      errors.push(`${where}: unknown hook type "${String(type)}"`);
  };

  for (const biome of biomes) {
    const where = `biome ${biome?.id}`;
    if (!biome?.presence) errors.push(`${where}: needs a presence hook`);
    else hookType(`${where}.presence`, biome.presence, PRESENCE_TYPES);
    if (biome?.inherit !== undefined) {
      // An entry that stands in a country is painted and sown by it. A ground
      // or a scatter of its own would never be read, and a field nothing reads
      // is a promise nobody keeps.
      const trees = (biome.inherit as { trees?: unknown } | null)?.trees;
      if (typeof trees !== 'number' || !(trees >= 0 && trees <= 1))
        errors.push(`${where}.inherit.trees: ${String(trees)} is not a share of 0..1`);
      if (biome.ground) errors.push(`${where}: stands in a country and paints no ground of its own`);
      if (biome.populate) errors.push(`${where}: stands in a country and sows nothing of its own`);
      if (biomes[0] === biome)
        errors.push(`${where}: the first biome takes unclaimed ground and cannot stand in a country`);
    } else if (!biome?.ground) errors.push(`${where}: needs a ground hook`);
    else hookType(`${where}.ground`, biome.ground, GROUND_TYPES);
    if (biome?.height) {
      hookType(`${where}.height`, biome.height, HEIGHT_TYPES);
      const offset = biome.height as { type?: string; meters?: number };
      if (offset?.type === 'offset' && Math.abs(offset.meters ?? 0) > BUDGET.heightDelta)
        errors.push(`${where}.height: ${offset.meters} m, the budget is ${BUDGET.heightDelta}`);
    }
    if (biome?.populate) {
      hookType(`${where}.populate`, biome.populate, POPULATE_TYPES);
      const sown = biome.populate as Partial<ScatterSpec>;
      if (sown?.type === 'scatter') {
        // The ring meets these ids years after they are typed; a typo here is a
        // silent empty forest, so it is refused at the door by name.
        const names = Object.keys(sown.species ?? {});
        if (names.length === 0) errors.push(`${where}.populate: names no species`);
        for (const id of names)
          if (!speciesIds.has(id)) errors.push(`${where}.populate: unknown species "${id}"`);
        for (const id of Object.keys(sown.props ?? {}))
          if (!propIds.has(id)) errors.push(`${where}.populate: unknown prop "${id}"`);
        if (!Number.isFinite(sown.density) || (sown.density as number) < 0)
          errors.push(`${where}.populate.density: ${sown.density} is not a density`);
        if (sown.grass) colorAt(`${where}.populate.grass.tint`, sown.grass.tint);
      }
    }
    if (biome?.ambience !== undefined) {
      const air = biome.ambience;
      if (typeof air !== 'object' || air === null) errors.push(`${where}.ambience: not a spec`);
      else {
        // A layer the engine cannot make is a typo that would sound like
        // silence, and a tint outside the envelope goes on the whole sky.
        for (const [layer, amount] of Object.entries(air.layers ?? {})) {
          if (!(AMBIENCE_LAYERS as readonly string[]).includes(layer))
            errors.push(`${where}.ambience.layers: unknown layer "${layer}"`);
          if (!Number.isFinite(amount) || (amount as number) < 0 || (amount as number) > 1)
            errors.push(`${where}.ambience.layers.${layer}: ${amount} is not a share of 0..1`);
        }
        if (air.fogTint !== undefined) colorAt(`${where}.ambience.fogTint`, air.fogTint);
        if (
          air.fogTintAmount !== undefined &&
          !(Number.isFinite(air.fogTintAmount) && air.fogTintAmount >= 0)
        )
          errors.push(`${where}.ambience.fogTintAmount: ${air.fogTintAmount} is not an amount`);
        if (air.inherit !== undefined && typeof air.inherit !== 'boolean')
          errors.push(`${where}.ambience.inherit: not a boolean`);
      }
    }
    if (biome?.sites) {
      const site = biome.sites;
      if (typeof site.fits !== 'function') errors.push(`${where}.sites: needs a fits hook`);
      if (typeof site.build !== 'function') errors.push(`${where}.sites: needs a build hook`);
      if (!(site.cell > 0)) errors.push(`${where}.sites.cell: ${site.cell} is not a lattice`);
      // A settlement is seated off its presence hook, so a biome that carries
      // sites and no lattice under them has nothing to seat them on.
      if (typeof biome.presence !== 'function' && biome.presence?.type !== 'lattice')
        errors.push(`${where}.sites: needs a lattice presence to stand on`);
      // One site a cell, so how many can face the flight at once is the lattice
      // against the ring's reach. Counted the way the ring counts: every cell
      // the reach touches, plus the one the flight stands in.
      const across = Math.floor((2 * BUDGET.siteReach) / site.cell) + 1;
      if (site.cell > 0 && across * across > BUDGET.siteInstances)
        errors.push(
          `${where}.sites.cell: ${site.cell} m puts up to ${across * across} sites in the ring, the budget is ${BUDGET.siteInstances}`,
        );
      const radius = site.radius;
      if (!Array.isArray(radius) || radius.length !== 2 || !(radius[0] > 0 && radius[1] >= radius[0]))
        errors.push(`${where}.sites.radius: needs a [min, max] of positive meters`);
      else if (radius[1] > SITE_RADIUS)
        errors.push(`${where}.sites.radius: ${radius[1]} m, the budget is ${SITE_RADIUS}`);
      for (const [i, tint] of (site.palette ?? []).entries()) colorAt(`${where}.sites.palette[${i}]`, tint);
      // The ids a settlement asks for are checked here for the same reason a
      // biome's species are: the site builds years after someone types them.
      for (const id of Object.keys(site.structures ?? {}))
        if (!structureIds.has(id)) errors.push(`${where}.sites: unknown structure "${id}"`);
    }
    // A colour in params is written as a swatch name or a hex string: a bare
    // number is a number (a density, a metre count), and every number is also
    // a perfectly good colour, so there is no telling them apart by value.
    for (const [key, value] of Object.entries(biome?.params ?? {})) {
      if (typeof value !== 'string') continue;
      const problem = colorProblem(value);
      if (problem) errors.push(`${where}.params.${key}: ${problem}`);
    }
  }

  for (const entry of species) {
    const where = `species ${entry?.id}`;
    // Data for the built-in kit, or a generator of its own -- but one of the two.
    if (!entry?.trunk && typeof entry?.bake !== 'function')
      errors.push(`${where}: needs a trunk or a bake hook`);
    const scale = entry?.scale;
    if (!Array.isArray(scale) || scale.length !== 2 || !scale.every((v) => Number.isFinite(v) && v > 0))
      errors.push(`${where}.scale: needs a [min, max] of positive meters`);
    else {
      if (scale[1] <= scale[0]) errors.push(`${where}.scale: [${scale[0]}, ${scale[1]}] does not grow`);
      if (scale[1] > BUDGET.speciesScale)
        errors.push(`${where}.scale: ${scale[1]}, the budget is ${BUDGET.speciesScale}`);
    }
    const cards = entry?.crown?.cards;
    if (typeof cards === 'number' && cards > BUDGET.crownCards)
      errors.push(`${where}.crown.cards: ${cards}, the budget is ${BUDGET.crownCards}`);
    if (entry?.leaf !== undefined && !(entry.leaf in LEAVES))
      errors.push(`${where}.leaf: unknown leaf "${String(entry.leaf)}"`);
    for (const role of ['cold', 'warm', 'dry'] as const)
      colorAt(`${where}.tint.${role}`, entry?.tint?.[role]);
    if (entry?.trunk) colorAt(`${where}.trunk.tint`, entry.trunk.tint);
  }

  for (const entry of props) {
    const where = `prop ${entry?.id}`;
    if (typeof entry?.bake !== 'function') errors.push(`${where}: needs a bake hook`);
    if (typeof entry?.place !== 'function') errors.push(`${where}: needs a place hook`);
    const triangles = entry?.budget?.triangles,
      instances = entry?.budget?.instances;
    if (typeof triangles === 'number' && triangles > BUDGET.propTriangles)
      errors.push(`${where}.budget.triangles: ${triangles}, the budget is ${BUDGET.propTriangles}`);
    if (typeof instances === 'number' && instances > BUDGET.propInstances)
      errors.push(`${where}.budget.instances: ${instances}, the budget is ${BUDGET.propInstances}`);
    const obstacle = entry?.obstacle;
    if (obstacle && !(obstacle.radius > 0 && obstacle.height > 0))
      errors.push(`${where}.obstacle: radius and height must both be positive`);
  }

  for (const entry of structures) {
    const where = `structure ${entry?.id}`;
    const footprint = entry?.footprint;
    if (!Array.isArray(footprint) || footprint.length !== 2 || !footprint.every((v) => v > 0))
      errors.push(`${where}.footprint: needs two positive meters`);
    const floors = entry?.floors;
    if (!Array.isArray(floors) || floors.length !== 2 || !floors.every((v) => Number.isInteger(v) && v > 0))
      errors.push(`${where}.floors: needs a [min, max] of whole floors`);
    else if (floors[1] < floors[0])
      errors.push(`${where}.floors: [${floors[0]}, ${floors[1]}] does not rise`);
    else if (floors[1] - floors[0] + 1 > BUDGET.floorSpan)
      errors.push(
        `${where}.floors: ${floors[1] - floors[0] + 1} storey counts, the budget is ${BUDGET.floorSpan}`,
      );
    if (!ROOFS.has(entry?.roof)) errors.push(`${where}.roof: unknown roof "${String(entry?.roof)}"`);
    for (const role of ['wall', 'roof', 'trim', 'window'] as const) {
      const value = entry?.palette?.[role];
      if (value !== undefined) colorAt(`${where}.palette.${role}`, value);
      else if (role === 'wall' || role === 'roof') errors.push(`${where}.palette.${role}: missing`);
    }
    const triangles = entry?.budget?.triangles;
    if (typeof triangles === 'number' && triangles > BUDGET.propTriangles)
      errors.push(`${where}.budget.triangles: ${triangles}, the budget is ${BUDGET.propTriangles}`);
    const obstacle = entry?.obstacle;
    if (obstacle && !(obstacle.radius > 0 && obstacle.height > 0))
      errors.push(`${where}.obstacle: radius and height must both be positive`);
  }
  return errors;
}

/** What validateBaked reads of an attribute; a BufferAttribute is one of these. */
interface BakedAttribute {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}
/**
 * A baked geometry, as little of one as this needs. It is spelled through
 * getAttribute rather than attributes.position because BufferGeometry types its
 * attributes as an index signature, and an index signature never satisfies a
 * required named property -- so the obvious shape would refuse the one kind of
 * argument this function exists to take.
 */
interface BakedGeometry {
  index?: { count: number } | null;
  getAttribute(name: string): BakedAttribute | undefined;
}

/** Problems with a baked geometry against its entry's budget and the color envelope; empty when clean. */
export function validateBaked(
  entry: { kind?: string; id: string; budget?: { triangles?: number } },
  geometry: BakedGeometry,
): string[] {
  const errors: string[] = [];
  const where = `${entry.kind ?? 'entry'} ${entry.id}`;
  const position = geometry.getAttribute('position');
  if (!position) return [`${where}: baked nothing`];
  const triangles = (geometry.index ? geometry.index.count : position.count) / 3;
  const cap = entry.budget?.triangles ?? BUDGET.propTriangles;
  if (triangles > cap) errors.push(`${where}: ${triangles} triangles, the budget is ${cap}`);
  const colors = geometry.getAttribute('color');
  if (colors) {
    const stride = Math.max(1, Math.floor(colors.count / 200)),
      c = new Color();
    for (let i = 0; i < colors.count; i += stride) {
      // vertex colors are stored linear; judge them in sRGB like every other color
      c.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i), LinearSRGBColorSpace).getHSL(
        hsl,
        SRGBColorSpace,
      );
      // a neutral near-white is a tint carrier for per-instance color, not a choice
      const carrier = hsl.s < 0.05 && hsl.l > 0.9;
      if (
        !carrier &&
        (hsl.s > ENVELOPE.maxSaturation + 0.05 ||
          hsl.l < ENVELOPE.minLightness - 0.05 ||
          hsl.l > ENVELOPE.maxLightness + 0.05)
      ) {
        errors.push(`${where}: a vertex color is outside the palette envelope`);
        break;
      }
    }
  }
  return errors;
}

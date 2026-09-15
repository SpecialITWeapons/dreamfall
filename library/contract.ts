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
  siteInstances: 4,
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
  u(k: number): number;
}

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
  | { type: 'mul'; of: PresenceDescriptor[] }
  | { type: 'max'; of: PresenceDescriptor[] };
/** How much of this place is this biome's, 0..1. The engine normalises across the registry. */
export type Presence = ((f: Fields) => number) | PresenceDescriptor;

export type HeightDescriptor =
  { type: 'offset'; meters: number } | { type: 'terraces'; step: number; sharpness?: number };
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
  mix(a: Node<'vec3'>, b: Node<'vec3'>, t: Node<'float'>): Node<'vec3'>;
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
  weight(biomeId: string): number;
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
export type PopulateHook = (cell: Cell, kit: SceneryKit) => void;

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
  road(points: Array<[number, number]>, width: number, opts?: { color?: SceneryColor }): void;
  reserve(x: number, z: number, radius: number): void;
}
export interface SitesSpec {
  cell: number;
  odds: number;
  radius: [number, number];
  fits(f: Fields): boolean;
  build(site: Site, kit: SiteKit): void;
}

export interface AmbienceSpec {
  layers?: Partial<Record<'crickets' | 'birds' | 'surf' | 'bells' | 'wind-high', number>>;
  fogTint?: SceneryColor;
  fogTintAmount?: number;
}

export interface Biome {
  kind?: 'biome';
  id: string;
  name: string;
  /** JSON: colors as swatch names or #rrggbb, plus whatever the hooks read. */
  params: Record<string, string | number>;
  presence: Presence;
  height?: HeightHook;
  ground: GroundHook;
  populate?: PopulateHook;
  sites?: SitesSpec;
  ambience?: AmbienceSpec;
  /** Default true: the world's snow layer. */
  snow?: boolean;
  /** Default true: sand at sea level. */
  shore?: boolean;
}

export interface Species {
  kind?: 'species';
  id: string;
  name: string;
  [key: string]: unknown;
}
export interface Prop {
  kind?: 'prop';
  id: string;
  [key: string]: unknown;
}
export interface Structure {
  kind?: 'structure';
  id: string;
  [key: string]: unknown;
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

const PRESENCE_TYPES = new Set(['climatePoint', 'heightBand', 'mul', 'max']);
const HEIGHT_TYPES = new Set(['offset', 'terraces']);
const GROUND_TYPES = new Set(['layers']);

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
  idsOf(species, 'species');
  idsOf(props, 'prop');
  idsOf(structures, 'structure');

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
    if (!biome?.ground) errors.push(`${where}: needs a ground hook`);
    else hookType(`${where}.ground`, biome.ground, GROUND_TYPES);
    if (biome?.height) {
      hookType(`${where}.height`, biome.height, HEIGHT_TYPES);
      const offset = biome.height as { type?: string; meters?: number };
      if (offset?.type === 'offset' && Math.abs(offset.meters ?? 0) > BUDGET.heightDelta)
        errors.push(`${where}.height: ${offset.meters} m, the budget is ${BUDGET.heightDelta}`);
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
  return errors;
}

/** Problems with a baked geometry against its entry's budget and the color envelope; empty when clean. */
export function validateBaked(
  entry: { kind?: string; id: string; budget?: { triangles?: number } },
  geometry: {
    index?: { count: number } | null;
    attributes: {
      position: { count: number };
      color?: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number };
    };
  },
): string[] {
  const errors: string[] = [];
  const where = `${entry.kind ?? 'entry'} ${entry.id}`;
  const triangles = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  const cap = entry.budget?.triangles ?? BUDGET.propTriangles;
  if (triangles > cap) errors.push(`${where}: ${triangles} triangles, the budget is ${cap}`);
  const colors = geometry.attributes.color;
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

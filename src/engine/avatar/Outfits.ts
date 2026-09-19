// The wardrobe's catalogue: what the figure wears, and the markings laid over
// it. Both are data and both are pure -- a pattern is a function of where a
// vertex sits on its own chain, nothing else -- which is what lets the SVG
// tiles in the wardrobe be drawn from the same numbers as the figure. A tile
// that draws itself some other way is a tile that can disagree with the
// figure, and it would, on the first outfit somebody added.
//
// Names live here, with the colours they name. The rule about interface text
// belonging to `index.html` and `Hud.ts` is about the page a player reads
// their way around; a garment's name belongs to the garment.

/** The places a colour can go. The figure's vertices carry these by name. */
export type Swatch = 'suit' | 'trim' | 'helmet' | 'goggles' | 'boots' | 'gloves' | 'skin';

export interface Outfit {
  id: string;
  name: string;
  suit: number;
  trim: number;
  helmet: number;
  goggles: number;
  boots: number;
  gloves: number;
  skin: number;
}

export interface Pattern {
  id: string;
  name: string;
  /**
   * What this vertex should take instead of its own swatch, or null for "leave
   * it alone". `along` runs 0..1 from the first joint of the chain to the last,
   * `around` runs 0..2pi round the ring.
   *
   * A pattern may only repaint the **suit**, and only ever in a colour the
   * outfit already carries. That is not shyness: the alternative is a catalogue
   * where a marking can paint a visor pink, and the figure's face is a place
   * the engine gets to keep.
   */
  mark(swatch: Swatch, along: number, around: number): Swatch | null;
}

const TAU = Math.PI * 2;
/** 1 at the middle of a band of the given width, 0 outside it; the argument wraps. */
const band = (v: number, width: number) => {
  const d = Math.abs((((v % 1) + 1.5) % 1) - 0.5);
  return d < width / 2;
};

export const PATTERNS: readonly Pattern[] = [
  { id: 'plain', name: 'plain', mark: () => null },
  {
    // Rings down the arms and legs, and round the body: the one marking that
    // reads from every bearing, because it never runs out of the picture.
    id: 'bands',
    name: 'banded',
    mark: (swatch, along) => (swatch === 'suit' && band(along * 4.5, 0.34) ? 'trim' : null),
  },
  {
    // One turn of the spiral per chain: a sash on the body, a stripe that winds
    // on a limb. It is the same line in both places, which is the point.
    id: 'sash',
    name: 'sash',
    mark: (swatch, along, around) =>
      swatch === 'suit' && band(along * 1.7 + around / TAU, 0.22) ? 'trim' : null,
  },
  {
    // The outside of everything: the seam a flying suit would be cut along.
    id: 'flanks',
    name: 'flanks',
    mark: (swatch, _along, around) => (swatch === 'suit' && Math.cos(around) > 0.58 ? 'trim' : null),
  },
  {
    // Shoulders, hips and the top of every limb: what a harness covers.
    id: 'yoke',
    name: 'yoke',
    mark: (swatch, along) => (swatch === 'suit' && along < 0.28 ? 'trim' : null),
  },
];

/**
 * The outfits. Colours sit inside the world's own envelope (HSL saturation at
 * most 0.62, lightness 0.18..0.93, spec 5.5): the figure is lit by the same sun
 * as the ground, and a shirt outside that envelope reads as a hole in the
 * picture rather than as a bright shirt.
 */
export const OUTFITS: readonly Outfit[] = [
  {
    id: 'dusk',
    name: 'dusk',
    suit: 0x2e3f6b,
    trim: 0xd9a066,
    helmet: 0xe8e2d4,
    goggles: 0x1a1d24,
    boots: 0x2b2622,
    gloves: 0x2b2622,
    skin: 0xd9a984,
  },
  {
    id: 'ember',
    name: 'ember',
    suit: 0x6b3a2e,
    trim: 0xe0c08a,
    helmet: 0xd8cfc0,
    goggles: 0x241a18,
    boots: 0x33261f,
    gloves: 0x33261f,
    skin: 0xc98f6a,
  },
  {
    id: 'moss',
    name: 'moss',
    suit: 0x3c5540,
    trim: 0xc9c08a,
    helmet: 0xdfe0d4,
    goggles: 0x1c2420,
    boots: 0x2a2b24,
    gloves: 0x2a2b24,
    skin: 0xb98a63,
  },
  {
    id: 'frost',
    name: 'frost',
    suit: 0x4a5c6b,
    trim: 0xe4ecf2,
    helmet: 0xc9d6de,
    goggles: 0x191f24,
    boots: 0x232a30,
    gloves: 0x232a30,
    skin: 0xe0b394,
  },
  {
    id: 'plum',
    name: 'plum',
    suit: 0x4a3355,
    trim: 0xd9a6bc,
    helmet: 0xe6dee8,
    goggles: 0x1d1822,
    boots: 0x2a222e,
    gloves: 0x2a222e,
    skin: 0xa8734f,
  },
  {
    id: 'sand',
    name: 'sand',
    suit: 0xa8956b,
    trim: 0x4a4334,
    helmet: 0xe8e2d4,
    goggles: 0x22201a,
    boots: 0x413a2c,
    gloves: 0x413a2c,
    skin: 0x8a5a3c,
  },
];

export const DEFAULT_OUTFIT: Outfit = OUTFITS[0]!;
export const DEFAULT_PATTERN: Pattern = PATTERNS[0]!;

export const outfitById = (id: string): Outfit => OUTFITS.find((o) => o.id === id) ?? DEFAULT_OUTFIT;
export const patternById = (id: string): Pattern => PATTERNS.find((p) => p.id === id) ?? DEFAULT_PATTERN;

/**
 * The marking a world hands out when nobody has chosen one: a rule, not a roll.
 * The seed decides, so a world dresses its flyer the same way every time it is
 * opened, and a shared address arrives wearing what it wore.
 */
export const patternForSeed = (seed: number): Pattern => {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  // Unsigned before the modulo: `^` hands back a *signed* 32-bit integer, and
  // half the seeds indexed the catalogue from the wrong end of nowhere.
  return PATTERNS[((h ^ (h >>> 16)) >>> 0) % PATTERNS.length]!;
};

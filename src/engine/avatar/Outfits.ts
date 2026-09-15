// Outfits and patterns. One outfit and the plain pattern for now; the
// wardrobe, the catalog and the SVG tiles arrive in M5 and extend these.

export interface Outfit {
  id: string;
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
}

export const OUTFITS: readonly Outfit[] = [
  {
    id: 'dusk',
    suit: 0x2e3f6b,
    trim: 0xd9a066,
    helmet: 0xe8e2d4,
    goggles: 0x1a1d24,
    boots: 0x2b2622,
    gloves: 0x2b2622,
    skin: 0xd9a984,
  },
];
export const PATTERNS: readonly Pattern[] = [{ id: 'plain' }];
export const DEFAULT_OUTFIT: Outfit = OUTFITS[0]!;
export const DEFAULT_PATTERN: Pattern = PATTERNS[0]!;

export const outfitById = (id: string): Outfit => OUTFITS.find((o) => o.id === id) ?? DEFAULT_OUTFIT;
export const patternById = (id: string): Pattern => PATTERNS.find((p) => p.id === id) ?? DEFAULT_PATTERN;

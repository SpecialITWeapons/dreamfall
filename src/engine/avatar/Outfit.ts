// What the figure wears: one suit, one colour, and the gear that is not the
// suit. There was a wardrobe here once -- six suits, five markings and a panel
// to pick them from -- and the owner took one look at a seed's own marking and
// asked what the camouflage was for. A flyer in a plain suit reads as a person;
// the rest read as a pattern.
//
// Colours sit inside the world's own envelope (HSL saturation at most 0.62,
// lightness 0.18..0.93, spec 5.5): the figure is lit by the same sun as the
// ground, and a suit outside that envelope reads as a hole in the picture. The
// goggles, boots and gloves sit under its floor on purpose -- a visor has to
// read as dark from a hundred metres -- and a test holds both halves.

/** The places a colour can go. The figure's vertices carry these by name. */
export type Swatch = 'suit' | 'helmet' | 'goggles' | 'boots' | 'gloves' | 'skin';

export type Outfit = Record<Swatch, number>;

/** The dark parts: what may sit under the envelope's floor, and nothing else. */
export const DARK: readonly Swatch[] = ['goggles', 'boots', 'gloves'];

export const OUTFIT: Outfit = {
  suit: 0x2e3f6b,
  helmet: 0xe8e2d4,
  goggles: 0x1a1d24,
  boots: 0x2b2622,
  gloves: 0x2b2622,
  skin: 0xd9a984,
};

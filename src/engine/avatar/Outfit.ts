// What the figure wears: the colours of its suit and its helmet, the boots and
// gloves its file does not have, and the skin they leave showing. There was a
// wardrobe here once -- six suits, five markings and a panel to pick them from
// -- and the owner took one look at a seed's own marking and asked what the
// camouflage was for. A flyer in a plain suit reads as a person; the rest read
// as a pattern.
//
// The suit and the helmet are the file's shapes in these colours: the file's
// own were near-black textures on both, so the figure was one dark silhouette
// (`AuthoredFigure.ts`, `recolour`). The body the file carries is hands, feet
// and a neck -- everything the suit covers was cut away -- so the hands are
// painted into gloves and the feet get boots built over them (`dress`,
// `cobble`).
//
// Colours sit inside the world's own envelope (HSL saturation at most 0.62,
// lightness 0.18..0.93, spec 5.5): the figure is lit by the same sun as the
// ground, and a colour outside that envelope reads as a hole in the picture.
// The boots and the gloves sit under its floor on purpose -- they read as gear
// on the suit rather than as more of the figure -- and a test holds both halves.

/** The places a colour can go. */
export type Swatch = 'suit' | 'helmet' | 'boots' | 'gloves' | 'skin';

export type Outfit = Record<Swatch, number>;

/** The dark parts: what may sit under the envelope's floor, and nothing else. */
export const DARK: readonly Swatch[] = ['boots', 'gloves'];

export const OUTFIT: Outfit = {
  suit: 0x2e3f6b,
  helmet: 0xe8e2d4,
  boots: 0x2b2622,
  gloves: 0x2b2622,
  skin: 0xd9a984,
};

import { defineSpecies } from '../contract';

// A taller, darker oak for the deep woods.
export default defineSpecies({
  id: 'elder',
  name: 'elder oak',
  trunk: { height: 9, radius: 1.1, lean: 0.4, tint: 'barkDark' },
  limbs: { count: 6, spread: 7, rise: 13, from: 0.5 },
  crown: { shape: 'dome', cards: 32, size: 4.4, radius: 5.5, height: 3.4 },
  leaf: 'elder',
  tint: { cold: 'canopyDusk', warm: 'white', dry: 'canopyDusk' },
  scale: [1.3, 2.1],
});

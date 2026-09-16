import { defineSpecies } from '../contract';

// A flat-topped tree of the steppe: wide limbs, a thin dome of yellow-green cards.
export default defineSpecies({
  id: 'acacia',
  name: 'acacia',
  trunk: { height: 5.5, radius: 0.5, lean: 0.9, tint: 'barkWarm' },
  limbs: { count: 4, spread: 6.5, rise: 6.6, from: 0.6 },
  crown: { shape: 'dome', cards: 28, size: 3.6, radius: 5.5, height: 1.1 },
  leaf: 'acacia',
  tint: { cold: 'white', warm: 'white', dry: 'canopyDry' },
  scale: [1.0, 1.8],
});

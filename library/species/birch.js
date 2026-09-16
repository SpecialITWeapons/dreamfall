import { defineSpecies } from '../contract';

// A slim pale trunk and an upright crown in autumn colors.
export default defineSpecies({
  id: 'birch',
  name: 'autumn birch',
  trunk: { height: 7.5, radius: 0.45, lean: 0.3, tint: 'barkPale' },
  limbs: { count: 4, spread: 3.2, rise: 10, from: 0.5 },
  crown: { shape: 'dome', cards: 30, size: 3.2, radius: 3.4, height: 3.6 },
  leaf: 'autumn',
  tint: { cold: 'white', warm: 'white', dry: 'white' },
  scale: [1.0, 2.0],
});

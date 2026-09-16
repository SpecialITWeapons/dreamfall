import { defineSpecies } from '../contract';

// A tall leaning trunk with a fan of fronds at the top, each painted from the
// card's foot outward.
export default defineSpecies({
  id: 'palm',
  name: 'palm',
  trunk: { height: 13, radius: 0.5, lean: 1.8, tint: 'barkWarm' },
  limbs: { count: 0 },
  crown: { shape: 'fan', cards: 13, size: 7.5, radius: 4.2, height: 1.5 },
  leaf: 'frond',
  tint: { cold: 'white', warm: 'white', dry: 'canopyDry' },
  scale: [1.1, 1.8],
});

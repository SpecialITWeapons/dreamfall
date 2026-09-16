import { defineSpecies } from '../contract';

// Wood only: a bare trunk and limbs for the badlands and the moor. A bare crown
// takes no leaf, so the engine bakes it as one geometry and never asks for a map.
export default defineSpecies({
  id: 'deadwood',
  name: 'dead tree',
  trunk: { height: 6, radius: 0.5, lean: 0.9, tint: 'rockPale' },
  limbs: { count: 5, spread: 4, rise: 8.5, from: 0.45 },
  crown: { shape: 'bare' },
  tint: { cold: 'white', warm: 'white', dry: 'white' },
  scale: [0.9, 1.6],
});

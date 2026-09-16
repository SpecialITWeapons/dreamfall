import { defineSpecies } from '../contract';

// The broad oak of the ordinary hills: a leaning trunk, five limbs, a cloud of
// broad cards on each. Data for the built-in tree kit; see CONTRIBUTING.md for
// the four crown shapes and for growing a species its own way with bake(kit).
export default defineSpecies({
  id: 'oak',
  name: 'oak',
  trunk: { height: 6.4, radius: 0.9, lean: 0.65, tint: 'white' },
  limbs: { count: 5, spread: 6, rise: 8.8, from: 0.55 },
  crown: { shape: 'dome', cards: 35, size: 3.8, radius: 5, height: 2.8 },
  leaf: 'broad',
  tint: { cold: 'canopyCold', warm: 'white', dry: 'canopyDry' },
  scale: [1.15, 2.4],
});

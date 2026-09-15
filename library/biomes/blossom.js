import { defineBiome } from '../contract';

// Warm, damp and unlikely: pale green meadow, pale stone, a place that looks like spring.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'blossom',
  name: 'Blossom grove',
  params: { base: 'paleGreen', alt: 'meadow', rock: 'rockPale' },
  presence: { type: 'climatePoint', point: [0.62, 0.56, 0.92] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'paleGreen' },
      { color: 'meadow', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockPale', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
});

import { defineBiome } from '../contract';

// The middle of the world: broad meadow hills under oaks, the place a climate falls back to.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'wildsong',
  name: 'Wildsong hills',
  params: { base: 'meadow', alt: 'steppe', rock: 'rock' },
  presence: { type: 'climatePoint', point: [0.5, 0.5, 0.35] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'meadow' },
      { color: 'steppe', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rock', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
});

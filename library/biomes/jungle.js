import { defineBiome } from '../contract';

// Hot and wet: deep green under deeper green, rock only on the steepest ground.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'jungle',
  name: 'Jungle',
  params: { base: 'jungleDeep', alt: 'jungle', rock: 'rock' },
  presence: { type: 'climatePoint', point: [0.84, 0.8, 0.5] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'jungleDeep' },
      { color: 'jungle', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rock', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
});

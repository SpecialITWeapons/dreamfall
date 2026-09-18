import { defineBiome } from '../contract';

// Warm and dry: gold grass gone to seed, pale stone, flat light.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'steppe',
  name: 'Golden steppe',
  params: { base: 'gold', alt: 'steppe', rock: 'rockPale' },
  presence: { type: 'climatePoint', point: [0.68, 0.32, 0.45] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'gold' },
      { color: 'steppe', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockPale', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { acacia: 1, cypress: 0.12 },
    density: 0.3,
    props: { boulders: 0.25 },
    grass: { tint: 'grassGold', density: 0.9 },
  },
  // Grass gone to seed, full of insects, with nothing to stop the wind.
  ambience: { layers: { crickets: 0.75, birds: 0.25, 'wind-high': 0.3 } },
});

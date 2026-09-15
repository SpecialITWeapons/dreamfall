import { defineBiome } from '../contract';

// The driest place there is: pale sand shading to ochre, and rock only where the wind found some.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'dunes',
  name: 'Dune sea',
  params: { base: 'sandPale', alt: 'ochre', rock: 'rockPale' },
  presence: { type: 'climatePoint', point: [0.86, 0.12, 0.3] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'sandPale' },
      { color: 'ochre', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockPale', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
});

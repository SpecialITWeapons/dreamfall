import { defineBiome } from '../contract';

// The driest place there is: pale sand shading to ochre, and rock only where the wind found some.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'dunes',
  name: 'Dune sea',
  params: { base: 'sandPale', alt: 'ochre', rock: 'rockPale', road: 'barkDark' },
  presence: { type: 'climatePoint', point: [0.86, 0.12, 0.3] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'sandPale' },
      { color: 'ochre', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockPale', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { palm: 1 },
    density: 0.08,
    props: { boulders: 0.1 },
    grass: { tint: 'grassGold', density: 0 },
  },
  // Sand, wind, and often the sea on the other side of it.
  // Sand in the air, which is why a desert horizon has no line in it.
  ambience: { layers: { 'wind-high': 0.9, surf: 0.45 }, fogTint: 'sandPale', fogTintAmount: 0.3 },
});

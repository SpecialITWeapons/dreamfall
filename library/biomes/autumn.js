import { defineBiome } from '../contract';

// Mild, and always late in the year: amber ground over leaf litter.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'autumn',
  name: 'Autumn vale',
  params: { base: 'amber', alt: 'leafLitter', rock: 'rock' },
  presence: { type: 'climatePoint', point: [0.45, 0.5, 0.82] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'amber' },
      { color: 'leafLitter', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rock', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { birch: 1, oak: 0.3 },
    density: 0.85,
    props: { boulders: 0.2 },
    grass: { tint: 'grassGold', density: 0.7 },
  },
});

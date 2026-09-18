import { defineBiome } from '../contract';

// Cold and damp: frost over tundra, the rock as cold as the ground.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'frostpines',
  name: 'Frost pines',
  params: { base: 'frost', alt: 'tundra', rock: 'rockCold' },
  presence: { type: 'climatePoint', point: [0.16, 0.6, 0.5] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'frost' },
      { color: 'tundra', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockCold', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { pine: 1 },
    density: 0.9,
    props: { boulders: 0.5, cairns: 0.5 },
    grass: { tint: 'grassCool', density: 0.15 },
  },
  // Cold and nearly empty. What lives here is not loud.
  // Cold air over snow: the distance goes pale rather than blue.
  ambience: { layers: { 'wind-high': 0.7, birds: 0.12 }, fogTint: 'frost', fogTintAmount: 0.24 },
});

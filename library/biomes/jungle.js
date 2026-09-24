import { defineBiome } from '../contract';

// Hot and wet: deep green under deeper green, rock only on the steepest ground.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'jungle',
  name: 'Jungle',
  params: { base: 'jungleDeep', alt: 'jungle', rock: 'rock', road: 'clay' },
  presence: { type: 'climatePoint', point: [0.84, 0.8, 0.5] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'jungleDeep' },
      { color: 'jungle', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rock', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { palm: 1, elder: 0.6 },
    density: 1.2,
    props: { boulders: 0.15 },
    grass: { tint: 'white', density: 0.8 },
  },
  // The loudest country there is, and the only one as loud at midnight as at noon.
  // Wet heat you can see: the air over a jungle is the jungle's own green.
  ambience: { layers: { crickets: 1, birds: 0.9 }, fogTint: 'jungle', fogTintAmount: 0.26 },
});

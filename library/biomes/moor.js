import { defineBiome } from '../contract';

// Cold and half dry: moor grass with heather in it, cold stone under a low sky.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'moor',
  name: 'Highland moor',
  params: { base: 'moor', alt: 'heather', rock: 'rockCold', road: 'clay' },
  presence: { type: 'climatePoint', point: [0.3, 0.42, 0.22] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'moor' },
      { color: 'heather', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockCold', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { pine: 1, deadwood: 0.3 },
    density: 0.12,
    props: { boulders: 0.8, cairns: 1 },
    grass: { tint: 'grassCool', density: 0.4 },
  },
  // A low sky over open heath: mostly weather, with something calling across it.
  // A low sky pressed onto wet ground -- the one country here that is usually indoors.
  ambience: { layers: { 'wind-high': 0.55, birds: 0.25 }, fogTint: 'rockCold', fogTintAmount: 0.18 },
});

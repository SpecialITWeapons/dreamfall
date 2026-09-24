import { defineBiome } from '../contract';

// Cool and wet: deep moss under old timber, and cold stone where the slope shows through.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'elderwood',
  name: 'Elderwood',
  params: { base: 'mossDeep', alt: 'forest', rock: 'rockCold', road: 'sandPale' },
  presence: { type: 'climatePoint', point: [0.42, 0.74, 0.5] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'mossDeep' },
      { color: 'forest', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockCold', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { elder: 1, pine: 0.25 },
    density: 1.15,
    props: { boulders: 0.3 },
    grass: { tint: 'grassCool', density: 0.5 },
  },
  // Old timber and deep moss: fewer birds than an open wood, and they carry further.
  ambience: { layers: { birds: 0.55, crickets: 0.35 } },
});

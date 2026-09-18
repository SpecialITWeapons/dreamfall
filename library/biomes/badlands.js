import { defineBiome } from '../contract';

// Hot, dry and old: terracotta over clay, red rock on every edge.
// climate is temperature, moisture and region, each 0..1; the ground is a stack
// of swatches, each layer coming in by its own mask.
export default defineBiome({
  id: 'badlands',
  name: 'Red badlands',
  params: { base: 'terracotta', alt: 'clay', rock: 'rockRed' },
  presence: { type: 'climatePoint', point: [0.82, 0.2, 0.78] },
  ground: {
    type: 'layers',
    layers: [
      { color: 'terracotta' },
      { color: 'clay', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 },
      { color: 'rockRed', mask: 'slope', from: 0.32, to: 0.55 },
    ],
  },
  populate: {
    type: 'scatter',
    species: { deadwood: 1 },
    density: 0.2,
    props: { boulders: 1, cairns: 0.3 },
    grass: { tint: 'grassGold', density: 0 },
  },
  // Bare rock has nothing to make a sound with; what it has is air moving over an edge.
  ambience: { layers: { 'wind-high': 0.75, crickets: 0.2 } },
});

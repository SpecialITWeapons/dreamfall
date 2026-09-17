import { defineStructure } from '../contract';

// The long shed at the edge of a plot: twice a cottage's plan, a lower storey
// and a shallower roof, weathered timber under slate. It names no window
// colour, so the kit gives it no windows and nothing in it lights up -- a barn
// is dark at night, which is what tells it apart from a house seen from above.
export default defineStructure({
  id: 'barn',
  name: 'barn',
  footprint: [21, 12],
  floors: [1, 2],
  floorHeight: 4.2,
  roof: 'gable',
  roofPitch: 0.55,
  palette: { wall: 'barkWarm', roof: 'stoneDark', trim: 'barkDark' },
});

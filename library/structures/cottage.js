import { defineStructure } from '../contract';

// The house a village is mostly made of: one or two storeys under a steep
// gable, whitewashed daub over a timber frame, a chimney on the ridge. Data
// only -- the structure kit builds the walls, the roof and a band of windows
// per floor out of these numbers, and the window colour is what lights up at
// night. See CONTRIBUTING.md for a building that bakes itself with bake(kit).
export default defineStructure({
  id: 'cottage',
  name: 'cottage',
  footprint: [7, 5.5],
  floors: [1, 2],
  roof: 'gable',
  roofPitch: 0.8,
  chimney: true,
  palette: { wall: 'sandPale', roof: 'terracotta', trim: 'barkDark', window: 'amber' },
});

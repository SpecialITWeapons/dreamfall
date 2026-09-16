import { defineStructure } from '../contract';

// The house a village is mostly made of: one, two or three storeys under a
// steep gable, whitewashed daub over a timber frame, a chimney on the ridge.
// Data only -- the structure kit builds the walls, the roof and a band of
// windows per floor out of these numbers, and the window colour is what lights
// up at night. See CONTRIBUTING.md for a building that bakes itself with
// bake(kit).
//
// The third storey is the town's, and it is the whole reason a town needs no
// recipes of its own: the only other buildings with a three-storey bake are the
// mill and the tower, and a town centre made of windmills is not a town centre.
// It costs one more bake and one more pool -- a building is instanced whole, so
// every count in `floors` is its own bake.
export default defineStructure({
  id: 'cottage',
  name: 'cottage',
  footprint: [7, 5.5],
  floors: [1, 3],
  roof: 'gable',
  roofPitch: 0.8,
  chimney: true,
  palette: { wall: 'sandPale', roof: 'terracotta', trim: 'barkDark', window: 'amber' },
});

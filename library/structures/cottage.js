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
//
// Grown twice on 2026-09-17, both times from a photograph and the second time
// because the first was not enough. It began at 7 x 5.5 m on 2.8 m storeys,
// which is 5.0 m to the ridge, under a wood whose oaks stand forty to sixty.
// It is 14 x 11 on 4.2 m storeys now: 8.6 m at one storey and 17.0 at three.
// Three to one against a tree is a house under it; ten to one is a mushroom
// beside one. Lot depth and setback grew with it, twice.
export default defineStructure({
  id: 'cottage',
  name: 'cottage',
  footprint: [14, 11],
  floorHeight: 4.2,
  floors: [1, 3],
  roof: 'gable',
  roofPitch: 0.8,
  chimney: true,
  palette: { wall: 'sandPale', roof: 'terracotta', trim: 'barkDark', window: 'amber' },
});

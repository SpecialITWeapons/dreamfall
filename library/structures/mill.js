import { defineStructure } from '../contract';

// The tall one: a narrow square tower of rendered stone under a hipped roof,
// three or four storeys of it, which over a village of cottages makes it the
// thing you steer by. A square plan hips into a pyramid, so the roof reads the
// same from every side, and every storey carries its own band of windows.
export default defineStructure({
  id: 'mill',
  name: 'mill',
  footprint: [9, 8.3],
  floors: [3, 4],
  floorHeight: 4.4,
  roof: 'hip',
  roofPitch: 1,
  palette: { wall: 'stoneWarm', roof: 'stoneDark', trim: 'barkDark', window: 'gold' },
});

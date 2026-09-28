// The ground a road is searched over, in the route worker: the base height
// with the sea cliffs cut into it, because a road searched over the uncut
// coast drives up the face. The worker has no registry, so it does not know
// where a settlement stands; the two ends of the route are settlements, and
// round each the cliffs give way over the settlement's own radius and feather,
// as the window gives way to a village in a cove. Pure CPU.
import { sstep } from '../terrain/noise';
import type { WorldSampler } from '../terrain/WorldSampler';

export interface RouteEnd {
  x: number;
  z: number;
  radius: number;
}

/** Metres past a settlement's radius over which the cliffs come back: a settlement's own feather. */
export const END_FEATHER = 150;

export function routeGround(
  sampler: WorldSampler,
  ends: readonly RouteEnd[],
): (x: number, z: number) => number {
  const fields = new Float64Array(5);
  return (x, z) => {
    sampler.baseFields(x, z, fields);
    const b = fields[0]!;
    let share = 1;
    for (const end of ends)
      share = Math.min(share, sstep(end.radius, end.radius + END_FEATHER, Math.hypot(x - end.x, z - end.z)));
    return b + sampler.cliffs.at(x, z, b, share);
  };
}

// The ground the site plans speak for, asked two ways. A tree keeps off a road
// and off a house by the house's whole reach plus a margin, because a crown
// overhangs; a tuft of grass keeps off the road and the walls and nothing
// else, because the garden between them is exactly where grass grows. The
// plans' own reservations -- a town's plaza -- are the trees' alone.
//
// A house claims its ground through its baked shape, as the obstacle it is
// measured into does, and not through its plan: a plan reserved a circle of
// 16.8 m round every lot, lots stand 24 m apart, and the circles closed the
// whole street to trees -- none could stand between two houses or in front of
// one, however thick the country around it.
//
// One index of 64 m cells, the obstacles' cell for the obstacles' reason, filled
// once a ring rebuild and read once a tree and once a tuft, so a query reads the
// single cell it lands in. Pure CPU: no three, no DOM.
import type { SitePlan } from '../../../library/contract';
import { OBSTACLE_CELL } from './Obstacles';

/** Metres a tree keeps from a building's own reach: a trunk is not a crown. */
export const TREE_MARGIN = 3;
/** Metres a tuft keeps from a road's edge. */
export const GRASS_ROAD_MARGIN = 0.5;
/** Metres a tuft keeps from a wall: the eaves overhang it. */
export const GRASS_WALL_MARGIN = 1;
/** What a prop a plan asked for -- a well, a trough -- keeps clear, m. */
export const PROP_CLAIM = 2;
const CELL = OBSTACLE_CELL;

/** What the baked geometry says of a building: its reach, and its plan at ground level. */
export interface ClaimShapes {
  building(id: string, floors: number): { radius: number; footprint?: [number, number] } | null;
}

/** A plan in the index, with the box its claims cover. */
export interface PlanBounds {
  id: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface Claims {
  /** Forgets every plan: the ring refills the index from nothing at every rebuild. */
  clear(): void;
  add(plan: SitePlan, shapes: ClaimShapes): void;
  /** Is (x, z) ground a tree or a scattered prop may not stand on? */
  trees(x: number, z: number): boolean;
  /** Is (x, z) ground a tuft of grass may not stand on? */
  grass(x: number, z: number): boolean;
  readonly plans: ReadonlyArray<PlanBounds>;
}

/** A segment with a radius -- a road -- or a point with one, which is a disc. */
interface Capsule {
  kind: 0;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Squared, because that is the only way the query ever asks. */
  r2: number;
}
/** A rectangle turned about its centre: a house seen from above. */
interface Box {
  kind: 1;
  x: number;
  z: number;
  cos: number;
  sin: number;
  /** Half its width along its own x, and half its depth along its own z. */
  hw: number;
  hd: number;
}
type Claim = Capsule | Box;

const inside = (c: Claim, x: number, z: number) => {
  if (c.kind === 1) {
    // Into the house's own frame: three turns a mesh by its yaw about y, so a
    // world offset comes back by the transpose of that turn.
    const dx = x - c.x,
      dz = z - c.z;
    return Math.abs(dx * c.cos - dz * c.sin) <= c.hw && Math.abs(dx * c.sin + dz * c.cos) <= c.hd;
  }
  const dx = c.x1 - c.x0,
    dz = c.z1 - c.z0,
    len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.x0) * dx + (z - c.z0) * dz) / len2)) : 0;
  const ox = x - (c.x0 + t * dx),
    oz = z - (c.z0 + t * dz);
  return ox * ox + oz * oz <= c.r2;
};

/** One layer of the index: each claim filed under every cell it touches. */
function createGrid() {
  const cells = new Map<string, Claim[]>();
  const file = (claim: Claim, x0: number, z0: number, x1: number, z1: number) => {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const key = `${cx},${cz}`,
          bucket = cells.get(key);
        if (bucket) bucket.push(claim);
        else cells.set(key, [claim]);
      }
  };
  return {
    clear: () => cells.clear(),
    capsule(x0: number, z0: number, x1: number, z1: number, r: number) {
      file(
        { kind: 0, x0, z0, x1, z1, r2: r * r },
        Math.min(x0, x1) - r,
        Math.min(z0, z1) - r,
        Math.max(x0, x1) + r,
        Math.max(z0, z1) + r,
      );
    },
    box(x: number, z: number, yaw: number, hw: number, hd: number) {
      const reach = Math.hypot(hw, hd);
      file(
        { kind: 1, x, z, cos: Math.cos(yaw), sin: Math.sin(yaw), hw, hd },
        x - reach,
        z - reach,
        x + reach,
        z + reach,
      );
    },
    has(x: number, z: number) {
      // A world with no settlements pays one comparison for the question.
      if (cells.size === 0) return false;
      const bucket = cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!bucket) return false;
      for (const claim of bucket) if (inside(claim, x, z)) return true;
      return false;
    },
  };
}

export function createClaims(): Claims {
  const trees = createGrid(),
    grass = createGrid();
  const plans: PlanBounds[] = [];
  return {
    clear() {
      trees.clear();
      grass.clear();
      plans.length = 0;
    },
    add(plan, shapes) {
      const bounds: PlanBounds = { id: plan.id, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      const reach = (x: number, z: number, r: number) => {
        bounds.x0 = Math.min(bounds.x0, x - r);
        bounds.z0 = Math.min(bounds.z0, z - r);
        bounds.x1 = Math.max(bounds.x1, x + r);
        bounds.z1 = Math.max(bounds.z1, z + r);
      };
      for (const spot of plan.reservations) {
        trees.capsule(spot.x, spot.z, spot.x, spot.z, spot.radius);
        reach(spot.x, spot.z, spot.radius);
      }
      for (const road of plan.roads) {
        const half = road.width / 2;
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!,
            b = road.points[i]!;
          trees.capsule(a[0], a[1], b[0], b[1], half);
          grass.capsule(a[0], a[1], b[0], b[1], half + GRASS_ROAD_MARGIN);
          reach(a[0], a[1], half + GRASS_ROAD_MARGIN);
          reach(b[0], b[1], half + GRASS_ROAD_MARGIN);
        }
      }
      for (const lot of plan.lots) {
        // A lot with no floors is a prop the plan asked for: a well, a trough.
        if (lot.floors <= 0) {
          trees.capsule(lot.x, lot.z, lot.x, lot.z, PROP_CLAIM);
          grass.capsule(lot.x, lot.z, lot.x, lot.z, PROP_CLAIM);
          reach(lot.x, lot.z, PROP_CLAIM);
          continue;
        }
        // Nothing baked, nothing raised (the ring counts it refused), and
        // nothing claimed: the ground stays the country's.
        const shape = shapes.building(lot.structure, lot.floors);
        if (!shape) continue;
        const r = shape.radius + TREE_MARGIN;
        trees.capsule(lot.x, lot.z, lot.x, lot.z, r);
        reach(lot.x, lot.z, r);
        if (shape.footprint)
          grass.box(
            lot.x,
            lot.z,
            lot.yaw,
            shape.footprint[0] / 2 + GRASS_WALL_MARGIN,
            shape.footprint[1] / 2 + GRASS_WALL_MARGIN,
          );
      }
      if (bounds.x0 <= bounds.x1) plans.push(bounds);
    },
    trees: (x, z) => trees.has(x, z),
    grass: (x, z) => grass.has(x, z),
    get plans() {
      return plans;
    },
  };
}

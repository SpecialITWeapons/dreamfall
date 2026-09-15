// The obstacle registry: everything that stands on the ground and the flight
// must clear (trees from M3, buildings from M4). A hash grid of 64 m cells
// keeps the queries local: floorAt reads the cells under one point and near
// collects the records within reach of one, so a look-ahead along a route
// touches only the cells on it. Pure CPU, no Three.js.

export interface Obstacle {
  x: number;
  z: number;
  /** Ground height under the obstacle, m above sea level. */
  ground: number;
  /** Height of its top, m above sea level. */
  top: number;
  radius: number;
}

export const OBSTACLE_CELL = 64;

export interface Obstacles {
  readonly size: number;
  readonly cell: number;
  add(obstacle: Obstacle): void;
  clear(): void;
  /** The highest top among obstacles whose disc, widened by pad, covers (x, z); -Infinity when none. */
  floorAt(x: number, z: number, pad?: number): number;
  /** Every obstacle whose disc comes within reach of (x, z), written into out (emptied first). */
  near(x: number, z: number, reach: number, out: Obstacle[]): Obstacle[];
}

export function createObstacles(opts: { cell?: number } = {}): Obstacles {
  const cell = opts.cell ?? OBSTACLE_CELL;
  const cells = new Map<string, Obstacle[]>();
  let size = 0;
  // Records live in the cell of their center; a scan widens by the largest radius seen.
  let maxRadius = 0;
  const cellOf = (v: number) => Math.floor(v / cell);
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  const scan = (x: number, z: number, reach: number, visit: (o: Obstacle) => void) => {
    if (size === 0) return;
    const span = reach + maxRadius;
    const x0 = cellOf(x - span),
      x1 = cellOf(x + span),
      z0 = cellOf(z - span),
      z1 = cellOf(z + span);
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = cells.get(key(cx, cz));
        if (bucket) for (const o of bucket) visit(o);
      }
  };
  return {
    get size() {
      return size;
    },
    cell,
    add(o) {
      const k = key(cellOf(o.x), cellOf(o.z));
      const bucket = cells.get(k);
      if (bucket) bucket.push(o);
      else cells.set(k, [o]);
      size++;
      maxRadius = Math.max(maxRadius, o.radius);
    },
    clear() {
      cells.clear();
      size = 0;
      maxRadius = 0;
    },
    floorAt(x, z, pad = 5) {
      let floor = -Infinity;
      scan(x, z, pad, (o) => {
        const r = o.radius + pad;
        if ((o.x - x) ** 2 + (o.z - z) ** 2 <= r * r) floor = Math.max(floor, o.top);
      });
      return floor;
    },
    near(x, z, reach, out) {
      out.length = 0;
      scan(x, z, reach, (o) => {
        const r = reach + o.radius;
        if ((o.x - x) ** 2 + (o.z - z) ** 2 <= r * r) out.push(o);
      });
      return out;
    },
  };
}

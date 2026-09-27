// The trees past the ring: every cell whose centre lies beyond the ring's
// reach and inside the far terrain's, sown by the same `Sowing` the ring sows
// through, over the ground the near window would have answered with. That is
// the whole of what makes the card seen at three kilometres the tree the ring
// puts up when the flight gets there.
//
// A cell's trees are a function of its own coordinates and of the plans built
// over it, and of nothing else: nothing here reads where the flyer is except
// to decide which cells are wanted and in what order they are sown, so coming
// at a wood from either side grows the same wood. The cells are sown from a
// queue, nearest first, with a budget checked before a cell and never during
// one; a cell that leaves the reach is forgotten at once. A plan that arrives
// over cells already sown has them sown again, once, as the grass does.
//
// Pure CPU: from three it takes nothing but what Sowing takes.
import type { Library } from '../../../library/contract';
import type { GroundQuery } from '../terrain/SampledGround';
import type { WorldSampler } from '../terrain/WorldSampler';
import type { Claims } from './Claims';
import { TREE_CELL, TREE_RADIUS } from './Ring';
import { createSowing } from './Sowing';

/** How far the trees reach, m: the far terrain's own grid ends at 8.2 km. */
export const FAR_TREE_RADIUS = 8200;
/** Milliseconds a frame may spend sowing far cells; checked before a cell, never during one. */
export const FAR_TREES_BUDGET_MS = 2;

/** One far tree, kept: the placement, and its climate tint as three numbers rather than a scratch colour. */
export interface FarTree {
  species: string;
  x: number;
  y: number;
  z: number;
  scale: number;
  tall: number;
  yaw: number;
  tint: [number, number, number];
}

export interface FarTrees {
  /** Where the ring last rebuilt, in the world: decides which cells are wanted, and forgets the rest. */
  update(x: number, z: number): void;
  /** Sows queued cells, nearest first, until the budget is spent. */
  work(budgetMs: number): void;
  /** Grows whenever the set of trees changes. */
  readonly version: number;
  readonly queued: number;
  /** Cells sown and held, sea included. */
  readonly cells: number;
  readonly trees: number;
  /** Milliseconds the last `work` took. */
  readonly ms: number;
  forEach(fn: (tree: FarTree) => void): void;
}

/** A cell's two indices as one number: exact for |index| < 2^21 cells, which is 200 000 km. */
const OFFSET = 2097152,
  SPAN = 4194304;
const keyOf = (ix: number, iz: number) => (ix + OFFSET) * SPAN + (iz + OFFSET);
const ixOf = (key: number) => Math.floor(key / SPAN) - OFFSET;
const izOf = (key: number) => (key % SPAN) - OFFSET;

export function createFarTrees(deps: {
  seed: number;
  library: Library;
  sampler: WorldSampler;
  ground: GroundQuery;
  /** The ground the plans in the ring's reach speak for; a far tree keeps off it as a near one does. */
  claims?: Claims;
  /** Whether the species has a baked shape to stand. */
  baked(speciesId: string): boolean;
  /** The ring's reach, m: cells whose centre is this near are the ring's. */
  inner?: number;
  radius?: number;
  cell?: number;
  now?: () => number;
}): FarTrees {
  const size = deps.cell ?? TREE_CELL;
  const inner = deps.inner ?? TREE_RADIUS;
  const radius = deps.radius ?? FAR_TREE_RADIUS;
  const now = deps.now ?? (() => performance.now());
  const claims = deps.claims;

  const live = new Map<number, FarTree[]>();
  const wanted = new Set<number>();
  let queue: number[] = [];
  let head = 0;
  let version = 0,
    trees = 0,
    ms = 0;

  let current: FarTree[] = [];
  const sowing = createSowing({
    seed: deps.seed,
    library: deps.library,
    sampler: deps.sampler,
    ground: deps.ground,
    size,
    occupied: (x, z) => claims?.trees(x, z) ?? false,
    // No ceilings: the card pool counts what it refuses on its own.
    admit: () => true,
    baked: deps.baked,
    emit: (t) => {
      current.push({
        species: t.species,
        x: t.x,
        y: t.y,
        z: t.z,
        scale: t.scale,
        tall: t.tall,
        yaw: t.yaw,
        tint: [t.tint.r, t.tint.g, t.tint.b],
      });
      return true;
    },
  });

  const forget = (key: number) => {
    const held = live.get(key);
    if (!held) return false;
    trees -= held.length;
    live.delete(key);
    return true;
  };

  /** Plans the cells were sown around; a new one has the cells under it sown again. */
  const accounted = new Set<string>();
  const account = () => {
    if (!claims) return false;
    let changed = false;
    const plans = claims.plans;
    for (const plan of plans) {
      if (accounted.has(plan.id)) continue;
      accounted.add(plan.id);
      for (let iz = Math.floor(plan.z0 / size); iz <= Math.floor(plan.z1 / size); iz++)
        for (let ix = Math.floor(plan.x0 / size); ix <= Math.floor(plan.x1 / size); ix++)
          changed = forget(keyOf(ix, iz)) || changed;
    }
    if (accounted.size > plans.length)
      for (const id of accounted) if (!plans.some((plan) => plan.id === id)) accounted.delete(id);
    return changed;
  };

  return {
    update(x, z) {
      let changed = false;
      wanted.clear();
      const distance = new Map<number, number>();
      const cx = Math.floor(x / size),
        cz = Math.floor(z / size),
        span = Math.ceil(radius / size);
      for (let iz = cz - span; iz <= cz + span; iz++)
        for (let ix = cx - span; ix <= cx + span; ix++) {
          const d = Math.hypot((ix + 0.5) * size - x, (iz + 0.5) * size - z);
          if (d <= inner || d > radius) continue;
          const key = keyOf(ix, iz);
          wanted.add(key);
          if (!live.has(key)) distance.set(key, d);
        }
      for (const key of [...live.keys()]) if (!wanted.has(key)) changed = forget(key) || changed;
      if (account()) {
        changed = true;
        // the cells a plan made stale are wanted and no longer live
        for (const key of wanted)
          if (!live.has(key) && !distance.has(key)) {
            const ix = ixOf(key),
              iz = izOf(key);
            distance.set(key, Math.hypot((ix + 0.5) * size - x, (iz + 0.5) * size - z));
          }
      }
      queue = [...distance.keys()].sort((a, b) => distance.get(a)! - distance.get(b)!);
      head = 0;
      if (changed) version++;
    },
    work(budgetMs) {
      const started = now();
      let sown = false;
      while (head < queue.length) {
        if (now() - started >= budgetMs) break;
        const key = queue[head++]!;
        if (!wanted.has(key) || live.has(key)) continue;
        current = [];
        if (sowing.enter(ixOf(key), izOf(key))) sowing.sowTrees();
        live.set(key, current);
        trees += current.length;
        sown = true;
      }
      if (sown) version++;
      ms = now() - started;
    },
    get version() {
      return version;
    },
    get queued() {
      return queue.length - head;
    },
    get cells() {
      return live.size;
    },
    get trees() {
      return trees;
    },
    get ms() {
      return ms;
    },
    forEach(fn) {
      for (const held of live.values()) for (const tree of held) fn(tree);
    },
  };
}

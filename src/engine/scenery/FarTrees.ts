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
// one; a cell that leaves the reach is forgotten at once. A plan or a road
// that arrives over cells already sown has the cells it touches sown again,
// once, as the grass does, and their cards stand until it is done.
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

  /**
   * Cells to sow again: a claim has come over them or gone from them. Their old
   * trees stand until then, so a road arriving over the far land never leaves a
   * patch of it bare for the frames the queue takes.
   */
  const stale = new Set<number>();
  /** Cells sown while a claim reached into them: when none does, they grow back. */
  const claimed = new Set<number>();
  const touched = (key: number) => {
    if (!claims) return false;
    const ix = ixOf(key),
      iz = izOf(key);
    return claims.touches(ix * size, iz * size, (ix + 1) * size, (iz + 1) * size);
  };

  const forget = (key: number) => {
    const held = live.get(key);
    if (!held) return false;
    trees -= held.length;
    live.delete(key);
    stale.delete(key);
    claimed.delete(key);
    return true;
  };

  /**
   * Plans and roads the cells were sown around. A new one has the cells it
   * reaches into sown again -- the cells its claims touch, not its whole box,
   * which for a road between settlements is kilometres of land it never
   * crosses -- and one that has gone has the cells it cleared sown again, so a
   * cell is a function of its coordinates and the claims over it now.
   */
  const accounted = new Set<string>();
  const account = (x: number, z: number) => {
    if (!claims) return;
    const plans = claims.plans;
    for (const plan of plans) {
      if (accounted.has(plan.id)) continue;
      accounted.add(plan.id);
      // only as far as the far land reaches: a road's box can be fourteen kilometres
      const x0 = Math.max(plan.x0, x - radius),
        x1 = Math.min(plan.x1, x + radius),
        z0 = Math.max(plan.z0, z - radius),
        z1 = Math.min(plan.z1, z + radius);
      for (let iz = Math.floor(z0 / size); iz <= Math.floor(z1 / size); iz++)
        for (let ix = Math.floor(x0 / size); ix <= Math.floor(x1 / size); ix++) {
          const key = keyOf(ix, iz);
          if (live.has(key) && touched(key)) stale.add(key);
        }
    }
    if (accounted.size > plans.length)
      for (const id of accounted) if (!plans.some((plan) => plan.id === id)) accounted.delete(id);
    for (const key of claimed) if (!touched(key)) stale.add(key);
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
      account(x, z);
      for (const key of stale)
        distance.set(key, Math.hypot((ixOf(key) + 0.5) * size - x, (izOf(key) + 0.5) * size - z));
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
        if (!wanted.has(key) || (live.has(key) && !stale.has(key))) continue;
        current = [];
        if (sowing.enter(ixOf(key), izOf(key))) sowing.sowTrees();
        // the old trees of a stale cell go only now, as the new ones arrive
        trees += current.length - (live.get(key)?.length ?? 0);
        live.set(key, current);
        stale.delete(key);
        if (touched(key)) claimed.add(key);
        else claimed.delete(key);
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

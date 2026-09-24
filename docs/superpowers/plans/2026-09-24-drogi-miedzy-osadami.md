# Drogi między osadami (etap 2) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** osady na wspólnym lądzie łączy kręta droga widoczna z wysokości. Każda droga kończy się osadą z obu stron, więc lecąc wzdłuż niej trafia się na zabudowania.

**Architektura:**
- **Graf.** Czysty moduł `scenery/RoadNetwork.ts` wybiera pary osad grafem sąsiedztwa względnego.
- **Trasa.** Czysty moduł `scenery/Route.ts` wyznacza trasę: A* po wysokości bazowej, potem kształt zależny od terenu.
- **Menedżer.** `scenery/Roads.ts` odkrywa osady (`Sites.charted`), zleca trasy workerowi (`routes.worker.ts`), trzyma je w pamięci podręcznej i przycina ich końce do ulic planu.
- **Ring.** Zajmuje grunt drogi w `Claims` (przesieka dla drzew, pas dla trawy) i podaje ją zlewowi.
- **Rysowanie.** Pools rysuje drogę kawałkami po ok. 1 km materiałem, który poszerza dalekie odcinki i wygasza je na krawędzi pierścienia. Kolor drogi pochodzi z kraju (`params.road`).

**Stack:** Vite, TypeScript, JavaScript z JSDoc (`library/`), Vitest, Playwright, three 0.185.1 (`three/webgpu`, TSL), Web Worker.

**Specyfikacja:** `docs/superpowers/specs/2026-09-24-osady-w-kraju-i-drogi-design.md`, sekcja 5. Etap 1 (gałąź `claude/settlements-in-country`) jest bazą tej gałęzi (`claude/settlement-roads`).

## Ograniczenia globalne

- Kod, identyfikatory, komentarze i commity po angielsku, w stylu otaczającego kodu. Commit kończy się linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Moduły czystego CPU (`RoadNetwork.ts`, `Route.ts`, części `Roads.ts` bez workera) nie importują `three/webgpu`, `three/tsl` ani DOM. Worker importuje tylko `Route.ts` i `WorldSampler.ts`.
- Trasa jest czystą funkcją seeda i pary osad: wychodzi ta sama bez względu na to, skąd nadlatuje lot.
- Siatka nie przekracza 8 buforów wierzchołków; wstęga drogi ma ich 5.
- Szerokość drogi między osadami: 5 m. Limit długości krawędzi: 14 km. Korytarz A*: bbox pary + 3 km. Siatka A*: 48 m. Morze: grunt poniżej 3 m to ściana. Objazd dłuższy niż 2,5 × linia prosta odpada.
- Po każdym zadaniu `npm run typecheck && npm run lint && npm test` jest zielone; na końcu `npm run check` i testy e2e dróg.

## Mapa plików

| Plik | Rola | Zadanie |
| --- | --- | --- |
| `src/engine/scenery/RoadNetwork.ts` (nowy) | graf sąsiedztwa względnego | 1 |
| `src/engine/scenery/Route.ts` (nowy) | A*, kształt, krętość | 2, 3 |
| `src/engine/scenery/Sites.ts` | `charted`: obsadzanie bez kolejki planów | 4 |
| `src/engine/scenery/Roads.ts` (nowy) | menedżer tras, `stretchOf`, `chunksOf` | 4 |
| `src/engine/scenery/routes.worker.ts` (nowy) | worker trasy | 4 |
| `src/engine/scenery/Claims.ts` | `addRoute` | 5 |
| `src/engine/scenery/Ring.ts` | trasy w indeksie i w zlewie | 5 |
| `src/engine/scenery/RoadKit.ts` | kolor z kraju per wierzchołek, atrybut `spread` | 6 |
| `src/engine/scenery/Painted.ts` | materiał `road` (poszerzanie, zanik) | 6 |
| `src/engine/scenery/Pools.ts` | wstęgi tras kawałkami | 6 |
| `src/engine/scenery/Scenery.ts` | tworzenie `Roads`, statystyki | 6 |
| `library/biomes/*.js` | `params.road` | 6 |
| `tests/e2e/smoke.spec.ts`, `AGENTS.md` | przeglądarka, dokumentacja | 7 |

---

### Zadanie 1: graf sąsiedztwa względnego

**Pliki:**
- Utwórz: `src/engine/scenery/RoadNetwork.ts`
- Test: `tests/unit/roadNetwork.test.ts`

**Interfejsy — produkuje:**

```ts
export const MAX_EDGE = 14000;
export interface NetworkSite { id: string; x: number; z: number; radius: number }
export interface Edge<S extends NetworkSite = NetworkSite> { id: string; a: S; b: S; length: number }
export function relativeNeighbours<S extends NetworkSite>(sites: readonly S[], maxEdge?: number): Edge<S>[];
```

`a` to osada o mniejszym id (porównanie `<` na stringach), a `id` krawędzi to `${a.id}|${b.id}`.

- [ ] **Krok 1: napisz test, który nie przejdzie**

```ts
import { describe, expect, it } from 'vitest';
import { MAX_EDGE, relativeNeighbours } from '../../src/engine/scenery/RoadNetwork';

const site = (id: string, x: number, z: number) => ({ id, x, z, radius: 150 });

describe('relativeNeighbours', () => {
  it('joins two places and not the long side of a triangle with a place between', () => {
    // a and c are 8 km apart with b half way: a road a-c would run beside a-b-c
    const a = site('a', 0, 0),
      b = site('b', 4000, 300),
      c = site('c', 8000, 0);
    const ids = relativeNeighbours([a, b, c]).map((e) => e.id);
    expect(ids.sort()).toEqual(['a|b', 'b|c']);
  });

  it('keeps a fair triangle whole, because no corner is nearer both others', () => {
    const ids = relativeNeighbours([site('a', 0, 0), site('b', 6000, 0), site('c', 3000, 5200)]).map((e) => e.id);
    expect(ids.sort()).toEqual(['a|b', 'a|c', 'b|c']);
  });

  it('builds no road longer than the limit', () => {
    expect(relativeNeighbours([site('a', 0, 0), site('b', MAX_EDGE + 1, 0)])).toEqual([]);
    expect(relativeNeighbours([site('a', 0, 0), site('b', MAX_EDGE - 1, 0)])).toHaveLength(1);
  });

  it('names an edge by its ends in one order, whichever order they came in', () => {
    const [edge] = relativeNeighbours([site('zeta', 0, 0), site('alpha', 5000, 0)]);
    expect(edge!.id).toBe('alpha|zeta');
    expect(edge!.a.id).toBe('alpha');
    expect(edge!.length).toBeCloseTo(5000, 6);
  });

  it('is the same graph from any list the same places are in', () => {
    const places = Array.from({ length: 30 }, (_, i) =>
      site(`s${i}`, Math.sin(i * 12.9898) * 20000, Math.cos(i * 78.233) * 20000),
    );
    const one = relativeNeighbours(places).map((e) => e.id).sort();
    const two = relativeNeighbours([...places].reverse()).map((e) => e.id).sort();
    expect(two).toEqual(one);
    expect(one.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/roadNetwork.test.ts`. Oczekiwane: FAIL, brak modułu.

- [ ] **Krok 3: implementacja**

```ts
// Which settlements a road joins: the relative neighbourhood graph. Two places
// are joined when no third is nearer to both of them than they are to each
// other, which is the graph a road network grows into -- no triangle whose
// long side runs beside its two short ones, and the shortest link between any
// two clusters kept. It is decided by the places within one edge of both ends
// and nothing else, so a flight that sees the same neighbourhood draws the
// same roads whichever way it arrived. Pure CPU: no three, no DOM.

/** The longest road, m: two and a half village cells, three minutes of flying. */
export const MAX_EDGE = 14000;

export interface NetworkSite {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface Edge<S extends NetworkSite = NetworkSite> {
  /** `a.id|b.id`, the ends in one order. */
  id: string;
  /** The end with the smaller id: a route is always walked from it. */
  a: S;
  b: S;
  length: number;
}

/**
 * The graph over `sites`. It is only complete for a pair whose every rival --
 * a place within `length` of both ends -- is in the list, so the caller hands
 * in the places around the pairs it asks about, one edge further out.
 */
export function relativeNeighbours<S extends NetworkSite>(sites: readonly S[], maxEdge = MAX_EDGE): Edge<S>[] {
  const edges: Edge<S>[] = [];
  for (let i = 0; i < sites.length; i++)
    for (let j = i + 1; j < sites.length; j++) {
      const p = sites[i]!,
        q = sites[j]!;
      const length = Math.hypot(p.x - q.x, p.z - q.z);
      if (length > maxEdge) continue;
      let blocked = false;
      for (let k = 0; k < sites.length && !blocked; k++) {
        if (k === i || k === j) continue;
        const c = sites[k]!;
        blocked = Math.max(Math.hypot(p.x - c.x, p.z - c.z), Math.hypot(q.x - c.x, q.z - c.z)) < length;
      }
      if (blocked) continue;
      const [a, b] = p.id < q.id ? [p, q] : [q, p];
      edges.push({ id: `${a.id}|${b.id}`, a, b, length });
    }
  return edges;
}
```

- [ ] **Krok 4: testy, lint, commit**

```bash
npx vitest run tests/unit/roadNetwork.test.ts && npm run typecheck && npx eslint src/engine/scenery/RoadNetwork.ts tests/unit/roadNetwork.test.ts && npx prettier --write src/engine/scenery/RoadNetwork.ts tests/unit/roadNetwork.test.ts
git add src/engine/scenery/RoadNetwork.ts tests/unit/roadNetwork.test.ts
git commit -m "Which settlements a road joins: the relative neighbourhood graph

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 2: trasa po terenie (A*)

**Pliki:**
- Utwórz: `src/engine/scenery/Route.ts`
- Test: `tests/unit/route.test.ts`

**Interfejsy — produkuje:**

```ts
export const ROUTE: {
  grid: number; pad: number; sea: number; maxGrade: number; gradeCost: number;
  wander: { scale: number; weight: number; salt: number; flat: [number, number] };
  detour: number;
};
export interface RouteEnd { id: string; x: number; z: number }
export type HeightAt = (x: number, z: number) => number;
/** The grid path from the end with the smaller id to the other, or null: no land way within the corridor, or only a detour. */
export function pathBetween(a: RouteEnd, b: RouteEnd, heightAt: HeightAt, seed: number): Array<[number, number]> | null;
```

- [ ] **Krok 1: napisz test, który nie przejdzie**

```ts
import { describe, expect, it } from 'vitest';
import { ROUTE, pathBetween } from '../../src/engine/scenery/Route';

/** Rolling land with a sea to the south of z = -3000. */
const land = (x: number, z: number) => (z < -3000 ? -20 : 60 + 25 * Math.sin(x / 700) * Math.cos(z / 900));
const a = { id: 'village:0,0', x: 0, z: 0 },
  b = { id: 'village:1,0', x: 6000, z: 1500 };
const length = (p: Array<[number, number]>) =>
  p.slice(1).reduce((sum, q, i) => sum + Math.hypot(q[0] - p[i]![0], q[1] - p[i]![1]), 0);

describe('pathBetween', () => {
  it('walks from the end with the smaller id to the other, whichever is asked first', () => {
    const one = pathBetween(a, b, land, 42)!,
      two = pathBetween(b, a, land, 42)!;
    expect(one).not.toBeNull();
    expect(two).toEqual(one);
    expect(one[0]).toEqual([a.x, a.z]);
    expect(one.at(-1)).toEqual([b.x, b.z]);
  });

  it('keeps to land and to a grade a road can take', () => {
    const path = pathBetween(a, b, land, 42)!;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!,
        [x1, z1] = path[i]!;
      expect(land(x1, z1)).toBeGreaterThanOrEqual(ROUTE.sea);
      const run = Math.hypot(x1 - x0, z1 - z0);
      if (i > 1 && i < path.length - 1)
        expect(Math.abs(land(x1, z1) - land(x0, z0)) / run).toBeLessThanOrEqual(ROUTE.maxGrade + 1e-9);
    }
    expect(length(path)).toBeLessThan(Math.hypot(b.x - a.x, b.z - a.z) * ROUTE.detour);
  });

  it('finds no road across the sea', () => {
    expect(pathBetween(a, { id: 'village:0,-2', x: 0, z: -9000 }, land, 42)).toBeNull();
  });

  it('bends on the flat, where nothing else would make it', () => {
    const flat = () => 50;
    const path = pathBetween(a, { id: 'village:1,0', x: 8000, z: 0 }, flat, 42)!;
    // a ruler would keep every point on z = 0
    expect(Math.max(...path.map((p) => Math.abs(p[1])))).toBeGreaterThan(ROUTE.grid);
  });
});
```

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/route.test.ts`. Oczekiwane: FAIL, brak modułu.

- [ ] **Krok 3: implementacja A***

`src/engine/scenery/Route.ts`:

```ts
// The road between two settlements, as a pure function of the seed and the
// pair. A* over the base height on a grid, from the end with the smaller id,
// so the road is the same whichever way the flight came to it: a road that
// depended on the approach would move under a flyer who turned round.
//
// The cost is the road's own: the run, a grade that costs its square and is
// refused past `maxGrade` so a hillside is climbed in turns, and on the flat a
// slow noise that stands for everything the terrain does not say -- a wet
// meadow, somebody's field -- without which a road on a plain is a ruler.
// Pure CPU: no three, no DOM; the worker runs it off the main thread.
import { fbm, hash2, sstep } from '../terrain/noise';

export const ROUTE = {
  /** Metres between the nodes the search walks. */
  grid: 48,
  /** How far outside the pair's own box the search may go, m. */
  pad: 3000,
  /** Ground under this is sea, and a wall. */
  sea: 3,
  /** The steepest grade a road takes; a hillside past it is climbed in turns. */
  maxGrade: 0.12,
  /** What a grade costs, on top of the run: `run * gradeCost * grade^2`. */
  gradeCost: 40,
  /**
   * The flat's own reasons to bend. `weight` is the most it adds to a metre;
   * it fades out between the two grades of `flat`, where the terrain starts to
   * give the road reasons of its own.
   */
  wander: { scale: 600, weight: 0.8, salt: 0x70ad, flat: [0.02, 0.08] as [number, number] },
  /** A road longer than this times the straight line is a detour round a bay, and is not built. */
  detour: 2.5,
};

export interface RouteEnd {
  id: string;
  x: number;
  z: number;
}
export type HeightAt = (x: number, z: number) => number;

const STEPS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** A pair's own salt, from both ids: two roads never wander alike. */
export function pairSalt(a: RouteEnd, b: RouteEnd, seed: number): number {
  let h = seed | 0;
  for (const c of `${a.id}|${b.id}`) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return hash2(h, 0x5eed, 0x7a11) & 0xffff;
}

export function pathBetween(
  first: RouteEnd,
  second: RouteEnd,
  heightAt: HeightAt,
  seed: number,
): Array<[number, number]> | null {
  const [a, b] = first.id < second.id ? [first, second] : [second, first];
  const { grid, pad, sea, maxGrade, gradeCost, wander } = ROUTE;
  const salt = pairSalt(a, b, seed);
  // The grid is the world's, not the pair's: its nodes sit on multiples of the
  // step, so two roads out of one village share their first metres of lattice.
  const x0 = Math.floor((Math.min(a.x, b.x) - pad) / grid) * grid,
    z0 = Math.floor((Math.min(a.z, b.z) - pad) / grid) * grid;
  const w = Math.ceil((Math.max(a.x, b.x) + pad - x0) / grid) + 1,
    h = Math.ceil((Math.max(a.z, b.z) + pad - z0) / grid) + 1;
  const n = w * h;
  const height = new Float32Array(n).fill(Number.NaN);
  const heightOf = (i: number) => {
    if (Number.isNaN(height[i]!)) height[i] = heightAt(x0 + (i % w) * grid, z0 + Math.floor(i / w) * grid);
    return height[i]!;
  };
  const node = (x: number, z: number) => Math.round((z - z0) / grid) * w + Math.round((x - x0) / grid);
  const start = node(a.x, a.z),
    goal = node(b.x, b.z);
  if (heightOf(start) < sea || heightOf(goal) < sea) return null;
  const gx = goal % w,
    gz = Math.floor(goal / w);
  const guess = (i: number) => Math.hypot((i % w) - gx, Math.floor(i / w) - gz) * grid;

  const cost = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  // A binary heap of node and key, in two arrays: this runs over a hundred
  // thousand nodes and allocates nothing per step.
  const heap: number[] = [],
    keys: number[] = [];
  const push = (i: number, key: number) => {
    let c = heap.length;
    heap.push(i);
    keys.push(key);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (keys[p]! <= keys[c]!) break;
      [heap[p], heap[c]] = [heap[c]!, heap[p]!];
      [keys[p], keys[c]] = [keys[c]!, keys[p]!];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!,
      lastKey = keys.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      keys[0] = lastKey;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1,
          r = l + 1;
        let m = c;
        if (l < heap.length && keys[l]! < keys[m]!) m = l;
        if (r < heap.length && keys[r]! < keys[m]!) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c]!, heap[m]!];
        [keys[m], keys[c]] = [keys[c]!, keys[m]!];
        c = m;
      }
    }
    return top;
  };

  cost[start] = 0;
  push(start, guess(start));
  while (heap.length > 0) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    const ix = i % w,
      iz = Math.floor(i / w),
      hi = heightOf(i);
    for (const [dx, dz] of STEPS) {
      const jx = ix + dx,
        jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      if (closed[j]) continue;
      const hj = heightOf(j);
      if (hj < sea) continue;
      const run = Math.hypot(dx, dz) * grid,
        grade = Math.abs(hj - hi) / run;
      // The first and last steps leave and enter a settlement, whose plateau is
      // not in the base height: they may take any grade.
      if (grade > maxGrade && i !== start && j !== goal) continue;
      const mx = x0 + (ix + dx / 2) * grid,
        mz = z0 + (iz + dz / 2) * grid;
      const field = (fbm(mx / wander.scale, mz / wander.scale, salt, 3) + 1) / 2;
      const flat = 1 - sstep(wander.flat[0], wander.flat[1], grade);
      const next = cost[i]! + run * (1 + gradeCost * grade * grade + wander.weight * field * flat);
      if (next < cost[j]!) {
        cost[j] = next;
        from[j] = i;
        push(j, next + guess(j));
      }
    }
  }
  if (from[goal] === -1) return null;
  const path: Array<[number, number]> = [];
  for (let i = goal; i !== -1; i = from[i]!) path.push([x0 + (i % w) * grid, z0 + Math.floor(i / w) * grid]);
  path.reverse();
  path[0] = [a.x, a.z];
  path[path.length - 1] = [b.x, b.z];
  let length = 0;
  for (let i = 1; i < path.length; i++)
    length += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]);
  if (length > ROUTE.detour * Math.hypot(b.x - a.x, b.z - a.z)) return null;
  return path;
}
```

Uwaga do testu spadku: pierwszy i ostatni krok pomija się, bo zostały zastąpione dokładnymi środkami osad. Test o spadku sprawdza tylko węzły siatki, a dokładny limit gradientu dotyczy kroku siatki.

- [ ] **Krok 4: uruchom testy**

Uruchom: `npx vitest run tests/unit/route.test.ts`. Oczekiwane: PASS, 4 testy. Jeśli test „bends on the flat" nie przejdzie, podnieś `wander.weight` (0,8 → 1,2) i zapisz, jakie odchylenie wyszło.

- [ ] **Krok 5: commit**

```bash
npm run typecheck && npx eslint src/engine/scenery/Route.ts tests/unit/route.test.ts && npx prettier --write src/engine/scenery/Route.ts tests/unit/route.test.ts
git add src/engine/scenery/Route.ts tests/unit/route.test.ts
git commit -m "A road between two settlements, searched over the ground

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 3: kształt trasy i krętość zależna od terenu

**Pliki:**
- Zmień: `src/engine/scenery/Route.ts`
- Test: `tests/unit/route.test.ts`, nowy `tests/unit/routeWinding.test.ts`

**Interfejsy — produkuje:**

```ts
export const SHAPE: {
  sample: number; chaikin: number;
  meander: { amplitude: number; wavelength: number; salt: number; taper: number; steep: [number, number] };
  turn: { radius: number; steep: number; steepSlope: number; passes: number };
  probe: number;
};
/** The road a flight follows: the path, rounded, meandered on the flat, sampled every SHAPE.sample m. */
export function routeBetween(a: RouteEnd, b: RouteEnd, heightAt: HeightAt, seed: number): Array<[number, number]> | null;
```

- [ ] **Krok 1: testy kształtu, które nie przejdą**

Dopisz do `tests/unit/route.test.ts` (i zaimportuj `SHAPE`, `routeBetween`):

```ts
describe('routeBetween', () => {
  const turn = (p: Array<[number, number]>, i: number) => {
    const [ax, az] = p[i - 1]!,
      [bx, bz] = p[i]!,
      [cx, cz] = p[i + 1]!;
    const u = Math.atan2(bz - az, bx - ax),
      v = Math.atan2(cz - bz, cx - bx);
    return Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
  };

  it('is the path rounded and sampled, and the same from both ends', () => {
    const one = routeBetween(a, b, land, 42)!,
      two = routeBetween(b, a, land, 42)!;
    expect(two).toEqual(one);
    expect(one[0]![0]).toBeCloseTo(a.x, 6);
    expect(one.at(-1)![0]).toBeCloseTo(b.x, 6);
    for (let i = 1; i < one.length - 1; i++) {
      const step = Math.hypot(one[i]![0] - one[i - 1]![0], one[i]![1] - one[i - 1]![1]);
      expect(step).toBeLessThanOrEqual(SHAPE.sample + 1e-6);
    }
  });

  it('turns no tighter than a road can', () => {
    const path = routeBetween(a, b, land, 42)!;
    // on this rolling land the slope never reaches the serpentine's, so every
    // bend is held to the open radius
    const limit = SHAPE.sample / SHAPE.turn.radius;
    for (let i = 1; i < path.length - 1; i++) expect(turn(path, i)).toBeLessThanOrEqual(limit * 1.05);
  });

  it('keeps near its grade after the rounding, and off the sea', () => {
    const path = routeBetween(a, b, land, 42)!;
    for (let i = 1; i < path.length; i++) {
      const [x0, z0] = path[i - 1]!,
        [x1, z1] = path[i]!;
      expect(land(x1, z1)).toBeGreaterThanOrEqual(ROUTE.sea);
      const run = Math.hypot(x1 - x0, z1 - z0);
      if (run > 1) expect(Math.abs(land(x1, z1) - land(x0, z0)) / run).toBeLessThanOrEqual(ROUTE.maxGrade * 1.6);
    }
  });

  it('meanders on the flat and runs straighter up a hillside', () => {
    const flat = () => 50;
    const onFlat = routeBetween(a, { id: 'village:1,0', x: 8000, z: 0 }, flat, 42)!;
    const wiggle = (p: Array<[number, number]>) => {
      let sum = 0;
      for (let i = 1; i < p.length - 1; i++) sum += turn(p, i);
      return sum / (p.length - 2);
    };
    expect(wiggle(onFlat)).toBeGreaterThan(0.01);
  });
});
```

- [ ] **Krok 2: test krętości na prawdziwym świecie**

`tests/unit/routeWinding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { relativeNeighbours } from '../../src/engine/scenery/RoadNetwork';
import { ROUTE, routeBetween } from '../../src/engine/scenery/Route';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createSites } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/** Every road around the middle of a world, with how much it winds and over what ground. */
const roads = (seed: number) => {
  const library = createLibrary();
  const sampler = createWorldSampler(seed, { biomes: library.biomes });
  const sites = createSites({ library, sampler, heightfield: createHeightfield(sampler), overrides: createOverrides([]) });
  const out = new Float64Array(5);
  const heightAt = (x: number, z: number) => (sampler.baseFields(x, z, out), out[0]!);
  const slope = (x: number, z: number) =>
    Math.hypot(heightAt(x + 60, z) - heightAt(x - 60, z), heightAt(x, z + 60) - heightAt(x, z - 60)) / 120;
  const places = sites.near(0, 0, 30000, []);
  return relativeNeighbours(places)
    .filter((e) => Math.hypot(e.a.x, e.a.z) < 16000)
    .map((edge) => {
      const path = routeBetween(edge.a, edge.b, heightAt, seed);
      let relief = 0;
      for (let t = 0.1; t < 0.95; t += 0.1) relief += slope(edge.a.x + (edge.b.x - edge.a.x) * t, edge.a.z + (edge.b.z - edge.a.z) * t);
      const length = path ? path.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - path[i]![0], q[1] - path[i]![1]), 0) : 0;
      return { edge, path, relief: relief / 9, winding: path ? length / edge.length : Number.NaN };
    });
};

const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)] ?? Number.NaN;

describe('how a road winds', () => {
  it('winds gently on the flat, more in the hills, and most in the mountains', () => {
    const all = [42, 7, 1234].flatMap(roads).filter((r) => r.path);
    const flat = all.filter((r) => r.relief < 0.05).map((r) => r.winding),
      hills = all.filter((r) => r.relief >= 0.05 && r.relief < 0.15).map((r) => r.winding),
      steep = all.filter((r) => r.relief >= 0.15).map((r) => r.winding);
    expect(flat.length + hills.length + steep.length).toBeGreaterThan(20);
    if (flat.length > 2) {
      expect(median(flat)).toBeGreaterThan(1.1);
      expect(median(flat)).toBeLessThan(1.25);
    }
    if (hills.length > 2) {
      expect(median(hills)).toBeGreaterThan(1.15);
      expect(median(hills)).toBeLessThan(1.4);
    }
    if (steep.length > 2) expect(median(steep)).toBeLessThan(1.8);
  });

  it('joins most of the pairs a steeper road would have joined', () => {
    // The spec's rule for the grade limit: 12% may refuse no more than one pair
    // in ten that a 25% road joins.
    const pairs = [42, 7, 1234].flatMap(roads);
    const joined = pairs.filter((r) => r.path).length;
    const was = ROUTE.maxGrade;
    ROUTE.maxGrade = 0.25;
    const looser = [42, 7, 1234].flatMap(roads).filter((r) => r.path).length;
    ROUTE.maxGrade = was;
    expect(joined).toBeGreaterThanOrEqual(Math.floor(looser * 0.9));
  });
});
```

`ROUTE` musi być zwykłym obiektem, nie `as const`, żeby test mógł zmienić `maxGrade`. W zadaniu 2 tak jest.

- [ ] **Krok 3: uruchom i sprawdź, że nie przechodzą**

Uruchom: `npx vitest run tests/unit/route.test.ts tests/unit/routeWinding.test.ts`. Oczekiwane: FAIL, brak `routeBetween`.

- [ ] **Krok 4: implementacja kształtu**

Dopisz w `src/engine/scenery/Route.ts`:

```ts
export const SHAPE = {
  /** Metres between the points of the finished road. */
  sample: 24,
  /** Rounding passes over the grid's stairs: Chaikin's, which cuts corners and never straightens a bend. */
  chaikin: 2,
  /**
   * A country road's own sway: a few metres off its line, a few hundred metres
   * a wave, and none of it on a hillside, where the terrain already bends it
   * and a sway would only add a grade. It tapers to nothing at the two ends, so
   * the road meets a settlement's street straight.
   */
  meander: { amplitude: 9, wavelength: 350, salt: 0x3ea7, taper: 200, steep: [0.04, 0.12] as [number, number] },
  /**
   * The tightest bend, m: 40 in open country, 20 on a slope steeper than
   * `steepSlope`, where a serpentine's hairpin is what a road does.
   */
  turn: { radius: 40, steep: 20, steepSlope: 0.15, passes: 24 },
  /** Metres either side the slope under a point is measured across. */
  probe: 60,
};

/** Chaikin's corner cutting, the two ends kept where they are. */
function chaikin(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;
  const out: Array<[number, number]> = [points[0]!];
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!,
      [x1, z1] = points[i + 1]!;
    out.push([x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25], [x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75]);
  }
  out.push(points.at(-1)!);
  return out;
}

/** The polyline walked every `step` metres, its two ends included. */
function resample(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [points[0]!];
  let carry = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!,
      [x1, z1] = points[i + 1]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    let at = step - carry;
    while (at < length) {
      const t = at / length;
      out.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
      at += step;
    }
    carry = length - (at - step);
  }
  const last = points.at(-1)!,
    tail = out.at(-1)!;
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.25) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

export function routeBetween(
  first: RouteEnd,
  second: RouteEnd,
  heightAt: HeightAt,
  seed: number,
): Array<[number, number]> | null {
  const path = pathBetween(first, second, heightAt, seed);
  if (!path) return null;
  const [a, b] = first.id < second.id ? [first, second] : [second, first];
  const salt = pairSalt(a, b, seed) ^ SHAPE.meander.salt;
  let points = path;
  for (let k = 0; k < SHAPE.chaikin; k++) points = chaikin(points);
  points = resample(points, SHAPE.sample);
  const slopeAt = (x: number, z: number) => {
    const p = SHAPE.probe;
    return Math.hypot(heightAt(x + p, z) - heightAt(x - p, z), heightAt(x, z + p) - heightAt(x, z - p)) / (2 * p);
  };
  const slopes = points.map(([x, z]) => slopeAt(x, z));

  // The sway: across the road, by a slow noise of the distance walked.
  const total = (points.length - 1) * SHAPE.sample;
  const { amplitude, wavelength, taper, steep } = SHAPE.meander;
  const swayed = points.map(([x, z], i): [number, number] => {
    if (i === 0 || i === points.length - 1) return [x, z];
    const [px, pz] = points[i - 1]!,
      [nx, nz] = points[i + 1]!;
    const dx = nx - px,
      dz = nz - pz,
      d = Math.hypot(dx, dz) || 1;
    const along = i * SHAPE.sample;
    const ends = sstep(0, taper, along) * sstep(0, taper, total - along);
    const open = 1 - sstep(steep[0], steep[1], slopes[i]!);
    const offset = amplitude * ends * open * fbm(along / wavelength, 0.5, salt, 2);
    return [x - (dz / d) * offset, z + (dx / d) * offset];
  });

  // The bends a road cannot take are eased: a point that turns the road more
  // than its radius allows moves half way to its neighbours' middle, and the
  // pass repeats until none does.
  const out = swayed;
  for (let pass = 0; pass < SHAPE.turn.passes; pass++) {
    let eased = false;
    for (let i = 1; i < out.length - 1; i++) {
      const [ax, az] = out[i - 1]!,
        [bx, bz] = out[i]!,
        [cx, cz] = out[i + 1]!;
      const u = Math.atan2(bz - az, bx - ax),
        v = Math.atan2(cz - bz, cx - bx);
      const angle = Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
      const radius = slopes[i]! > SHAPE.turn.steepSlope ? SHAPE.turn.steep : SHAPE.turn.radius;
      if (angle <= SHAPE.sample / radius) continue;
      out[i] = [bx + ((ax + cx) / 2 - bx) * 0.5, bz + ((az + cz) / 2 - bz) * 0.5];
      eased = true;
    }
    if (!eased) break;
  }
  return out;
}
```

- [ ] **Krok 5: uruchom testy i stroj**

Uruchom: `npx vitest run tests/unit/route.test.ts tests/unit/routeWinding.test.ts`.

Jeśli testy krętości nie mieszczą się w celach, stroj tylko te liczby, w tej kolejności:
1. `ROUTE.wander.weight` dla płaskiego: więcej, gdy mediana < 1,1; mniej, gdy > 1,25.
2. `ROUTE.gradeCost` dla wzgórz.
3. `ROUTE.maxGrade` dla gór i łączności. Jeśli drugi test odrzuci ponad 10% par, podnoś limit o 0,02 aż do spełnienia.

Każdą zmienioną liczbę opisz w komentarzu przy niej: co zmierzono i dlaczego tyle. Jeśli „turns no tighter" nie przechodzi po 24 przejściach, podnieś `passes` do 48.

- [ ] **Krok 6: commit**

```bash
npm run typecheck && npx eslint src/engine/scenery/Route.ts tests/unit/route.test.ts tests/unit/routeWinding.test.ts && npx prettier --write src/engine/scenery/Route.ts tests/unit/route.test.ts tests/unit/routeWinding.test.ts
git add src/engine/scenery/Route.ts tests/unit/route.test.ts tests/unit/routeWinding.test.ts
git commit -m "A road rounds its grid, sways on the flat and turns in hairpins on a slope

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 4: `Sites.charted`, menedżer tras i worker

**Pliki:**
- Zmień: `src/engine/scenery/Sites.ts`
- Utwórz: `src/engine/scenery/Roads.ts`, `src/engine/scenery/routes.worker.ts`
- Test: `tests/unit/sites.test.ts`, nowy `tests/unit/roads.test.ts`

**Interfejsy:**
- Konsumuje: `relativeNeighbours`, `MAX_EDGE` (zadanie 1); `routeBetween` (zadanie 3); `Site`, `Sites`, `SitePlan`.
- Produkuje:

```ts
// Sites
charted(x: number, z: number, reach: number, out: Site[]): Site[];

// Roads.ts
export const ROUTE_WIDTH = 5;
export interface RoadRoute { id: string; a: Site; b: Site; points: Array<[number, number]> }
export interface RouteJob { id: string; seed: number; a: { id: string; x: number; z: number }; b: { id: string; x: number; z: number } }
export type RouteRunner = (job: RouteJob, done: (points: Array<[number, number]> | null) => void) => () => void;
export interface Roads {
  update(x: number, z: number): void;
  near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[];
  readonly version: number;
  readonly built: number;
  readonly queued: number;
  readonly refused: number;
  dispose(): void;
}
export function createRoads(deps: { seed: number; sites: Sites; run?: RouteRunner; reach?: number }): Roads;
export function stretchOf(route: RoadRoute, planA: SitePlan | null, planB: SitePlan | null): Array<[number, number]>;
export function chunksOf(points: Array<[number, number]>, length?: number): Array<Array<[number, number]>>;
```

- [ ] **Krok 1: test `charted`, który nie przejdzie**

W `tests/unit/sites.test.ts` dopisz:

```ts
  it('charts the sites of a wide reach without queueing a plan for any of them', () => {
    const s = sites(library([village()]));
    const charted = s.charted(0, 0, 3000, []);
    expect(charted.length).toBeGreaterThan(0);
    expect(s.queued).toBe(0);
    // the same places the ring would find, by the same ids
    const found = s.near(0, 0, 3000, []).map((site) => site.id).sort();
    expect(charted.map((site) => site.id).sort()).toEqual(found);
  });
```

(Helper `sites(...)` i `village()` istnieją w tym pliku. Jeśli `sites` zwraca obiekt z dodatkowymi polami, dostosuj dostęp do `Sites` tak jak w sąsiednich testach.)

- [ ] **Krok 2: implementacja `charted`**

W `src/engine/scenery/Sites.ts` dopisz do interfejsu `Sites`:

```ts
  /**
   * Every site seated within `reach`, nearest first, and no plan queued for any
   * of them: what the road network plans between, tens of kilometres out,
   * where a plan would be built for nobody. Its own cache, forgotten past the
   * reach it was last asked for.
   */
  charted(x: number, z: number, reach: number, out: Site[]): Site[];
```

a w obiekcie zwracanym przez `createSites` (obok `near`), z nową mapą `const charts = new Map<string, Site | null>();` pod `found`:

```ts
    charted(x, z, reach, out) {
      out.length = 0;
      for (const [key, site] of charts)
        if (site && Math.hypot(site.x - x, site.z - z) > reach + KEEP_PAD) charts.delete(key);
      for (const entry of settled) {
        const cell = entry.spec.cell;
        const span = reach + entry.spec.radius[1];
        for (let gz = Math.floor((z - span) / cell); gz <= Math.floor((z + span) / cell); gz++)
          for (let gx = Math.floor((x - span) / cell); gx <= Math.floor((x + span) / cell); gx++) {
            const key = `${entry.biome.id}:${gx},${gz}`;
            let site = charts.get(key);
            if (site === undefined) {
              site = found.get(key) ?? seat(entry, gx, gz);
              charts.set(key, site);
            }
            if (site && Math.hypot(site.x - x, site.z - z) <= span) out.push(site);
          }
      }
      out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      return out;
    },
```

Puste komórki (`null`) daleko od punktu zapytania też trzeba zapominać. Klucz niesie `gx,gz`, więc filtr odrzucający komórki poza zasięgiem wygląda tak:

```ts
      for (const [key, site] of charts) {
        if (site) {
          if (Math.hypot(site.x - x, site.z - z) > reach + KEEP_PAD) charts.delete(key);
          continue;
        }
        const [, cellPart] = key.split(':');
        const [gx, gz] = cellPart!.split(',').map(Number);
        const cell = settled.find((e) => key.startsWith(`${e.biome.id}:`))!.spec.cell;
        if (Math.hypot((gx! + 0.5) * cell - x, (gz! + 0.5) * cell - z) > reach + KEEP_PAD + cell) charts.delete(key);
      }
```

Użyj tej pętli zamiast pierwszej.

Uruchom: `npx vitest run tests/unit/sites.test.ts`. Oczekiwane: PASS.

- [ ] **Krok 3: testy `Roads`, które nie przejdą**

`tests/unit/roads.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SitePlan } from '../../library/contract';
import type { Site, Sites } from '../../src/engine/scenery/Sites';
import { chunksOf, createRoads, stretchOf, type RoadRoute, type RouteRunner } from '../../src/engine/scenery/Roads';

const site = (id: string, x: number, z: number, radius = 200): Site => ({
  id,
  biome: 'village',
  x,
  z,
  radius,
  yaw: 0,
  fields: {} as Site['fields'],
  random: () => 0.5,
});

/** Sites that are exactly these places, charted wherever asked. */
const fixed = (places: Site[]): Sites =>
  ({
    charted: (x: number, z: number, reach: number, out: Site[]) => {
      out.length = 0;
      out.push(...places.filter((p) => Math.hypot(p.x - x, p.z - z) <= reach));
      return out;
    },
  }) as unknown as Sites;

/** A runner that answers at once with the straight line, and counts what it was asked. */
const straight = (asked: string[]): RouteRunner => (job, done) => {
  asked.push(job.id);
  done([
    [job.a.x, job.a.z],
    [job.b.x, job.b.z],
  ]);
  return () => {};
};

describe('createRoads', () => {
  const places = [site('village:0,0', 0, 0), site('village:1,0', 6000, 0), site('village:2,0', 12000, 0)];

  it('asks for the roads near the flight, once each, and hands them out', () => {
    const asked: string[] = [];
    const roads = createRoads({ seed: 42, sites: fixed(places), run: straight(asked) });
    roads.update(0, 0);
    roads.update(10, 10);
    expect(asked.sort()).toEqual(['village:0,0|village:1,0', 'village:1,0|village:2,0']);
    expect(roads.built).toBe(2);
    expect(roads.version).toBe(2);
    const near = roads.near(0, 0, 2600, []);
    expect(near.map((r) => r.id)).toEqual(['village:0,0|village:1,0']);
    expect(near[0]!.a.id).toBe('village:0,0');
  });

  it('counts a pair with no land way between as refused, and does not ask again', () => {
    const asked: string[] = [];
    const never: RouteRunner = (job, done) => {
      asked.push(job.id);
      done(null);
      return () => {};
    };
    const roads = createRoads({ seed: 42, sites: fixed(places.slice(0, 2)), run: never });
    roads.update(0, 0);
    roads.update(2000, 0);
    expect(asked).toHaveLength(1);
    expect(roads.refused).toBe(1);
    expect(roads.near(0, 0, 2600, [])).toEqual([]);
  });
});

describe('stretchOf', () => {
  const a = site('village:0,0', 0, 0, 200),
    b = site('village:1,0', 6000, 0, 200);
  const route: RoadRoute = {
    id: 'village:0,0|village:1,0',
    a,
    b,
    points: Array.from({ length: 251 }, (_, i) => [i * 24, 0] as [number, number]),
  };
  const plan = (at: Site, street: Array<[number, number]>): SitePlan => ({
    id: at.id,
    x: at.x,
    z: at.z,
    radius: at.radius,
    roads: [{ points: street, width: 6 }],
    lines: [],
    lots: [],
    reservations: [],
  });

  it('stops at the edge of a settlement whose plan is not built yet', () => {
    const drawn = stretchOf(route, null, null);
    expect(drawn[0]![0]).toBeGreaterThanOrEqual(a.radius - 24);
    expect(drawn.at(-1)![0]).toBeLessThanOrEqual(b.x - b.radius + 24);
  });

  it('runs into the street once the plan is there, and ends on it', () => {
    // a street crossing the approach 120 m out from the centre
    const street: Array<[number, number]> = [
      [120, -150],
      [120, 150],
    ];
    const drawn = stretchOf(route, plan(a, street), null);
    expect(drawn[0]![0]).toBeCloseTo(120, 0);
    expect(Math.abs(drawn[0]![1])).toBeLessThan(1);
  });
});

describe('chunksOf', () => {
  it('cuts a road into pieces of about a kilometre that share their seams', () => {
    const points = Array.from({ length: 200 }, (_, i) => [i * 24, 0] as [number, number]);
    const chunks = chunksOf(points, 1000);
    expect(chunks.length).toBe(5);
    for (let k = 1; k < chunks.length; k++) expect(chunks[k]![0]).toEqual(chunks[k - 1]!.at(-1));
    expect(chunks.flat().length).toBe(points.length + chunks.length - 1);
  });
});
```

Uruchom: `npx vitest run tests/unit/roads.test.ts`. Oczekiwane: FAIL, brak modułu.

- [ ] **Krok 4: implementacja `Roads.ts`**

```ts
// The roads between settlements: which pairs, their routes, and what of each
// the ring draws. The routes are searched in a worker -- 14 to 45 ms each over
// nine thousand samples of the ground, which a frame cannot pay -- and kept
// here by pair. A pair is asked for once the flight is within reach of its
// line, nearest first; one that has no land way is remembered as refused, so
// an island does not ask again every time the flight passes.
//
// The worker is the default runner; a test hands in its own.
import type { SitePlan } from '../../../library/contract';
import { toPolyline } from '../../../library/settlements/geometry.js';
import { MAX_EDGE, relativeNeighbours } from './RoadNetwork';
import type { Site, Sites } from './Sites';

/** A road between settlements, m: a country road, narrower than a street. */
export const ROUTE_WIDTH = 5;
/** How far past the ring a pair is asked for, so a road is ready before it is seen, m. */
const LOOKAHEAD = 3000;
/** How far the flight moves before the network is looked at again, m. */
const DISCOVER_STEP = 1000;
/** Routes further than this beyond the reach are forgotten, m. */
const KEEP_PAD = 8000;
/** Where a route meets a street: this near the street's own edge, m. */
const MEET = 2;

export interface RoadRoute {
  id: string;
  a: Site;
  b: Site;
  points: Array<[number, number]>;
}
export interface RouteJob {
  id: string;
  seed: number;
  a: { id: string; x: number; z: number };
  b: { id: string; x: number; z: number };
}
export type RouteRunner = (job: RouteJob, done: (points: Array<[number, number]> | null) => void) => () => void;

export interface Roads {
  /** Looks at the network around (x, z) when the flight has moved far enough, and asks for what is missing. */
  update(x: number, z: number): void;
  /** The built routes whose line comes within `reach` of (x, z). */
  near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[];
  /** Grows by one whenever a route arrives: the ring rebuilds on it. */
  readonly version: number;
  readonly built: number;
  readonly queued: number;
  readonly refused: number;
  dispose(): void;
}

/** The distance from a point to a segment, m. */
const toSegment = (ax: number, az: number, bx: number, bz: number, x: number, z: number) =>
  toPolyline(
    [
      [ax, az],
      [bx, bz],
    ],
    x,
    z,
  );

/** One worker, one route at a time, in the order asked. */
const workerRunner = (): { run: RouteRunner; dispose(): void } => {
  let worker: Worker | null = null;
  const waiting = new Map<string, (points: Array<[number, number]> | null) => void>();
  const start = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./routes.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<{ id: string; points: Float64Array | null }>) => {
      const { id, points } = event.data;
      const done = waiting.get(id);
      waiting.delete(id);
      if (!done) return;
      if (!points) return done(null);
      const out: Array<[number, number]> = [];
      for (let i = 0; i < points.length; i += 2) out.push([points[i]!, points[i + 1]!]);
      done(out);
    });
    return worker;
  };
  return {
    run(job, done) {
      waiting.set(job.id, done);
      start().postMessage(job);
      return () => waiting.delete(job.id);
    },
    dispose() {
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
  };
};

export function createRoads(deps: { seed: number; sites: Sites; run?: RouteRunner; reach?: number }): Roads {
  const { seed, sites } = deps;
  const reach = deps.reach ?? 2600;
  const own = deps.run ? null : workerRunner();
  const run = deps.run ?? own!.run;
  const routes = new Map<string, RoadRoute | null>();
  const queue: Array<{ id: string; a: Site; b: Site; d: number }> = [];
  let running: string | null = null,
    version = 0,
    atX = Number.NaN,
    atZ = Number.NaN;
  const charted: Site[] = [];

  const next = () => {
    if (running || queue.length === 0) return;
    const job = queue.shift()!;
    running = job.id;
    run(
      { id: job.id, seed, a: { id: job.a.id, x: job.a.x, z: job.a.z }, b: { id: job.b.id, x: job.b.x, z: job.b.z } },
      (points) => {
        routes.set(job.id, points ? { id: job.id, a: job.a, b: job.b, points } : null);
        if (points) version++;
        running = null;
        next();
      },
    );
  };

  return {
    update(x, z) {
      if (Math.hypot(x - atX, z - atZ) < DISCOVER_STEP) return;
      atX = x;
      atZ = z;
      // Every place within one edge of every end a wanted road may have, so
      // the graph is decided with all of each pair's rivals in it.
      const places = sites.charted(x, z, reach + LOOKAHEAD + 2 * MAX_EDGE, charted);
      const wanted = relativeNeighbours(places).filter(
        (e) => toSegment(e.a.x, e.a.z, e.b.x, e.b.z, x, z) <= reach + LOOKAHEAD,
      );
      for (const edge of wanted) {
        if (routes.has(edge.id) || running === edge.id || queue.some((q) => q.id === edge.id)) continue;
        queue.push({ id: edge.id, a: edge.a, b: edge.b, d: toSegment(edge.a.x, edge.a.z, edge.b.x, edge.b.z, x, z) });
      }
      queue.sort((p, q) => p.d - q.d);
      for (const [id, route] of routes) {
        const ends = route ?? null;
        if (ends && toSegment(ends.a.x, ends.a.z, ends.b.x, ends.b.z, x, z) > reach + LOOKAHEAD + KEEP_PAD)
          routes.delete(id);
      }
      next();
    },
    near(x, z, within, out) {
      out.length = 0;
      for (const route of routes.values())
        if (route && toPolyline(route.points, x, z) <= within) out.push(route);
      out.sort((p, q) => (p.id < q.id ? -1 : 1));
      return out;
    },
    get version() {
      return version;
    },
    get built() {
      let n = 0;
      for (const route of routes.values()) if (route) n++;
      return n;
    },
    get queued() {
      return queue.length + (running ? 1 : 0);
    },
    get refused() {
      let n = 0;
      for (const route of routes.values()) if (!route) n++;
      return n;
    },
    dispose() {
      own?.dispose();
      queue.length = 0;
    },
  };
}

/** The nearest point on a polyline to (x, z), and how far it is. */
function nearestOn(points: Array<[number, number]>, x: number, z: number): { x: number; z: number; d: number } {
  let best = { x: points[0]![0], z: points[0]![1], d: Infinity };
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]!,
      [bx, bz] = points[i]!;
    const dx = bx - ax,
      dz = bz - az,
      len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + dx * t,
      pz = az + dz * t,
      d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { x: px, z: pz, d };
  }
  return best;
}

/**
 * Where one end of a route stops, walking in from outside the settlement: the
 * index of the last point outside its radius, and with a plan, the point on
 * its street the route runs into.
 */
function endOf(points: Array<[number, number]>, at: Site, plan: SitePlan | null) {
  let out = 0;
  while (out < points.length - 1 && Math.hypot(points[out]![0] - at.x, points[out]![1] - at.z) <= at.radius) out++;
  if (!plan || plan.roads.length === 0) return { index: out, join: null };
  // In from the edge until the route comes within reach of a street; it joins
  // the street where it came nearest, so it never stops short in a garden.
  let best = { index: out, x: 0, z: 0, d: Infinity };
  for (let i = out; i >= 0; i--) {
    const [x, z] = points[i]!;
    for (const road of plan.roads) {
      const on = nearestOn(road.points, x, z);
      const gap = on.d - road.width / 2;
      if (gap < best.d) best = { index: i, x: on.x, z: on.z, d: gap };
    }
    if (best.d <= MEET) break;
  }
  return { index: best.index, join: [best.x, best.z] as [number, number] };
}

/**
 * What of a route is drawn. Outside the two settlements it is drawn always;
 * inside one it is drawn only once that settlement's plan is built, and then
 * only as far as the street it runs into -- before that it stops at the edge,
 * because a road into a village with no street yet is a road into a field.
 */
export function stretchOf(route: RoadRoute, planA: SitePlan | null, planB: SitePlan | null): Array<[number, number]> {
  const pts = route.points;
  const head = endOf(pts, route.a, planA);
  const reversed = [...pts].reverse();
  const tail = endOf(reversed, route.b, planB);
  const last = pts.length - 1 - tail.index;
  if (last <= head.index) return [];
  const body = pts.slice(head.index, last + 1);
  if (head.join) body.unshift(head.join);
  if (tail.join) body.push(tail.join);
  return body;
}

/** A route cut into pieces of about `length` m, each sharing its first point with the last of the one before. */
export function chunksOf(points: Array<[number, number]>, length = 1000): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  let piece: Array<[number, number]> = [];
  let walked = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (piece.length > 0) walked += Math.hypot(p[0] - piece.at(-1)![0], p[1] - piece.at(-1)![1]);
    piece.push(p);
    if (walked >= length && i < points.length - 1) {
      out.push(piece);
      piece = [p];
      walked = 0;
    }
  }
  if (piece.length > 1) out.push(piece);
  return out;
}
```

Sprawdź, czy `library/settlements/geometry.js` eksportuje `toPolyline` (tak, wiersze 29–39). Jeśli test `chunksOf` spodziewa się 5 kawałków, a wyjdzie 4 lub 6, sprawdź liczenie: 199 odcinków × 24 m = 4776 m, więc przy cięciu po ≥1000 m wychodzą 4 pełne kawałki i 776 m reszty, razem 5.

- [ ] **Krok 5: worker**

`src/engine/scenery/routes.worker.ts`:

```ts
// Searching a road between two settlements off the main thread: 14 to 45 ms
// over nine thousand samples of the ground, which a frame cannot pay. The
// ground is the base height, which the registry does not touch, so the worker
// builds a sampler with no biomes and imports nothing of the library.
import { createWorldSampler, type WorldSampler } from '../terrain/WorldSampler';
import { routeBetween } from './Route';
import type { RouteJob } from './Roads';

const samplers = new Map<number, WorldSampler>();
const fields = new Float64Array(5);

self.addEventListener('message', (event: MessageEvent<RouteJob>) => {
  const job = event.data;
  let sampler = samplers.get(job.seed);
  if (!sampler) samplers.set(job.seed, (sampler = createWorldSampler(job.seed)));
  const heightAt = (x: number, z: number) => {
    sampler.baseFields(x, z, fields);
    return fields[0]!;
  };
  const route = routeBetween(job.a, job.b, heightAt, job.seed);
  const points = route ? new Float64Array(route.flat()) : null;
  (self as unknown as Worker).postMessage({ id: job.id, points }, points ? [points.buffer] : []);
});
```

`import type { RouteJob } from './Roads'` to tylko typ, więc worker nie ciągnie za sobą `Roads.ts` (ani `geometry.js`).

- [ ] **Krok 6: testy, lint, commit**

```bash
npx vitest run tests/unit/roads.test.ts tests/unit/sites.test.ts && npm run typecheck && npm run lint && npx prettier --write src/engine/scenery tests/unit/roads.test.ts tests/unit/sites.test.ts
git add src/engine/scenery/Sites.ts src/engine/scenery/Roads.ts src/engine/scenery/routes.worker.ts tests/unit/roads.test.ts tests/unit/sites.test.ts
git commit -m "The roads a flight is near are searched in a worker and kept by pair

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 5: droga zajmuje grunt, Ring ją podaje

**Pliki:**
- Zmień: `src/engine/scenery/Claims.ts`, `src/engine/scenery/Ring.ts`
- Test: `tests/unit/claims.test.ts`, `tests/unit/ring.test.ts`

**Interfejsy:**
- Produkuje:
  - `Claims.addRoute(id: string, points: Array<[number, number]>, width: number): void` oraz stała `ROUTE_CLEARING = 5`;
  - `RingDeps.roads?: { near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[] }`;
  - `ScenerySink.route?(id: string, points: Array<[number, number]>): void`.

- [ ] **Krok 1: test `Claims.addRoute`, który nie przejdzie**

W `tests/unit/claims.test.ts`:

```ts
  it('cuts a ride through the trees along a road between settlements, and keeps the grass off the road', () => {
    const claims = createClaims();
    claims.addRoute('a|b', [
      [0, 0],
      [1000, 0],
    ], 5);
    expect(claims.trees(500, 2.5 + ROUTE_CLEARING - 0.1)).toBe(true);
    expect(claims.trees(500, 2.5 + ROUTE_CLEARING + 0.1)).toBe(false);
    expect(claims.grass(500, 2.9)).toBe(true);
    expect(claims.grass(500, 3.1)).toBe(false);
    expect(claims.plans.map((p) => p.id)).toEqual(['a|b']);
  });
```

(dopisz `ROUTE_CLEARING` do importu.)

- [ ] **Krok 2: implementacja**

W `Claims.ts`:

```ts
/**
 * Metres a tree keeps from a road between settlements, past its edge: a
 * crown's reach, so a wood a road runs through does not close over it and the
 * road reads from the air as the ride it cuts.
 */
export const ROUTE_CLEARING = 5;
```

w interfejsie `Claims`:

```ts
  /** A road between settlements: a ride through the trees, a strip off the grass. */
  addRoute(id: string, points: Array<[number, number]>, width: number): void;
```

i w obiekcie:

```ts
    addRoute(id, points, width) {
      const half = width / 2;
      const bounds: PlanBounds = { id, x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!;
        trees.capsule(a[0], a[1], b[0], b[1], half + ROUTE_CLEARING);
        grass.capsule(a[0], a[1], b[0], b[1], half + GRASS_ROAD_MARGIN);
        for (const [x, z] of [a, b]) {
          bounds.x0 = Math.min(bounds.x0, x - half - ROUTE_CLEARING);
          bounds.z0 = Math.min(bounds.z0, z - half - ROUTE_CLEARING);
          bounds.x1 = Math.max(bounds.x1, x + half + ROUTE_CLEARING);
          bounds.z1 = Math.max(bounds.z1, z + half + ROUTE_CLEARING);
        }
      }
      if (bounds.x0 <= bounds.x1) plans.push(bounds);
    },
```

Id w `plans` jest dla trawy tylko kluczem: trasa przycięta do planu dostaje w Ring id `${route.id}#${points.length}`. Dzięki temu gdy dojdzie plan i przycięcie się zmieni, trawa przepisze kafle pod nowym kształtem.

- [ ] **Krok 3: test Ring, który nie przejdzie**

W `tests/unit/ring.test.ts`, w `collector`: dopisz tablicę `routes: Array<{ id: string; points: Array<[number, number]> }>`, czyszczoną w `begin`, metodę sink `route(id, points) { routes.push({ id, points }); }` i dodaj `routes` do zwracanego obiektu. W helperze `ring(...)` dodaj opcję `roads?: RingDeps['roads']` przekazywaną do `createRing`. Test:

```ts
  it('offers a road between settlements to the pools, and keeps the wood off it', () => {
    const a = { id: 'village:0,0', biome: 'village', x: -900, z: 0, radius: 150, yaw: 0, fields: {} as Fields, random: () => 0.5 };
    const b = { ...a, id: 'village:1,0', x: 900 };
    const route = {
      id: 'village:0,0|village:1,0',
      a,
      b,
      points: Array.from({ length: 76 }, (_, i) => [-900 + i * 24, 0] as [number, number]),
    };
    const roads = { near: (_x: number, _z: number, _r: number, out: (typeof route)[]) => ((out.length = 0), out.push(route), out) };
    const r = ring(library([everywhere('woods', 10)]), { roads });
    r.ring.update(0, 0, false);
    expect(r.routes.map((x) => x.id)).toEqual([route.id]);
    // no plan at either end: the road stops at both edges
    const drawn = r.routes[0]!.points;
    expect(drawn[0]![0]).toBeGreaterThanOrEqual(-900 + 150 - 24);
    expect(r.trees.filter((t) => Math.abs(t.z) <= 2.5 + 5 && Math.abs(t.x) < 700)).toEqual([]);
  });
```

(Dodaj import `type RingDeps` z `Ring`.)

- [ ] **Krok 4: implementacja w Ring**

W `src/engine/scenery/Ring.ts`:
- `import { ROUTE_WIDTH, stretchOf, type RoadRoute } from './Roads';`
- w `ScenerySink` dopisz:

```ts
  /**
   * A road between settlements, as much of it as is drawn: offered whole every
   * rebuild that covers it, after the plans, and dropped by the pools the
   * rebuild it is not offered. Optional: a sink that draws no roads needs none.
   */
  route?(id: string, points: Array<[number, number]>): void;
```

- w `RingDeps`: `roads?: { near(x: number, z: number, reach: number, out: RoadRoute[]): RoadRoute[] };`
- w `createRing`, obok `nearby`, dopisz `const routesNear: RoadRoute[] = [];` i `const drawn = new Map<string, Array<[number, number]>>();`
- w `indexPlans`, po pętli planów:

```ts
    // The roads between them, as far as each is drawn: into a street where the
    // settlement's plan is built, to its edge where it is not.
    drawn.clear();
    if (!deps.roads) return;
    for (const route of deps.roads.near(x, z, radius, routesNear)) {
      const points = stretchOf(route, sites.planFor(route.a), sites.planFor(route.b));
      if (points.length < 2) continue;
      drawn.set(route.id, points);
      claims.addRoute(`${route.id}#${points.length}`, points, ROUTE_WIDTH);
    }
```

  Wcześniejsze `if (!sites) return;` na początku `indexPlans` zamień na blok: `if (sites) for (...) {...}` bez wczesnego wyjścia. Pętla tras potrzebuje `sites.planFor`, więc ją też osłoń `if (sites)`.
- w `raise(x, z)` na końcu (po pętli osad) dopisz:

```ts
    for (const [id, points] of drawn) sink.route?.(id, points);
```

  `raise` zaczyna się od `if (!sites) return;`; przenieś tę pętlę przed to wyjście albo zamień wyjście na blok, żeby trasy były oferowane zawsze.

- [ ] **Krok 5: testy, commit**

```bash
npx vitest run tests/unit/claims.test.ts tests/unit/ring.test.ts && npm run typecheck && npm run lint && npx prettier --write src/engine/scenery tests/unit/claims.test.ts tests/unit/ring.test.ts
git add src/engine/scenery/Claims.ts src/engine/scenery/Ring.ts tests/unit/claims.test.ts tests/unit/ring.test.ts
git commit -m "A road between settlements cuts a ride through the wood and reaches the pools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 6: droga widoczna z góry

**Pliki:**
- Zmień: `src/engine/scenery/RoadKit.ts`, `src/engine/scenery/Painted.ts`, `src/engine/scenery/Pools.ts`, `src/engine/scenery/Scenery.ts`
- Zmień: `library/biomes/*.js` (10 plików), `tests/unit/contract.test.ts`
- Test: `tests/unit/roadKit.test.ts`

**Interfejsy:**
- `RoadDeps.colorAt?: (x: number, z: number, out: Color) => Color` nadpisuje kolor drogi per wierzchołek;
- `RoadDeps.spread?: boolean` dokłada atrybut `spread` (vec3: kierunek rozstawu × strona, połowa szerokości);
- `SceneryMaterials.road(fade: readonly [number, number]): Material`;
- `SceneryStats.routes`, `routesQueued`, `routesRefused`, `routeChunks`.

- [ ] **Krok 1: test RoadKit, który nie przejdzie**

W `tests/unit/roadKit.test.ts` (importy `buildRoads`, `Color` już tam są albo dodaj):

```ts
  it('paints a road the colour of the country under each vertex, and says which way each rim spreads', () => {
    const geometry = buildRoads(
      [
        {
          points: [
            [0, 0],
            [100, 0],
          ],
          width: 5,
        },
      ],
      {
        heightAt: () => 0,
        colorAt: (x, _z, out) => out.setRGB(x < 50 ? 0.2 : 0.8, 0.5, 0.5),
        spread: true,
      },
    )!;
    const color = geometry.getAttribute('color'),
      position = geometry.getAttribute('position'),
      spread = geometry.getAttribute('spread');
    expect(spread.itemSize).toBe(3);
    for (let i = 0; i < position.count; i++) {
      expect(color.getX(i)).toBeCloseTo(position.getX(i) < 50 ? 0.2 : 0.8, 6);
      // a rim sits its half width out along its own spread
      expect(spread.getZ(i)).toBeCloseTo(2.5, 6);
      expect(Math.abs(position.getZ(i))).toBeCloseTo(2.5, 6);
      expect(Math.sign(spread.getY(i))).toBe(Math.sign(position.getZ(i)));
    }
    // five buffers, well inside the eight a pipeline may bind
    expect(Object.keys(geometry.attributes).length).toBe(5);
  });
```

Uwaga: `spread` trzyma (ox·strona, oz·strona, połowa), gdzie kierunek (ox, oz) jest w płaszczyźnie xz. Test czyta `getY` jako składową z kierunku.

- [ ] **Krok 2: implementacja w RoadKit**

W `RoadDeps` dopisz:

```ts
  /** The colour of the ground's road at a point; overrides the road's own colour, per vertex. */
  colorAt?: (x: number, z: number, out: Color) => Color;
  /**
   * Adds `spread` -- which way each rim lies from the centre line and the half
   * width it was built at -- so a material can widen a far road to stay a line
   * and not dissolve into the pixels between its rims.
   */
  spread?: boolean;
```

W `buildRoads`: dodaj tablicę `spreads: number[] = []` i `const tint = new Color();`. Zmień `push` na `push(rim, color, sx, sz, half)`, gdzie przy `deps.spread` dopisuje `spreads.push(sx, sz, half)`, a kolor bierze z `deps.colorAt ? deps.colorAt(rim.x + ox, rim.z + oz, tint) : color`. Rim ma współrzędne lokalne, więc do `colorAt` trzeba podać światowe: dodaj z powrotem `ox`/`oz` z `deps.at`. Przy budowie rims zapamiętaj kierunek próbki: dla rim `a` (+) jest to `(s.ox, s.oz)`, dla `b` (−) `(-s.ox, -s.oz)`. Zamień `rims` na:

```ts
    const rims = samples.map((s): [Rim, Rim, number, number] => [
      rimAt(s.x + s.ox * half, s.z + s.oz * half, 0, s.along / road.width),
      rimAt(s.x - s.ox * half, s.z - s.oz * half, 1, s.along / road.width),
      s.ox,
      s.oz,
    ]);
    for (let i = 0; i + 1 < rims.length; i++) {
      const [a0, b0, ax, az] = rims[i]!,
        [a1, b1, cx, cz] = rims[i + 1]!;
      push(a0, color, ax, az, half);
      push(b0, color, -ax, -az, half);
      push(a1, color, cx, cz, half);
      push(b0, color, -ax, -az, half);
      push(b1, color, -cx, -cz, half);
      push(a1, color, cx, cz, half);
    }
```

Kierunek z `walkPolyline` jest już wydłużony o mitrę, więc szerokość rośnie w narożniku tak samo jak geometria. Na końcu, gdy `deps.spread`, dopisz `geometry.setAttribute('spread', new Float32BufferAttribute(spreads, 3));`.

Uruchom: `npx vitest run tests/unit/roadKit.test.ts`. Oczekiwane: PASS, także dotychczasowe testy (bez `spread` i `colorAt` nic się nie zmienia).

- [ ] **Krok 3: materiał drogi**

W `src/engine/scenery/Painted.ts`, w obiekcie materiałów obok `prop`, dopisz (importy TSL: `attribute`, `cameraPosition`, `float`, `length`, `max`, `modelWorldMatrix`, `positionLocal`, `smoothstep`, `vec3`, `vec4`; większość już tam jest):

```ts
    /**
     * A road between settlements. Near, it is its own width; far, it widens so
     * that it never falls under about a pixel and a half across, because a road
     * the flight is meant to follow from altitude is a line or it is nothing.
     * It fades out at the edge of the ring with the trees it runs between.
     */
    road(fade: readonly [number, number]) {
      const spread = attribute<'vec3'>('spread', 'vec3');
      const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
      const distance = length(world.sub(cameraPosition));
      const half = max(spread.z, distance.mul(ROAD_WIDEN));
      const m = litMaterial(attribute<'vec3'>('color', 'vec3'), {
        basic: { alphaTest: FADE_ALPHA_TEST, alphaToCoverage: true },
      });
      m.positionNode = positionLocal.add(
        vec3(spread.x.mul(half.sub(spread.z)), distance.mul(ROAD_RISE), spread.y.mul(half.sub(spread.z))),
      );
      m.opacityNode = float(1).sub(smoothstep(fade[0], fade[1], distance));
      return m;
    },
```

i stałe na poziomie modułu:

```ts
/**
 * How wide a far road is kept, as half its width per metre of distance: 0.0015
 * is about three pixels across at 1080p face on and one and a half at the
 * grazing angle of a flight at 1 400 m looking 2.5 km out. Below 1 700 m the
 * road's own 2.5 m is wider and nothing changes.
 */
const ROAD_WIDEN = 0.0015;
/** How far a far road is lifted per metre of distance, so a widened rim does not sink into the slope it overhangs. */
const ROAD_RISE = 0.0005;
```

- [ ] **Krok 4: pule rysują trasy kawałkami**

W `src/engine/scenery/Pools.ts`:
- eksportuj `RING_FADE` (`export const RING_FADE`), bo Scenery i testy mogą go potrzebować;
- importy: `import { chunksOf } from './Roads';`, `import { countryOf, standingOf } from '../terrain/Country';`, `swatchColor` z kontraktu, jeśli go brak;
- pod `ribbons` dopisz:

```ts
  // The roads between settlements, a kilometre a mesh: a route is ten of them,
  // and only the ones inside the ring are built. Keyed by route, piece and the
  // piece's own two ends, so a route whose end moves -- its village's plan
  // arrived and it now runs into the street -- rebuilds that piece and no other.
  const routeMaterial = materials.road(RING_FADE);
  materialsMade.push(routeMaterial);
  const pieces = new Map<string, Mesh>();
  const offeredPieces = new Set<string>();
  // The country's own road colour, the way the ground under it is the country's.
  const roadColor = library.biomes.map(
    (biome) => new Color(swatchColor((biome.params?.road as SceneryColor | undefined) ?? 'clay')),
  );
  const stands = standingOf(library.biomes);
  const slotIds = new Uint8Array(4),
    slotWeights = new Float32Array(4),
    countryIds = new Uint8Array(4),
    countryWeights = new Float32Array(4);
  const colorAt = (x: number, z: number, out: Color) => {
    heightfield.weightsAt(x, z, slotIds, slotWeights);
    countryOf(slotIds, slotWeights, stands, countryIds, countryWeights);
    out.setRGB(0, 0, 0);
    for (let s = 0; s < 3; s++) {
      const w = countryWeights[s]!,
        c = roadColor[countryIds[s]!]!;
      if (w > 0) out.setRGB(out.r + c.r * w, out.g + c.g * w, out.b + c.b * w);
    }
    return out;
  };
  const PIECE_REACH = 2600 + 200;
```

- w `begin`: `offeredPieces.clear();`
- nowa metoda sink:

```ts
    route(id, points) {
      chunksOf(points).forEach((piece, k) => {
        let near = Infinity;
        for (const [x, z] of piece) near = Math.min(near, Math.hypot(x - flyerX, z - flyerZ));
        if (near > PIECE_REACH) return;
        const first = piece[0]!,
          last = piece.at(-1)!;
        const key = `${id}#${k}:${first[0].toFixed(1)},${first[1].toFixed(1)}:${last[0].toFixed(1)},${last[1].toFixed(1)}`;
        offeredPieces.add(key);
        let mesh = pieces.get(key);
        if (!mesh) {
          const geometry = buildRoads([{ points: piece, width: ROUTE_WIDTH }], {
            heightAt: (x: number, z: number) => heightfield.heightAt(x, z),
            site: id,
            at: [first[0], first[1]],
            colorAt,
            spread: true,
          });
          if (!geometry) return;
          mesh = new Mesh(geometry, routeMaterial);
          mesh.receiveShadow = true;
          mesh.userData.origin = first;
          roads.add(mesh);
          pieces.set(key, mesh);
        }
        mesh.position.set(origin.localX(first[0]), 0, origin.localZ(first[1]));
      });
    },
```

  (`ROUTE_WIDTH` importuj z `./Roads`.)
- w `end`: po pętli `ribbons` dopisz zwalnianie `pieces`, których nie ma w `offeredPieces` (`roads.remove`, `geometry.dispose`, `pieces.delete`);
- w `dispose`: zwolnij geometrię wszystkich `pieces`;
- udostępnij liczbę: dodaj do zwracanego obiektu `get routePieces() { return pieces.size; }` i dopisz to pole do typu zwracanego przez `createPools` (jeśli typ jest jawny).

- [ ] **Krok 5: Scenery tworzy `Roads`**

W `src/engine/scenery/Scenery.ts`:
- `import { createRoads } from './Roads';`
- po `createSites`: `const roads = createRoads({ seed, sites });` i przekaż `roads` do `createRing({ ..., roads })`;
- w `update`, przed `ring.update`:

```ts
      // The network is looked at every kilometre and its routes arrive from a
      // worker; one arriving is a rebuild, as a plan arriving is.
      roads.update(x, z);
      const routed = roads.version !== seenRoutes;
      seenRoutes = roads.version;
```

  z `let seenRoutes = 0;` obok `let rebuilds = 0;`. Warunek `ring.update(x, z, moved || sites.built > planned)` zamień na `ring.update(x, z, moved || sites.built > planned || routed)`.
- `SceneryStats`: dopisz pola z komentarzami:

```ts
  /** Roads between settlements built, waiting in the worker's queue, and refused for having no land way. */
  routes: number;
  routesQueued: number;
  routesRefused: number;
  /** Kilometre pieces of those roads standing in the ring. */
  routeChunks: number;
```

  i w `stats`: `routes: roads.built, routesQueued: roads.queued, routesRefused: roads.refused, routeChunks: pools.routePieces`;
- w `dispose` wywołaj `roads.dispose()`.

- [ ] **Krok 6: kolor drogi w każdym kraju**

Dopisz `road` do `params` każdego biomu kraju. Kolor ma kontrastować z `base`:

| plik | `base` | `road` |
| --- | --- | --- |
| `wildsong.js` | zieleń | `'clay'` |
| `elderwood.js` | ciemna zieleń | `'sandPale'` |
| `steppe.js` | steppe | `'barkDark'` |
| `badlands.js` | czerwona skała | `'stoneDark'` |
| `dunes.js` | piasek | `'barkDark'` |
| `frostpines.js` | frost | `'barkDark'` |
| `moor.js` | moor | `'clay'` |
| `autumn.js` | bursztyn | `'stoneDark'` |
| `jungle.js` | dżungla | `'clay'` |
| `blossom.js` | zieleń | `'clay'` |

Otwórz każdy plik i sprawdź jego `base`. Jeśli wybrany kolor jest z nim zbyt zbliżony, weź drugi z pary `clay` / `barkDark`. W `tests/unit/contract.test.ts` zmień oczekiwane klucze na `['base', 'alt', 'rock', 'road']` dla krajów.

- [ ] **Krok 7: testy, commit**

```bash
npm run typecheck && npm run lint && npm test
npx prettier --write src library tests
git add src/engine/scenery library/biomes tests/unit
git commit -m "A road between settlements is drawn a kilometre at a time, in its country's colour, and stays a line from altitude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 7: przeglądarka, obraz i dokumentacja

**Pliki:**
- Zmień: `tests/e2e/smoke.spec.ts`, `AGENTS.md`

- [ ] **Krok 1: test e2e**

W `tests/e2e/smoke.spec.ts`, po testach wioski:

```ts
test('a road leaves the village for the next one, and stands from altitude', async ({ page }) => {
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  await teleport(page, VILLAGE, 1200);
  // The routes come from a worker, a few tens of milliseconds each; the ring
  // rebuilds when one arrives.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const w = window.__world!;
          w.step(0.05);
          return w.scenery!.routeChunks;
        }),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  const stats = await page.evaluate(() => window.__world!.scenery!);
  expect(stats.routes).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
```

Uruchom: `npm run build && npx playwright test -g "a road leaves"`. Oczekiwane: PASS. Jeśli `routeChunks` zostaje na 0, sprawdź w `WorldDebug` `routes` i `routesRefused`: sama odmowa znaczy, że wioska stoi na wyspie, i wtedy przenieś test na parę, która się łączy (np. `village:1,-1` ↔ `village:1,-2`).

- [ ] **Krok 2: obraz**

Uruchom podgląd `dev`, otwórz `?seed=42` i kliknij Begin. Przez `__world` wstrzymaj lot i ustaw go 400 m przed `VILLAGE` na wysokości 1 200 m nad gruntem, z kursem na wioskę (jak w zadaniu 7 etapu 1). Zrób zrzut i sprawdź:
- droga wychodzi z wioski i biegnie dalej krętą linią;
- w lesie jest przesieka;
- droga jest widoczna aż po zanik pierścienia.

Zrób też zrzut z 80 m nad drogą w terenie płaskim i w pagórkowatym. Jeśli z 1 200 m linia znika, podnieś `ROAD_WIDEN` (0,0015 → 0,0025) i zapisz w komentarzu zmierzoną szerokość w pikselach. Zamknij kartę po zakończeniu.

- [ ] **Krok 3: AGENTS.md**

- Na liście czystych modułów CPU dopisz `scenery/RoadNetwork.ts`, `scenery/Route.ts`.
- W „Layout", przy `scenery/`, dopisz „road network and routes".
- W sekcji „Settlements" dopisz punkt:

```markdown
- **Roads join settlements** that share land: the relative neighbourhood graph
  over every seated site, edges up to 14 km (`RoadNetwork.ts`), and a route
  per edge that is a pure function of the seed and the pair, searched from the
  end with the smaller id (`Route.ts`: A* over the base height, 48 m grid,
  12% grade, a slow noise that bends it on the flat, Chaikin, a sway that
  fades on slopes, 40 m bends and 20 m hairpins). It runs in a worker
  (`routes.worker.ts`), because a route is 14 to 45 ms; `Roads.ts` asks for
  the pairs near the flight and keeps them by pair, and `Sites.charted` seats
  the sites it needs without queueing a plan for any. A route is drawn to the
  edge of a settlement whose plan is not built and into its street once it is
  (`stretchOf`), a kilometre a mesh, widened with distance so it stays a line
  from altitude, in its country's `params.road`; it cuts a ride through the
  trees (`ROUTE_CLEARING`). Every road ends at a settlement at both ends: it is
  a way to find one from the air.
```

- [ ] **Krok 4: pełne sprawdzenie i commit**

```bash
npm run check
git add tests/e2e/smoke.spec.ts AGENTS.md src library
git commit -m "Say how roads join settlements, and check one stands from altitude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Samokontrola planu wobec specyfikacji (sekcja 5)

| Spec | Zadanie |
| --- | --- |
| 5.1 graf sąsiedztwa względnego, 14 km, rozstrzygany lokalnie | 1, 4 (`charted` w zasięgu 2 krawędzi) |
| 5.2 A*, 48 m, korytarz +3 km, morze < 3 m, 12%, koszt, objazd 2,5× | 2 |
| 5.3 krętość zależna od terenu, Chaikin bez prostowania, meander, promienie 40/20 m, cele krętości | 3 |
| 5.4 worker bez biblioteki, kolejka od najbliższej, pamięć podręczna, zapominanie | 4 |
| 5.5 kawałki 1 km, wejście do osady, szerokość i poszerzanie, `params.road`, zanik, przesieka, statystyki | 4 (`stretchOf`, `chunksOf`), 5, 6 |
| 5.6 testy | 1–7 |
| 6 dokumentacja | 7 |
| 8 ryzyka: niewidoczna droga, kanciaste serpentyny | 7 (krok 2), 3 (strojenie) |

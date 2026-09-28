# Klify nadmorskie — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gdzieniegdzie morze podcina ląd i zostawia ścianę, która z lotu czyta się jak prawdziwy klif: bez trójkątów w świetle, bez piły na krawędzi, w więcej niż jednym kolorze.

**Architecture:** Czysty moduł CPU `terrain/SeaCliffs.ts` liczy zmianę wysokości punktu: odległość od linii wody, „czy to morze” i wysokość czoła żyją w węzłach siatki co 64 m (kroki Newtona, cache), punkt interpoluje węzły. `WorldSampler.sampleWindow` dodaje ją po hakach biomów, więc bliskie i dalekie okno, `SampledGround`, `Sites` i `heightAt` dostają klify same. Worker tras dostaje tę samą warstwę przez `scenery/RouteGround.ts`. Wygląd ściany to gałąź w `TerrainMesh`: normalna z szerszego wycinka, rzeźba skały i kolor z szumu 3D.

**Tech Stack:** TypeScript, three 0.185.1 (TSL), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-klify-nadmorskie-design.md`

## Global Constraints

- Warstwa świata w silniku, nie hak biomu; kontrakt biblioteki (`library/contract.ts`) się nie zmienia.
- `SEA_CLIFF` start: `scale 3500`, `cover [0.05, 0.3]`, `width [70, 190]`, `face 32`, `floor 7`, `minFace [18, 34]`, `maxFace [140, 190]`, `jag 22` (szum 160 m, jeden składnik), `probe 300`, `deep [3, 10]`, `low -40`; `COAST_NODE = 64`.
- `face` nigdy poniżej 32 m (dwie komórki): węższy skok piłuje się na siatce 16 m.
- Wynik punktu jest czystą funkcją punktu: niezależny od kolejności zapytań i od cache.
- `WorldSampler.sample` i `baseFields` bez zmian: złote wartości seeda 42 zostają.
- Seed warstwy `S3 + 101`.
- Moduły CPU nie importują `three/webgpu`, `three/tsl` ani DOM (`AGENTS.md`).
- Koszt pełnego wypełnienia okna przy klifowym wybrzeżu seeda 42: najwyżej +8%.
- Waga ściany w shaderze: `smoothstep(0.42, 0.7, ·)` nachylenia, wygaszona w 180–240 m wysokości; szum ściany tylko w gałęzi `If(wall > 0.01)`.
- Komentarze i identyfikatory po angielsku, opisy commitów po angielsku ze stopką `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Osada przy brzegu w masce klifu** — wioska ma stać w zatoczce, a nie na krawędzi urwiska ani pod wodą: udział osady w tekselu zmniejsza podcięcie dokładnie w tej proporcji (test w Task 2).
2. **Kolejność wypełniania i wypieranie cache** — bliskie okno, dalekie okno i `SampledGround` pytają o te same punkty w innej kolejności i z innym krokiem; wynik musi być co do bitu ten sam (test w Task 1).
3. **Droga do osady w zatoczce** — worker widzi klify, ale końce trasy nie mogą wpaść do podciętego morza, bo A* odrzuci trasę (`ROUTE.sea`) (test w Task 4).
4. **Pilot leci ręcznie na ścianę 160 m, 30 m nad wodą** — prześwit nigdy poniżej `MIN_CLEARANCE`, wznoszenie nie szybsze niż `CLIMB` (test w Task 5).
5. **Klif przecięty krawędzią bliskiej siatki (4,2 km)** — ściana przechodzi w stok dalekiego okna bez szczeliny i bez skoku światła (zdjęcie z 1000 m w Task 6).

---

### Task 1: `terrain/SeaCliffs.ts`, czysty moduł

**Files:**
- Create: `src/engine/terrain/SeaCliffs.ts`
- Test: `tests/unit/seaCliffs.test.ts`

**Interfaces:**
- Consumes: `fbm`, `sstep` z `src/engine/terrain/noise.ts`.
- Produces:
  - `export interface SeaCliffForm { scale: number; cover: [number, number]; width: [number, number]; face: number; floor: number; minFace: [number, number]; maxFace: [number, number]; jag: number; probe: number; deep: [number, number]; low: number }`
  - `export const SEA_CLIFF: SeaCliffForm`
  - `export const COAST_NODE = 64`
  - `export type BaseHeight = (x: number, z: number, out: Float64Array) => void`
  - `export interface SeaCliffs { at(x: number, z: number, b: number, share: number): number }`
  - `export function createSeaCliffs(base: BaseHeight, salt: number, form?: SeaCliffForm): SeaCliffs`
  - `export const NO_CLIFFS: SeaCliffs` (zawsze 0)

- [ ] **Step 1: Napisz testy**

`tests/unit/seaCliffs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  NO_CLIFFS,
  SEA_CLIFF,
  createSeaCliffs,
  type BaseHeight,
  type SeaCliffForm,
} from '../../src/engine/terrain/SeaCliffs';

/** Every coast is cut, at one width, with no wander: the shape alone. */
const EVERYWHERE: SeaCliffForm = { ...SEA_CLIFF, cover: [-3, -2], width: [120, 120], jag: 0 };
/** No coast is cut. */
const NOWHERE: SeaCliffForm = { ...SEA_CLIFF, cover: [2, 3] };

/** A straight coast along z: the sea for x < 0 down to the shelf, land rising `rise` a metre for x > 0. */
const coast =
  (rise: number): BaseHeight =>
  (x, _z, out) => {
    out[0] = x < 0 ? Math.max(-46, x * 0.08) : x * rise;
  };
/** A pond three metres deep in land twenty metres up. */
const pond: BaseHeight = (x, z, out) => {
  const r = Math.hypot(x, z);
  out[0] = r < 60 ? -3 + (r / 60) * 23 : 20;
};
const heightOn = (base: BaseHeight, form: SeaCliffForm) => {
  const cliffs = createSeaCliffs(base, 7, form);
  const out = new Float64Array(5);
  return (x: number, z = 0) => {
    base(x, z, out);
    const b = out[0]!;
    return b + cliffs.at(x, z, b, 1);
  };
};

describe('createSeaCliffs', () => {
  it('cuts the land in the band down to the floor and leaves what is behind the front alone', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    expect(h(40)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    expect(h(60)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    // behind the front: to the bit
    for (const x of [130, 200, 300]) expect(h(x)).toBe(x * 0.4);
  });
  it('stands the face over no more than two cells', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    let low = Number.NaN,
      high = Number.NaN;
    for (let x = 40; x <= 180; x += 0.5) {
      const share = (h(x) + SEA_CLIFF.floor) / (x * 0.4 + SEA_CLIFF.floor);
      if (share <= 0.2) low = x;
      if (Number.isNaN(high) && share >= 0.8) high = x;
    }
    expect(high - low).toBeGreaterThan(0);
    expect(high - low).toBeLessThanOrEqual(32);
  });
  it('deepens the sea at the foot and gives the shelf back further out', () => {
    const h = heightOn(coast(0.4), EVERYWHERE);
    expect(h(-20)).toBeCloseTo(-SEA_CLIFF.floor, 1);
    for (const x of [-170, -300, -600]) expect(h(x)).toBe(Math.max(-46, x * 0.08));
  });
  it('leaves a low coast a beach and a mountain a mountain', () => {
    const beach = heightOn(coast(0.1), EVERYWHERE);
    for (let x = 0; x <= 300; x += 8) expect(beach(x)).toBe(x * 0.1);
    const steep = heightOn(coast(2), EVERYWHERE);
    for (let x = 0; x <= 300; x += 8) expect(steep(x)).toBe(x * 2);
  });
  it('never cuts round a pond', () => {
    const h = heightOn(pond, EVERYWHERE);
    const out = new Float64Array(5);
    for (let r = 8; r <= 200; r += 4) {
      pond(r, 0, out);
      expect(h(r)).toBe(out[0]);
    }
  });
  it('cuts nothing where the mask is off, where a settlement stands, or with no cliffs at all', () => {
    const cliffs = createSeaCliffs(coast(0.4), 7, EVERYWHERE);
    expect(cliffs.at(60, 0, 24, 0)).toBe(0);
    expect(cliffs.at(60, 0, 24, 0.5)).toBeCloseTo(cliffs.at(60, 0, 24, 1) / 2, 9);
    expect(createSeaCliffs(coast(0.4), 7, NOWHERE).at(60, 0, 24, 1)).toBe(0);
    expect(NO_CLIFFS.at(60, 0, 24, 1)).toBe(0);
  });
  it('answers the same whatever the order of the questions and whatever the cache forgot', () => {
    const base = coast(0.4);
    const points: Array<[number, number]> = [];
    for (let i = 0; i < 3000; i++) points.push([((i * 37) % 500) - 200, ((i * 91) % 4000) - 2000]);
    const ask = (order: Array<[number, number]>, thrash: boolean) => {
      const cliffs = createSeaCliffs(base, 7, SEA_CLIFF);
      const out = new Float64Array(5);
      const answers = new Map<string, number>();
      for (const [x, z] of order) {
        // a far point between two near ones evicts what the near ones cached
        if (thrash) cliffs.at(x + 1e6, z - 1e6, 10, 1);
        base(x, z, out);
        answers.set(`${x},${z}`, cliffs.at(x, z, out[0]!, 1));
      }
      return points.map(([x, z]) => answers.get(`${x},${z}`)!);
    };
    const forward = ask(points, false);
    expect(ask([...points].reverse(), true)).toEqual(forward);
  });
});
```

- [ ] **Step 2: Uruchom, żeby zobaczyć porażkę**

Run: `npx vitest run tests/unit/seaCliffs.test.ts`
Expected: FAIL, „Failed to resolve import ../../src/engine/terrain/SeaCliffs”.

- [ ] **Step 3: Napisz moduł**

`src/engine/terrain/SeaCliffs.ts`:

```ts
// Sea cliffs: here and there the sea has cut into the land. Within a width W
// of the base water line the land is taken down to a floor under the sea, and
// the face stands where the width ends, as tall as the land is there -- so a
// cliff rises where high land meets the sea and a low coast stays a beach. A
// jump in height across a front is what a heightfield draws as a wall, and a
// front two cells wide is the narrowest that does not saw along the grid.
//
// Where the water line is, whether it is the sea and how tall the land at the
// front stands are asked of a lattice of nodes every COAST_NODE metres, each a
// pure function of its own indices, and read between them bilinearly: asked of
// the point itself, the distance is noise past a few metres from the water and
// the cut is full of holes. Pure CPU: no three, no DOM.
import { fbm, sstep } from './noise';

export interface SeaCliffForm {
  /** Width of the slow mask that says where a coast is cut at all, m. */
  scale: number;
  /** The mask: `sstep(cover[0], cover[1], fbm)`. How much coast has a cliff. */
  cover: [number, number];
  /** How far the sea has cut in, m, drawn from a second slow noise. */
  width: [number, number];
  /** How wide the face is, m. Never under two cells. */
  face: number;
  /** How far under the sea the cut land goes, m. */
  floor: number;
  /** A face lower than this is a beach, m. */
  minFace: [number, number];
  /** A face higher than this is a mountain, m. */
  maxFace: [number, number];
  /** How far the front wanders, m. */
  jag: number;
  /** How far past the water line the sea is looked for, m. */
  probe: number;
  /** How deep the water must be there to be the sea, m: a pond is shallower. */
  deep: [number, number];
  /** The lowest base height the cut considers, m: the shelf bottoms out at about -46. */
  low: number;
}

export const SEA_CLIFF: SeaCliffForm = {
  scale: 3500,
  cover: [0.05, 0.3],
  width: [70, 190],
  face: 32,
  floor: 7,
  minFace: [18, 34],
  maxFace: [140, 190],
  jag: 22,
  probe: 300,
  deep: [3, 10],
  low: -40,
};

/** Spacing of the lattice of nodes, m. */
export const COAST_NODE = 64;
/** Newton steps a node takes toward the water line. */
const NEWTON_STEPS = 3;
/** Nodes remembered; a power of two. */
const CACHE = 4096;

export type BaseHeight = (x: number, z: number, out: Float64Array) => void;

export interface SeaCliffs {
  /** The change to a point's height, m; `share` is how much of the point may be cut. */
  at(x: number, z: number, b: number, share: number): number;
}

/** No cliffs anywhere: a sampler built without them, and a measurement's baseline. */
export const NO_CLIFFS: SeaCliffs = { at: () => 0 };

export function createSeaCliffs(base: BaseHeight, salt: number, form: SeaCliffForm = SEA_CLIFF): SeaCliffs {
  const C = form;
  const tmp = new Float64Array(5);
  const height = (x: number, z: number) => {
    base(x, z, tmp);
    return tmp[0]!;
  };
  const widthAt = (x: number, z: number) =>
    C.width[0] + (C.width[1] - C.width[0]) * (0.5 + 0.5 * fbm(x / 1400 + 5.1, z / 1400 - 2.7, salt + 1, 2));
  const keyX = new Float64Array(CACHE).fill(Number.NaN),
    keyZ = new Float64Array(CACHE),
    distance = new Float64Array(CACHE),
    seaness = new Float64Array(CACHE),
    frontOf = new Float64Array(CACHE);
  // One node: walk down the gradient to the water line, then look past it for
  // the sea and back up it for the land the front stands in.
  const node = (ix: number, iz: number) => {
    const slot = (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & (CACHE - 1);
    if (keyX[slot] === ix && keyZ[slot] === iz) return slot;
    const x0 = ix * COAST_NODE,
      z0 = iz * COAST_NODE;
    let x = x0,
      z = z0,
      h = height(x, z),
      ux = 0,
      uz = 0;
    const E = 12;
    for (let k = 0; k < NEWTON_STEPS; k++) {
      const gx = (height(x + E, z) - height(x - E, z)) / (2 * E);
      const gz = (height(x, z + E) - height(x, z - E)) / (2 * E);
      const g = Math.max(Math.hypot(gx, gz), 0.004);
      ux = gx / g;
      uz = gz / g;
      const step = Math.max(-400, Math.min(400, h / g));
      x -= ux * step;
      z -= uz * step;
      h = height(x, z);
      if (Math.abs(h) < 0.5) break;
    }
    const W = widthAt(x0, z0);
    keyX[slot] = ix;
    keyZ[slot] = iz;
    distance[slot] = Math.hypot(x - x0, z - z0) * Math.sign(height(x0, z0));
    seaness[slot] = sstep(C.deep[0], C.deep[1], -height(x - ux * C.probe, z - uz * C.probe));
    frontOf[slot] = height(x + ux * W, z + uz * W);
    return slot;
  };
  const coast = { d: 0, sea: 0, front: 0 };
  const lookup = (x: number, z: number) => {
    const fx = x / COAST_NODE,
      fz = z / COAST_NODE;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const tx = fx - ix,
      tz = fz - iz;
    const a = node(ix, iz),
      b = node(ix + 1, iz),
      c = node(ix, iz + 1),
      e = node(ix + 1, iz + 1);
    const mix = (v: Float64Array) => (v[a]! * (1 - tx) + v[b]! * tx) * (1 - tz) + (v[c]! * (1 - tx) + v[e]! * tx) * tz;
    coast.d = mix(distance);
    coast.sea = mix(seaness);
    coast.front = mix(frontOf);
    return coast;
  };
  return {
    at(x, z, b, share) {
      if (share <= 0 || b < C.low || b > C.maxFace[1]) return 0;
      const m = sstep(C.cover[0], C.cover[1], fbm(x / C.scale, z / C.scale, salt, 2)) * share;
      if (m <= 0) return 0;
      const { d: dist, sea, front } = lookup(x, z);
      if (sea <= 0) return 0;
      const W = widthAt(x, z);
      const d = dist + C.jag * fbm(x / 160, z / 160, salt + 2, 2);
      const cut = 1 - sstep(W - C.face, W, d);
      if (cut <= 0) return 0;
      const worth = sstep(C.minFace[0], C.minFace[1], front) * (1 - sstep(C.maxFace[0], C.maxFace[1], front));
      // Sharpened, or a half-made cut leaves flat land just under the water:
      // a pale shoal in front of the cliff. The mask is not: it is what makes
      // a cliff fade along the coast, and that has to take hundreds of metres.
      const k = m * cut * sstep(0.35, 0.65, worth * sea);
      if (k <= 0) return 0;
      // A cliff stands in deep water: the floor is the same under the face and
      // for 40 m out to sea, and only then goes back to the shelf.
      return k * (Math.min(b, -C.floor * sstep(-160, -40, d)) - b);
    },
  };
}
```

- [ ] **Step 4: Uruchom testy**

Run: `npx vitest run tests/unit/seaCliffs.test.ts`
Expected: PASS, 7 testów. Jeśli „stands the face over no more than two cells” pada na `high - low > 32`, nie luzuj progu: sprawdź, czy `face` to 32 i czy `jag` w `EVERYWHERE` jest 0.

- [ ] **Step 5: Typy i lint**

Run: `npx tsc --noEmit && npx eslint src/engine/terrain/SeaCliffs.ts tests/unit/seaCliffs.test.ts && npx prettier --check src/engine/terrain/SeaCliffs.ts tests/unit/seaCliffs.test.ts`
Expected: bez błędów (jeśli prettier zgłasza, `npx prettier --write` na tych dwóch plikach).

- [ ] **Step 6: Commit**

```bash
git add src/engine/terrain/SeaCliffs.ts tests/unit/seaCliffs.test.ts
git commit -m "Let the sea cut into the land and leave a wall, as a pure function of the point" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: klify w `WorldSampler`, i jak często

**Files:**
- Modify: `src/engine/terrain/WorldSampler.ts` (interfejs `WorldSampler`, `createWorldSampler`, `sampleWindow`)
- Test: `tests/unit/seaCliffsWorld.test.ts`
- Modify: `tests/unit/ringGolden.test.ts` (snapshoty, świadomie)

**Interfaces:**
- Consumes: `createSeaCliffs`, `NO_CLIFFS`, `SEA_CLIFF`, `type SeaCliffs`, `type SeaCliffForm` (Task 1).
- Produces:
  - `WorldSampler.cliffs: SeaCliffs` (tylko do odczytu) — ta sama warstwa, której używa `sampleWindow`; worker tras (Task 4) woła `sampler.cliffs.at`.
  - `createWorldSampler(seed, opts: { biomes?: Biome[]; seaCliffs?: SeaCliffForm | false })` — `false` wyłącza klify (pomiar kosztu, Task 3).

- [ ] **Step 1: Napisz testy**

`tests/unit/seaCliffsWorld.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Biome } from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler, type WorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });
/** The two cliffs of seed 42 the probes photographed. */
const PLACES = [
  { x: 3584, z: -2992 },
  { x: 2720, z: 2240 },
];

/** A point near (x, z) the cliffs cut by at least `depth` metres, on a 16 m grid. */
const cutNear = (s: WorldSampler, x0: number, z0: number, depth: number) => {
  const out = new Float64Array(5);
  for (let r = 0; r <= 600; r += 16)
    for (let a = 0; a < 32; a++) {
      const x = x0 + Math.cos((a / 32) * Math.PI * 2) * r,
        z = z0 + Math.sin((a / 32) * Math.PI * 2) * r;
      s.baseFields(x, z, out);
      if (s.cliffs.at(x, z, out[0]!, 1) < -depth) return { x, z, b: out[0]! };
    }
  throw new Error(`no cut of ${depth} m near ${x0}, ${z0}`);
};

describe('sea cliffs in the sampler', () => {
  it('adds the cut to the window and leaves the base fields alone', () => {
    const { x, z, b } = cutNear(sampler, PLACES[0]!.x, PLACES[0]!.z, 20);
    const out = new Float64Array(4),
      slots = new Uint8Array(4),
      base = new Float64Array(5);
    sampler.baseFields(x, z, base);
    expect(base[0]).toBe(b);
    sampler.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeLessThan(b - 20);
    const bare = createWorldSampler(42, { biomes: lib.biomes, seaCliffs: false });
    bare.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeGreaterThan(b - 20);
  });
  it('gives way to a settlement by exactly its share of the texel', () => {
    const plain = { id: 'plain', presence: () => 1 } as unknown as Biome;
    const town = { id: 'town', presence: () => 1, inherit: { trees: 0.5 } } as unknown as Biome;
    const halved = createWorldSampler(42, { biomes: [plain, town] });
    const { x, z, b } = cutNear(halved, PLACES[0]!.x, PLACES[0]!.z, 20);
    const out = new Float64Array(4),
      slots = new Uint8Array(4);
    halved.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeCloseTo(b + halved.cliffs.at(x, z, b, 0.5), 9);
    const alone = createWorldSampler(42, { biomes: [plain] });
    alone.sampleWindow(x, z, out, slots);
    expect(out[0]).toBeCloseTo(b + alone.cliffs.at(x, z, b, 1), 9);
  });
  it('cuts without holes and leaves no islets in front of a cliff', () => {
    for (const place of PLACES) {
      const size = 192;
      const hf = createHeightfield(sampler, { size });
      const cx = Math.round(place.x / 16),
        cz = Math.round(place.z / 16);
      hf.fillAll(cx, cz);
      const base = new Float64Array(5);
      const h = new Float64Array(size * size),
        cut = new Uint8Array(size * size);
      for (let j = 0; j < size; j++)
        for (let i = 0; i < size; i++) {
          const x = (cx - size / 2 + i) * 16,
            z = (cz - size / 2 + j) * 16;
          sampler.baseFields(x, z, base);
          h[j * size + i] = hf.heightAt(x, z);
          cut[j * size + i] = h[j * size + i]! < base[0]! - 2 ? 1 : 0;
        }
      const near = (k: number) => [k - 1, k + 1, k - size, k + size];
      let cuts = 0,
        holes = 0;
      for (let j = 1; j < size - 1; j++)
        for (let i = 1; i < size - 1; i++) {
          const k = j * size + i;
          if (!cut[k]) continue;
          cuts++;
          if (near(k).every((n) => !cut[n])) holes++;
        }
      expect(cuts).toBeGreaterThan(100); // the place still has its cliff
      expect(holes).toBe(0);
      // islets: land left standing in the cut, smaller than 3 x 3 cells
      const seen = new Uint8Array(size * size);
      let islets = 0;
      for (let k = 0; k < size * size; k++) {
        if (seen[k] || !(h[k]! > 0)) continue;
        const stack = [k],
          cells: number[] = [];
        seen[k] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          cells.push(c);
          const ci = c % size;
          for (const n of near(c)) {
            if (n < 0 || n >= size * size || Math.abs((n % size) - ci) > 1) continue;
            if (!seen[n] && h[n]! > 0) {
              seen[n] = 1;
              stack.push(n);
            }
          }
        }
        if (cells.length < 9 && cells.some((c) => near(c).some((n) => cut[n]))) islets++;
      }
      expect(islets).toBe(0);
    }
  });
  it('cuts a tenth to a fifth of the coast, here and there', () => {
    const out = new Float64Array(4),
      slots = new Uint8Array(4),
      base = new Float64Array(5);
    let coast = 0,
      cut = 0;
    for (let z = -20000; z <= 20000; z += 48)
      for (let x = -20000; x <= 20000; x += 48) {
        sampler.baseFields(x, z, base);
        if (base[0]! < 0.5 || base[0]! > 3) continue;
        coast++;
        sampler.sampleWindow(x, z, out, slots);
        if (out[0]! < base[0]! - 3) cut++;
      }
    const share = cut / coast;
    console.log(`coast samples ${coast}, cut ${cut}, share ${(share * 100).toFixed(1)}%`);
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.2);
  }, 60_000);
});
```

- [ ] **Step 2: Uruchom, żeby zobaczyć porażkę**

Run: `npx vitest run tests/unit/seaCliffsWorld.test.ts`
Expected: FAIL (typ: `cliffs` nie istnieje na `WorldSampler`, `seaCliffs` nie istnieje w opcjach).

- [ ] **Step 3: Wepnij warstwę w sampler**

W `src/engine/terrain/WorldSampler.ts`:

Import pod importem `./noise`:

```ts
import { NO_CLIFFS, SEA_CLIFF, createSeaCliffs, type SeaCliffForm, type SeaCliffs } from './SeaCliffs';
```

W `interface WorldSampler`, po `sampleWindow`:

```ts
  /**
   * The sea cliffs `sampleWindow` adds after the biomes' hooks: the one place
   * the cut is decided, so the route worker, which has no registry, cuts the
   * same coast.
   */
  readonly cliffs: SeaCliffs;
```

Sygnatura i początek `createWorldSampler`:

```ts
export function createWorldSampler(
  seed: number,
  opts: { biomes?: Biome[]; seaCliffs?: SeaCliffForm | false } = {},
): WorldSampler {
```

Po `const raw = new Float64Array(biomes.length);`:

```ts
  // An entry that stands in a country -- a settlement -- is not cut: its share
  // of a texel is taken off the cut, so a village on the shore stands in a cove.
  const settles = biomes.map((b) => b.inherit !== undefined);
```

W obiekcie `sampler` dodaj pole (obok `seeds`), a pod `const fields = createFields(sampler);` utwórz warstwę. Pole ustawiane jest po utworzeniu obiektu, więc w literale:

```ts
    cliffs: NO_CLIFFS,
```

a na końcu fabryki, przed `return sampler;`:

```ts
  // The cliffs read the sampler's own base fields, so they are built after it.
  const cliffs =
    opts.seaCliffs === false
      ? NO_CLIFFS
      : createSeaCliffs((x, z, o) => sampler.baseFields(x, z, o), S3 + 101, opts.seaCliffs ?? SEA_CLIFF);
  (sampler as { cliffs: SeaCliffs }).cliffs = cliffs;
```

W `sampleWindow`, gałąź „bez biblioteki”: `out[0] = scratch[0]!;` zamień na

```ts
        out[0] = scratch[0]! + cliffs.at(x, z, scratch[0]!, 1);
```

Gałąź „nikt nie wziął” (`if (!(sum > 0) || !(w0 > 0))`): to samo zastąpienie.

Na końcu `sampleWindow` zamień `out[0] = h;` na:

```ts
      let settled = 0;
      for (let k = 0; k < SLOTS; k++) if (settles[slots[k]!]) settled += out[k + 1]!;
      // The cut is not a hook: it has its own bounds (SEA_CLIFF) and is not
      // weighed by any biome, or a cliff would end at a biome's border like a
      // block cut off.
      out[0] = h + cliffs.at(x, z, base, 1 - settled);
```

- [ ] **Step 4: Uruchom testy klifów**

Run: `npx vitest run tests/unit/seaCliffsWorld.test.ts tests/unit/worldSampler.test.ts`
Expected: `worldSampler.test.ts` PASS bez zmian (złote wartości). W `seaCliffsWorld.test.ts` pierwsze trzy PASS. Czwarty drukuje udział; jeśli nie jest w (10%, 20%), przesuń oba końce `SEA_CLIFF.cover` o tę samą wartość (w górę = mniej klifów, krokami po 0,05) i uruchom ponownie, aż wejdzie. Zanotuj końcowy `cover` i udział do opisu commita. Jeśli po zmianie `cover` któreś z `PLACES` straci klif (`cuts > 100` pada), weź najbliższe miejsce z największym podcięciem (skan jak w teście udziału, `base - h > 30`), wpisz je do `PLACES` tutaj i w `tests/unit/seaCliffsCost.test.ts`, `tests/unit/routeGround.test.ts`, `tools/cliffs/look.mjs` i vantage'u `cliff` (Task 3, 4, 6). Jeśli pada test dziur albo wysepek, nie luzuj progu: zgłoś to (kształt z Task 1 ma je wykluczać).

- [ ] **Step 5: Cały zestaw i świadome snapshoty**

Run: `npx vitest run`
Expected: pada `ringGolden.test.ts` (4 snapshoty: ring sieje na podciętym brzegu). Inne porażki to nie są zmiany świadome: zbadaj je, zanim cokolwiek zaktualizujesz. Snapshoty:

Run: `npx vitest run tests/unit/ringGolden.test.ts -u`
Expected: PASS, zaktualizowane skróty.

- [ ] **Step 6: Commit**

```bash
git add src/engine/terrain/WorldSampler.ts src/engine/terrain/SeaCliffs.ts tests/unit/seaCliffsWorld.test.ts tests/unit/ringGolden.test.ts
git commit -m "Cut the sea cliffs into the window after the biomes, and give way to a settlement" -m "The ring sows the cut coast, so its digests move on purpose. cover <wartość>, <udział>% of the coast cut." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(W drugim `-m` wpisz zanotowane liczby.)

---

### Task 3: koszt wypełnienia okna

**Files:**
- Test: `tests/unit/seaCliffsCost.test.ts` (uruchamiany tylko z `MEASURE=1`)
- Modify (jeśli trzeba): `src/engine/terrain/SeaCliffs.ts` (`NEWTON_STEPS`, `COAST_NODE`, `CACHE`)
- Modify: `docs/perf-notes.md`

**Interfaces:**
- Consumes: `createWorldSampler(seed, { biomes, seaCliffs: false })` (Task 2), `createHeightfield`.
- Produces: nic nowego dla innych zadań.

- [ ] **Step 1: Napisz pomiar**

`tests/unit/seaCliffsCost.test.ts`:

```ts
// What the sea cliffs cost a full window fill: run with MEASURE=1, never in CI
// (a shared runner measures its own weather). Rounds are interleaved and the
// minimum of each side is kept, the method of docs/perf-notes.md.
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const PLACES = [
  { name: 'cliff', x: 3584, z: -2992 },
  { name: 'cliff 2', x: 2720, z: 2240 },
  { name: 'origin', x: 0, z: 0 },
];

describe.runIf(process.env.MEASURE)('what the sea cliffs cost a fill', () => {
  it('times a full window with and without them', () => {
    for (const place of PLACES) {
      const best = { with: Infinity, without: Infinity };
      for (let round = 0; round < 3; round++)
        for (const side of ['without', 'with'] as const) {
          const sampler = createWorldSampler(42, {
            biomes: lib.biomes,
            ...(side === 'without' ? { seaCliffs: false as const } : {}),
          });
          const hf = createHeightfield(sampler);
          const t = performance.now();
          hf.fillAll(Math.round(place.x / 16), Math.round(place.z / 16));
          best[side] = Math.min(best[side], performance.now() - t);
        }
      const more = best.with / best.without - 1;
      console.log(
        `${place.name}: ${best.without.toFixed(0)} ms without, ${best.with.toFixed(0)} ms with, +${(more * 100).toFixed(1)}%`,
      );
      expect(more).toBeLessThan(0.08);
    }
  }, 120_000);
});
```

- [ ] **Step 2: Zmierz**

Run: `MEASURE=1 npx vitest run tests/unit/seaCliffsCost.test.ts --silent=false`
(PowerShell: `$env:MEASURE='1'; npx vitest run tests/unit/seaCliffsCost.test.ts --silent=false`)
Expected: trzy linie z milisekundami. Probe dał ok. +15–20%, więc najpewniej FAIL przy `cliff`.

- [ ] **Step 3: Dźwignie, po kolei, każda z pomiarem**

Po każdej zmianie: `npx vitest run tests/unit/seaCliffs.test.ts tests/unit/seaCliffsWorld.test.ts` (kształt, dziury, wysepki i udział muszą dalej przechodzić) i pomiar ze Step 2. Zatrzymaj się na pierwszej, przy której wszystkie trzy miejsca są poniżej +8%.

1. `const NEWTON_STEPS = 2;`
2. Pierwszy krok Newtona różnicami jednostronnymi (dwie próbki zamiast czterech) — w pętli `node`:

```ts
    for (let k = 0; k < NEWTON_STEPS; k++) {
      const gx =
        k === 0 ? (height(x + E, z) - h) / E : (height(x + E, z) - height(x - E, z)) / (2 * E);
      const gz =
        k === 0 ? (height(x, z + E) - h) / E : (height(x, z + E) - height(x, z - E)) / (2 * E);
```

3. `export const COAST_NODE = 96;`
4. `const CACHE = 8192;`

Jeśli po czterech dźwigniach nadal jest ponad +8%, nie zmieniaj budżetu: zapisz liczby i zgłoś właścicielowi.

- [ ] **Step 4: Zapisz liczby**

Na końcu `docs/perf-notes.md` dopisz sekcję (liczby z ostatniego pomiaru, maszyna tak jak w innych sekcjach):

```markdown
## Sea cliffs: what the cut costs a fill

A full window fill (313 600 texels, `fillAll`), seed 42, Node <wersja> on
<maszyna>, minimum of three interleaved rounds (`MEASURE=1 npx vitest run
tests/unit/seaCliffsCost.test.ts`):

| Place | Without | With | More |
| --- | --- | --- | --- |
| cliff (3584, -2992) | … ms | … ms | +…% |
| cliff 2 (2720, 2240) | … ms | … ms | +…% |
| origin | … ms | … ms | +…% |

The probe paid +15 to 20 % with three Newton steps a node on a 64 m lattice;
<które dźwignie weszły i co dały>.
```

Zastąp wielokropki i nawiasy ostrymi zmierzonymi wartościami; w tabeli nie może zostać nic nieuzupełnionego.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/seaCliffsCost.test.ts src/engine/terrain/SeaCliffs.ts docs/perf-notes.md
git commit -m "Keep what the sea cliffs cost a window fill under eight per cent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: drogi widzą klify

**Files:**
- Create: `src/engine/scenery/RouteGround.ts`
- Modify: `src/engine/scenery/routes.worker.ts`
- Modify: `src/engine/scenery/Roads.ts:36-41` (`RouteJob`) i `:113-121` (tworzenie zadania)
- Test: `tests/unit/routeGround.test.ts`

**Interfaces:**
- Consumes: `WorldSampler.cliffs` (Task 2), `sstep` z `terrain/noise.ts`.
- Produces:
  - `export interface RouteEnd { x: number; z: number; radius: number }`
  - `export const END_FEATHER = 150`
  - `export function routeGround(sampler: WorldSampler, ends: readonly RouteEnd[]): (x: number, z: number) => number`
  - `RouteJob.a`, `RouteJob.b`: `{ id: string; x: number; z: number; radius: number }`

- [ ] **Step 1: Napisz testy**

`tests/unit/routeGround.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { END_FEATHER, routeGround } from '../../src/engine/scenery/RouteGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

// The worker's sampler has no registry; the cliffs are the world's all the same.
const sampler = createWorldSampler(42);

const cutPoint = () => {
  const out = new Float64Array(5);
  for (let r = 0; r <= 600; r += 16)
    for (let a = 0; a < 32; a++) {
      const x = 3584 + Math.cos((a / 32) * Math.PI * 2) * r,
        z = -2992 + Math.sin((a / 32) * Math.PI * 2) * r;
      sampler.baseFields(x, z, out);
      if (sampler.cliffs.at(x, z, out[0]!, 1) < -20) return { x, z, b: out[0]! };
    }
  throw new Error('no cut near the cliff of seed 42');
};

describe('routeGround', () => {
  it('is the cut coast away from the ends of the route', () => {
    const { x, z, b } = cutPoint();
    const ground = routeGround(sampler, [{ x: x + 5000, z, radius: 300 }]);
    expect(ground(x, z)).toBe(b + sampler.cliffs.at(x, z, b, 1));
    expect(ground(x, z)).toBeLessThan(b - 20);
  });
  it('gives a settlement at either end its cove back, over its feather', () => {
    const { x, z, b } = cutPoint();
    expect(routeGround(sampler, [{ x, z, radius: 200 }])(x, z)).toBe(b);
    const edge = routeGround(sampler, [{ x: x + 200 + END_FEATHER / 2, z, radius: 200 }])(x, z);
    expect(edge).toBeGreaterThan(b + sampler.cliffs.at(x, z, b, 1));
    expect(edge).toBeLessThan(b);
  });
});
```

- [ ] **Step 2: Uruchom, żeby zobaczyć porażkę**

Run: `npx vitest run tests/unit/routeGround.test.ts`
Expected: FAIL, brak modułu `RouteGround`.

- [ ] **Step 3: Napisz moduł**

`src/engine/scenery/RouteGround.ts`:

```ts
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

export function routeGround(sampler: WorldSampler, ends: readonly RouteEnd[]): (x: number, z: number) => number {
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
```

- [ ] **Step 4: Worker i zadanie trasy**

`src/engine/scenery/Roads.ts`, interfejs:

```ts
export interface RouteJob {
  id: string;
  seed: number;
  a: { id: string; x: number; z: number; radius: number };
  b: { id: string; x: number; z: number; radius: number };
}
```

W `next()`:

```ts
        a: { id: job.a.id, x: job.a.x, z: job.a.z, radius: job.a.radius },
        b: { id: job.b.id, x: job.b.x, z: job.b.z, radius: job.b.radius },
```

`src/engine/scenery/routes.worker.ts` — komentarz na górze i ciało:

```ts
// Searching a road between two settlements off the main thread: 14 to 45 ms
// over nine thousand samples of the ground, and past a hundred round a bay,
// which a frame cannot pay. The ground is the base height with the sea cliffs
// cut into it (RouteGround), which the registry does not touch, so the worker
// builds a sampler with no biomes and never loads the library.
import { createWorldSampler, type WorldSampler } from '../terrain/WorldSampler';
import type { RouteJob } from './Roads';
import { routeBetween } from './Route';
import { routeGround } from './RouteGround';

const samplers = new Map<number, WorldSampler>();

self.addEventListener('message', (event: MessageEvent<RouteJob>) => {
  const job = event.data;
  let sampler = samplers.get(job.seed);
  if (!sampler) samplers.set(job.seed, (sampler = createWorldSampler(job.seed)));
  const heightAt = routeGround(sampler, [job.a, job.b]);
  const route = routeBetween(job.a, job.b, heightAt, job.seed);
  const points = route ? new Float64Array(route.flat()) : null;
  (self as unknown as Worker).postMessage({ id: job.id, points }, points ? [points.buffer] : []);
});
```

- [ ] **Step 5: Testy**

Run: `npx tsc --noEmit && npx vitest run tests/unit/routeGround.test.ts tests/unit/roads.test.ts tests/unit/route.test.ts tests/unit/routeWinding.test.ts`
Expected: PASS. Jeśli `tsc` zgłasza atrapę `RouteJob` bez `radius` w teście, dopisz tam `radius` z obiektu `Site`, który atrapa już ma.

- [ ] **Step 6: Commit**

```bash
git add src/engine/scenery/RouteGround.ts src/engine/scenery/routes.worker.ts src/engine/scenery/Roads.ts tests/unit/routeGround.test.ts
git commit -m "Search the roads over the cut coast, with a cove kept at either end" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: lot nad klifem

**Files:**
- Test: `tests/unit/flightController.test.ts` (nowy `it` w `describe('createFlightController')`)

**Interfaces:**
- Consumes: `createFlightController`, `CLIMB`, `MIN_CLEARANCE` (już importowane w pliku), pomocnik `hold` z tego pliku.
- Produces: nic.

- [ ] **Step 1: Napisz test**

Po teście `keeps the floor and the ceiling while the pilot flies by hand` dopisz:

```ts
  it('climbs a sea cliff no faster than it can climb, flown by hand or not', () => {
    // a face 32 m wide out of water 7 m deep: what SeaCliffs stands on a coast
    const smooth = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    for (const pilot of [false, true])
      for (const tall of [60, 160]) {
        const groundAt = (x: number) => -7 + (tall + 7) * smooth(1000, 1032, x);
        const c = createFlightController({
          seed: 1,
          groundAt,
          pulls: hold(Math.PI / 2),
          start: { heading: Math.PI / 2, y: 30 },
          schedule: () => 0,
        });
        if (pilot) c.fly(0, 0); // the pilot has the stick and holds the height
        let prev = c.state.y,
          fastest = 0,
          minClearance = Infinity;
        for (let i = 0; i < 1200; i++) {
          c.step(0.05);
          fastest = Math.max(fastest, (c.state.y - prev) / 0.05);
          prev = c.state.y;
          minClearance = Math.min(minClearance, c.clearance());
        }
        expect(c.state.x).toBeGreaterThan(1100); // it went over the cliff
        expect(minClearance).toBeGreaterThanOrEqual(MIN_CLEARANCE - 1e-9);
        expect(fastest).toBeLessThanOrEqual(CLIMB + 1e-6);
      }
  });
```

- [ ] **Step 2: Uruchom**

Run: `npx vitest run tests/unit/flightController.test.ts`
Expected: PASS (w probe kontroler wznosił się najwyżej 14,3 m/s, czyli `CLIMB`, w obu trybach). Jeśli pada na `fastest`, nie poprawiaj kontrolera w tym zadaniu: zgłoś to właścicielowi z liczbami (to zmiana lotu, spoza tego specu).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/flightController.test.ts
git commit -m "Hold the flight to its own climb over a sea cliff, in either mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: wygląd ściany

**Files:**
- Modify: `src/engine/terrain/TerrainMesh.ts` (importy TSL; po normalnej komórki; przed `colorNode`; w `colorNode` po `seaFloor`; `litMaterial(...)`; `normalNode`)
- Create: `tools/cliffs/look.mjs`
- Modify: `tools/vantages.ts` (opcjonalny `heading`, vantage `cliff`)

**Interfaces:**
- Consumes: teren z klifami (Task 2).
- Produces: `Vantage.heading?: number` w `tools/vantages.ts`; vantage `cliff` dla `npm run bench` i `npm run parity`.

- [ ] **Step 1: Narzędzie do zdjęć**

`tools/cliffs/look.mjs`:

```js
// Photograph a sea cliff of seed 42 from the sea.
//
//     npm run build && npm run preview       # in another shell
//     node tools/cliffs/look.mjs OUT_DIR [X Z UX UZ]
//
// (X, Z) is a point on the cliff and (UX, UZ) the way inland from it; the
// default is the cliff at (3584, -2992). Five pictures at noon: from the sea
// 450 m out at 45 m, close (230 m out, 35 m), from the side at 70 m, from
// 300 m and from 1000 m -- the last one where the face goes over into the far
// grid. `GPU=1` asks for this machine's GPU (ANGLE on D3D11) instead of
// SwiftShader, `PHASE` moves the hour, and `CHROMIUM` names the browser.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [out, cx = '3584', cz = '-2992', ux = '0.697', uz = '0.718'] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/cliffs/look.mjs OUT_DIR [X Z UX UZ]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const C = { x: Number(cx), z: Number(cz) },
  U = { x: Number(ux), z: Number(uz) },
  V = { x: U.z, z: -U.x };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: process.env.GPU
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console:', m.text());
});
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  localStorage.setItem(
    'dreamfall-settings',
    JSON.stringify({ volume: 0, muted: true, camera: { yaw: 0, pitch: 0.08, dist: 9 }, view: 'tpp' }),
  );
});
await page.goto('http://localhost:4173/?seed=42&webgl=1');
await page.waitForFunction(() => window.__world?.ready === true, null, { timeout: 600_000 });
await page.click('#beginBtn');
await page.evaluate((phase) => {
  const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
  w.skipOpening();
  w.setPaused(true);
  w.dayPhase = phase;
}, Number(process.env.PHASE ?? 0.42));
// A jump reads the ground under the new place from the window it leaves, so
// the first one only brings the window there.
await page.evaluate(({ x, z }) => window.__world?.jump(x, z, 400), C);

/** A vantage `back` metres out to sea from the cliff, `side` along it, at `y` over the sea. */
const at = (/** @type {number} */ back, /** @type {number} */ side, /** @type {number} */ y) => {
  const x = C.x - U.x * back + V.x * side,
    z = C.z - U.z * back + V.z * side;
  return { x, z, y, heading: Math.atan2(C.x - x, C.z - z) };
};
const shots = {
  low: at(450, 0, 45),
  near: at(230, 140, 35),
  side: at(260, 900, 70),
  mid: at(900, 250, 300),
  high: at(1800, 0, 1000),
};
for (const [name, s] of Object.entries(shots)) {
  const info = await page.evaluate((s) => {
    const w = /** @type {NonNullable<Window['__world']>} */ (window.__world);
    w.jump(s.x, s.z, 50);
    w.jump(s.x, s.z, s.y - w.heightAt(s.x, s.z));
    w.state.heading = s.heading;
    for (let i = 0; i < 3; i++) w.step(1 / 60);
    w.settleScenery();
    return { y: Math.round(w.state.y), ground: Math.round(w.heightAt(s.x, s.z)) };
  }, s);
  // Real frames, each in an animation frame of its own (AGENTS.md, the loop).
  for (let i = 0; i < 3; i++)
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => {
            window.__world?.frame(1 / 60);
            done(null);
          }),
        ),
    );
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name, JSON.stringify(info));
}
await browser.close();
```

Vantage klifu dla benchu i parity, w `tools/vantages.ts` — w `interface Vantage` po `phase`:

```ts
  /** Where the camera looks, radians; the flight's own heading when unset. */
  heading?: number;
```

na końcu listy `VANTAGES`:

```ts
  // A sea cliff from 450 m out at sea, at 45 m: the wall's branch of the
  // ground shader on screen (docs/superpowers/specs/2026-09-28-klify-nadmorskie-design.md).
  { name: 'cliff', x: 3270, z: -3315, above: 45, phase: 0.42, heading: 0.771 },
```

i w `settle`, w `page.evaluate`:

```ts
  await page.evaluate((v) => {
    window.__world!.jump(v.x, v.z, v.above);
    window.__world!.dayPhase = v.phase;
    if (v.heading !== undefined) window.__world!.state.heading = v.heading;
  }, vantage);
```

Run: `npx tsc --noEmit`
Expected: bez błędów w `tools/cliffs/look.mjs` i `tools/vantages.ts` (pliki `.mjs` są sprawdzane przez `checkJs`).

- [ ] **Step 2: Zdjęcia „przed”**

Uruchom podgląd (`npm run build`, potem serwer `preview` z `.claude/launch.json`, port 4173) i:

Run: `node tools/cliffs/look.mjs <scratch>/before` oraz `node tools/cliffs/look.mjs <scratch>/before2 2720 2240 -0.184 -0.983` (z `GPU=1` na maszynie z GPU)
Expected: pięć zdjęć na miejsce; klif stoi (Task 2), ściana ma trójkąty w świetle i jeden kolor, a piasek sięga na nią do 7,5 m.

Run: `npm run bench`
Expected: sześć vantage'y z medianą ramki; zanotuj je jako „przed”.

- [ ] **Step 3: Normalna ściany**

`src/engine/terrain/TerrainMesh.ts`, importy TSL — do listy z `three/tsl` dodaj `cameraPosition` i `cross` (alfabetycznie, po `abs`):

```ts
  abs,
  cameraPosition,
  cross,
  float,
```

Po bloku `if (deps.coarse) { ... surfaceNormal = ... }` i przed `const normalV = varying(surfaceNormal).normalize();`:

```ts
  // The light on a cliff. A normal from one cell either side flips between
  // neighbouring vertices of a face two cells wide -- one at its top, one at
  // its foot -- and the light draws the triangles. Two cells either side is
  // one normal for the whole face. Only the light takes it: the slope the
  // biomes and the snow read is the cell's own, as it was.
  const wideNormal = normalize(
    vec3(
      loadCell(ix.sub(2), iz).x.sub(loadCell(ix.add(2), iz).x),
      cell * 4,
      loadCell(ix, iz.sub(2)).x.sub(loadCell(ix, iz.add(2)).x),
    ),
  );
  let lightNormal: Node<'vec3'> = normalize(
    mix(
      ownNormal,
      wideNormal,
      smoothstep(0.3, 0.55, float(1).sub(ownNormal.y)).mul(float(1).sub(smoothstep(180, 240, ownHeight))),
    ),
  );
  if (deps.coarse) {
    const rim = smoothstep(NEAR_REACH - MORPH, NEAR_REACH, max(abs(positionLocal.x), abs(positionLocal.z)));
    lightNormal = normalize(mix(lightNormal, surfaceNormal, rim));
  }
  const lightV = varying(lightNormal).normalize();
```

- [ ] **Step 4: Waga ściany i rzeźba skały**

Przed `const colorNode = Fn(() => {`:

```ts
  // How much of a fragment is a cliff's wall: steep, and low enough not to be
  // a mountain's face, which keeps its own look (the snow, the alpine rock).
  const wallAt = smoothstep(0.42, 0.7, float(1).sub(lightV.y).max(slope)).mul(
    float(1).sub(smoothstep(180, 240, positionWorld.y)),
  );
  // The rock's relief on a wall, in metres: strata, ledges every 4.5 m, cracks
  // cut in, and a little grain. It only bends the light (the bump below).
  const relief = (p: Node<'vec3'>) =>
    mx_noise_float(vec3(p.x.mul(0.01), p.y.mul(0.16), p.z.mul(0.01)))
      .mul(0.9)
      .add(
        smoothstep(
          0.55,
          0.8,
          fract(p.y.div(4.5).add(mx_noise_float(vec3(p.x.mul(0.006), p.y.mul(0.02), p.z.mul(0.006))).mul(1.5))),
        ).mul(0.5),
      )
      .sub(
        float(1)
          .sub(smoothstep(0.02, 0.09, abs(mx_noise_float(vec3(p.x.mul(0.07), p.y.mul(0.0015), p.z.mul(0.07))))))
          .mul(0.8),
      )
      .add(mx_noise_float(p.mul(0.15)).mul(0.35));
```

- [ ] **Step 5: Kolor ściany**

W `colorNode`, zaraz po `ground.assign(mix(palette.seaFloor, ground, smoothstep(-10.0, 0.5, h)));`:

```ts
    // A cliff's wall is the biome's rock in more than one colour. Noise over
    // world x and z smears into streaks on a wall, so everything here is 3D:
    // strata that change fast with height and slowly along the wall, ledges
    // every 4.5 m, thin cracks and water streaks running down it, lichen, and
    // a wet foot. The cracks and streaks are read along the wall (`run`), not
    // over x and z: a face that leans moves in x and z as it rises, and a crack
    // read there wanders like handwriting.
    If(wallAt.greaterThan(0.01), () => {
      const x = worldXZ.x,
        z = worldXZ.y;
      const run = worldXZ.dot(normalize(vec2(lightV.z.negate(), lightV.x).add(vec2(0.0001, 0))));
      const bands = mx_noise_float(vec3(x.mul(0.01), h.mul(0.16), z.mul(0.01)));
      const ledges = smoothstep(
        0.55,
        0.8,
        fract(h.div(4.5).add(mx_noise_float(vec3(x.mul(0.006), h.mul(0.02), z.mul(0.006))).mul(1.5))),
      ).sub(0.5);
      const crack = float(1).sub(smoothstep(0.02, 0.08, abs(mx_noise_float(vec2(run.mul(0.08), h.mul(0.004))))));
      const streak = mx_noise_float(vec2(run.mul(0.22), h.mul(0.01))).max(0);
      const lichen = smoothstep(0.3, 0.6, mx_noise_float(vec3(x.mul(0.035), h.mul(0.05), z.mul(0.035))));
      const stone = mix(ground.mul(vec3(0.88, 0.96, 1.06)), ground.mul(vec3(1.12, 1.03, 0.86)), bands.mul(0.5).add(0.5)).toVar();
      stone.assign(mix(stone, vec3(0.62, 0.6, 0.46), lichen.mul(0.3)));
      stone.mulAssign(float(0.88).add(bands.mul(0.2)).add(ledges.mul(0.16)).sub(streak.mul(0.28)).sub(crack.mul(0.4)));
      stone.assign(mix(stone, stone.mul(vec3(0.5, 0.56, 0.5)), smoothstep(7, 1.5, h).mul(0.85)));
      ground.assign(mix(ground, stone, wallAt));
    });
```

- [ ] **Step 6: Piasek nie na ścianie i rzeźba w świetle**

Linia materiału:

```ts
  // Sand lies on the shore, never up a wall: the steepness takes it off.
  const material = litMaterial(
    mix(palette.sand, colorNode, max(smoothstep(1.5, 7.5, h), smoothstep(0.3, 0.5, slope))).mul(brush),
  );
```

`material.normalNode = transformNormalToView(normalV);` zamień na:

```ts
  // The light's normal: the wall's own, bent by the rock's relief. Finite
  // differences along the wall and up it, in metres, rather than screen
  // derivatives, which are undefined inside a branch that not every fragment
  // of a quad takes. Faded out with distance, where it would only shimmer.
  const bumped = Fn(() => {
    const n = lightV.toVar();
    If(wallAt.greaterThan(0.01), () => {
      const p = vec3(worldXZ.x, h, worldXZ.y);
      const along = normalize(cross(n, vec3(0, 1, 0)).add(vec3(0.0001, 0, 0)));
      const up = cross(along, n);
      const e = 0.5;
      const h0 = relief(p);
      const ga = relief(p.add(along.mul(e))).sub(h0).div(e);
      const gu = relief(p.add(up.mul(e))).sub(h0).div(e);
      const fade = wallAt.mul(float(1).sub(smoothstep(300, 1200, positionWorld.distance(cameraPosition))));
      n.assign(normalize(n.sub(along.mul(ga.mul(fade))).sub(up.mul(gu.mul(fade)))));
    });
    return n;
  })();
  material.normalNode = transformNormalToView(bumped);
```

Run: `npx tsc --noEmit && npx eslint src/engine/terrain/TerrainMesh.ts && npx prettier --write src/engine/terrain/TerrainMesh.ts`
Expected: bez błędów.

- [ ] **Step 7: Zdjęcia „po” i dobór jasności**

Run: `npm run build`, potem te same dwa polecenia co w Step 2 do `<scratch>/after` i `<scratch>/after2`.
Expected, i to sprawdzasz na każdym z dziesięciu zdjęć:
- na ścianie nie ma trójkątów w świetle (`low`, `near`);
- krawędź nie jest piłą tam, gdzie klif przechodzi w plażę (`low` drugiego miejsca, prawa strona);
- przed klifem nie ma jasnego pasa mielizny (`mid`);
- widać ławice, pionowe spękania i ciemną stopę (`near`);
- na `high` klif przechodzi w daleką siatkę bez szczeliny i bez skoku światła.
Jeśli któryś punkt nie przechodzi, stroisz tylko liczby jasności i barw z Step 5 (`0.88`, `0.2`, `0.16`, `0.28`, `0.4`, barwy `warm`/`cool`), nie kształt z Task 1. Pokaż zdjęcia „po” właścicielowi przed commitem.

- [ ] **Step 8: Bench „po”**

Run: `npm run bench`
Expected: bench przechodzi z sześcioma vantage'ami. Liczby wszystkich vantage'y „przed” (Step 2) i „po” zapisz do `docs/perf-notes.md`, w sekcji z Task 3, pod nagłówkiem „The wall's branch”, w tabeli vantage × przed × po. Przyrost poza `cliff` ma być w szumie pomiaru (gałąź ściany nie działa tam, gdzie nie ma ściany); jeśli nie jest, zgłoś to z liczbami.

- [ ] **Step 9: Przeglądarka**

Run: `npm run test:e2e:gpu` (na maszynie z GPU; w przeciwnym razie `npm run test:e2e`)
Expected: PASS, bez nowych błędów konsoli (`uncapturederror` jest fatalny). Jeśli pada `start.h` w `smoke.spec.ts` (43,886), sprawdź `sampleWindow(0, 0)`: gdy klif sięga startu, zaktualizuj wartość świadomie i napisz to w opisie commita.

- [ ] **Step 10: Commit**

```bash
git add src/engine/terrain/TerrainMesh.ts tools/cliffs/look.mjs tools/vantages.ts docs/perf-notes.md
git commit -m "Give a cliff's wall one light and more than one colour" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `AGENTS.md`, pełna kontrola, sprzątanie

**Files:**
- Modify: `AGENTS.md` (lista czystych modułów; nowy punkt w „Terrain, sky and time”)

**Interfaces:**
- Consumes: wszystko powyżej.
- Produces: nic.

- [ ] **Step 1: Lista czystych modułów**

W `AGENTS.md`, w liście czystych modułów CPU, po `terrain/Lod.ts,` dopisz `terrain/SeaCliffs.ts,`, a po `scenery/Route.ts` dopisz `scenery/RouteGround.ts`.

- [ ] **Step 2: Punkt o klifach**

W sekcji „Terrain, sky and time”, po punkcie o `WorldSampler` (golden values), dopisz:

```markdown
- **Here and there the sea has cut into the land** (`terrain/SeaCliffs.ts`):
  within 70 to 190 m of the base water line the land is taken down to 7 m
  under the sea, and the face stands where the cut ends, as tall as the land
  is there, so a cliff rises where high land meets the sea and a low coast
  stays a beach. It is a world layer added in `sampleWindow` after the hooks,
  weighed by no biome (a hook's weight ended a cliff at a biome's border like
  a block cut off) and by one minus a settlement's share, so a village on the
  shore stands in a cove. Where the water line is, whether it is the sea (a
  pond is shallow 300 m past its line) and how tall the land at the front
  stands are asked of **a lattice of nodes every 64 m**, each a pure function
  of its indices, read bilinearly: asked of the point, the distance is noise
  and the cut is full of holes. The face is 32 m wide and never less: a
  narrower step saws along the 16 m grid. `sample` and `baseFields` do not
  see it, so the golden values hold; the route worker searches over it
  (`scenery/RouteGround.ts`) with a cove kept at both ends. On the GPU a wall
  takes its light from a normal two cells either side and bent by the rock's
  relief, and its colour from 3D noise read along the wall
  (`TerrainMesh.ts`); `tools/cliffs/look.mjs` photographs one.
```

- [ ] **Step 3: Pełna kontrola**

Run: `npm run check`
Expected: PASS (typy, lint, format, testy, build). `seaCliffsCost.test.ts` jest pominięty bez `MEASURE`.

Run: `npm run test:e2e:gpu` (albo `npm run test:e2e`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "Tell the next change where the sea cliffs are cut, and why that way" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Sprzątanie po probe (za zgodą właściciela)**

Zapytaj właściciela, czy usunąć gałąź `spike/klify-nadmorskie` i stash `spike: klify nadmorskie (probe 1-3, z wygladem scian)`. Dopiero po „tak”:

```bash
git branch -D spike/klify-nadmorskie
git stash list
git stash drop stash@{N}
```

(`N` to numer tej pozycji z `git stash list`.) Zamknij karty przeglądarki otwarte do testów.

# Drzewa, krok 1: jedno sianie i grunt poza oknem — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wydzielić z `Ring.ts` sianie drzew jednej komórki do `scenery/Sowing.ts` i dodać `terrain/SampledGround.ts`, który odpowiada jak bliskie okno także poza nim — bez żadnej zmiany w tym, co pierścień sadzi.

**Architecture:** `Sowing` trzyma `Cell` podawany hookom, strumienie komórki, kraj pod komórką i sadzenie drzewa; pierścień woła go dla każdej komórki i sam zostaje przy rekwizytach, nadpisaniach, przeszkodach, planach i drogach. Grunt jest interfejsem `GroundQuery` (`heightAt`, `slopeAt`, `weightsAt`), który `Heightfield` spełnia strukturalnie, a `SampledGround` spełnia wszędzie, próbkując generator tym samym wywołaniem, którym okno wypełnia texel. Najpierw test charakteryzujący zamraża to, co pierścień sadzi dziś.

**Tech Stack:** TypeScript, Vitest (Node), three (tylko `Color`), biblioteka `library/` (JS + JSDoc).

**Spec:** `docs/superpowers/specs/2026-09-27-drzewa-daleko-i-w-osadach-design.md` (sekcje 4.1, 4.2, 6, 7 krok 1).

## Global Constraints

- Kod, identyfikatory, komentarze i commity po angielsku; plan po polsku.
- Brak singletonów modułowych: stan w obiektach zwracanych przez fabryki (`createSowing`, `createSampledGround`).
- `scenery/Sowing.ts` i `terrain/SampledGround.ts` to czysty CPU: nie importują `three/webgpu`, `three/tsl` ani DOM; z `three` biorą tylko klasy matematyki (`Color`).
- **Nic na CPU nie czyta dalekiego okna** (`farField`). `SampledGround` próbkuje generator albo czyta bliskie okno.
- Pierścień sadzi **identycznie** jak przed zmianą: te same drzewa, rekwizyty, kolejność losowań.
- Komentarze w stylu repozytorium: pełne zdania mówiące „dlaczego”, bez oczywistości.
- `npm run check` (typy, lint, format, testy, build) przechodzi na końcu każdego zadania, które dotyka `src/`.

## Review Focus

1. Punkt, którego trójkąt leży na krawędzi bliskiego okna (część texeli w oknie, część poza) — `SampledGround` z oknem musi dać to samo co bez okna. Test w zadaniu 2.
2. Ujemne współrzędne świata (`Math.floor` vs `Math.round`, kodowanie klucza pamięci podręcznej) — test w zadaniu 2.
3. Okno jeszcze niewypełnione (`version === 0`) — `SampledGround` nie może czytać jego zer. Test w zadaniu 2.
4. Pula gatunku pełna w środku komórki (`sink.tree` zwraca `false`) — kolejne drzewa komórki losują te same liczby co dziś. Pokrywa istniejący test w `ring.test.ts` i test w zadaniu 3.
5. Rekwizyty czytają `cell.share` z poprzedniego biomu poprzedniej komórki (dzisiejsze zachowanie) — `enter` nie może zerować `share`. Pokrywa test charakteryzujący z zadania 1 (zawiera rekwizyty).

---

### Task 1: Test charakteryzujący pierścień na prawdziwej bibliotece

Zamraża dzisiejsze wyniki, zanim cokolwiek się zmieni. Wartości wpisuje sam Vitest (`toMatchInlineSnapshot`) przy pierwszym uruchomieniu.

**Files:**
- Create: `tests/unit/ringGolden.test.ts`

**Interfaces:**
- Consumes: `createRing`, `ScenerySink` (`src/engine/scenery/Ring.ts`), `createLibrary` (`library/index.js`), `createWorldSampler`, `createHeightfield`, `createObstacles`, `createOverrides`.
- Produces: nic dla innych zadań poza testem, który musi przechodzić po zadaniu 3.

- [ ] **Step 1: Napisz test**

```ts
// What the ring puts up over the real library, frozen before the sowing was
// lifted out of it (scenery/Sowing.ts). Every tree and prop of three places of
// seed 42, digested: a change to what the ring sows moves the digest, and the
// refactor that made the far trees possible must not have.
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createRing, type ScenerySink } from '../../src/engine/scenery/Ring';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/** 32-bit FNV-1a over a string: enough to tell two sowings apart. */
const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });

const sow = (x: number, z: number) => {
  // 192 texels of 16 m reach 1.5 km either way: the ring's 1.2 km, a cell's
  // overhang and the slope's neighbour, with room to spare.
  const heightfield = createHeightfield(sampler, { size: 192 });
  heightfield.fillAll(Math.round(x / 16), Math.round(z / 16));
  const rows: string[] = [];
  let trees = 0,
    props = 0;
  const sink: ScenerySink = {
    begin() {
      rows.length = 0;
      trees = props = 0;
    },
    tree(t) {
      trees++;
      rows.push(
        `t ${t.species} ${t.x.toFixed(3)} ${t.z.toFixed(3)} ${t.y.toFixed(3)} ${t.scale.toFixed(4)} ${t.tall.toFixed(4)} ${t.yaw.toFixed(4)} ${t.tint.getHexString()}`,
      );
      return true;
    },
    prop(p) {
      props++;
      rows.push(
        `p ${p.prop} ${p.x.toFixed(3)} ${p.z.toFixed(3)} ${p.y.toFixed(3)} ${p.scale.map((s) => s.toFixed(3)).join(',')} ${p.yaw.toFixed(4)} ${p.sink.toFixed(3)} ${p.tint.getHexString()}`,
      );
      return true;
    },
    structure: () => true,
    site() {},
    end() {},
  };
  const ring = createRing({
    seed: 42,
    library: lib,
    sampler,
    heightfield,
    obstacles: createObstacles(),
    overrides: createOverrides(),
    metrics: {
      species: () => ({ top: 12, radius: 4 }),
      prop: () => ({ radius: 2, height: 2 }),
      structure: () => null,
    },
    sink,
    propKit: {
      sstep: (a: number, b: number, v: number) => Math.max(0, Math.min(1, (v - a) / (b - a || 1))),
    } as never,
    radius: 1200,
  });
  ring.update(x, z, true);
  return { trees, props, digest: fnv(rows.join('\n')) };
};

describe('the ring over the real library', () => {
  it('sows the origin as it always has', () => {
    expect(sow(0, 0)).toMatchInlineSnapshot();
  });
  it('sows the woods as it always has', () => {
    expect(sow(-48000, -42000)).toMatchInlineSnapshot();
  });
  it('sows a third place as it always has', () => {
    expect(sow(20000, -15000)).toMatchInlineSnapshot();
  });
});
```

- [ ] **Step 2: Uruchom, żeby Vitest wpisał wartości**

Run: `npx vitest run tests/unit/ringGolden.test.ts`
Expected: 3 passed; plik ma teraz wypełnione `toMatchInlineSnapshot(...)` z `trees`, `props`, `digest`. Sprawdź, że w każdym `trees > 0`; jeśli w którymś miejscu `props` wynosi 0, to w porządku (kraina bez rekwizytów), ale przynajmniej jedno miejsce musi mieć `props > 0` — inaczej zamień trzecie miejsce na inne (np. `(-30000, 25000)`) i uruchom ponownie, aż tak będzie.

- [ ] **Step 3: Uruchom drugi raz, bez zapisu**

Run: `npx vitest run tests/unit/ringGolden.test.ts`
Expected: 3 passed, plik się nie zmienia (`git diff --stat` pokazuje tylko nowy plik).

- [ ] **Step 4: Format i commit**

```bash
npx prettier --write tests/unit/ringGolden.test.ts
git add tests/unit/ringGolden.test.ts
git commit -m "Freeze what the ring sows over the real library

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `terrain/SampledGround.ts`

**Files:**
- Create: `src/engine/terrain/SampledGround.ts`
- Test: `tests/unit/sampledGround.test.ts`

**Interfaces:**
- Consumes: `WorldSampler.sampleWindow(x, z, out, slots)`, `CELL` (`WorldSampler.ts`), `Heightfield` (`cell`, `size`, `version`, `center`, `texel`, `weightsAt`).
- Produces:
  - `interface GroundQuery { heightAt(x: number, z: number): number; slopeAt(x: number, z: number): number; weightsAt(x: number, z: number, ids: Uint8Array, weights: Float32Array): void }`
  - `interface SampledGround extends GroundQuery { readonly cached: number }`
  - `const GROUND_CACHE = 8192`
  - `function createSampledGround(sampler: WorldSampler, window?: Heightfield): SampledGround`

- [ ] **Step 1: Napisz testy**

```ts
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { GROUND_CACHE, createSampledGround } from '../../src/engine/terrain/SampledGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';
import { mulberry32 } from '../../src/engine/terrain/noise';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });

/** A window of 64 texels (±512 m) filled around a point, in metres. */
const windowAt = (x: number, z: number) => {
  const hf = createHeightfield(sampler, { size: 64 });
  hf.fillAll(Math.round(x / 16), Math.round(z / 16));
  return hf;
};

/** Everything a GroundQuery answers at one point, as plain numbers. */
const ask = (
  g: {
    heightAt(x: number, z: number): number;
    slopeAt(x: number, z: number): number;
    weightsAt(x: number, z: number, i: Uint8Array, w: Float32Array): void;
  },
  x: number,
  z: number,
) => {
  const ids = new Uint8Array(4),
    weights = new Float32Array(4);
  g.weightsAt(x, z, ids, weights);
  return { h: g.heightAt(x, z), s: g.slopeAt(x, z), ids: [...ids.slice(0, 3)], w: [...weights.slice(0, 3)] };
};

/** Points well inside a window centred on (cx, cz): 400 m of its 512, so every neighbour is in it. */
const pointsNear = (cx: number, cz: number, n: number, seed: number) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => [cx + (r() - 0.5) * 800, cz + (r() - 0.5) * 800] as const);
};

describe('SampledGround', () => {
  it('answers as the near window does, without one', () => {
    const hf = windowAt(0, 0),
      ground = createSampledGround(sampler);
    for (const [x, z] of pointsNear(0, 0, 200, 1)) expect(ask(ground, x, z)).toEqual(ask(hf, x, z));
  });

  it('answers as the near window does at negative coordinates', () => {
    const hf = windowAt(-37000, -52000),
      ground = createSampledGround(sampler);
    for (const [x, z] of pointsNear(-37000, -52000, 200, 2)) expect(ask(ground, x, z)).toEqual(ask(hf, x, z));
  });

  it('reads its window inside it and samples past it, and the two agree', () => {
    const near = windowAt(0, 0),
      ground = createSampledGround(sampler, near);
    for (const [x, z] of pointsNear(0, 0, 100, 3)) expect(ask(ground, x, z)).toEqual(ask(near, x, z));
    // 3 km out is past the window's 512 m: what a window filled there says
    const there = windowAt(3000, -2000);
    for (const [x, z] of pointsNear(3000, -2000, 100, 4)) expect(ask(ground, x, z)).toEqual(ask(there, x, z));
  });

  it('agrees across the window edge, where a triangle has texels on both sides', () => {
    const near = windowAt(0, 0),
      withWindow = createSampledGround(sampler, near),
      without = createSampledGround(sampler);
    // The window holds texels -32..31, so -512 m and 496 m are its edge rows.
    for (const edge of [-512, 496])
      for (let t = -400; t <= 400; t += 37) {
        for (const [x, z] of [
          [edge + 7.3, t],
          [t, edge + 7.3],
          [edge - 7.3, t],
        ] as const)
          expect(ask(withWindow, x, z)).toEqual(ask(without, x, z));
      }
  });

  it('never reads a window nobody filled', () => {
    const empty = createHeightfield(sampler, { size: 64 }),
      withEmpty = createSampledGround(sampler, empty),
      without = createSampledGround(sampler);
    for (const [x, z] of pointsNear(0, 0, 50, 5)) expect(ask(withEmpty, x, z)).toEqual(ask(without, x, z));
  });

  it('keeps its cache bounded and answers the same after dropping it', () => {
    const ground = createSampledGround(sampler),
      fresh = createSampledGround(sampler);
    const first = ask(ground, 123.4, 567.8);
    // a line of distinct points far longer than the cache
    for (let i = 0; i < GROUND_CACHE * 2; i++) ground.heightAt(i * 16.5, 9000);
    expect(ground.cached).toBeLessThanOrEqual(GROUND_CACHE);
    expect(ask(ground, 123.4, 567.8)).toEqual(first);
    expect(first).toEqual(ask(fresh, 123.4, 567.8));
  });
});
```

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `npx vitest run tests/unit/sampledGround.test.ts`
Expected: FAIL, „Failed to load url ../../src/engine/terrain/SampledGround”.

- [ ] **Step 3: Napisz moduł**

```ts
// The ground as the near window answers it, anywhere. A point of the 16 m
// grid is the one `sampleWindow` call the window fills its texel with, stored
// as the window stores it (float32 heights and weights, byte slots), so the
// heights, weights and slots agree with the window to the bit, and between the
// points it interpolates the same triangle the terrain grid draws. Inside the
// window it reads the window; past it, it samples and keeps the points in a
// small cache. It never reads the far window: that one is for looking at.
import type { Heightfield } from './Heightfield';
import { CELL, type WorldSampler } from './WorldSampler';

/** What sowing asks of the ground: `Heightfield` answers it inside its window, `SampledGround` everywhere. */
export interface GroundQuery {
  heightAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
  weightsAt(x: number, z: number, ids: Uint8Array, weights: Float32Array): void;
}

export interface SampledGround extends GroundQuery {
  /** Points held in the cache now. */
  readonly cached: number;
}

/**
 * Points kept before the cache is dropped whole. One cell's sowing reuses its
 * own few dozen points and almost nothing of its neighbours', so this only has
 * to outlast a cell, and dropping it costs a resample, never a wrong answer.
 */
export const GROUND_CACHE = 8192;

/** A texel index pair as one number: exact for |index| < 2^21, which is 33 000 km of world. */
const keyOf = (ix: number, iz: number) => (ix + 2097152) * 4194304 + (iz + 2097152);

export function createSampledGround(sampler: WorldSampler, window?: Heightfield): SampledGround {
  if (window && window.cell !== CELL)
    throw new Error(`SampledGround: a window of ${window.cell} m cells is not the near window`);
  const cell = CELL;
  const half = window ? window.size / 2 : 0;
  // Stored as the window stores them, so the rounding is the window's.
  const data = new Float32Array(GROUND_CACHE * 4);
  const slots = new Uint8Array(GROUND_CACHE * 4);
  const index = new Map<number, number>();
  const tmp = new Float64Array(4);
  const tmpSlots = new Uint8Array(4);

  /** Whether the window holds this texel: filled, and inside the square it last filled. */
  const inWindow = (ix: number, iz: number) =>
    window !== undefined &&
    window.version > 0 &&
    ix >= window.center.cx - half &&
    ix < window.center.cx + half &&
    iz >= window.center.cz - half &&
    iz < window.center.cz + half;

  /** The cache slot of a point, sampled on first use. */
  const load = (ix: number, iz: number) => {
    const key = keyOf(ix, iz);
    let i = index.get(key);
    if (i === undefined) {
      if (index.size >= GROUND_CACHE) index.clear();
      i = index.size;
      sampler.sampleWindow(ix * cell, iz * cell, tmp, tmpSlots);
      data.set(tmp, i * 4);
      slots.set(tmpSlots, i * 4);
      index.set(key, i);
    }
    return i;
  };

  const height = (ix: number, iz: number) =>
    inWindow(ix, iz) ? window!.texel(ix, iz, 0) : data[load(ix, iz) * 4]!;

  return {
    get cached() {
      return index.size;
    },
    heightAt(x, z) {
      const fx = x / cell,
        fz = z / cell;
      const ix = Math.floor(fx),
        iz = Math.floor(fz);
      const tx = fx - ix,
        tz = fz - iz;
      const h00 = height(ix, iz),
        h10 = height(ix + 1, iz),
        h01 = height(ix, iz + 1),
        h11 = height(ix + 1, iz + 1);
      // The window's own arithmetic, diagonal and all (Heightfield.heightAt).
      return tx + tz <= 1
        ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
        : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    },
    slopeAt(x, z) {
      const ix = Math.round(x / cell),
        iz = Math.round(z / cell);
      const dx = height(ix + 1, iz) - height(ix - 1, iz),
        dz = height(ix, iz + 1) - height(ix, iz - 1);
      return Math.hypot(dx, dz) / (2 * cell);
    },
    weightsAt(x, z, ids, weights) {
      const ix = Math.round(x / cell),
        iz = Math.round(z / cell);
      if (inWindow(ix, iz)) {
        window!.weightsAt(x, z, ids, weights);
        return;
      }
      const o = load(ix, iz) * 4;
      for (let k = 0; k < 3; k++) {
        ids[k] = slots[o + k]!;
        weights[k] = data[o + 1 + k]!;
      }
    },
  };
}
```

Uwaga do implementacji: `i = index.size` po `index.clear()` daje 0, a bez czyszczenia kolejne wolne miejsce — sloty są przydzielane rosnąco od zera i nigdy nie przekraczają `GROUND_CACHE − 1`.

- [ ] **Step 4: Uruchom — ma przejść**

Run: `npx vitest run tests/unit/sampledGround.test.ts`
Expected: 6 passed. Jeśli test krawędzi okna nie przechodzi, sprawdź zakres `inWindow` względem `Heightfield.fillAll` (`ix` od `cx − half` do `cx + half − 1`).

- [ ] **Step 5: Format, lint, commit**

```bash
npx prettier --write src/engine/terrain/SampledGround.ts tests/unit/sampledGround.test.ts
npx eslint src/engine/terrain/SampledGround.ts tests/unit/sampledGround.test.ts
git add src/engine/terrain/SampledGround.ts tests/unit/sampledGround.test.ts
git commit -m "Answer as the near window does, past its edge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `scenery/Sowing.ts` i pierścień, który go używa

**Files:**
- Create: `src/engine/scenery/Sowing.ts`
- Modify: `src/engine/scenery/Ring.ts` (usunięcie przeniesionych części, nowe `createSowing`, nowa pętla komórek)
- Test: `tests/unit/sowing.test.ts`; istniejące `tests/unit/ring.test.ts` i `tests/unit/ringGolden.test.ts` bez zmian.

**Interfaces:**
- Consumes: `GroundQuery`, `createSampledGround` (zadanie 2); `countryOf`, `standingOf` (`terrain/Country.ts`); `createFields` (`terrain/Fields.ts`); `hash2`, `mulberry32`, `sstep` (`terrain/noise.ts`); `CELL_TREES`, `resolvePopulate` (`library/standard/index.js`).
- Produces (dla planu kroku 2 — dalekich drzew):
  - `const LAND = 3`, `const POPULATE_FLOOR = 0.05`
  - `interface TreeInstance` (przeniesiony z `Ring.ts`; `Ring.ts` re-eksportuje go jako typ)
  - `function idHash(id: string): number`, `function saltOf(seed: number, name: string): number`
  - `type PlantOpts = { scale?: number; yaw?: number; tint?: unknown }`
  - `interface SowingDeps { seed; library; sampler; ground: GroundQuery; size: number; occupied(x, z): boolean; admit(speciesId): boolean; baked(speciesId): boolean; emit(tree: TreeInstance): boolean; prop?: SceneryKit['prop'] }`
  - `interface Sowing { readonly cell: Cell; enter(ix: number, iz: number): boolean; stream(salt: number): void; plant(speciesId: string, x: number, z: number, opts?: PlantOpts): void; sowTrees(): void }`
  - `function createSowing(deps: SowingDeps): Sowing`

- [ ] **Step 1: Napisz testy `Sowing`**

```ts
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { CELL_TREES } from '../../library/standard/index.js';
import { createSowing, type TreeInstance } from '../../src/engine/scenery/Sowing';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createSampledGround, type GroundQuery } from '../../src/engine/terrain/SampledGround';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });
const SIZE = 96;

/** Sows cells ix0..ix0+n-1 of one row over a ground and says what stood, cell by cell. */
const sowRow = (
  ground: GroundQuery,
  iz: number,
  ix0: number,
  n: number,
  opts: { admit?: (id: string) => boolean } = {},
) => {
  const out: Array<{ ix: number; trees: TreeInstance[] } | { ix: number; sea: true }> = [];
  let current: TreeInstance[] = [];
  const sowing = createSowing({
    seed: 42,
    library: lib,
    sampler,
    ground,
    size: SIZE,
    occupied: () => false,
    admit: opts.admit ?? (() => true),
    baked: () => true,
    emit: (tree) => {
      current.push({ ...tree, tint: tree.tint.clone() });
      return true;
    },
  });
  for (let ix = ix0; ix < ix0 + n; ix++) {
    if (!sowing.enter(ix, iz)) {
      out.push({ ix, sea: true });
      continue;
    }
    current = [];
    sowing.sowTrees();
    out.push({ ix, trees: current });
  }
  return out;
};

describe('Sowing', () => {
  it('sows the same trees over the near window and over the sampled ground', () => {
    const hf = createHeightfield(sampler, { size: 128 });
    hf.fillAll(0, 0);
    // cells -8..7 of rows -2..1: well inside the window's ±1 km
    for (const iz of [-2, -1, 0, 1]) expect(sowRow(createSampledGround(sampler), iz, -8, 16)).toEqual(sowRow(hf, iz, -8, 16));
  });

  it('puts up at most CELL_TREES in a cell, and something somewhere', () => {
    const ground = createSampledGround(sampler);
    let total = 0;
    for (const iz of [-3, 0, 3])
      for (const cell of sowRow(ground, iz, -20, 40))
        if ('trees' in cell) {
          expect(cell.trees.length).toBeLessThanOrEqual(CELL_TREES);
          total += cell.trees.length;
        }
    expect(total).toBeGreaterThan(0);
  });

  it('draws nothing for a tree it is not admitted to put up', () => {
    const ground = createSampledGround(sampler);
    const all = sowRow(ground, 0, -20, 40);
    // Refuse one species everywhere: every other tree stands exactly where it did,
    // because the refusal comes before any roll is drawn.
    const refused = all.flatMap((c) => ('trees' in c ? c.trees : []))[0]!.species;
    const without = sowRow(ground, 0, -20, 40, { admit: (id) => id !== refused });
    const keep = (cells: typeof all) =>
      cells.flatMap((c) => ('trees' in c ? c.trees.filter((t) => t.species !== refused) : []));
    expect(keep(without)).toEqual(keep(all));
  });

  it('says a cell over the sea is not sown', () => {
    const ground = createSampledGround(sampler);
    // Walk out along a row until the centre of a cell is under LAND; seed 42 has sea within 40 km of the origin.
    let found = false;
    for (let ix = 0; ix < 400 && !found; ix++) {
      const [cell] = sowRow(ground, 0, ix, 1);
      found = 'sea' in cell!;
    }
    expect(found).toBe(true);
  });
});
```

Uwaga: test „draws nothing…” jest poprawny tylko dlatego, że odmowa przychodzi przed losowaniem — przy odmowie po losowaniu drzewa tej samej komórki po odmówionym stałyby gdzie indziej. Jeśli w wierszu `iz = 0` nie ma drzewa, zmień `iz` na wiersz, w którym jest (np. `-3`), w obu wywołaniach.

- [ ] **Step 2: Uruchom — ma nie przejść**

Run: `npx vitest run tests/unit/sowing.test.ts`
Expected: FAIL, „Failed to load url ../../src/engine/scenery/Sowing”.

- [ ] **Step 3: Napisz `src/engine/scenery/Sowing.ts`**

Kod poniżej to części `Ring.ts` przeniesione bez zmiany logiki: kraj pod komórką, `Cell`, `climateTint`, sadzenie drzewa i pętla biomów. Kolejność losowań i warunków jest dokładnie ta z `Ring.ts`.

```ts
// The sowing of one cell: the country under it, the stream each entry draws
// from, and the trees its biomes' populate hooks put up. The ring sows its
// cells through this and the far trees sow theirs through it too, which is the
// whole of what makes a tree seen at three kilometres the tree the ring puts up
// when the flight gets there. It knows the Cell a hook is handed and the trees;
// props, overrides' props, obstacles, pools and plans are the caller's.
//
// Pure CPU: from three it takes Color and nothing else.
import { Color } from 'three';
import {
  swatchColor,
  type Cell,
  type Library,
  type SceneryKit,
  type Species,
} from '../../../library/contract';
import { CELL_TREES, resolvePopulate } from '../../../library/standard/index.js';
import { countryOf, standingOf } from '../terrain/Country';
import { createFields } from '../terrain/Fields';
import { hash2, mulberry32, sstep } from '../terrain/noise';
import type { GroundQuery } from '../terrain/SampledGround';
import { SLOTS, type WorldSampler } from '../terrain/WorldSampler';

/** Ground above this is land, in the only sense the scenery cares about. */
export const LAND = 3;
/** A biome with less than this share of a cell does not get to populate it (spec 7). */
export const POPULATE_FLOOR = 0.05;
const TAU = Math.PI * 2;

export interface TreeInstance {
  species: string;
  x: number;
  /** Ground height under it, m. */
  y: number;
  z: number;
  scale: number;
  /** Vertical scale; a tree is never quite as tall as it is wide. */
  tall: number;
  yaw: number;
  /** Scratch: the sink must copy it, because the next tree overwrites it. */
  tint: Color;
}

/** A hash of the whole id, so two entries collide only by being the same entry. */
export function idHash(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * The salt of one entry's streams, from the seed and the whole id: adding a
 * prop must not reshuffle the trees, and adding a biome must not reshuffle the props.
 */
export const saltOf = (seed: number, name: string) => (seed ^ idHash(name)) >>> 0;

export type PlantOpts = { scale?: number; yaw?: number; tint?: unknown };

export interface SowingDeps {
  seed: number;
  library: Library;
  sampler: WorldSampler;
  /** Where heights, slopes and the country come from: the near window, or the sampled ground past it. */
  ground: GroundQuery;
  /** The side of a cell, m. */
  size: number;
  /** Ground spoken for (scenery/Claims.ts): nothing is sown on it. */
  occupied(x: number, z: number): boolean;
  /** Whether a tree of this species may still stand: the caller's ceilings, asked before any roll is drawn. */
  admit(speciesId: string): boolean;
  /** Whether the species has a baked shape to stand. */
  baked(speciesId: string): boolean;
  /** Where a tree goes; false when it was refused, and then it does not count toward its cell. */
  emit(tree: TreeInstance): boolean;
  /** What a hook's `kit.prop` does. Without it a prop a hook asks for stands nowhere. */
  prop?: SceneryKit['prop'];
}

export interface Sowing {
  /** The cell a hook is handed, rewritten by `enter`. */
  readonly cell: Cell;
  /** Sets the cell up; false when its centre is under LAND, and nothing is sown there. */
  enter(ix: number, iz: number): boolean;
  /** Points `cell.roll` at this cell's own stream for one salt. */
  stream(salt: number): void;
  /** One tree on the current stream, held to CELL_TREES and the caller's ceilings. */
  plant(speciesId: string, x: number, z: number, opts?: PlantOpts): void;
  /** Every biome of the country with a share worth a visit, each on its own stream. */
  sowTrees(): void;
}

export function createSowing(deps: SowingDeps): Sowing {
  const { seed, library, sampler, ground, size } = deps;
  const biomes = library.biomes;
  const sown = biomes.map((biome) => (biome.populate ? resolvePopulate(biome.populate) : null));
  // What each biome wants of each prop, and the colours its params name: both
  // are read once per cell through the Cell, so resolve them once here.
  const wants = sown.map((entry) => entry?.scatter?.props ?? {});
  const palette = biomes.map((biome) => {
    const colors = new Map<string, Color>();
    for (const [key, value] of Object.entries(biome.params ?? {}))
      if (typeof value === 'string') colors.set(key, new Color(swatchColor(value)));
    return colors;
  });
  const speciesById = new Map((library.species ?? []).map((entry) => [entry.id, entry]));
  const tints = new Map(
    (library.species ?? []).map((entry) => [
      entry.id,
      {
        cold: new Color(swatchColor(entry.tint.cold)),
        warm: new Color(swatchColor(entry.tint.warm)),
        dry: new Color(swatchColor(entry.tint.dry)),
      },
    ]),
  );
  const biomeSalt = biomes.map((biome) => saltOf(seed, `biome:${biome.id}`));

  const fields = createFields(sampler);
  const slotIds = new Uint8Array(4);
  const slotWeights = new Float32Array(4);
  // The country under the cell. A settlement's slot is its presence and its
  // plateau, not a planting: its share goes to the biomes beside it, and what
  // they sow is thinned by `clearing` (terrain/Country.ts).
  const standing = standingOf(biomes);
  const countryIds = new Uint8Array(4);
  const countryWeights = new Float32Array(4);
  let clearing = 1;
  const blended = new Color();
  const scratch = new Color();

  let gx = 0,
    gz = 0,
    centerX = 0,
    centerZ = 0,
    // Not reset by `enter`: a prop placed before this cell's biomes have run
    // reads the last share of the cell before, as it always has.
    share = 0,
    cellTrees = 0,
    read = false;
  let here = fields.at(0, 0);
  let roll: () => number = () => 0;

  const cell: Cell = {
    size,
    corner: { x: 0, z: 0 },
    center: { x: 0, z: 0 },
    get share() {
      return share;
    },
    // Lazily: a cell that turns out to be sea, or that nobody claims, never
    // pays for a field sample, and a field sample is the expensive part.
    get fields() {
      if (!read) {
        here = fields.at(centerX, centerZ);
        read = true;
      }
      return here;
    },
    weight(id) {
      for (let s = 0; s < SLOTS; s++) if (biomes[countryIds[s]!]?.id === id) return countryWeights[s]!;
      return 0;
    },
    mix(id) {
      // A prop is thinned in a settlement exactly as a tree is: the country's
      // boulders, a clearing's share of them.
      let sum = 0;
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!;
        if (weight > 0) sum += weight * (wants[countryIds[s]!]?.[id] ?? 0);
      }
      return sum * clearing;
    },
    blend(param) {
      blended.setRGB(0, 0, 0);
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!,
          color = palette[countryIds[s]!]?.get(param);
        if (weight > 0 && color) {
          blended.r += weight * color.r;
          blended.g += weight * color.g;
          blended.b += weight * color.b;
        }
      }
      return blended;
    },
    height: (x, z) => ground.heightAt(x, z),
    slope: (x, z) => ground.slopeAt(x, z),
    land: (x, z) => ground.heightAt(x, z) > LAND,
    roll: () => roll(),
    occupied: (x, z) => deps.occupied(x, z),
  };

  /** The climate tint of one tree, in the scratch colour the caller copies. */
  const climateTint = (species: Species) => {
    const tint = tints.get(species.id)!;
    const climate = cell.fields;
    return scratch
      .copy(tint.cold)
      .lerp(tint.warm, sstep(0.3, 0.7, climate.temp))
      .lerp(tint.dry, sstep(0.45, 0.25, climate.moist));
  };

  const plant = (speciesId: string, x: number, z: number, opts?: PlantOpts) => {
    if (cellTrees >= CELL_TREES || !deps.admit(speciesId)) return;
    const species = speciesById.get(speciesId);
    if (!species || !deps.baked(speciesId)) return;
    const [min, max] = species.scale;
    const scale = opts?.scale ?? min + roll() * (max - min);
    const tall = scale * (0.9 + roll() * 0.4);
    const yaw = opts?.yaw ?? roll() * TAU;
    const y = ground.heightAt(x, z);
    const tint =
      opts?.tint === undefined
        ? climateTint(species)
        : scratch.set(swatchColor(opts.tint as string | number));
    if (!deps.emit({ species: speciesId, x, y, z, scale, tall, yaw, tint })) return;
    cellTrees++;
  };

  const kit: SceneryKit = {
    tree: (speciesId, x, z, opts) => plant(speciesId, x, z, opts),
    prop: (propId, x, z, opts) => deps.prop?.(propId, x, z, opts),
    structure: () => {
      // Not unfinished work: a scatter says what grows on a cell, and a
      // building is not something that grows. Buildings stand on site plans,
      // which are placed whole by the ring.
      throw new Error(
        'scenery library: a biome scatters, it does not build; a building belongs to a site plan',
      );
    },
    color: (value) => new Color(swatchColor(value)),
  };

  return {
    cell,
    enter(ix, iz) {
      const ccx = (ix + 0.5) * size,
        ccz = (iz + 0.5) * size;
      if (ground.heightAt(ccx, ccz) < LAND) return false;
      gx = ix;
      gz = iz;
      cell.corner.x = ix * size;
      cell.corner.z = iz * size;
      cell.center.x = centerX = ccx;
      cell.center.z = centerZ = ccz;
      read = false;
      cellTrees = 0;
      ground.weightsAt(ccx, ccz, slotIds, slotWeights);
      clearing = countryOf(slotIds, slotWeights, standing, countryIds, countryWeights);
      return true;
    },
    stream(salt) {
      roll = mulberry32(hash2(gx, gz, salt));
    },
    plant,
    sowTrees() {
      for (let s = 0; s < SLOTS; s++) {
        // The floor is the country's own share: which biomes get a say in a
        // cell is not changed by a village standing on it, only how much of
        // what they sow comes up.
        const weight = countryWeights[s]!;
        if (weight < POPULATE_FLOOR) continue;
        const entry = sown[countryIds[s]!];
        if (!entry) continue;
        share = weight * clearing;
        roll = mulberry32(hash2(gx, gz, biomeSalt[countryIds[s]!]!));
        entry.hook(cell, kit);
      }
    },
  };
}
```

- [ ] **Step 4: Uruchom testy `Sowing` — mają przejść**

Run: `npx vitest run tests/unit/sowing.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Przełącz `Ring.ts` na `Sowing`**

5a. W nagłówku pliku, zaraz po importach, zamień definicje przeniesione do `Sowing.ts`:
- usuń `const LAND = 3;`, `export const POPULATE_FLOOR = 0.05;` (z komentarzem), `interface TreeInstance` (z komentarzami) i funkcję `idHash`;
- dodaj:

```ts
import { createSowing, saltOf, type TreeInstance } from './Sowing';
export { POPULATE_FLOOR, type TreeInstance } from './Sowing';
```

`ScenerySink.tree(tree: TreeInstance)` dalej używa tego typu — import wyżej go dostarcza.

5b. W `createRing` zastąp wszystko od `const biomes = library.biomes;` do końca `const stream = (salt: number) => mulberry32(hash2(gx, gz, salt));` **poza** blokiem roszczeń (`const claims = …` do `const occupied = …` włącznie z `indexPlans`), funkcją `standProp` i funkcją `raise`, które zostają bez zmian. Konkretnie: usuń `biomes`, `sown`, `wants`, `palette`, `speciesById`, `tints`, `biomeSalt`, `fields`, `slotIds`, `slotWeights`, `standing`, `countryIds`, `countryWeights`, `clearing`, `blended`, zmienne `gx`…`read`, `here`, `roll`, obiekt `cell`, `climateTint`, `plantTree`, obiekt `kit` i `stream`. Zostaw `scratch` (używają go `standProp` i `raise`). Salty rekwizytów i nadpisań oraz sianie wstaw tuż po `const full = new Set<string>();`:

```ts
  const propEntries: Prop[] = library.props ?? [];
  const byId = new Map(propEntries.map((entry) => [entry.id, entry]));
  // One stream per cell per entry, from the whole id: adding a prop must not
  // reshuffle the trees, and adding a biome must not reshuffle the props.
  const propSalt = propEntries.map((entry) => saltOf(seed, `prop:${entry.id}`));
  const overrideSalt = saltOf(seed, 'override');

  // A cell's trees are sown where the far trees sow theirs (Sowing.ts): what
  // the ring adds is its ceilings, the pools and the obstacles.
  const sowing = createSowing({
    seed,
    library,
    sampler,
    ground: heightfield,
    size,
    occupied,
    admit: (speciesId) => trees < maxTrees && !full.has(speciesId),
    baked: (speciesId) => metrics.species(speciesId) !== null,
    emit: (tree) => {
      if (!sink.tree(tree)) {
        full.add(tree.species);
        return false;
      }
      // Clearance comes from the baked shape, so no generator can understate itself.
      const shape = metrics.species(tree.species)!;
      obstacles.add({
        x: tree.x,
        z: tree.z,
        ground: tree.y,
        top: tree.y + shape.top * tree.tall,
        radius: tree.scale * shape.radius,
      });
      trees++;
      return true;
    },
    prop: (propId, x, z, opts) => {
      standProp(propId, { x, z, ...opts });
    },
  });
  const cell = sowing.cell;
```

(Jeśli `propEntries` i `byId` były już zdefiniowane wyżej, zostaw jedną definicję — tę tutaj — i usuń starą.)

5c. W `rebuild` zastąp ciało pętli po komórkach (od `const ccx = …` do końca pętli biomów) tym:

```ts
        const ccx = (ix + 0.5) * size,
          ccz = (iz + 0.5) * size;
        if (Math.hypot(ccx - x, ccz - z) > radius) continue;
        if (!sowing.enter(ix, iz)) continue;
        cells++;
        // The layer is asked before any hook runs, and while it is empty it does
        // not even cost the key.
        const override = overrides.size === 0 ? null : overrides.for(cellKey(ix, iz));
        if (override?.skip) continue;
        if (override?.placements) {
          sowing.stream(overrideSalt);
          for (const put of override.placements) {
            // an override names a tree's scale as one number, like the hooks do
            if (put.species)
              sowing.plant(put.species, put.x, put.z, {
                scale: typeof put.scale === 'number' ? put.scale : undefined,
                yaw: put.yaw,
                tint: put.tint,
              });
            else if (put.prop) standProp(put.prop, put);
          }
          continue;
        }
        for (let p = 0; p < propEntries.length; p++) {
          const entry = propEntries[p]!;
          sowing.stream(propSalt[p]!);
          // A scattered prop keeps off a plan as a tree does. A prop the plan
          // asked for is the plan's own and is stood by `raise`, not here.
          for (const put of entry.place(cell, propKit) ?? [])
            if (!occupied(put.x, put.z)) standProp(entry.id, put);
        }
        sowing.sowTrees();
```

5d. Usuń nieużywane importy. Run: `npx eslint src/engine/scenery/Ring.ts src/engine/scenery/Sowing.ts` i usuń wszystko, co zgłosi jako nieużywane (spodziewane: `CELL_TREES`, `resolvePopulate`, `countryOf`, `standingOf`, `createFields`, `sstep`, `mulberry32`, `SLOTS`, typy `Cell`, `SceneryKit`, `Species`). `hash2` zostaje (używa go `raise`), `Color` i `swatchColor` zostają.

- [ ] **Step 6: Uruchom testy pierścienia i charakteryzujące**

Run: `npx vitest run tests/unit/ring.test.ts tests/unit/ringGolden.test.ts tests/unit/sowing.test.ts`
Expected: wszystkie przechodzą, **bez** zmiany snapshotów w `ringGolden.test.ts` (`git diff tests/` pusty). Jeśli snapshot się nie zgadza, zmieniła się kolejność losowań — porównaj z `git show HEAD:src/engine/scenery/Ring.ts` (zmiana nie jest jeszcze zacommitowana, więc `HEAD` to stary pierścień) (warunki w `plant`, kolejność w pętli komórek, `share` nieresetowany w `enter`). Snapshotów nie aktualizuj.

- [ ] **Step 7: Pełne sprawdzenie**

Run: `npm run check`
Expected: typy, lint, format, wszystkie testy i build przechodzą.

- [ ] **Step 8: Commit**

```bash
git add src/engine/scenery/Sowing.ts src/engine/scenery/Ring.ts tests/unit/sowing.test.ts
git commit -m "Sow a cell's trees in one place, over any ground

The ring sows through it and so will the far trees: a tree at three
kilometres has to be the tree the ring puts up there.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `AGENTS.md` i pomiar kosztu

**Files:**
- Modify: `AGENTS.md` (lista czystych modułów CPU w „Rules”, sekcja „Scenery”)

- [ ] **Step 1: Zmierz, czy przebudowa pierścienia nie zwolniła**

Dopisz tymczasowo na końcu `tests/unit/ringGolden.test.ts` (nie commituj):

```ts
it('costs what it cost', () => {
  const t: number[] = [];
  for (let k = 0; k < 7; k++) {
    const s = performance.now();
    sow(-48000 + k * 97, -42000);
    t.push(performance.now() - s);
  }
  console.log('ring ms', t.map((v) => v.toFixed(1)).join(' '));
});
```

Uruchom dwa razy: raz z `Ring.ts` sprzed zadania 3, raz z obecnym.

```bash
git checkout HEAD~1 -- src/engine/scenery/Ring.ts
npx vitest run tests/unit/ringGolden.test.ts -t "costs" --silent=false
git checkout HEAD -- src/engine/scenery/Ring.ts
npx vitest run tests/unit/ringGolden.test.ts -t "costs" --silent=false
```

(`HEAD~1` to commit zadania 2, w którym `Ring.ts` jest jeszcze stary; `Sowing.ts` może zostać, stary pierścień go nie importuje.) Mediana obecnego nie może być wyższa o więcej niż ~10 % (pomiar zawiera wypełnienie okna, więc różnica powinna zginąć w szumie). Zapisz obie mediany w opisie commita. Usuń tymczasowy test i sprawdź `git status` — `Ring.ts` musi być w wersji z zadania 3.

- [ ] **Step 2: Zaktualizuj `AGENTS.md`**

W „Rules”, na liście czystych modułów CPU, po `scenery/Claims.ts,` dopisz `scenery/Sowing.ts, terrain/SampledGround.ts,`.

W „Scenery”, po punkcie o `populate`, dodaj punkt:

```markdown
- A cell's trees are sown in `scenery/Sowing.ts` and nowhere else, over any
  `GroundQuery`: the ring hands it the near window, and whatever sows past the
  window hands it `terrain/SampledGround.ts`, which samples the points the
  window would have filled and so answers to the bit what the window would --
  and never reads the far window. `ringGolden.test.ts` holds what the ring
  sows over the real library; a change that moves it is a change to the world.
```

- [ ] **Step 3: Format i commit**

```bash
npx prettier --write AGENTS.md
npm run check
git add AGENTS.md
git commit -m "Say where a cell's trees are sown, and over what ground

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

# Dalszy teren i suwaki pokładu — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** ląd widoczny do ok. 8 km zamiast 4,2 km, a suwaki `sea` i `fog` w panelu dev
mówią, czemu nic nie zmieniają.

**Architektura:** drugie, grube okno wysokości (64 m, 264 texele) z tego samego
samplera, pod nim siatka ±8,2 km z wyciętą dziurą na bliskie okno. Obie siatki
i woda mają jedną kotwicę co 64 m, a bliska siatka w ostatnich 320 m przechodzi
w powierzchnię grubej. Kurtyna mgły i morze chmur idą na 7,4–8,2 km. Spec:
`docs/superpowers/specs/2026-09-26-dalszy-teren-design.md`.

**Stack:** TypeScript, three 0.185.1 (`three/webgpu`, TSL), Vitest, Playwright.

## Ograniczenia globalne

- Kod, identyfikatory, komentarze i commity po angielsku; plan i spec po polsku.
- `terrain/Lod.ts` i `sky/CloudCover.ts` są czystymi modułami CPU: bez
  `three/webgpu`, `three/tsl` i DOM; z `three` tylko klasy matematyczne.
- Bliskie okno jest jedyną prawdą o terenie: grubego okna nie czyta nic na CPU
  (lot, sceneria, trawa, drogi, dźwięk, `heightAt`).
- Siatka może wiązać najwyżej 8 buforów wierzchołków (tu 2: `position`, `normal`).
- TSL: parametry `Fn` typowane `Node<'vec2'>` / `Node<'float'>`, nigdy gołe `Node`.
- `npm run check` przechodzi po każdym zadaniu; commit po każdym zadaniu, na
  gałęzi `claude/dalszy-teren`, z linią
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stałe: `FAR_CELL = 64`, `FAR_CELLS = 256`, `FAR_WINDOW = 264`, `NEAR_CELLS = 528`,
  `HOLE = 66`, `NEAR_REACH = 4224`, `MORPH = 320`; `farCover` 7400–8200 m;
  morze chmur `reach = 8200`, `steps = 200`, wygaszanie 7400–8200 m.

## Mapa plików

| Plik | Co robi |
| --- | --- |
| `playwright.gpu.config.ts` (nowy) | Testy e2e na prawdziwym GPU (ANGLE D3D11) zamiast SwiftShadera. |
| `src/engine/terrain/Lod.ts` (nowy) | Stałe LOD, `anchorOf`, `morphWeight`, `gridIndices` z dziurą. Czysty CPU. |
| `src/engine/terrain/TerrainMesh.ts` | `buildGrid` z dziurą, wspólne `surfaceHeight`/`cellNormal`, `createTerrain` z parametrami okna i przejściem na brzegu. |
| `src/engine/water/Water.ts` | Głębokość z bliskiego okna, w pasie przejścia mieszana z grubym, dalej z grubego. |
| `src/engine/World.ts` | Grube okno, gruba siatka, wspólna kotwica, warstwa `far`, `look.seaSeen`. |
| `src/engine/sky/Fog.ts` | `farCover` 7400–8200. |
| `src/engine/sky/CloudSea.ts` | Siatka morza do 8200 m, wygaszanie 7400–8200. |
| `src/engine/sky/CloudCover.ts` | `CLOUD_SEA_DROP`, `SEA_SEEN` i `seaSeenOver` (przeniesione z `CloudSea.ts`, który je re-eksportuje). |
| `src/dev/Panel.ts` | Dopiski i wyszarzenie suwaków `sea` / `fog`. |
| `tests/unit/lod.test.ts` (nowy) | Testy `Lod.ts` i zgodności okien. |
| `tests/unit/cloudCover.test.ts`, `tests/unit/devPanel.test.ts`, `tests/unit/cloudSea.test.ts` | `seaSeenOver`, dopiski panelu, nowa siatka morza. |
| `tests/e2e/smoke.spec.ts` | Test: gruba siatka rysuje ląd za 4,2 km. |
| `AGENTS.md`, `docs/perf-notes.md`, spec | Zasady i liczby. |

---

### Task 1: Testy e2e na GPU

**Files:**
- Create: `playwright.gpu.config.ts`
- Modify: `package.json` (skrypt `test:e2e:gpu`), `AGENTS.md` (sekcja „Checking”)

**Interfaces:**
- Produces: `npm run test:e2e:gpu`, używane do weryfikacji w zadaniach 4–6 i 8.

- [ ] **Step 1: Konfiguracja**

```ts
// playwright.gpu.config.ts
// The browser tests on this machine's own GPU: the same suite as
// `playwright.config.ts`, with ANGLE on D3D11 instead of SwiftShader. The tests
// still ask for `?webgl=1`, so this is WebGL2 on hardware; it is for a person
// at a machine with a GPU and never runs in CI, where there is none.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'gpu',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-angle=d3d11',
            '--enable-gpu',
            '--ignore-gpu-blocklist',
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
});
```

W `package.json` obok `test:e2e`:

```json
"test:e2e:gpu": "vite build && playwright test --config playwright.gpu.config.ts",
```

- [ ] **Step 2: Sprawdź, że renderer to naprawdę GPU**

Zapisz w katalogu scratchpad skrypt `gpu-probe.mjs`:

```js
import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
});
console.log(renderer);
await browser.close();
```

Uruchom z katalogu repo: `node <scratchpad>/gpu-probe.mjs`
Oczekiwane: napis z `NVIDIA` (np. `ANGLE (NVIDIA, NVIDIA RTX 1000 Ada … Direct3D11 …)`).
Jeśli wyjdzie `SwiftShader`, dodaj `headless: false` do `use` projektu `gpu`
i powtórz sondę z `chromium.launch({ headless: false, … })`.

- [ ] **Step 3: Pełny przebieg na GPU jako punkt odniesienia**

Run: `npm run test:e2e:gpu`
Oczekiwane: wszystkie testy przechodzą. Zapisz czas przebiegu i ewentualne
błędy; to stan sprzed zmian, do porównania w Task 8.

- [ ] **Step 4: AGENTS.md**

W sekcji „Checking” po zdaniu o `npm run test:e2e` dopisz:

```md
`npm run test:e2e:gpu` runs the same suite on this machine's GPU (ANGLE on
D3D11, still `?webgl=1`); it is minutes rather than the rasteriser's twenty,
and it is for a machine with a GPU only.
```

- [ ] **Step 5: `npm run check`, commit**

```bash
git add playwright.gpu.config.ts package.json AGENTS.md
git commit -m "Run the browser tests on the local GPU as well as on SwiftShader"
```

---

### Task 2: `terrain/Lod.ts` i siatka z dziurą

**Files:**
- Create: `src/engine/terrain/Lod.ts`, `tests/unit/lod.test.ts`
- Modify: `src/engine/terrain/TerrainMesh.ts` (`buildGrid`, `TERRAIN_CELLS`, `WATER_CELLS`, `WATER_CELL`)

**Interfaces:**
- Consumes: `CELL` z `terrain/WorldSampler.ts`, `sstep` z `terrain/noise.ts`,
  `N` i `createHeightfield` z `terrain/Heightfield.ts`.
- Produces:
  - `FAR_CELL = 64`, `FAR_CELLS = 256`, `FAR_WINDOW = 264`, `NEAR_CELLS = 528`,
    `HOLE = 66`, `NEAR_REACH = 4224`, `MORPH = 320`;
  - `anchorOf(v: number): number`;
  - `morphWeight(dx: number, dz: number): number`;
  - `gridIndices(cells: number, hole?: number): Uint32Array`;
  - `buildGrid(cells: number, cell: number, hole = 0): BufferGeometry` (`TerrainMesh.ts`).

- [ ] **Step 1: Testy (najpierw czerwone)**

```ts
// tests/unit/lod.test.ts
import { describe, expect, it } from 'vitest';
import { N, createHeightfield } from '../../src/engine/terrain/Heightfield';
import {
  FAR_CELL,
  FAR_CELLS,
  FAR_WINDOW,
  HOLE,
  MORPH,
  NEAR_CELLS,
  NEAR_REACH,
  anchorOf,
  gridIndices,
  morphWeight,
} from '../../src/engine/terrain/Lod';
import { CELL, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

describe('the far window', () => {
  it('is the near one read every fourth cell: the same samples to the bit', () => {
    const sampler = createWorldSampler(42);
    const near = createHeightfield(sampler, { size: 96 });
    const far = createHeightfield(sampler, { cell: FAR_CELL, size: 24 });
    near.fillAll(0, 0);
    far.fillAll(0, 0);
    const step = FAR_CELL / CELL;
    for (let j = -10; j < 10; j++)
      for (let i = -10; i < 10; i++)
        for (let c = 0; c < 4; c++) expect(far.texel(i, j, c)).toBe(near.texel(i * step, j * step, c));
  });

  it('holds both grids with their normals wherever the flight goes', () => {
    // The near window follows the flyer in 16 m cells and the grids in 64 m
    // anchors, so the grid can stand two cells off the window's middle.
    for (let k = 0; k < 400; k++) {
      const x = k * 23.7 - 4000,
        z = -k * 41.3 + 900;
      const nearMiddle = { x: Math.round(x / CELL), z: Math.round(z / CELL) };
      const farMiddle = { x: Math.round(x / FAR_CELL), z: Math.round(z / FAR_CELL) };
      const a = { x: anchorOf(x) / CELL, z: anchorOf(z) / CELL };
      for (const axis of ['x', 'z'] as const) {
        expect(Math.abs(a[axis] - nearMiddle[axis]) + NEAR_CELLS / 2 + 1).toBeLessThanOrEqual(N / 2 - 1);
        expect(a[axis] / (FAR_CELL / CELL)).toBe(farMiddle[axis]);
      }
      expect(FAR_CELLS / 2 + 1).toBeLessThanOrEqual(FAR_WINDOW / 2 - 1);
    }
  });
});

describe('anchorOf', () => {
  it('snaps to the far cell, so the near grid always ends on a far grid line', () => {
    for (const v of [-7777.7, -64, -31.9, 0, 31.9, 32.1, 5000]) {
      const a = anchorOf(v);
      expect(a % FAR_CELL === 0).toBe(true);
      expect(Math.abs(a - v)).toBeLessThanOrEqual(FAR_CELL / 2);
      expect((a + NEAR_REACH) % FAR_CELL === 0).toBe(true);
    }
    expect(NEAR_REACH).toBe((NEAR_CELLS * CELL) / 2);
    expect(HOLE * FAR_CELL).toBe(NEAR_REACH);
  });
});

describe('morphWeight', () => {
  it('is the near grid inside, the far one on the edge, and eases between', () => {
    expect(morphWeight(0, 0)).toBe(0);
    expect(morphWeight(NEAR_REACH - MORPH, 0)).toBe(0);
    expect(morphWeight(0, -NEAR_REACH)).toBe(1);
    expect(morphWeight(NEAR_REACH, NEAR_REACH)).toBe(1);
    const mid = morphWeight(NEAR_REACH - MORPH / 2, 100);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
});

describe('gridIndices', () => {
  it('without a hole is the whole grid, with the diagonal buildGrid always had', () => {
    const idx = gridIndices(4);
    expect(idx.length).toBe(4 * 4 * 6);
    // cell (0,0): vertex, vertex + side, vertex + 1, vertex + side + 1, vertex + 1, vertex + side
    expect(Array.from(idx.slice(0, 6))).toEqual([0, 5, 1, 6, 1, 5]);
  });

  it('leaves out exactly the middle square the near grid covers', () => {
    const cells = FAR_CELLS,
      side = cells + 1;
    const idx = gridIndices(cells, HOLE);
    expect(idx.length / 3).toBe((cells * cells - 4 * HOLE * HOLE) * 2);
    const lo = cells / 2 - HOLE,
      hi = cells / 2 + HOLE;
    const edge = new Set<number>();
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [0, 1, 2].map((k) => idx[t + k]! % side),
        zs = [0, 1, 2].map((k) => Math.floor(idx[t + k]! / side));
      const cx = Math.min(...xs),
        cz = Math.min(...zs);
      // no triangle of a cell inside the hole
      expect(cx >= lo && cx < hi && cz >= lo && cz < hi).toBe(false);
      for (let k = 0; k < 3; k++) {
        const x = xs[k]!,
          z = zs[k]!;
        const onRim = x >= lo && x <= hi && z >= lo && z <= hi && (x === lo || x === hi || z === lo || z === hi);
        if (onRim) edge.add(z * side + x);
      }
    }
    // every vertex of the hole's rim is used: the far grid meets the near one all the way round
    expect(edge.size).toBe(8 * HOLE);
  });
});
```

- [ ] **Step 2: Uruchom, ma nie przejść**

Run: `npx vitest run tests/unit/lod.test.ts`
Oczekiwane: FAIL, `Cannot find module '../../src/engine/terrain/Lod'`.

- [ ] **Step 3: `Lod.ts`**

```ts
// The far terrain's arithmetic: a second, coarse window under a grid that
// reaches twice as far as the near one, with a hole where the near one lies.
// Both grids and the water stand on one anchor, snapped to the far cell, so the
// near grid always ends on a far grid line and the hole never moves inside the
// far grid; the near grid's last `MORPH` metres go over into the far surface,
// so on the edge the two are one surface. What is drawn past the near window is
// for looking at: nothing on the CPU reads the far window, and `heightAt` does
// not know the rim is bent -- it starts 3.9 km out, past everything that asks.
import { sstep } from './noise';
import { CELL } from './WorldSampler';

/** Near grid, cells a side: ±4.2 km. */
export const NEAR_CELLS = 528;
/** Metres from the anchor to the near grid's edge. */
export const NEAR_REACH = (NEAR_CELLS * CELL) / 2;
/** The far window's cell, m: four near ones, so its samples are the near window's own. */
export const FAR_CELL = 64;
/** Far grid, cells a side: ±8.2 km. */
export const FAR_CELLS = 256;
/** Far window, texels a side: the grid and a central difference either side of it, and a little. */
export const FAR_WINDOW = 264;
/** Far cells either side of the far grid's middle left out: the near grid's square. */
export const HOLE = NEAR_REACH / FAR_CELL;
/** Metres of the near grid's rim that go over into the far surface. */
export const MORPH = 320;

/** The anchor both grids and the water stand on, m: a whole number of far cells. */
export const anchorOf = (v: number) => Math.round(v / FAR_CELL) * FAR_CELL;

/** How far the near surface has gone over into the far one, 0..1, at (dx, dz) m from the anchor. */
export const morphWeight = (dx: number, dz: number) =>
  sstep(NEAR_REACH - MORPH, NEAR_REACH, Math.max(Math.abs(dx), Math.abs(dz)));

/**
 * A grid's triangles, `cells` a side, with the diagonal `Heightfield.heightAt`
 * interpolates on, leaving out `hole` cells either side of the middle.
 */
export function gridIndices(cells: number, hole = 0): Uint32Array {
  const side = cells + 1,
    lo = cells / 2 - hole,
    hi = cells / 2 + hole;
  const out = new Uint32Array((cells * cells - 4 * hole * hole) * 6);
  let i = 0;
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      if (hole > 0 && x >= lo && x < hi && z >= lo && z < hi) continue;
      const v = z * side + x;
      out.set([v, v + side, v + 1, v + side + 1, v + 1, v + side], i);
      i += 6;
    }
  return out;
}
```

- [ ] **Step 4: `buildGrid` z dziurą w `TerrainMesh.ts`**

Import: `import { FAR_CELL, FAR_CELLS, NEAR_CELLS, gridIndices } from './Lod';`

Stałe (zastępują obecne `TERRAIN_CELLS`, `WATER_CELLS`, `WATER_CELL`):

```ts
/** Rendered terrain, cells per side (±4.2 km); the far grid goes on from there (terrain/Lod.ts). */
export const TERRAIN_CELLS = NEAR_CELLS;
/** The water reaches as far as the far terrain, on the same anchor. */
export const WATER_CELLS = FAR_CELLS;
export const WATER_CELL = FAR_CELL;
```

`buildGrid`:

```ts
/** An indexed grid centered on the origin; the diagonal matches Heightfield.heightAt. `hole` as in `gridIndices`. */
export function buildGrid(cells: number, cell: number, hole = 0): BufferGeometry {
  const side = cells + 1,
    count = side * side;
  const positions = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  for (let z = 0; z <= cells; z++)
    for (let x = 0; x <= cells; x++) {
      const vertex = z * side + x;
      positions[vertex * 3] = (x - cells / 2) * cell;
      positions[vertex * 3 + 2] = (z - cells / 2) * cell;
      normals[vertex * 3 + 1] = 1;
    }
  const all = gridIndices(cells, hole);
  const indices = count > 65535 ? all : Uint16Array.from(all);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
}
```

Siatka wody ma teraz 256 komórek zamiast 132; to zamierzone i dokończone w Task 4.

- [ ] **Step 5: Testy przechodzą, `AGENTS.md`**

Run: `npx vitest run tests/unit/lod.test.ts` → PASS. Potem `npm run check` → PASS.

W `AGENTS.md`, na liście czystych modułów CPU, po `terrain/Country.ts` dopisz
`terrain/Lod.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/terrain/Lod.ts src/engine/terrain/TerrainMesh.ts tests/unit/lod.test.ts AGENTS.md
git commit -m "Lay out the far terrain's grid: one anchor, a hole where the near grid lies"
```

---

### Task 3: Gruba siatka terenu i przejście na brzegu bliskiej

**Files:**
- Modify: `src/engine/terrain/TerrainMesh.ts` (`createTerrain`, nowe `surfaceHeight`, `cellNormal`)
- Modify: `src/engine/World.ts` (grube okno, gruba siatka, wspólna kotwica, warstwa `far`, `dispose`)
- Test: `tests/e2e/smoke.spec.ts` (nowy test)

**Interfaces:**
- Consumes: z Task 2 `FAR_CELL`, `FAR_CELLS`, `FAR_WINDOW`, `HOLE`, `MORPH`,
  `NEAR_REACH`, `anchorOf`, `buildGrid(cells, cell, hole)`.
- Produces:
  - `surfaceHeight(load: LoadCell, cell: number)`: `Fn` od `Node<'vec2'>` (punkt świata) do wysokości na trójkącie siatki;
  - `createTerrain` przyjmuje `cell?`, `cells?`, `hole?`, `coarse?: LoadCell` i zwraca to samo co dziś (`mesh`, `loadCell`, `uAnchor`, `update`, `upload`, `biomeParams`, `dispose`);
  - warstwa `far` w `world.layers`.

- [ ] **Step 1: Test w przeglądarce (najpierw czerwony)**

Dopisz w `tests/e2e/smoke.spec.ts` po teście „the deck lays its fog…”:

```ts
test('the land reaches past the near window: the far terrain draws what it cannot', async ({ page }) => {
  // The near window ends 4.2 km from the flyer. From high up, looking level,
  // with the air and every cloud term off, what the far grid draws is land
  // where there used to be only the horizon's colour.
  test.slow();
  const errors = await begun(page, 'seed=42&webgl=1');
  await paused(page);
  const cost = await page.evaluate(async () => {
    const w = window.__world!;
    w.jump(0, 0, 1500);
    w.dayPhase = 0.3;
    w.look.set({ air: 0 });
    for (const name of ['clouds', 'deck', 'deck fog', 'underside', 'high']) w.layers.set(name, false);
    for (let i = 0; i < 120; i++) w.step(0);
    const shot = async () => {
      w.frame(0);
      const c = await w.capture(160, 90);
      return c ? Array.from(c.data) : [];
    };
    const diff = (a: number[], b: number[]) => a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;
    await shot();
    const on = await shot();
    w.layers.set('far', false);
    const off = await shot();
    w.layers.set('far', true);
    return diff(on, off);
  });
  expect(cost).toBeGreaterThan(0.005);
  expect(errors).toEqual([]);
});
```

Run: `npx vite build && npx playwright test --config playwright.gpu.config.ts -g "far terrain"`
Oczekiwane: FAIL (nie ma warstwy `far`, więc różnica = 0).

- [ ] **Step 2: Wspólne węzły wysokości i normalnej w `TerrainMesh.ts`**

Dodaj do importów z `three/tsl`: `abs`, `fract`, `max`. Po typie `LoadCell`:

```ts
/**
 * The height on the exact triangle a grid of `cell` draws, at a world point:
 * the diagonal of `buildGrid` and `heightAt`, also at negative coordinates.
 * Bilinear interpolation would draw a different shoreline.
 */
export const surfaceHeight = (load: LoadCell, cell: number) =>
  Fn(([pt]: [Node<'vec2'>]) => {
    const at = pt.div(cell),
      base = at.floor(),
      f = fract(at);
    const upperTriangle = step(1, f.x.add(f.y));
    const a = load(base.x.add(upperTriangle), base.y.add(upperTriangle)).x;
    const b = load(base.x.add(1), base.y).x;
    const c = load(base.x, base.y.add(1)).x;
    return a
      .add(b.sub(a).mul(mix(f.x, float(1).sub(f.y), upperTriangle)))
      .add(c.sub(a).mul(mix(f.y, float(1).sub(f.x), upperTriangle)));
  });

/** The normal at a window cell, from central differences over two cells of `cell` metres. */
const cellNormal = (load: LoadCell, cell: number, ix: Node<'float'>, iz: Node<'float'>) =>
  normalize(
    vec3(
      load(ix.sub(1), iz).x.sub(load(ix.add(1), iz).x),
      cell * 2,
      load(ix, iz.sub(1)).x.sub(load(ix, iz.add(1)).x),
    ),
  );
```

- [ ] **Step 3: `createTerrain` z parametrami okna i przejściem**

Do typu `deps` dopisz:

```ts
  /** Metres a cell and cells a side of the grid; the near window's by default. */
  cell?: number;
  cells?: number;
  /** Cells either side of the middle left out (terrain/Lod.ts `HOLE`): the far grid's, where the near one lies. */
  hole?: number;
  /** The far terrain's loader: given, this grid's last `MORPH` metres go over into the far surface. */
  coarse?: LoadCell;
```

W ciele zamień `CELL` na `cell` (`const cell = deps.cell ?? CELL;`) w `ix`, `iz`
i w normalnej, a wysokość i normalną wierzchołka policz tak:

```ts
  const ix = wx.div(cell).add(0.5).floor(),
    iz = wz.div(cell).add(0.5).floor();
  const ownHeight = loadCell(ix, iz).x;
  const ownNormal = cellNormal(loadCell, cell, ix, iz);
  // The near grid's rim goes over into the far surface, so on the edge the two
  // grids are one surface and there is no crack between them to see the dome through.
  let hv: Node<'float'> = ownHeight;
  let surfaceNormal: Node<'vec3'> = ownNormal;
  if (deps.coarse) {
    const rim = smoothstep(NEAR_REACH - MORPH, NEAR_REACH, max(abs(positionLocal.x), abs(positionLocal.z)));
    const fx = wx.div(FAR_CELL).add(0.5).floor(),
      fz = wz.div(FAR_CELL).add(0.5).floor();
    hv = mix(ownHeight, surfaceHeight(deps.coarse, FAR_CELL)(vec2(wx, wz)), rim);
    surfaceNormal = normalize(mix(ownNormal, cellNormal(deps.coarse, FAR_CELL, fx, fz), rim));
  }
  const normalV = varying(surfaceNormal).normalize();
```

(`normalV` i reszta materiału bez zmian.) Siatka:

```ts
  const mesh = new Mesh(buildGrid(deps.cells ?? TERRAIN_CELLS, cell, deps.hole ?? 0), material);
```

Importy z `./Lod`: `FAR_CELL`, `MORPH`, `NEAR_REACH` (obok tych z Task 2).

- [ ] **Step 4: `World.ts`: grube okno, gruba siatka, jedna kotwica**

Importy:

```ts
import { FAR_CELL, FAR_CELLS, FAR_WINDOW, HOLE, anchorOf } from './terrain/Lod';
```

Z importu `./terrain/TerrainMesh` usuń `WATER_CELL`, jeśli nic innego go nie używa.

Po `heightfield.fillAll(…)`:

```ts
  // The far window: the same sampler every fourth cell, for the grid that
  // reaches past the near one. Nothing on the CPU reads it (terrain/Lod.ts).
  const farField = createHeightfield(sampler, { cell: FAR_CELL, size: FAR_WINDOW });
  farField.fillAll(Math.round((resume?.x ?? 0) / FAR_CELL), Math.round((resume?.z ?? 0) / FAR_CELL));
```

W miejscu tworzenia terenu:

```ts
  const farTerrain = createTerrain({
    heightfield: farField,
    uniforms,
    litMaterial,
    palette,
    biomes: library.biomes,
    cell: FAR_CELL,
    cells: FAR_CELLS,
    hole: HOLE,
  });
  const terrain = createTerrain({
    heightfield,
    uniforms,
    litMaterial,
    palette,
    biomes: library.biomes,
    shade,
    coarse: farTerrain.loadCell,
  });
  scene.add(terrain.mesh, farTerrain.mesh);
```

Warstwy: po `terrain: [terrain.mesh],` dopisz `far: [farTerrain.mesh],`.

W `place`:

```ts
    heightfield.update(state.x, state.z);
    farField.update(state.x, state.z);
    terrain.upload();
    farTerrain.upload();
    // One anchor for both grids and the water, a whole far cell: the near grid
    // ends on a far grid line and the far grid's hole stays where it was cut.
    const ax = anchorOf(state.x),
      az = anchorOf(state.z);
    terrain.update(ax, az, origin.x, origin.z);
    farTerrain.update(ax, az, origin.x, origin.z);
    water.update(ax, az, origin.x, origin.z);
```

(zastępuje dotychczasowe `ax/az` z `CELL` i osobną kotwicę wody z `WATER_CELL`).

W `dispose` po `terrain.dispose();` dopisz `farTerrain.dispose();`.

- [ ] **Step 5: Typy i testy**

Run: `npm run check` → PASS.
Run: `npx vite build && npx playwright test --config playwright.gpu.config.ts -g "far terrain"` → PASS.

- [ ] **Step 6: Zdjęcie szwu**

`npm run preview`, otwórz `http://localhost:4173/?seed=42&dev=1` w przeglądarce
wbudowanej, wyłącz `air` (suwak na 0) i warstwy chmur, poleć nisko (ok. 300 m)
i wysoko (1800 m). Sprawdź zbliżeniem (`zoom`) pas 4,2 km od lotnika:
- brak jasnych punkcików ani linii nieba na szwie;
- brak schodków kolorów biomów na grubej siatce.

Jeśli widać punkciki, dodaj fartuch z punktu 4.4 specu i opisz go w specu.
Jeśli widać schodki, zanotuj to w specu (sekcja „Ryzyka”) jako znane
ograniczenie do osobnej zmiany.

- [ ] **Step 7: Commit**

```bash
git add src/engine/terrain/TerrainMesh.ts src/engine/World.ts tests/e2e/smoke.spec.ts
git commit -m "Draw the land past the near window on a far grid the near one bends into"
```

---

### Task 4: Woda do 8,2 km

**Files:**
- Modify: `src/engine/water/Water.ts`, `src/engine/World.ts` (przekazanie `farLoadCell`)

**Interfaces:**
- Consumes: `surfaceHeight` (Task 3), `FAR_CELL`, `MORPH`, `NEAR_REACH` (Task 2),
  `WATER_CELLS = 256`, `WATER_CELL = 64` (Task 2).
- Produces: `createWater({ …, loadCell, farLoadCell })`.

- [ ] **Step 1: Głębokość z dwóch okien**

W `deps` dopisz `farLoadCell: LoadCell;` z komentarzem
`/** The far window's loader: past the near window the shore is read off it. */`.
Zamień lokalne `groundAt` na:

```ts
  // The shore is read off the near window where the near grid is drawn, off
  // the far one past it, and across the near grid's rim the two are mixed by
  // the weight the rim bends with, so the water meets the ground it is drawn on.
  const nearGround = surfaceHeight(loadCell, CELL);
  const farGround = surfaceHeight(deps.farLoadCell, FAR_CELL);
  const fromAnchor = p.sub(uAnchor).abs();
  const rim = smoothstep(NEAR_REACH - MORPH, NEAR_REACH, max(fromAnchor.x, fromAnchor.y));
  const depth = max(float(SEA_LEVEL).sub(mix(nearGround(p), farGround(p), rim)), 0);
```

Importy: `surfaceHeight` z `../terrain/TerrainMesh`, `FAR_CELL`, `MORPH`,
`NEAR_REACH` z `../terrain/Lod`; usuń nieużywane (`fract`, `step`, jeśli nic
już ich nie czyta).

- [ ] **Step 2: `World.ts`**

```ts
  const water = createWater({
    uniforms,
    horizon,
    litMaterial,
    palette,
    loadCell: terrain.loadCell,
    farLoadCell: farTerrain.loadCell,
  });
```

- [ ] **Step 3: Sprawdzenie**

Run: `npm run check` → PASS.
Run: `npx vite build && npx playwright test --config playwright.gpu.config.ts -g "sea|water|far terrain"` → PASS.
W przeglądarce: z 1500 m morze i linia brzegu ciągną się za 4,2 km, bez szwu
w wodzie.

- [ ] **Step 4: Commit**

```bash
git add src/engine/water/Water.ts src/engine/World.ts
git commit -m "Take the water as far as the far terrain, and its shore off whichever window draws it"
```

---

### Task 5: Mgła i morze chmur do 8,2 km

**Files:**
- Modify: `src/engine/sky/Fog.ts`, `src/engine/sky/CloudSea.ts`
- Test: `tests/unit/cloudSea.test.ts`

**Interfaces:**
- Produces: `SEA_GRID = { core: 30, coreReach: 1200, reach: 8200, steps: 200 }`.

- [ ] **Step 1: Test siatki morza (czerwony)**

W `tests/unit/cloudSea.test.ts` dopisz:

```ts
  it('reaches as far as the land, and no step of it is coarser than 200 m', () => {
    const axis = seaAxis();
    expect(SEA_GRID.reach).toBeGreaterThanOrEqual(8192);
    for (let i = 1; i < axis.length; i++) expect(axis[i]! - axis[i - 1]!).toBeLessThanOrEqual(200.5);
  });
```

Run: `npx vitest run tests/unit/cloudSea.test.ts` → FAIL (`reach` 4500).

- [ ] **Step 2: `CloudSea.ts`**

```ts
export const SEA_GRID = { core: 30, coreReach: 1200, reach: 8200, steps: 200 };
```

oraz w `opacityNode`: `smoothstep(3400, 4400, …)` → `smoothstep(7400, 8200, …)`.
Popraw komentarz nad `SEA_GRID`, jeśli podaje zasięg w liczbach.

- [ ] **Step 3: `Fog.ts`**

```ts
  // Gentle local air; only the far streamed edge needs complete cover. That
  // edge is the far terrain's -- its grid ends 8.2 km from the flyer, a square
  // with the dome behind it (terrain/Lod.ts) -- and the cover hides it and
  // nothing else. It was the near window's 4.2 km until the far grid went on
  // from there, and before that 2600 m, which the owner read as a wall of haze.
  const farCover = smoothstep(7400, 8200, distance);
```

- [ ] **Step 4: Sprawdzenie**

Run: `npx vitest run tests/unit/cloudSea.test.ts` → PASS; `npm run check` → PASS.
Run: `npx vite build && npx playwright test --config playwright.gpu.config.ts -g "deck|cloud|sky|far terrain"` → PASS.
W przeglądarce znad pokładu (np. 1700 m): morze chmur sięga do końca lądu.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sky/Fog.ts src/engine/sky/CloudSea.ts tests/unit/cloudSea.test.ts
git commit -m "Pull the far cover and the cloud sea out to where the land now ends"
```

---

### Task 6: `seaSeen` i suwaki, które mówią dlaczego

**Files:**
- Modify: `src/engine/sky/CloudCover.ts`, `src/engine/sky/CloudSea.ts`, `src/engine/World.ts`, `src/dev/Panel.ts`
- Test: `tests/unit/cloudCover.test.ts`, `tests/unit/devPanel.test.ts`

**Interfaces:**
- Produces:
  - `CLOUD_SEA_DROP`, `SEA_SEEN` eksportowane z `CloudCover.ts` (re-eksport w `CloudSea.ts`);
  - `seaSeenOver(cover: CloudCover, x: number, z: number, y: number): number`;
  - `SkyLookControl.seaSeen: number` (0..1, pod kamerą).

- [ ] **Step 1: Test `seaSeenOver` (czerwony)**

W `tests/unit/cloudCover.test.ts`:

```ts
import { CLOUD_SEA_DROP, DECK, SEA_SEEN, createCloudCover, seaSeenOver } from '../../src/engine/sky/CloudCover';

describe('seaSeenOver', () => {
  it('is the sea shader\'s own answer: nothing under its level, all of it just over', () => {
    const cover = createCloudCover(42);
    const level = cover.baseAt(100, -200) + DECK.sea - CLOUD_SEA_DROP;
    expect(seaSeenOver(cover, 100, -200, level + SEA_SEEN[0] - 1)).toBe(0);
    expect(seaSeenOver(cover, 100, -200, level + SEA_SEEN[1] + 1)).toBe(1);
    const mid = seaSeenOver(cover, 100, -200, level + (SEA_SEEN[0] + SEA_SEEN[1]) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
```

Plik już importuje `COVER, DECK, bankAt, createCloudCover, deckAt` z `CloudCover`:
dołącz `CLOUD_SEA_DROP`, `SEA_SEEN`, `seaSeenOver` do tego importu zamiast dodawać drugi.
Run: `npx vitest run tests/unit/cloudCover.test.ts` → FAIL.

- [ ] **Step 2: Przenieś stałe i dodaj funkcję w `CloudCover.ts`**

Przenieś z `CloudSea.ts` do `CloudCover.ts` (z ich komentarzami)
`export const CLOUD_SEA_DROP = 55;` i `export const SEA_SEEN = [-60, 10] as const;`.
W `CloudSea.ts` zamień definicje na
`import { CLOUD_SEA_DROP, SEA_SEEN } from './CloudCover';` i
`export { CLOUD_SEA_DROP, SEA_SEEN };`, żeby `Clouds.ts` i `World.ts` działały
bez zmian. Import `sstep` z `../terrain/noise` obok `hash2`. Na końcu
`CloudCover.ts`:

```ts
/**
 * How much of the cloud sea is seen from a point, 0..1: `seaSeenAt` in
 * sky/CloudSea.ts on the CPU, read at the camera. Under the sea's level it is
 * 0, and there the sea, and the fog it lays on the ground, draw nothing at all.
 */
export function seaSeenOver(cover: CloudCover, x: number, z: number, y: number): number {
  return sstep(SEA_SEEN[0], SEA_SEEN[1], y - (cover.baseAt(x, z) + DECK.sea - CLOUD_SEA_DROP));
}
```

Run: `npx vitest run tests/unit/cloudCover.test.ts` → PASS.

- [ ] **Step 3: `look.seaSeen` w `World.ts`**

W `SkyLookControl` dopisz:

```ts
  /** How much of the cloud sea the camera sees, 0..1 (`seaSeenOver`): 0 under its level, where `sea` and `fog` draw nothing. */
  readonly seaSeen: number;
```

W obiekcie `look`:

```ts
      get seaSeen() {
        return seaSeenOver(
          cloudCover,
          camera.position.x + origin.x,
          camera.position.z + origin.z,
          camera.position.y,
        );
      },
```

Import `seaSeenOver` z `./sky/CloudCover`.

- [ ] **Step 4: Test panelu (czerwony)**

W `tests/unit/devPanel.test.ts`: w `stub()` dopisz do mapy warstw
`['deck', true]` i `['deck fog', true]`, do `look` pole `seaSeen: 1` oraz
w `ranges`/`form` klucz `fog` (`fog: [0, 1, 0.25]`, `fog: 0.25`). Test:

```ts
  it('says why the deck sliders are silent: a layer off, or the camera under the sea', () => {
    const { world, raw } = stub();
    panel = createDevPanel(document, world);
    const note = (key: string) =>
      document.querySelector<HTMLElement>(`#dev [data-slider="${key}"] .why`)?.textContent ?? '';
    expect(note('sea')).toBe('');
    world.layers.set('deck', false);
    panel.refresh();
    expect(note('sea')).toBe('deck off');
    expect(document.querySelector('#dev [data-slider="sea"]')!.classList.contains('muted')).toBe(true);
    expect(note('fog')).toBe('');
    world.layers.set('deck', true);
    raw.look.seaSeen = 0;
    panel.refresh();
    expect(note('sea')).toBe('under the sea');
    expect(note('fog')).toBe('under the sea');
    world.layers.set('deck fog', false);
    panel.refresh();
    // a switch that is off is the first reason
    expect(note('fog')).toBe('deck fog off');
    // still movable: the value can be set before climbing
    const slider = document.querySelector<HTMLInputElement>('#dev [data-slider="sea"] input')!;
    expect(slider.disabled).toBe(false);
  });
```

Run: `npx vitest run tests/unit/devPanel.test.ts` → FAIL.

- [ ] **Step 5: Panel**

W `STYLE` dopisz:

```css
#dev .muted { opacity: 0.45; }
#dev .why { color: #f0c27a; margin-left: 6px; }
```

`formSliders` dostaje czwarty, opcjonalny parametr i opakowuje wiersz i suwak
w jeden element z `data-slider`, żeby dało się go wyszarzyć razem:

```ts
  const formSliders = <K extends string>(
    ranges: { readonly [key in K]: readonly [number, number, number] },
    read: () => Readonly<Record<K, number>>,
    write: (change: Partial<Record<K, number>>) => void,
    /** Why a slider changes nothing now, or null; it is dimmed and says so, and stays movable. */
    why?: (key: K) => string | null,
  ) => {
    const shows: Array<() => void> = [];
    for (const key of Object.keys(ranges) as K[]) {
      const [min, max] = ranges[key];
      const box = make('div');
      box.dataset.slider = key;
      const row = make('div', 'row');
      const value = make('span');
      const label = make('span', '', key);
      const note = make('span', 'why');
      label.append(note);
      row.append(label, value);
      const slider = make('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String((max - min) / 100);
      const show = () => {
        const now = read()[key];
        value.textContent = fixed(now, 2);
        if (doc.activeElement !== slider) slider.value = String(now);
        const reason = why?.(key) ?? null;
        if (note.textContent !== (reason ?? '')) note.textContent = reason ?? '';
        box.classList.toggle('muted', reason !== null);
      };
      slider.addEventListener('input', () => {
        write({ [key]: Number(slider.value) } as Partial<Record<K, number>>);
        show();
        draw();
      });
      show();
      shows.push(show);
      box.append(row, slider);
      panel.append(box);
    }
    return shows;
  };
```

W sekcji „deck & air”:

```ts
  // The sea and its fog draw nothing with their switch off or from under the
  // sea's level, and a slider that moves nothing looks broken: it says which.
  const silent = (key: keyof typeof looks): string | null => {
    const layer = key === 'sea' ? 'deck' : key === 'fog' ? 'deck fog' : null;
    if (layer === null) return null;
    if (!world.layers.visible(layer)) return `${layer} off`;
    if (world.look.seaSeen < 0.01) return 'under the sea';
    return null;
  };
  const lookSliders = formSliders(
    looks,
    () => world.look.form,
    (change) => world.look.set(change),
    silent,
  );
  readings.push(() => {
    for (const show of lookSliders) show();
  });
```

Uwaga: `.row span:last-child` koloruje ostatni `span` wiersza. Sprawdź, czy
dopisek w etykiecie nie łapie tej reguły (jest wewnątrz pierwszego `span`,
więc nie powinien); jeśli łapie, zawęź selektor do `.row > span:last-child`.

- [ ] **Step 6: Testy przechodzą**

Run: `npx vitest run tests/unit/devPanel.test.ts tests/unit/cloudCover.test.ts` → PASS;
`npm run check` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/sky/CloudCover.ts src/engine/sky/CloudSea.ts src/engine/World.ts src/dev/Panel.ts tests/unit/cloudCover.test.ts tests/unit/devPanel.test.ts
git commit -m "Have the deck sliders say why they are silent: a switch off, or the camera under the sea"
```

---

### Task 7: Zasady i spec

**Files:**
- Modify: `AGENTS.md`, `src/engine/flight/FlightController.ts` (komentarz przy `MAX_ALTITUDE`),
  `docs/superpowers/specs/2026-09-26-dalszy-teren-design.md`

- [ ] **Step 1: `AGENTS.md`, sekcja „Terrain, sky and time”**

Po punkcie o `heightAt` dopisz:

```md
- **The far terrain is for looking at.** A second window, 64 m a cell and
  264 texels (`terrain/Lod.ts`), is filled from the same sampler and draws a
  grid to 8.2 km with a hole cut where the near grid lies; both grids and the
  water stand on one anchor, a whole far cell, so the hole never moves and the
  near grid always ends on a far grid line. The near grid's last `MORPH` metres
  go over into the far surface. Nothing on the CPU reads the far window, and
  `heightAt` does not know about the bent rim: it begins 3.9 km out, past
  everything that asks. The fog's far cover and the cloud sea end where the far
  grid does, at 8.2 km.
```

W sekcji „Layout” przy `terrain/` dopisz `far window` do listy
(„noise, base fields, heightfield window, far window, terrain mesh”).

- [ ] **Step 2: Komentarz przy `MAX_ALTITUDE`**

Zastąp liczby z 4,2 km w komentarzu (`FlightController.ts:25-31`) zdaniem:

```ts
 * Ceiling, m above sea level. What bounded it was how far the world reached:
 * the land ended 4.2 km from the eye until the far terrain (terrain/Lod.ts)
 * took it to 8.2 km. It stays at 2000 until someone flies higher and looks.
```

- [ ] **Step 3: Spec**

W specu: w punkcie 4.3 zamień zdanie o przełączniku na „Warstwa `terrain`
przełącza bliską siatkę, a nowa warstwa `far` grubą (test w przeglądarce
porównuje obraz z nią i bez niej).”; w punkcie 4.7 usuń `coarseHeightAt`
(to po prostu `heightAt` grubego okna). Dopisz wyniki zdjęć z Task 3, Step 6.

- [ ] **Step 4: `npm run check`, commit**

```bash
git add AGENTS.md src/engine/flight/FlightController.ts docs/superpowers/specs/2026-09-26-dalszy-teren-design.md
git commit -m "Write down the far terrain's rules"
```

---

### Task 8: Pomiary i pełne testy

**Files:**
- Modify: `docs/perf-notes.md`

- [ ] **Step 1: Bench przed i po**

Praca jest zacommitowana, więc wystarczy przełączać gałęzie:
`git switch main`, `npm run bench`, potem `git switch claude/dalszy-teren`,
`npm run bench`. Bench trwa długo (SwiftShader), więc uruchamiaj go w tle. Zapisz medianę i minimum pięciu punktów widokowych w obu wersjach.

- [ ] **Step 2: `docs/perf-notes.md`**

Nowa sekcja „Far terrain” z tabelą: punkt widokowy × (przed, po), plus koszt
wypełnienia grubego okna (`timings` strony) i liczba trójkątów z `memory()`
w obu wersjach.

- [ ] **Step 3: Pełne testy**

Run: `npm run check` → PASS.
Run: `npm run test:e2e:gpu` → wszystkie PASS; porównaj czas z Task 1, Step 3.

- [ ] **Step 4: Commit**

```bash
git add docs/perf-notes.md
git commit -m "Measure what the far terrain costs"
```

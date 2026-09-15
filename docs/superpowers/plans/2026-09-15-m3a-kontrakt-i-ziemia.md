# M3a Kontrakt v2 i ziemia: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biblioteka zaczyna rządzić ziemią. `library/contract.ts` z typami kontraktu v2, koperta kolorów, budżety i walidatory zatrzymujące start; standardowe haki obecności, wysokości i ziemi w `library/standard/`; `WorldSampler` liczy obecność biomów, normalizuje ją do trzech slotów i dokłada modyfikatory wysokości; okno wysokości niesie `(h, w0, w1, w2)` i drugą teksturę `(i0, i1, i2, zapas)`; materiał terenu składa kolor z haków `ground` biomów pod maską slotów; dziesięć biomów oryginału wraca jako biomy z danych. Wynik: ziarno 42 ma dziesięć klimatów malujących ziemię własnymi kolorami, bez jednej wbudowanej trójki `MEADOW/STEPPE/ROCK`.

**Architecture:** Zgodnie ze specyfikacją `docs/superpowers/specs/2026-09-14-dreamfall-design.md` (sekcje 4, 5, 6.1, 6.2, 6.3, 18.2.4) i notatkami `docs/superpowers/notes/2026-09-15-m2.1-sylwetka-i-stery.md` (sekcja 6: ustalenia pod M3). `library/` to JavaScript z JSDoc plus jedyny plik TS (`contract.ts`), sprawdzany przez `checkJs` — `tsconfig.json` już obejmuje ten katalog, `eslint.config.js` już łyka `.js`. Czysty CPU (`library/contract.ts`, `library/standard/**`, `terrain/Fields.ts`, `terrain/WorldSampler.ts`, `terrain/Heightfield.ts`) nie importuje `three/webgpu`, `three/tsl` ani DOM — z `three` wolno mu wziąć tylko `Color` — i jest testowany w Vitest. Prezentacja: `terrain/TerrainMesh.ts` składa materiał z haków TSL raz przy starcie; `library/standard/ground.js` produkuje węzły, nie kolory.

**Tech Stack:** jak w M2: Vite 8.3.0, TypeScript 5.9.3, three 0.185.1 (`three` → `three/webgpu`), @types/three 0.185.4, Vitest 4.1.11, Playwright 1.63.0. Bez nowych zależności.

## Global Constraints

- Gałąź robocza od `main` po scaleniu M2.1 (PR #4). Kod, identyfikatory, komentarze w kodzie, komunikaty commitów i dokumentacja repozytorium po angielsku (`CLAUDE.md`); plan i specyfikacja po polsku. Każdy commit kończy się linią `Co-Authored-By: <model z przypomnienia o atrybucji sesji> <noreply@anthropic.com>`.
- **Pola bazowe są zamrożone.** `sampleWorld` z fly-with-me zostaje co do bitu: wartości wzorcowe ziarna 42 w `tests/unit/worldSampler.test.ts` i `tests/unit/noise.test.ts` mają przejść **bez zmian**. Dlatego Task 4 rozdziela `baseFields` (dzisiejsze `sample`, cztery kanały `h, temp, moist, region`) od nowego `sample`, który dokłada wagi — stare testy pilnują `baseFields`, nowe pilnują reszty. Zmiana skali gór jest poza zakresem (ustalenie właściciela, notatki M2.1 §6).
- **Trzy sloty, nie dziesięć.** Oryginał miesza wszystkie dziesięć biomów w każdym fragmencie; spec §6.1 każe zostawić trzy najwyższe wagi i renormalizować. To świadoma różnica: kolor ziemi ziarna 42 **nie** będzie pikselowo równy oryginałowi, choć teren pod nim tak. Dziesiąta waga przy `CLIMATE_SHARPNESS 2.2` jest rzędu 10⁻³, więc różnica jest poniżej progu widoczności — ale nie udawaj, że jej nie ma, i nie „popraw” tego przez mieszanie wszystkiego.
- Stałe klimatu z oryginału, przenoszone co do wartości: `CLIMATE_STRETCH 2.2`, `CLIMATE_RADIUS 0.12`, `CLIMATE_SHARPNESS 2.2`. Ta sama arytmetyka musi liczyć się na CPU (`climatePoint`) i na GPU nie musi — w v2 wagi liczy CPU i zapisuje do slotów, GPU je tylko czyta. To upraszcza shader względem oryginału i jest jedynym powodem, dla którego biom może mieć dowolną funkcję `presence`.
- Koperta kolorów: saturacja HSL ≤ 0,62, jasność 0,18..0,93, mierzone w sRGB; nazwane próbki przechodzą po nazwie; neutralna prawie-biel (`s < 0.05 && l > 0.9`) jest nośnikiem odcienia i przechodzi zawsze.
- `MAX_HEIGHT_DELTA` 300 m; modyfikatory wysokości widzą wysokość **bazową**, nie wynik sąsiada, więc kolejność w rejestrze nie ma znaczenia (spec §6.1 punkt 3).
- Walidacja biegnie raz przy starcie świata i **zatrzymuje** start z komunikatem w konsoli, wymieniając wpis po nazwie (spec §5.6).
- TSL jest ściśle typowany: parametry `Fn` anotuj konkretnym typem węzła (`Node<'vec3'>`, `Node<'float'>`, `Node<'vec2'>`); goły `Node` nie ma metod operatorów i nigdy nie rzutuj do niego (reguła w `AGENTS.md`).
- Budżet pikseli i DPR bez zmian; `uncapturederror` nadal śmiertelny; shader, który tylko ostrzega, nie wchodzi.
- Poza zakresem M3a (nie budować): streaming komórek, pule instancji, warstwa nadpisań, drzewa, morfing koron, propsy, trawa, cień pod drzewami (**wszystko to M3b**); osady i stanowiska (M4); śnieg jako warstwa świata, Droga Mleczna, szafa, panel dev, `bench` i `parity` (M5); haki `populate`, `sites` i `ambience` — w kontrakcie **istnieją jako typy**, ale nic ich nie woła w M3a i walidator ma to znosić.

---

## Struktura plików po M3a

```
library/
  contract.ts                 nowy: typy v2, SWATCH, ENVELOPE, BUDGET, define*, validateLibrary, validateBaked
  index.js                    nowy: rejestr (dziesięć biomów)
  standard/presence.js        nowy: climatePoint, heightBand, mul, max
  standard/height.js          nowy: offset, terraces (plateau zostaje na M3b razem z kratą)
  standard/ground.js          nowy: layers — malarz warstw zwracający węzły TSL
  standard/index.js           nowy: resolvePresence, resolveHeight, resolveGround
  biomes/wildsong.js  elderwood.js  steppe.js  badlands.js  dunes.js
  biomes/frostpines.js  moor.js  autumn.js  jungle.js  blossom.js
src/engine/
  terrain/Fields.ts           nowy: pola dla haków CPU (hash, noise, lattice, shore)
  terrain/WorldSampler.ts     zmiana: baseFields (zamrożone) + sample z wagami i modyfikatorami
  terrain/Heightfield.ts      zmiana: kanały (h, w0, w1, w2), slots (i0, i1, i2), weightsAt
  terrain/TerrainMesh.ts      zmiana: druga tekstura, złożony shader ziemi, uniformy biomów
  World.ts                    zmiana: buduje bibliotekę, waliduje, podaje ją samplerowi i terenowi
tests/unit/contract.test.ts  standardHooks.test.ts  fields.test.ts  biomeWeights.test.ts
tests/unit/heightfield.test.ts (rozszerzony)  worldSampler.test.ts (bez zmian!)
tests/e2e/smoke.spec.ts       rozszerzony: ziemia dwóch klimatów różni się, rejestr w __world
AGENTS.md, CONTRIBUTING.md, README.md
```

---

### Task 1: Kontrakt v2 — typy, koperta, budżety, walidatory

**Files:**

- Create: `library/contract.ts`
- Test: `tests/unit/contract.test.ts`

**Interfaces:**

- Produces: `SWATCH`, `LEAVES`, `ENVELOPE`, `BUDGET`, `swatchColor`, `colorProblem`, `defineBiome`, `defineSpecies`, `defineProp`, `defineStructure`, `validateLibrary`, `validateBaked`, oraz typy `Biome`, `Fields`, `Presence`, `HeightHook`, `GroundHook`, `GroundCtx`, `GroundOut`, `PopulateHook`, `SitesSpec`, `AmbienceSpec`, `LatticeHit`, `SceneryColor`, `Library`.
- Port z `fly-with-me/library/contract.js`: `SWATCH` (wszystkie próbki), `LEAVES`, `ENVELOPE`, `colorProblem`, kształt `validateBaked`. Nowe: haki jako funkcje albo deskryptory, walidacja biomu v2 (obecność wymagana, `ground` wymagany, `height`/`populate`/`sites`/`ambience` opcjonalne).
- `BUDGET` w M3a niesie tylko to, co M3a potrafi zmierzyć: `heightDelta: 300`. Reszta (`crownCards`, `propTriangles`, `propInstances`, `siteInstances`, `speciesScale`) wchodzi w M3a jako stałe **bez użycia** — mają być na miejscu, żeby M3b ich nie wymyślał, i mają wartości ze spec §5.5: 200, 6000, 2000, 4, 3.

- [ ] **Step 1: Test, który nie przechodzi**

`tests/unit/contract.test.ts` — walidator ma odrzucać po nazwie wpisu, kolor po kopercie, a poprawna biblioteka ma przechodzić:

```ts
import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  ENVELOPE,
  colorProblem,
  defineBiome,
  swatchColor,
  validateLibrary,
} from '../../library/contract';

const ground = () => ({ albedo: null }) as never; // haki nie są wołane przez walidator
const biome = (over = {}) =>
  defineBiome({
    id: 'test',
    name: 'Test',
    params: { base: 'meadow' },
    presence: { type: 'climatePoint', point: [0.5, 0.5, 0.5], radius: 0.12 },
    ground,
    ...over,
  });

describe('colorProblem', () => {
  it('passes swatches and hex inside the envelope, and names what it refuses', () => {
    expect(colorProblem('meadow')).toBeNull();
    expect(colorProblem(0x7caa48)).toBeNull();
    expect(colorProblem('nosuch')).toBe('unknown swatch "nosuch"');
    expect(colorProblem(1.5)).toBe('not a color');
    expect(colorProblem(-1)).toBe('not a color');
    // neon: saturation over the envelope
    expect(colorProblem(0x00ff00)).toContain('outside the palette envelope');
    // pitch black and pure white
    expect(colorProblem(0x000000)).toContain('outside the palette envelope');
    expect(colorProblem(0xffffff)).toContain('outside the palette envelope');
    expect(ENVELOPE).toEqual({ maxSaturation: 0.62, minLightness: 0.18, maxLightness: 0.93 });
    expect(swatchColor('meadow')).toBe(0x7caa48);
    expect(swatchColor(0x123456)).toBe(0x123456);
  });
});

describe('validateLibrary', () => {
  it('accepts a library of one well-formed biome', () => {
    expect(validateLibrary({ biomes: [biome()] })).toEqual([]);
  });
  it('refuses bad ids, duplicates and missing hooks, by name', () => {
    const errors = validateLibrary({
      biomes: [
        biome({ id: 'Test' }),
        biome({ id: 'test' }),
        biome({ id: 'test' }),
        biome({ id: 'noground', ground: undefined }),
        biome({ id: 'nopresence', presence: undefined }),
      ],
    });
    expect(errors.join('\n')).toContain('id must be lowercase letters, digits and dashes');
    expect(errors.join('\n')).toContain('biome test: duplicate id');
    expect(errors.join('\n')).toContain('biome noground: needs a ground hook');
    expect(errors.join('\n')).toContain('biome nopresence: needs a presence hook');
  });
  it('refuses colors in params outside the envelope, naming the path', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'neon', params: { base: 0x00ff00, alt: 'meadow' } })],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('biome neon.params.base');
    expect(errors[0]).toContain('outside the palette envelope');
  });
  it('refuses a height hook that exceeds MAX_HEIGHT_DELTA in its own descriptor', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'tall', height: { type: 'offset', meters: 400 } })],
    });
    expect(errors[0]).toContain(`biome tall.height: 400 m, the budget is ${BUDGET.heightDelta}`);
    expect(BUDGET.heightDelta).toBe(300);
  });
  it('accepts a function in place of any descriptor, and the optional hooks left out', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'coded', presence: () => 1, height: (_f: unknown, base: number) => base })],
    });
    expect(errors).toEqual([]);
  });
  it('keeps the budgets M3b will need', () => {
    expect(BUDGET.crownCards).toBe(200);
    expect(BUDGET.propTriangles).toBe(6000);
    expect(BUDGET.propInstances).toBe(2000);
    expect(BUDGET.siteInstances).toBe(4);
    expect(BUDGET.speciesScale).toBe(3);
  });
});
```

Run: `npx vitest run tests/unit/contract.test.ts`
Expected: FAIL — `library/contract.ts` nie istnieje.

- [ ] **Step 2: Implementacja**

`library/contract.ts`. Port `SWATCH` i `LEAVES` **co do wartości** z `fly-with-me/library/contract.js` (próbki ziemi, skały, kory i koron; `LEAVES` nie jest używane w M3a, ale wchodzi teraz, żeby M3b miało paletę liści na miejscu). Dalej:

```ts
// The library contract. Everything a contributed file may say, and the rules
// that keep the world one world. Entries are plain objects returned by the
// define* helpers; the engine samples, bakes and places them, and owns light,
// sky, fog, streaming and budgets. Contributions never make materials, lights
// or shaders: a ground hook returns nodes the engine hangs on its own
// material, colors go through the swatch book, and validateLibrary refuses
// anything outside the contract by entry name when the page loads.
import { Color, SRGBColorSpace, LinearSRGBColorSpace } from 'three';

export const ENVELOPE = { maxSaturation: 0.62, minLightness: 0.18, maxLightness: 0.93 } as const;

/** Budgets the engine enforces per entry; the scenery ones bite in M3b. */
export const BUDGET = {
  heightDelta: 300, // meters a height hook may move the ground
  crownCards: 200,
  propTriangles: 6000,
  propInstances: 2000,
  siteInstances: 4,
  speciesScale: 3,
} as const;
```

Typy: przepisz `Biome`, `Fields`, `LatticeHit`, `Presence`, `HeightHook`, `GroundCtx`, `GroundOut`, `GroundHook`, `PopulateHook`, `SitesSpec`, `AmbienceSpec` **dosłownie ze spec §5.1 i §5.2**, z jedną zmianą: `GroundCtx` pola węzłowe anotuj konkretnie (`worldXZ: Node<'vec2'>`, `height: Node<'float'>`, `slope: Node<'float'>`, `normal: Node<'vec3'>`, `sunDir: Node<'vec3'>`, `weight: Node<'float'>`, `params: Record<string, Node<'float'> | Node<'vec3'>>`, `noise(scale: number, salt: number): Node<'float'>`, `hash(salt: number): Node<'float'>`). Typ `Node` bierz z `three/tsl` jako **import typu** (`import type { Node } from 'three/webgpu';`) — sam plik nadal nie importuje niczego wykonywalnego z TSL, więc zostaje czystym CPU.

Deskryptory:

```ts
export type PresenceDescriptor =
  | { type: 'climatePoint'; point: [number, number, number]; radius?: number }
  | { type: 'heightBand'; from: number; to: number; feather?: number }
  | { type: 'mul'; of: PresenceDescriptor[] }
  | { type: 'max'; of: PresenceDescriptor[] };
export type HeightDescriptor =
  | { type: 'offset'; meters: number }
  | { type: 'terraces'; step: number; sharpness?: number };
export type GroundDescriptor = { type: 'layers'; layers: GroundLayer[] };
export interface GroundLayer {
  color: SceneryColor;
  mask?: 'base' | 'slope' | 'height' | 'noise';
  from?: number;
  to?: number;
  scale?: number;
  salt?: number;
}
```

`defineBiome(spec)` taguje `{ kind: 'biome', ...spec }` i nic więcej. `defineSpecies`, `defineProp`, `defineStructure` tak samo — w M3a nikt ich nie woła, ale rejestr i walidator mają na nie miejsce.

`colorProblem` — port jeden do jednego z oryginału (HSL w sRGB, nazwane próbki po nazwie).

`validateLibrary({ biomes, species = [], props = [], structures = [] })` zwraca tablicę komunikatów (pusta = czysto):

1. `idsOf(list, what)` — port: `/^[a-z][a-z0-9-]*$/`, duplikaty po nazwie.
2. Dla każdego biomu: `presence` musi istnieć (funkcja albo deskryptor) → `biome <id>: needs a presence hook`; `ground` tak samo → `needs a ground hook`; każda wartość w `params`, która jest stringiem z `SWATCH` albo liczbą całkowitą w zakresie koloru, przechodzi przez `colorProblem` z ścieżką `biome <id>.params.<klucz>`; deskryptor `height` typu `offset` z `|meters| > BUDGET.heightDelta` → `biome <id>.height: <n> m, the budget is 300`.
3. Deskryptory rekurencyjnie: nieznany `type` → `biome <id>.presence: unknown hook type "<type>"`.
4. Funkcje przechodzą bez pytań — ich koszt mierzy panel dev z M5, nie walidator (spec §5.6).

`validateBaked(entry, geometry)` — port jeden do jednego (trójkąty i kolory wierzchołków, z nośnikiem odcienia `s < 0.05 && l > 0.9`). W M3a nikt go nie woła; wchodzi teraz, bo należy do kontraktu i M3b ma go zastać gotowego.

Run: `npx vitest run tests/unit/contract.test.ts`
Expected: PASS.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run typecheck && npx eslint library tests && npx prettier --check library tests
git add library/contract.ts tests/unit/contract.test.ts
git commit -m "feat: library contract v2 with the colour envelope, budgets and validators

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: Pola dla haków CPU (`Fields`)

**Files:**

- Create: `src/engine/terrain/Fields.ts`
- Test: `tests/unit/fields.test.ts`

**Interfaces:**

- Produces: `createFields(sampler: WorldSampler): { at(x: number, z: number): Fields }` — jeden obiekt `Fields` przepisywany w miejscu (bez alokacji na texel; okno przepisuje 313 600 texeli przy pełnym wypełnieniu, więc alokacja per texel jest zakazana).
- `Fields` ma pola ze spec §5.2: `x`, `z`, `cont`, `temp`, `baseTemp`, `moist`, `region`, `baseHeight`, `shore`, oraz metody `hash(salt)`, `noise(scale, salt, octaves?)`, `lattice(cell, salt)`.
- `shore` = `1 - smoothstep(0, 60, |baseHeight|)` dla wysokości nad poziomem morza i 0 pod wodą głębiej niż 60 m — bliskość brzegu liczona **z wysokości bazowej**, nie z wody.
- `hash(salt)` deterministyczny per texel: `hash2(floor(x/CELL), floor(z/CELL), salt)` znormalizowany do 0..1 — ta sama komórka daje tę samą wartość niezależnie od kolejności odwiedzin.
- `lattice(cell, salt)` zwraca `LatticeHit { cx, cz, d, u(k) }`: środek najbliższej komórki kraty `cell` (z przesunięciem centrum przez hash, żeby krata nie była widoczna jako siatka), `d` to odległość do niego w metrach, `u(k)` to k-ty strumień losowy tej komórki. To jedno źródło centrów dla obecności, modyfikatora wysokości i stanowisk (spec §5.3) — M3a używa go w testach, M3b i M4 w hakach.

- [ ] **Step 1: Test, który nie przechodzi**

```ts
import { describe, expect, it } from 'vitest';
import { createFields } from '../../src/engine/terrain/Fields';
import { CELL, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const fields = () => createFields(createWorldSampler(42));

describe('createFields', () => {
  it('carries the base fields of the sampler, with the altitude cooling split out', () => {
    const f = fields().at(0, 0);
    expect(f.x).toBe(0);
    expect(f.z).toBe(0);
    expect(f.baseHeight).toBeCloseTo(43.886, 2); // seed 42 at the origin, as in the e2e
    expect(f.baseTemp).toBeCloseTo(f.temp + Math.max(0, f.baseHeight) / 2600, 9);
    for (const v of [f.cont, f.temp, f.moist, f.region, f.shore])
      expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
  });
  it('is the same at the same place and different elsewhere', () => {
    const a = fields();
    const one = { ...a.at(1000, -2000) },
      two = { ...a.at(1000, -2000) };
    expect(two.baseHeight).toBe(one.baseHeight);
    expect(a.at(9000, 4000).baseHeight).not.toBe(one.baseHeight);
  });
  it('hashes per cell, not per point, and stays in 0..1', () => {
    const f = fields();
    const a = f.at(0, 0).hash(7),
      b = f.at(CELL * 0.4, CELL * 0.4).hash(7), // same cell
      c = f.at(CELL * 3, 0).hash(7),
      d = f.at(0, 0).hash(8);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    for (const v of [a, c, d]) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(1);
  });
  it('shores at the coast and not inland', () => {
    const f = fields();
    // walk east from the origin until the ground drops under water, then check both sides
    let coast = 0;
    for (let x = 0; x < 20000; x += 32)
      if (f.at(x, 0).baseHeight < 0) {
        coast = x;
        break;
      }
    expect(coast).toBeGreaterThan(0);
    expect(f.at(coast, 0).shore).toBeGreaterThan(0.6);
    expect(f.at(coast - 4000, 0).shore).toBeLessThan(0.4);
  });
  it('gives one lattice centre per cell, with its own random stream', () => {
    const f = fields();
    const hit = f.at(3000, 3000).lattice(6000, 3);
    expect(Math.hypot(hit.cx - 3000, hit.cz - 3000)).toBeCloseTo(hit.d, 6);
    // the neighbouring point inside the same lattice cell finds the same centre
    const same = f.at(3200, 3100).lattice(6000, 3);
    expect(same.cx).toBe(hit.cx);
    expect(same.u(0)).toBe(hit.u(0));
    expect(same.u(1)).not.toBe(same.u(0));
    for (let k = 0; k < 4; k++)
      expect(same.u(k)).toBeGreaterThanOrEqual(0), expect(same.u(k)).toBeLessThan(1);
    // a different salt is a different lattice
    expect(f.at(3000, 3000).lattice(6000, 4).cx).not.toBe(hit.cx);
  });
});
```

Run: `npx vitest run tests/unit/fields.test.ts` → FAIL (brak modułu).

- [ ] **Step 2: Implementacja**

`src/engine/terrain/Fields.ts`. Nagłówek mówi, po co ten plik istnieje:

```ts
// What a biome's CPU hooks see. The sampler fills one of these per texel and
// hands the same object to every hook, so a hook may read it but never keep
// it: there is one, rewritten in place, because a full window is 313 600
// texels and an object per texel is 313 600 objects. Pure CPU: noise and
// hashes only, no three, no DOM.
```

- `at(x, z)` woła `sampler.baseFields(x, z, tmp)` (Task 4 dodaje tę metodę; do tego czasu użyj dzisiejszego `sample`), rozkłada `h, temp, moist, region` na pola i liczy `cont` drugim wywołaniem? **Nie** — `cont` nie wychodzi dziś z samplera. Task 4 rozszerza `baseFields` o piąty kanał `cont` (kontynentalność już jest liczona w środku `sampleWorld`, wystarczy ją zapisać). Do czasu Taska 4 `Fields.cont` czytaj z `out[4]`.
- `baseTemp = temp + Math.max(0, baseHeight) / 2600` — odwrócenie ochłodzenia wysokościowego, które `sampleWorld` już wliczył (spec §5.2: `baseTemp` bez ochłodzenia, do linii śniegu).
- `hash(salt)`: `hash2(ix, iz, salt) / 4294967296`, gdzie `ix = Math.floor(x / CELL)`.
- `noise(scale, salt, octaves = 3)`: `fbm(x / scale, z / scale, salt, octaves)` — zakres −1..1, jak w `noise.ts`.
- `lattice(cell, salt)`: komórka `(Math.floor(x / cell), Math.floor(z / cell))`, centrum przesunięte o `(hash2(cx, cz, salt) / 2³² - 0.5) * cell * 0.6` w obu osiach, `u(k) = hash2(cx * 73856093 ^ k, cz, salt + k * 17) / 2³²`. Sąsiednie komórki **nie** są sprawdzane — spec chce najbliższego centrum kraty, a nie diagramu Woronoja; przy przesunięciu ±0,3 komórki to jest to samo w 99 % przypadków i kosztuje jeden hash zamiast dziewięciu.

Run: `npx vitest run tests/unit/fields.test.ts` → PASS.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add src/engine/terrain/Fields.ts tests/unit/fields.test.ts
git commit -m "feat: the fields a biome's CPU hooks read, rewritten in place per texel

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Standardowe haki obecności i wysokości

**Files:**

- Create: `library/standard/presence.js`, `library/standard/height.js`, `library/standard/index.js`
- Test: `tests/unit/standardHooks.test.ts`

**Interfaces:**

- Produces: `climatePoint({ point, radius })`, `heightBand({ from, to, feather })`, `mul([...])`, `max([...])` — każdy zwraca `(fields) => number` w 0..1. `offset({ meters })`, `terraces({ step, sharpness })` — każdy zwraca `(fields, base) => number` (nowa wysokość w metrach).
- `resolvePresence(hook)`, `resolveHeight(hook)`, `resolveGround(hook)` w `standard/index.js`: funkcja przechodzi bez zmian, deskryptor jest rozwiązywany do funkcji, nieznany typ rzuca z nazwą typu.
- `climatePoint` zwraca `Math.exp(-CLIMATE.sharpness · d²)`, gdzie `d² = ((t-ct)² + (m-cm)² + (r-cr)²) / radius²`, a każda oś przeszła przez `climateAxis(v) = clamp((v - 0.5) · 2.2 + 0.5, 0, 1)`. Ostrość **musi** siedzieć tutaj, nie w samplerze: sampler normalizuje liniowo (bo obecność może być dowolną funkcją biomu z kodu), więc `exp(-2.2·d²)` po normalizacji daje dokładnie softmax oryginału. Odjęcie „najbliższego”, które robi fly-with-me, jest tam wyłącznie ochroną przed niedomiarem `float32` na GPU; tutaj liczymy w `float64`, gdzie najdalszy klimat to `exp(-458) ≈ 1e-199` — daleko od granicy — a normalizacja i tak skraca wspólny czynnik. **Nie przepisuj tego na „nearest” bez powodu i nie zmieniaj podstawy wykładnika: to są granice biomów, które widać w locie.**

- [ ] **Step 1: Test, który nie przechodzi**

```ts
import { describe, expect, it } from 'vitest';
import { CLIMATE, climatePoint, heightBand, max, mul } from '../../library/standard/presence.js';
import { offset, terraces } from '../../library/standard/height.js';
import { resolveHeight, resolvePresence } from '../../library/standard/index.js';

const at = (over = {}) => ({
  x: 0, z: 0, cont: 0.5, temp: 0.5, baseTemp: 0.5, moist: 0.5, region: 0.5,
  baseHeight: 100, shore: 0, hash: () => 0.5, noise: () => 0, lattice: () => ({ cx: 0, cz: 0, d: 0, u: () => 0.5 }),
  ...over,
});

describe('climatePoint', () => {
  it('is one at its own point and falls off with the stretched distance', () => {
    const here = climatePoint({ point: [0.5, 0.5, 0.5], radius: CLIMATE.radius });
    expect(here(at())).toBeCloseTo(1, 9);
    const near = here(at({ temp: 0.54 })),
      far = here(at({ temp: 0.75 }));
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(0);
    // the stretch: a 0.04 step in temperature is 2.2 * 0.04 / 0.12 radii away,
    // and the sharpening is the exponent's own, not the sampler's
    const d = (2.2 * 0.04) / CLIMATE.radius;
    expect(near).toBeCloseTo(Math.exp(-CLIMATE.sharpness * d * d), 6);
    expect(CLIMATE).toEqual({ stretch: 2.2, radius: 0.12, sharpness: 2.2 });
  });
  it('clamps the stretched axes, so the corners of climate space stay reachable', () => {
    const cold = climatePoint({ point: [0, 0.5, 0.5] });
    expect(cold(at({ temp: 0 }))).toBeCloseTo(1, 9);
    expect(cold(at({ temp: 0.1 }))).toBeCloseTo(1, 9); // both clamp to 0
  });
});

describe('heightBand, mul and max', () => {
  it('bands by height with a feathered edge', () => {
    const band = heightBand({ from: 200, to: 600, feather: 100 });
    expect(band(at({ baseHeight: 400 }))).toBe(1);
    expect(band(at({ baseHeight: 0 }))).toBe(0);
    expect(band(at({ baseHeight: 150 }))).toBeCloseTo(0.5, 6);
    expect(band(at({ baseHeight: 650 }))).toBeCloseTo(0.5, 6);
  });
  it('combines', () => {
    const a = () => 0.5,
      b = () => 0.4;
    expect(mul([a, b])(at())).toBeCloseTo(0.2, 9);
    expect(max([a, b])(at())).toBeCloseTo(0.5, 9);
  });
});

describe('height hooks', () => {
  it('offsets and terraces around the base height', () => {
    expect(offset({ meters: 40 })(at(), 100)).toBe(140);
    const step = terraces({ step: 50, sharpness: 1 });
    expect(step(at(), 100)).toBeCloseTo(100, 6); // already on a step
    expect(step(at(), 124)).toBeLessThan(124); // pulled down to its step
    expect(step(at(), 126)).toBeGreaterThan(126);
  });
});

describe('resolve*', () => {
  it('passes functions through and builds descriptors', () => {
    const fn = () => 0.25;
    expect(resolvePresence(fn)).toBe(fn);
    expect(resolvePresence({ type: 'climatePoint', point: [0.5, 0.5, 0.5] })(at())).toBeCloseTo(1, 9);
    expect(resolveHeight({ type: 'offset', meters: 5 })(at(), 10)).toBe(15);
    expect(() => resolvePresence({ type: 'nope' })).toThrow(/nope/);
  });
});
```

Run: `npx vitest run tests/unit/standardHooks.test.ts` → FAIL.

- [ ] **Step 2: Implementacja**

`library/standard/presence.js` (JavaScript z JSDoc — `checkJs` to sprawdza):

```js
/**
 * Standard presence hooks: where a biome is, as a number from zero to one.
 * A biome from data names one of these; a biome from code writes its own
 * function of the same shape. The engine normalises what comes back across
 * the registry, so these do not have to agree on a scale -- only to be
 * monotonic in "how much this place is mine".
 */
export const CLIMATE = { stretch: 2.2, radius: 0.12, sharpness: 2.2 };
```

`climatePoint`, `heightBand`, `mul`, `max` jak w teście. `library/standard/height.js`: `offset` i `terraces` (`terraces` = `base + (Math.round(base / step) * step - base) * clamp(sharpness, 0, 1)` z wygładzeniem — przyciąga do najbliższego stopnia). `plateau` **nie wchodzi** w M3a: potrzebuje kraty osad z M4 i byłoby napisane na ślepo.

`library/standard/index.js` — `resolvePresence`, `resolveHeight`, `resolveGround`; nieznany typ: `throw new Error(\`unknown hook type "${type}"\`)`.

Run: `npx vitest run tests/unit/standardHooks.test.ts` → PASS.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add library/standard tests/unit/standardHooks.test.ts
git commit -m "feat: standard presence and height hooks for biomes made of data

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: Wagi biomów w samplerze — obecność, normalizacja, trzy sloty, modyfikatory wysokości

**Files:**

- Modify: `src/engine/terrain/WorldSampler.ts`
- Test: `tests/unit/biomeWeights.test.ts`
- Untouched on purpose: `tests/unit/worldSampler.test.ts`

**Interfaces:**

- `sample(x, z, out)` **zostaje dokładnie taka, jaka jest** — cztery kanały `h, temp, moist, region`, te same liczby, ten sam podpis. Wartości wzorcowe ziarna 42 nie mają prawa drgnąć, a plik testu ma zostać nietknięty; jeśli musisz go zmienić, popełniłeś błąd.
- Dochodzi `baseFields(x, z, out)` — pięć kanałów: `h, temp, moist, region, cont`. `sample` deleguje do niej i kopiuje pierwsze cztery. Kontynentalność jest już liczona w środku; chodzi tylko o to, żeby ją wypuścić, bo `Fields.cont` jej potrzebuje.
- Dochodzi `sampleWindow(x, z, out, slots)` — `out[0..3] = h, w0, w1, w2`, `slots[0..2] = i0, i1, i2` (indeksy biomów w rejestrze, `Uint8Array`). To jest to, co okno wysokości trzyma i co GPU czyta.
- `createWorldSampler(seed, opts?: { biomes?: Biome[] })`. Bez biomów: `w0 = 1`, `i0 = 0`, wysokość równa bazowej — czyli świat M1/M2 bez zmian, i wszystkie dzisiejsze testy samplera i okna dalej mają sens.
- Kolejność działań ze spec §6.1: obecność każdego biomu → przycięcie do 0..1 → normalizacja do sumy 1 → trzy najwyższe → renormalizacja → wysokość `h = base + Σ wᵢ · clamp(heightᵢ(fields, base) − base, ±MAX_HEIGHT_DELTA)`. Wszystkie zera → pierwszy biom rejestru dostaje 1.
- Modyfikatory wysokości widzą `base`, nie wynik sąsiada. Liczą się **po** normalizacji wag i tylko dla slotów, które przeżyły — biom z wagą 0,004 nie płaci za swoją funkcję wysokości i nie przesuwa ziemi.

- [ ] **Step 1: Test, który nie przechodzi**

`tests/unit/biomeWeights.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defineBiome } from '../../library/contract';
import { climatePoint } from '../../library/standard/presence.js';
import { MAX_HEIGHT_DELTA, createWorldSampler } from '../../src/engine/terrain/WorldSampler';

const ground = () => ({ albedo: null }) as never;
const at = (t: number, m: number, r: number) =>
  defineBiome({ id: `b${t}${m}${r}`, name: 'b', params: {}, presence: climatePoint({ point: [t, m, r] }), ground });
const sampleAt = (sampler: ReturnType<typeof createWorldSampler>, x: number, z: number) => {
  const out = new Float32Array(4),
    slots = new Uint8Array(4);
  sampler.sampleWindow(x, z, out, slots);
  return { h: out[0]!, w: [out[1]!, out[2]!, out[3]!], i: [slots[0]!, slots[1]!, slots[2]!] };
};

describe('sampleWindow', () => {
  it('without a library it is the world of M1: one slot, weight one, the base height', () => {
    const plain = createWorldSampler(42);
    const base = new Float32Array(4);
    plain.sample(1000, -500, base);
    const s = sampleAt(plain, 1000, -500);
    expect(s.h).toBe(base[0]);
    expect(s.w).toEqual([1, 0, 0]);
    expect(s.i).toEqual([0, 0, 0]);
  });
  it('keeps the three strongest biomes, renormalised to one', () => {
    // five points spread across climate space, so any place has a clear winner
    const biomes = [at(0.2, 0.2, 0.2), at(0.5, 0.5, 0.5), at(0.8, 0.8, 0.8), at(0.2, 0.8, 0.5), at(0.8, 0.2, 0.5)];
    const sampler = createWorldSampler(42, { biomes });
    for (const [x, z] of [[0, 0], [4000, -9000], [-21000, 13000], [60000, 60000]] as const) {
      const s = sampleAt(sampler, x, z);
      expect(s.w[0]! + s.w[1]! + s.w[2]!).toBeCloseTo(1, 6);
      expect(s.w[0]).toBeGreaterThanOrEqual(s.w[1]!);
      expect(s.w[1]).toBeGreaterThanOrEqual(s.w[2]!);
      expect(new Set(s.i).size).toBe(3); // three different biomes
      for (const i of s.i) expect(i).toBeLessThan(biomes.length);
    }
  });
  it('gives the whole texel to a biome that owns the climate outright', () => {
    const lonely = defineBiome({ id: 'lonely', name: 'l', params: {}, presence: () => 1, ground });
    const shy = defineBiome({ id: 'shy', name: 's', params: {}, presence: () => 0, ground });
    const s = sampleAt(createWorldSampler(42, { biomes: [lonely, shy] }), 0, 0);
    expect(s.w[0]).toBe(1);
    expect(s.i[0]).toBe(0);
    expect(s.w[1]).toBe(0);
  });
  it('falls back to the first biome when nobody claims the place', () => {
    const none = [0, 1].map((n) => defineBiome({ id: `n${n}`, name: 'n', params: {}, presence: () => 0, ground }));
    const s = sampleAt(createWorldSampler(42, { biomes: none }), 0, 0);
    expect(s.w).toEqual([1, 0, 0]);
    expect(s.i[0]).toBe(0);
  });
  it('moves the ground by the weighted modifiers, clipped to MAX_HEIGHT_DELTA, off the base height', () => {
    const flat = (id: string, meters: number) =>
      defineBiome({
        id,
        name: id,
        params: {},
        presence: () => 1,
        height: (_f: unknown, base: number) => base + meters,
        ground,
      });
    const sampler = createWorldSampler(42, { biomes: [flat('up', 100), flat('down', -60)] });
    const base = new Float32Array(4);
    sampler.sample(0, 0, base);
    const s = sampleAt(sampler, 0, 0);
    // equal presence: half of +100 and half of -60
    expect(s.h).toBeCloseTo(base[0]! + 20, 4);
    // and a modifier that asks for a kilometre gets 300 m
    const greedy = createWorldSampler(42, { biomes: [flat('greedy', 1000)] });
    expect(sampleAt(greedy, 0, 0).h).toBeCloseTo(base[0]! + MAX_HEIGHT_DELTA, 4);
    expect(MAX_HEIGHT_DELTA).toBe(300);
  });
  it('does not let the order of the registry change the ground', () => {
    const bump = (id: string, meters: number) =>
      defineBiome({ id, name: id, params: {}, presence: climatePoint({ point: [0.5, 0.5, 0.5] }), height: (_f: unknown, base: number) => base + meters, ground });
    const a = createWorldSampler(42, { biomes: [bump('a', 80), bump('b', -40), bump('c', 10)] });
    const b = createWorldSampler(42, { biomes: [bump('c', 10), bump('a', 80), bump('b', -40)] });
    for (const [x, z] of [[0, 0], [3000, 7000], [-12000, 400]] as const)
      expect(sampleAt(a, x, z).h).toBeCloseTo(sampleAt(b, x, z).h, 9);
  });
});
```

Run: `npx vitest run tests/unit/biomeWeights.test.ts tests/unit/worldSampler.test.ts`
Expected: nowy plik FAIL, stary PASS — i stary ma zostać zielony do końca zadania.

- [ ] **Step 2: Implementacja**

W `WorldSampler.ts`:

```ts
/** The most a biome's height hook may move the ground, m (spec 5.5). */
export const MAX_HEIGHT_DELTA = 300;
/** How many biomes mix in one point (spec 5.7). */
export const SLOTS = 3;
```

- Wyciągnij dzisiejsze ciało `sample` do `baseFields(x, z, out)` i dopisz `out[4] = cont`; `sample` woła `baseFields` do prywatnego bufora długości 5 i kopiuje cztery kanały. Żadnych innych zmian w liczbach.
- `createWorldSampler(seed, opts)` buduje raz: `presences = biomes.map((b) => resolvePresence(b.presence))`, `heights = biomes.map((b) => (b.height ? resolveHeight(b.height) : null))`, `fields = createFields(this)` oraz dwa bufory robocze (`raw: Float64Array(biomes.length)`, `pick: Int32Array(SLOTS)`).
- `sampleWindow`:
  1. `const f = fields.at(x, z)` (Fields czyta `baseFields`, więc pola bazowe liczą się raz).
  2. Brak biomów → `out[0] = f.baseHeight; out[1] = 1; out[2] = out[3] = 0; slots[0] = slots[1] = slots[2] = 0; return;`.
  3. `raw[i] = clamp(presences[i](f), 0, 1)`; suma; wszystkie zera → slot 0 dostaje 1 i wyjście.
  4. Trzy największe: pojedyncze przejście z trzema zmiennymi (bez sortowania całej tablicy — to jest pętla po texelach, 313 600 razy przy pełnym wypełnieniu).
  5. Renormalizacja trójki do sumy 1, zapis do `out[1..3]` i `slots[0..2]`. Nieużywane sloty: waga 0, indeks powtórzony z najsilniejszego (nie zero — zero to prawdziwy biom; powtórzenie z wagą zero jest nieszkodliwe i czytelne w debugu).
  6. Wysokość: `let h = f.baseHeight; for (k of 0..2) if (w[k] > 0 && heights[i[k]]) h += w[k] * clamp(heights[i[k]](f, f.baseHeight) - f.baseHeight, -MAX_HEIGHT_DELTA, MAX_HEIGHT_DELTA);` — zawsze od `f.baseHeight`, nigdy od `h` w trakcie pętli.
- **Uwaga na cykl importów:** `Fields` importuje `WorldSampler` (dla `CELL` i typu), a `WorldSampler` importuje `createFields`. Jeśli `tsc` albo Vite zaprotestuje, przenieś `CELL` do `noise.ts` albo do osobnego `terrain/constants.ts` — nie łam tego przez `import type` udające wartość.

Run: `npx vitest run` → wszystko zielone, w tym nietknięty `worldSampler.test.ts`.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add src/engine/terrain/WorldSampler.ts tests/unit/biomeWeights.test.ts
git commit -m "feat: biome presence normalised into three slots, with height modifiers off the base

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: Okno wysokości niesie sloty

**Files:**

- Modify: `src/engine/terrain/Heightfield.ts`
- Test: `tests/unit/heightfield.test.ts` (rozszerzony)

**Interfaces:**

- `data` zostaje `Float32Array(size · size · 4)`, ale kanały to teraz `h, w0, w1, w2`. `heightAt` i `slopeAt` czytają kanał 0 i **nie zmieniają się ani o linijkę** — interpolacja po tym samym trójkącie co `buildGrid` obowiązuje dalej.
- Dochodzi `slots: Uint8Array(size · size · 4)` — `i0, i1, i2, 0`. Czwarty bajt jest zarezerwowany na wodę stojącą (spec §6.1 punkt 4) i w M3a zawsze zero.
- `fieldAt(x, z, channel)` **znika**. Nikt w `src/` go nie woła (sprawdź `grep -rn fieldAt src/`), a jego kanały już nie znaczą tego, co znaczyły. Test, który go używał, przechodzi na `weightsAt`.
- Dochodzi `weightsAt(x, z, ids: Uint8Array, weights: Float32Array): void` — trzy sloty komórki, w której leży punkt (bez interpolacji: wagi są własnością komórki, tak jak kolor jest własnością trójkąta).
- `version` rośnie przy każdym zapisie i obejmuje **obie** tablice — prezentacja wgrywa dwie tekstury na jednym liczniku.

- [ ] **Step 1: Test, który nie przechodzi**

Do `tests/unit/heightfield.test.ts` dołóż (i podmień jedyne użycie `fieldAt`):

```ts
it('carries the three biome slots of each cell, unlaced from the height', () => {
  // a fake sampler: height from x, and a climate that swaps biomes across x = 0
  const sampler = {
    seed: 1,
    seeds: { S1: 0, S2: 0, S3: 0 },
    sample: () => {},
    baseFields: () => {},
    sampleWindow: (x: number, _z: number, out: Float32Array, slots: Uint8Array) => {
      out[0] = x;
      const east = x > 0;
      out[1] = east ? 0.6 : 0.9;
      out[2] = east ? 0.4 : 0.1;
      out[3] = 0;
      slots[0] = east ? 2 : 0;
      slots[1] = east ? 3 : 1;
      slots[2] = 0;
    },
  };
  const hf = createHeightfield(sampler as never, { size: 32 });
  hf.fillAll(0, 0);
  const ids = new Uint8Array(3),
    weights = new Float32Array(3);
  hf.weightsAt(5 * CELL, 0, ids, weights);
  expect([...ids]).toEqual([2, 3, 0]);
  expect([...weights]).toEqual([0.6, 0.4, 0]);
  hf.weightsAt(-5 * CELL, 0, ids, weights);
  expect([...ids]).toEqual([0, 1, 0]);
  expect(weights[0]).toBeCloseTo(0.9, 6);
  // the height still comes off channel zero, interpolated on the drawn triangle
  expect(hf.heightAt(5 * CELL, 0)).toBeCloseTo(5 * CELL, 6);
  expect(hf.slots.length).toBe(32 * 32 * 4);
});
it('bumps one version for both arrays, so the presentation uploads them together', () => {
  const hf = createHeightfield(flatSampler(), { size: 16 });
  hf.fillAll(0, 0);
  const v = hf.version;
  hf.update(1000, 1000);
  expect(hf.version).toBeGreaterThan(v);
});
```

Run: `npx vitest run tests/unit/heightfield.test.ts` → FAIL.

- [ ] **Step 2: Implementacja**

- `fillCell` woła `sampler.sampleWindow(ix * cell, iz * cell, tmp, tmpSlots)` i zapisuje cztery floaty oraz trzy bajty (`slots[o + 3] = 0`).
- `weightsAt(x, z, ids, weights)`: `ix = Math.round(x / cell)`, `iz = Math.round(z / cell)` — ta sama komórka co dawne `fieldAt`.
- Usuń `fieldAt` i jego wpis w interfejsie.
- Nagłówek pliku dopisuje jedno zdanie: okno niesie teraz wysokość **i** przynależność, bo obie muszą pochodzić z jednego próbkowania — inaczej ziemia byłaby malowana klimatem sąsiedniej komórki.

Run: `npx vitest run` → zielone.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add src/engine/terrain/Heightfield.ts tests/unit/heightfield.test.ts
git commit -m "feat: the height window carries three biome slots per cell

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: Standardowy hak ziemi (`layers`) i kontekst dla haków

**Files:**

- Create: `library/standard/ground.js`
- Modify: `library/standard/index.js` (dodaje `resolveGround`)
- Test: `tests/unit/standardHooks.test.ts` (rozszerzony o `layers` na atrapie kontekstu)

**Interfaces:**

- `layers([{ color, mask, from, to, scale, salt }, ...])` zwraca `(ctx) => ({ albedo })`. Warstwy mieszają się po kolei: pierwsza jest podkładem, każda następna wchodzi swoją maską. Maski: `'base'` (zawsze 1), `'slope'` (`ramp(slope, from, to)`), `'height'` (`ramp(height, from, to)`), `'noise'` (`ramp(noise(scale, salt), from, to)`).
- **Kontekst dostaje trzy pomocniki ponad spec §5.2** — `color(swatchOrHex)`, `mix(a, b, t)`, `ramp(v, from, to)` — po to, żeby `standard/ground.js` nie importował `three/tsl` i dał się przetestować w Node na atrapie. To jedyna rozsądna droga do haka ziemi, który jest testowalny; Task 11 dopisuje te trzy pola do `GroundCtx` w specyfikacji. Silnik podaje prawdziwe implementacje (Task 7), test podaje arytmetykę na liczbach.
- `params` biomu trafiają do `ctx.params` jako węzły; `layers` czyta kolory **z własnej listy warstw**, nie z `params` — parametry są dla haków pisanych w kodzie i dla przyszłego edytora.

- [ ] **Step 1: Test, który nie przechodzi**

```ts
import { layers } from '../../library/standard/ground.js';

/** A context whose nodes are plain numbers, so the painter can be read in Node. */
const numeric = (over = {}) => ({
  slope: 0,
  height: 100,
  weight: 1,
  params: {},
  noise: () => 0,
  hash: () => 0.5,
  color: (v: string | number) => v,
  mix: (a: unknown, b: unknown, t: number) => ({ a, b, t }),
  ramp: (v: number, from: number, to: number) =>
    Math.max(0, Math.min(1, (v - from) / (to - from || 1))),
  ...over,
});

describe('layers', () => {
  it('is its first layer when there is only one', () => {
    expect(layers([{ color: 'meadow' }])(numeric()).albedo).toBe('meadow');
  });
  it('mixes each next layer by its own mask', () => {
    const paint = layers([
      { color: 'meadow' },
      { color: 'rock', mask: 'slope', from: 0.3, to: 0.6 },
    ]);
    const gentle = paint(numeric({ slope: 0.1 })).albedo as { t: number };
    const steep = paint(numeric({ slope: 0.9 })).albedo as { t: number };
    expect(gentle.t).toBe(0);
    expect(steep.t).toBe(1);
    expect((steep as { a: unknown; b: unknown }).a).toBe('meadow');
    expect((steep as { a: unknown; b: unknown }).b).toBe('rock');
  });
  it('reads the noise mask through the context, with the layer's own scale and salt', () => {
    const seen: Array<[number, number]> = [];
    const paint = layers([
      { color: 'gold' },
      { color: 'steppe', mask: 'noise', scale: 0.012, salt: 3, from: -0.2, to: 0.4 },
    ]);
    paint(numeric({ noise: (scale: number, salt: number) => (seen.push([scale, salt]), 0.4) }));
    expect(seen).toEqual([[0.012, 3]]);
  });
});
```

- [ ] **Step 2: Implementacja**

`library/standard/ground.js` — czyste JS z JSDoc, zero importów poza typami:

```js
/**
 * The layer painter: a biome made of data says what its ground is as a stack
 * of colors, each mixed in by one mask. Everything it needs comes through the
 * context the engine hands it -- color, mix and ramp included -- so this file
 * makes no nodes of its own and can be read by a test in Node.
 */
export function layers(list) { /* ... */ }
```

Maska `'base'` (albo brak) to 1; reszta jak w interfejsach. Pierwsza warstwa ignoruje swoją maskę (jest podkładem).

`resolveGround` w `standard/index.js`: funkcja przechodzi, `{ type: 'layers', layers }` → `layers(...)`, nieznany typ rzuca.

Run: `npx vitest run tests/unit/standardHooks.test.ts` → PASS.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add library/standard tests/unit/standardHooks.test.ts
git commit -m "feat: the layer painter, a ground hook a test can read in Node

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: Złożony shader ziemi

**Files:**

- Modify: `src/engine/terrain/TerrainMesh.ts`
- Gate: `npm run typecheck`, `npm run build` i test przeglądarkowy z Taska 10 (shadery nie mają testów jednostkowych — reguła z M1)

**Interfaces:**

- `createTerrain(deps)` przyjmuje dodatkowo `biomes: Biome[]` i buduje materiał **raz**, pod pełny rejestr. Rekompilacja przy podmianie biblioteki to sprawa `World.setLibrary` z M6; w M3a rejestr jest stały.
- Druga tekstura: `DataTexture(hf.slots, size, size, RGBAFormat, UnsignedByteType)`, `NearestFilter`, bez mipmap, wgrywana na tym samym liczniku `hf.version` co wysokości.
- Wbudowane `MEADOW`, `STEPPE`, `ROCK` **znikają**. Zostają: piasek przy poziomie morza (`palette.sand`, próg `smoothstep(1.5, 7.5, h)`), dno morskie (`palette.seaFloor`), pędzel `brush`, cień chmur. Śnieg jako warstwa świata to M5 — nie dokładaj go.
- Maski liczone są **na komórkę**, nie na trójkąt: fragment czyta swój texel slotów i dla każdego biomu `k` z rejestru składa `mask_k = Σ_j w_j · (i_j == k)`. Spec §6.3 opisuje sumę z trzech wierzchołków trójkąta, bo oryginał liczył wagi w shaderze z interpolowanego klimatu; w v2 wagi liczy CPU i są własnością komórki, więc trzy odczyty rogów dałyby tę samą wartość rozmytą przez uśrednienie. Jeśli po Tasku 10 widać kwadraty 16 m z wysokości przelotowej, to jest kandydat na poprawkę w M3b — nie zgaduj teraz.
- Dla każdego biomu: `If(mask.greaterThan(0.01), () => { const out = hook(ctx); ground.addAssign(out.albedo.mul(mask)); total.addAssign(mask); })`. Po pętli `ground.divAssign(total.max(0.0001))`. Bramka `0.01` jest ze spec §6.3 i ma znaczenie wydajnościowe: przy trzech slotach najwyżej trzy z dziesięciu gałęzi wykonują się w danym fragmencie.

- [ ] **Step 1: Kontekst haka**

Zbuduj `GroundCtx` raz, poza pętlą biomów (wszystkie pola są wspólne; różni się tylko `weight` i `params`):

```ts
const ctx = {
  worldXZ,                                   // positionWorld.xz.add(u.uWorldOrigin), już jest
  height: h,                                 // positionWorld.y, już jest
  slope,                                     // float(1).sub(normalV.y), już jest
  normal: normalV,
  sunDir: u.uSunDir,
  noise: (scale: number, salt: number) => mx_noise_float(worldXZ.mul(scale).add(salt * 17.3)),
  hash: (salt: number) => mx_noise_float(worldXZ.mul(0.5).add(salt * 91.7)).mul(0.5).add(0.5),
  color: (value: SceneryColor) => {
    const c = new Color(swatchColor(value));
    return vec3(c.r, c.g, c.b);
  },
  mix: (a: Node<'vec3'>, b: Node<'vec3'>, t: Node<'float'>) => mix(a, b, t),
  ramp: (v: Node<'float'>, from: number, to: number) => smoothstep(from, to, v),
};
```

`params` na biom: `Object.fromEntries(Object.entries(biome.params).map(([k, v]) => [k, uniform(typeof v === 'number' ? v : new Color(swatchColor(v)))]))` — liczby jako `float`, kolory jako `Color`. Trzymaj je w tablicy obok materiału i wystaw z `createTerrain` jako `biomeParams`, żeby edytor z M6 miał za co chwycić.

- [ ] **Step 2: Implementacja**

Kolejność w `colorNode`, bez zmian tam, gdzie M1 już działa:

1. Odczyt slotów: `const s = loadSlots(ix, iz);` i `const idx = [s.x, s.y, s.z].map((c) => c.mul(255).round());` — `UnsignedByteType` wraca znormalizowany do 0..1.
2. Wagi: `const w = loadCell(ix, iz);` → `w.y, w.z, w.w`.
3. `ground` i `total` jako `.toVar()`; pętla po rejestrze z `If`.
4. Dno morskie, piasek, pędzel, cień chmur — dokładnie jak dziś, po pętli.
5. `material.positionNode` i `normalNode` bez zmian.

Pilnuj reguły typowania TSL: `Fn` z anotacjami, żadnego rzutowania na goły `Node`. Jeśli `textureLoad` na teksturze bajtowej nie chce wrócić `Node<'vec4'>`, rzutuj **pojedyncze wyrażenie** na konkretny typ z komentarzem, jak `exponentialHeightFogFactor(...) as Node<'float'>` w M1.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run typecheck && npm run build
npm run test:e2e   # smoke musi przejść bez błędów konsoli: shader się kompiluje
git add src/engine/terrain/TerrainMesh.ts
git commit -m "feat: the ground is painted by the biomes' own hooks, under the slot masks

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Dziesięć biomów z danych i rejestr

**Files:**

- Create: `library/biomes/*.js` (dziesięć plików), `library/index.js`
- Test: rozszerzenie `tests/unit/contract.test.ts` o prawdziwy rejestr

**Interfaces:**

- Każdy biom to `defineBiome({ id, name, params, presence: { type: 'climatePoint', point }, ground: { type: 'layers', layers } })`. Punkty klimatu i kolory **przepisz co do wartości** z oryginału — to jest tabela poniżej i jest jedynym źródłem, bo `fly-with-me` nie jest częścią tego repozytorium.

| id | name | climate (t, m, r) | base | alt | rock |
| --- | --- | --- | --- | --- | --- |
| `wildsong` | Wildsong hills | 0.5, 0.5, 0.35 | `meadow` | `steppe` | `rock` |
| `elderwood` | Elderwood | 0.42, 0.74, 0.5 | `mossDeep` | `forest` | `rockCold` |
| `steppe` | Golden steppe | 0.68, 0.32, 0.45 | `gold` | `steppe` | `rockPale` |
| `badlands` | Red badlands | 0.82, 0.2, 0.78 | `terracotta` | `clay` | `rockRed` |
| `dunes` | Dune sea | 0.86, 0.12, 0.3 | `sandPale` | `ochre` | `rockPale` |
| `frostpines` | Frost pines | 0.16, 0.6, 0.5 | `frost` | `tundra` | `rockCold` |
| `moor` | Highland moor | 0.3, 0.42, 0.22 | `moor` | `heather` | `rockCold` |
| `autumn` | Autumn vale | 0.45, 0.5, 0.82 | `amber` | `leafLitter` | `rock` |
| `jungle` | Jungle | 0.84, 0.8, 0.5 | `jungleDeep` | `jungle` | `rock` |
| `blossom` | Blossom grove | 0.62, 0.56, 0.92 | `paleGreen` | `meadow` | `rockPale` |

- Ziemia każdego biomu to ten sam przepis co w oryginale, zapisany jako warstwy:

```js
ground: {
  type: 'layers',
  layers: [
    { color: 'gold' },                                                        // base
    { color: 'steppe', mask: 'noise', scale: 0.012, salt: 1, from: 0.18, to: 0.48 }, // alt, the macro blotches
    { color: 'rockPale', mask: 'slope', from: 0.32, to: 0.55 },               // rock on the steep
  ],
},
```

Progi `0.012 / 0.18 / 0.48` i `0.32 / 0.55` to dzisiejsze wartości z `TerrainMesh.ts` (`macro` i `rockAmt`) — przenosisz je z silnika do biblioteki, nie wymyślasz nowych. Każdy biom dostaje `params: { base, alt, rock }` z tymi samymi trzema próbkami, żeby edytor z M6 miał je pod ręką, nawet jeśli `layers` czyta swoją listę.

- Pola oryginału, których M3a **nie** przepisuje, bo nie ma ich kto czytać: `species`, `density`, `grass`, `props`, `ruins`. Wchodzą w M3b razem z `populate`. Nie wstawiaj ich „na zapas” — walidator v2 ich nie zna i słusznie odrzuci.
- `library/index.js` eksportuje `createLibrary()` zwracające `{ biomes: [...dziesięć w tej kolejności...], species: [], props: [], structures: [] }`. Kolejność biomów jest ich własnością, nie priorytetem — ale pierwszy jest awaryjnym wyborem dla texela, którego nikt nie chce (Task 4), więc `wildsong` (środek klimatu) idzie pierwszy.

- [ ] **Step 1: Test**

```ts
import { createLibrary } from '../../library/index.js';

it('ships ten biomes that pass their own validator', () => {
  const library = createLibrary();
  expect(library.biomes).toHaveLength(10);
  expect(library.biomes[0]!.id).toBe('wildsong');
  expect(validateLibrary(library)).toEqual([]);
  expect(new Set(library.biomes.map((b) => b.id)).size).toBe(10);
});
it('spreads them across climate space: no two points closer than half a radius', () => {
  const points = createLibrary().biomes.map((b) => (b.presence as { point: number[] }).point);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(...points[i]!.map((v, k) => v - points[j]![k]!));
      expect(d).toBeGreaterThan(0.06);
    }
});
```

- [ ] **Step 2: Implementacja i commit**

```bash
npm run check
git add library/biomes library/index.js tests/unit/contract.test.ts
git commit -m "feat: the ten biomes of the original, as biomes made of data

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: Spięcie świata i brama walidacji

**Files:**

- Modify: `src/engine/World.ts`, `src/page/Debug.ts`, `src/main.ts` (tylko jeśli trzeba pokazać błąd biblioteki)

**Interfaces:**

- `createWorld(opts)` przyjmuje `library?: Library` (domyślnie `createLibrary()`), woła `validateLibrary(library)` i przy niepustym wyniku **rzuca** `new Error('library:\n' + errors.join('\n'))`. Strona ma już hak awarii z M0 — sprawdź, że komunikat przez niego przechodzi, i że w konsoli widać pełną listę, nie pierwszy błąd.
- `createWorldSampler(seed, { biomes: library.biomes })`, `createTerrain({ ..., biomes: library.biomes })`.
- `World` wystawia `library` (do debugu i do M3b).
- `WorldDebug` dostaje `readonly biomes: string[]` (identyfikatory w kolejności rejestru) i `weightsAt(x, z): Array<{ id: string; weight: number }>` — trzy sloty przetłumaczone na nazwy. To jest oczko, przez które test przeglądarkowy patrzy na wagi bez czytania pikseli.

- [ ] **Step 1..3**: test jednostkowy na rzucaniu (biblioteka z jednym złym kolorem → `createWorld` rzuca, komunikat zawiera nazwę wpisu), implementacja, `npm run check`, commit.

---

### Task 10: Testy przeglądarkowe

**Files:**

- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Testy**

1. **Rejestr żyje**: `__world.biomes` ma dziesięć identyfikatorów; `__world.weightsAt(0, 0)` sumuje się do 1 i pierwsza waga jest największa.
2. **Ziemia zależy od klimatu**: znajdź w locie dwa punkty o różnych dominujących biomach (skacz `state.x` co 20 km, czytaj `weightsAt`), ustaw kamerę nisko nad każdym i porównaj `capture()` — środkowe piksele mają się różnić powyżej progu. Jeśli nie znajdziesz dwóch różnych biomów w zasięgu 200 km ziarna 42, to jest błąd w wagach, nie w teście.
3. **Brak błędów konsoli** w obu przypadkach — to jest jedyny dowód, że złożony shader się skompilował, i dlatego ten test jest obowiązkowy.
4. **Zły wpis zatrzymuje stronę**: nie da się tego zrobić z zewnątrz bez podmiany biblioteki; zostaw to testowi jednostkowemu z Taska 9.

- [ ] **Step 2: Uruchomienie i commit**

```bash
npm run test:e2e
git add tests/e2e/smoke.spec.ts
git commit -m "test: the registry reaches the page and two climates paint different ground

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 11: Dokumentacja

**Files:**

- Modify: `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/superpowers/specs/2026-09-14-dreamfall-design.md`

- [ ] **Step 1: Reguły silnika (`AGENTS.md`)**

Dopisz do „Terrain, sky and time” trzy zdania, nie więcej:

- Okno niesie `(h, w0, w1, w2)` i sloty `(i0, i1, i2, zapas)`; wagi są własnością komórki, wysokość interpoluje się po trójkącie.
- Obecność liczy CPU i normalizuje do trzech slotów; GPU tylko czyta. Ostrość klimatu (2,2) siedzi w `climatePoint`, nie w samplerze.
- Modyfikatory wysokości widzą wysokość bazową i są przycięte do `MAX_HEIGHT_DELTA`, więc kolejność rejestru nie zmienia terenu.

Do „Layout” dopisz jedno: `library/` to JS z JSDoc plus `contract.ts`; `standard/` nie importuje TSL — hak ziemi dostaje `color`, `mix` i `ramp` z kontekstu.

- [ ] **Step 2: Kontrakt prozą (`CONTRIBUTING.md`)**

Sekcja „Library contract” mówi dziś „Lands in M3”. Zastąp ją prozą: czym jest wpis, jak dodać biom (plik plus linia w `index.js`), co znaczy obecność, wysokość i ziemia, co robi walidator, gdzie leży koperta kolorów i czym różni się biom z danych od biomu z kodu. Bez powtarzania typów — od tego jest `contract.ts`.

- [ ] **Step 3: Specyfikacja**

Dwie poprawki, obie z datą:

1. §5.2 `GroundCtx` dostaje `color`, `mix` i `ramp` — z jednym zdaniem dlaczego (żeby `standard/ground.js` nie importował TSL i dał się przetestować w Node).
2. §6.3 — maski są liczone na komórkę, nie jako suma z trzech wierzchołków, bo w v2 wagi liczy CPU; zapisz to jako świadomą różnicę wobec oryginału razem z warunkiem, przy którym wracamy do trójkąta (widoczne kwadraty 16 m).

- [ ] **Step 4: README**

Linijka statusu: `M3a Contract and ground: the library contract, standard hooks, three biome slots in the height window, a ground shader composed from the biomes' own hooks, ten biomes made of data.`

```bash
npx prettier --write AGENTS.md CONTRIBUTING.md README.md && npm run format:check
git add AGENTS.md CONTRIBUTING.md README.md docs/superpowers/specs
git commit -m "docs: the library contract in prose, the slot rules, and two spec amendments

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

## Samoprzegląd planu

- **Pokrycie M3 ze spec** (§15 punkt 4), część a: `contract.ts` (Task 1), walidatory (Task 1, brama w Task 9), standardowe haki (Task 3, 6), złożony shader ziemi z trzema slotami (Task 5, 7), dziesięć biomów oryginału jako biomy z danych (Task 8). Z §6.1: obecność, normalizacja, trzy sloty, modyfikatory wysokości przycięte do 300 m, dwie tekstury (Task 4, 5). Z §18.2.4: sampler i haki są czystymi funkcjami bez DOM i bez renderera, testowanymi w Node (Task 2, 3, 4, 6).
- **Poza M3a, celowo**: streaming, pule, nadpisania, drzewa, propsy, trawa, cień (M3b); `plateau` (potrzebuje kraty osad z M4); śnieg jako warstwa świata (M5); `populate`, `sites`, `ambience` jako typy bez wywołań; pomiar kosztu shadera ziemi — spec §17 mówi „mierzony od M3”, ale `tools/bench` jest w M5, więc M3a zostaje przy braku regresji w teście przeglądarkowym i przy bramce `0.01`, która trzyma liczbę wykonywanych gałęzi na trzech.
- **Zgodność nazw między taskami**: `SWATCH`/`ENVELOPE`/`BUDGET`/`colorProblem`/`swatchColor`/`defineBiome`/`validateLibrary`/`validateBaked`; `CLIMATE` (`stretch`, `radius`, `sharpness`), `climatePoint`/`heightBand`/`mul`/`max`, `offset`/`terraces`, `layers`, `resolvePresence`/`resolveHeight`/`resolveGround`; `createFields(sampler).at(x, z)` z polami spec §5.2; `createWorldSampler(seed, { biomes })`, `sample`/`baseFields`/`sampleWindow`, `MAX_HEIGHT_DELTA`, `SLOTS`; `Heightfield.slots`/`weightsAt(x, z, ids, weights)` (bez `fieldAt`); `createTerrain({ heightfield, uniforms, litMaterial, palette, biomes })` z `biomeParams`; `createLibrary()`; `createWorld({ ..., library })` i `WorldDebug.biomes`/`weightsAt`.
- **Ryzyka wykonania**: (1) cykl importów `Fields` ↔ `WorldSampler` — jeśli ugryzie, stała `CELL` przenosi się do osobnego pliku; (2) `textureLoad` na teksturze `UnsignedByteType` wraca znormalizowany, więc indeks slotu to `×255` i zaokrąglenie — pomyłka tutaj daje ziemię w kolorze jednego biomu wszędzie; (3) dziesięć gałęzi `If` w jednym materiale to pierwszy raz, kiedy koszt shadera ziemi rośnie z rejestrem (spec §17) — jeśli klatka wyraźnie siada na SwiftShaderze w CI, to jest sygnał, nie szum; (4) `worldSampler.test.ts` ma zostać nietknięty — jeśli kusi cię jego zmiana, wróć do Taska 4 i sprawdź, czy `sample` naprawdę deleguje bez zmiany liczb.

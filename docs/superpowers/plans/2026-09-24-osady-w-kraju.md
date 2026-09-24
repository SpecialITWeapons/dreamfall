# Osady w kraju (etap 1) — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cel:** osada przestaje wypierać kraj, na którym stoi. Grunt, śnieg, trawa, drzewa i rekwizyty pod nią są krajowe, drzewa rosną między domami, trawa omija drogi i domy, a wiosek jest więcej.

**Architektura:** biom dostaje flagę `inherit: { trees }`. Czysta funkcja `countryOf` (nowy `terrain/Country.ts`) zamienia trzy sloty okna na wagi samego kraju i współczynnik polany. Czytają ją Ring (drzewa, rekwizyty) i Grass, a shader gruntu liczy te same sumy w węzłach. Zajęty grunt przechodzi z Ring do nowego modułu `scenery/Claims.ts`, który odpowiada osobno drzewom (droga, budynek z wypieczonego kształtu + 3 m, plac) i trawie (droga, obrócony prostokąt budynku). Plany przestają rezerwować działki.

**Stack:** Vite, TypeScript (silnik), JavaScript z JSDoc (`library/`), Vitest, Playwright, three 0.185.1 (`three/webgpu`, TSL).

**Specyfikacja:** `docs/superpowers/specs/2026-09-24-osady-w-kraju-i-drogi-design.md`, sekcje 1–4 i 6.

## Ograniczenia globalne

- Kod, identyfikatory, komentarze i commity po angielsku, w stylu otaczającego kodu: komentarze tłumaczą **dlaczego**, pełnymi zdaniami, z liczbami z pomiarów.
- Moduły czystego CPU (`terrain/Country.ts`, `scenery/Claims.ts`) nie importują `three/webgpu`, `three/tsl` ani DOM; z `three` biorą najwyżej klasy matematyczne.
- Żadnych singletonów na poziomie modułu: stan żyje w obiektach zwracanych przez fabryki.
- Siatka wysokości CPU jest jedynym źródłem prawdy o terenie; GPU tylko ją czyta.
- Siatka nie przekracza 8 buforów wierzchołków (dotyczy dopiero etapu 2).
- Po każdym zadaniu `npm run typecheck && npm run lint && npm test` jest zielone; przed ostatnim commitem `npm run check` i `npm run test:e2e`.
- Commit kończy się linią `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Gałąź: `claude/settlements-in-country` (już istnieje, zawiera specyfikację).

## Mapa plików

| Plik | Rola | Zadanie |
| --- | --- | --- |
| `src/engine/terrain/Country.ts` (nowy) | `standingOf`, `countryOf`: kraj pod trzema slotami i współczynnik polany | 1 |
| `tests/unit/country.test.ts` (nowy) | testy powyższego | 1 |
| `library/contract.ts` | `InheritSpec`, `Biome.inherit`, `Biome.ground` opcjonalne, walidator; potem usunięcie `AmbienceSpec.inherit` | 2, 4 |
| `src/engine/terrain/TerrainMesh.ts` | maski gruntu liczone z samego kraju | 2 |
| `src/engine/scenery/Ring.ts` | wagi kraju i polana w `populate` i `cell.*`; potem `Claims` zamiast własnej siatki | 3, 5 |
| `src/engine/scenery/Grass.ts` | trawa kraju; potem omijanie `Claims` i przepisywanie kafli | 3, 6 |
| `src/engine/World.ts` | dźwięk i mgła czytają `biome.inherit` | 3, 4 |
| `library/settlements/settlement.js`, `village.js`, `town.js` | osada bez własnej farby i scattera, `clearing`, szansa wioski 0,75, bez `minTemp` | 4 |
| `src/engine/scenery/Claims.ts` (nowy) | zajęty grunt dla drzew i trawy | 5 |
| `tests/unit/claims.test.ts` (nowy) | testy powyższego | 5 |
| `library/settlements/plan.js`, `plan-town.js` | bez rezerwacji działek | 5 |
| `src/engine/scenery/Scenery.ts` | jeden `Claims` dla Ring i Grass | 6 |
| `AGENTS.md`, `docs/superpowers/specs/2026-09-14-dreamfall-design.md` | dokumentacja | 7 |

---

### Zadanie 1: `countryOf`, czyli kraj pod trzema slotami

**Pliki:**
- Utwórz: `src/engine/terrain/Country.ts`
- Test: `tests/unit/country.test.ts`

**Interfejsy:**
- Konsumuje: `SLOTS` z `src/engine/terrain/WorldSampler.ts` (= 3), typ `Biome` z `library/contract.ts` (pole `inherit` pojawi się w zadaniu 2; tu funkcja przyjmuje strukturalny typ `{ inherit?: { trees: number } }`).
- Produkuje:
  - `interface Standing { inherit: Uint8Array; trees: Float32Array }`
  - `standingOf(biomes: ReadonlyArray<{ inherit?: { trees: number } }>): Standing`
  - `countryOf(ids: ArrayLike<number>, weights: ArrayLike<number>, standing: Standing, outIds: Uint8Array, outWeights: Float32Array): number` zwraca współczynnik polany 0..1.

- [ ] **Krok 1: napisz test, który nie przejdzie**

`tests/unit/country.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countryOf, standingOf } from '../../src/engine/terrain/Country';

// Two countries and a settlement standing in them, in registry order.
const standing = standingOf([{}, {}, { inherit: { trees: 0.4 } }]);
const ids = new Uint8Array(4),
  weights = new Float32Array(4);

describe('countryOf', () => {
  it('leaves open country as it found it, with nothing cleared', () => {
    const clearing = countryOf([0, 1, 0], [0.7, 0.3, 0], standing, ids, weights);
    expect(clearing).toBe(1);
    expect(Array.from(ids.slice(0, 3))).toEqual([0, 1, 0]);
    expect(weights[0]).toBeCloseTo(0.7, 6);
    expect(weights[1]).toBeCloseTo(0.3, 6);
    expect(weights[2]).toBe(0);
  });

  it('hands a settlement's share to the country beside it, and clears its trees by it', () => {
    // A village on eight tenths of the texel, in a wood and a meadow.
    const clearing = countryOf([2, 0, 1], [0.8, 0.15, 0.05], standing, ids, weights);
    expect(weights[0]).toBe(0);
    expect(weights[1]).toBeCloseTo(0.75, 6);
    expect(weights[2]).toBeCloseTo(0.25, 6);
    expect(clearing).toBeCloseTo(1 - 0.8 * (1 - 0.4), 6);
  });

  it('gives ground with no country in it to the first biome, as the sampler does', () => {
    const clearing = countryOf([2, 2, 2], [1, 0, 0], standing, ids, weights);
    expect(Array.from(ids.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(weights.slice(0, 3))).toEqual([1, 0, 0]);
    expect(clearing).toBeCloseTo(0.4, 6);
  });

  it('reads who stands in a country off the registry, and a country clears nothing', () => {
    expect(Array.from(standing.inherit)).toEqual([0, 0, 1]);
    expect(standing.trees[0]).toBe(1);
    expect(standing.trees[2]).toBeCloseTo(0.4, 6);
  });
});
```

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/country.test.ts`
Oczekiwane: FAIL, `Failed to resolve import "../../src/engine/terrain/Country"`.

- [ ] **Krok 3: napisz implementację**

`src/engine/terrain/Country.ts`:

```ts
// What stands in a country rather than being one. A settlement is an entry of
// the registry -- it has a presence, a plateau and a plan -- but the ground it
// stands on, what grows there, its sound and its air belong to the country
// around it. Its weight in the window is what the plateau is weighed by, and
// for everything else that weight is handed to the slots beside it.
//
// This is the arithmetic every CPU reader of the window's three slots shares:
// the ring sows by it and the grass grows by it. The ground shader writes the
// same sums in nodes (TerrainMesh), because a shader cannot call this. Pure
// CPU: no three, no DOM.
import { SLOTS } from './WorldSampler';

export interface Standing {
  /** 1 where the registry entry stands in a country, by registry index. */
  inherit: Uint8Array;
  /** The share of the country's trees and props that stands on it; 1 for a country. */
  trees: Float32Array;
}

/** Who stands in a country, read once off the registry. */
export function standingOf(biomes: ReadonlyArray<{ inherit?: { trees: number } }>): Standing {
  const inherit = new Uint8Array(biomes.length),
    trees = new Float32Array(biomes.length).fill(1);
  biomes.forEach((biome, i) => {
    if (!biome.inherit) return;
    inherit[i] = 1;
    trees[i] = biome.inherit.trees;
  });
  return { inherit, trees };
}

/**
 * The country under three slots: the slots that are a country, renormalised
 * to one, and the others zeroed. Returns how much of the country's scatter
 * stands here -- 1 in open country, the settlement's own `trees` in the middle
 * of one, and between the two across its feather, so a village fades into the
 * wood around it instead of stopping at a line.
 *
 * With no country in any slot -- three settlements, or one with nothing beside
 * it in the window -- the first biome of the registry takes it all, which is
 * the sampler's own rule for ground nobody claims.
 */
export function countryOf(
  ids: ArrayLike<number>,
  weights: ArrayLike<number>,
  standing: Standing,
  outIds: Uint8Array,
  outWeights: Float32Array,
): number {
  let country = 0,
    clearing = 1;
  for (let s = 0; s < SLOTS; s++) {
    const weight = weights[s]!,
      id = ids[s]!;
    if (!(weight > 0)) continue;
    if (standing.inherit[id]) clearing -= weight * (1 - standing.trees[id]!);
    else country += weight;
  }
  for (let s = 0; s < SLOTS; s++) {
    const weight = weights[s]!,
      id = ids[s]!;
    outIds[s] = id;
    outWeights[s] = country > 0 && weight > 0 && !standing.inherit[id] ? weight / country : 0;
  }
  if (!(country > 0)) {
    outIds.fill(0, 0, SLOTS);
    outWeights.fill(0, 0, SLOTS);
    outWeights[0] = 1;
  }
  return Math.max(0, Math.min(1, clearing));
}
```

- [ ] **Krok 4: uruchom testy**

Uruchom: `npx vitest run tests/unit/country.test.ts`
Oczekiwane: PASS, 4 testy.

- [ ] **Krok 5: typecheck, lint, commit**

```bash
npm run typecheck && npx eslint src/engine/terrain/Country.ts tests/unit/country.test.ts && npx prettier --check src/engine/terrain/Country.ts tests/unit/country.test.ts
git add src/engine/terrain/Country.ts tests/unit/country.test.ts
git commit -m "The country under three slots, for what stands in one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 2: kontrakt `inherit` i grunt kraju w shaderze

**Pliki:**
- Zmień: `library/contract.ts` (`interface Biome` ok. wiersz 554; walidator ok. wiersze 783–786)
- Zmień: `src/engine/terrain/TerrainMesh.ts` (ok. wiersze 217–253)
- Test: `tests/unit/contract.test.ts`

**Interfejsy:**
- Konsumuje: nic z zadania 1 (shader liczy te same sumy w węzłach).
- Produkuje:
  - `export interface InheritSpec { trees: number }`
  - `Biome.inherit?: InheritSpec`
  - `Biome.ground?: GroundHook` (wymagane, gdy nie ma `inherit`; walidator tego pilnuje)
  - komunikaty walidatora (dokładne teksty w teście niżej).

- [ ] **Krok 1: napisz test walidatora, który nie przejdzie**

Dopisz w `tests/unit/contract.test.ts`, w `describe` z testami `validateLibrary` (obok testu na `ambience`, ok. wiersz 78):

```ts
  it('lets an entry stand in a country, and then it paints and sows nothing of its own', () => {
    const camp = (over: Partial<Biome> = {}): Biome =>
      defineBiome({
        id: 'camp',
        name: 'Camp',
        params: {},
        presence: { type: 'climatePoint', point: [0.5, 0.5, 0.5], radius: 0.12 },
        inherit: { trees: 0.4 },
        ...over,
      });
    // standing in a country with no ground of its own is the whole point
    expect(validateLibrary({ biomes: [biome(), camp()] })).toEqual([]);
    const errors = validateLibrary({
      biomes: [
        biome(),
        camp({ id: 'painted', ground }),
        camp({ id: 'sown', populate: { type: 'scatter', species: {}, density: 0 } }),
        camp({ id: 'dense', inherit: { trees: 1.5 } }),
        camp({ id: 'nan', inherit: { trees: Number.NaN } }),
        biome({ id: 'bare', ground: undefined }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome painted: stands in a country and paints no ground of its own');
    expect(all).toContain('biome sown: stands in a country and sows nothing of its own');
    expect(all).toContain('biome dense.inherit.trees: 1.5 is not a share of 0..1');
    expect(all).toContain('biome nan.inherit.trees: NaN is not a share of 0..1');
    expect(all).toContain('biome bare: needs a ground hook');
    // the first biome takes the ground nobody claims, so it has to be a country
    expect(validateLibrary({ biomes: [camp(), biome()] })).toContain(
      'biome camp: the first biome takes unclaimed ground and cannot stand in a country',
    );
  });
```

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/contract.test.ts -t "stands in a country"`
Oczekiwane: FAIL. Typecheck zgłosi też `inherit` jako nieznane pole, a pusty `validateLibrary` zwróci `needs a ground hook` dla `camp`.

- [ ] **Krok 3: kontrakt**

W `library/contract.ts`, tuż przed `export interface Biome`:

```ts
/**
 * What an entry that stands **in** a country rather than being one keeps for
 * itself. Its ground, its snow, its grass, its trees and props, its sound and
 * its air are the country's around it: its weight in the window still carries
 * its presence and its height hook -- a settlement's plateau -- and for all the
 * rest it is handed to the slots beside it. A settlement says this, because a
 * village painted its own disc of clay and sowed its own trees, and from the
 * air that read as a patch cut out of the jungle rather than a village in it.
 */
export interface InheritSpec {
  /**
   * The share of the country's trees and props that stands on this entry's
   * ground, 0..1: a settlement is a clearing, not a wood and not a bald patch.
   */
  trees: number;
}
```

W `interface Biome` zamień `ground: GroundHook;` na:

```ts
  /** Required, unless the entry stands in a country (`inherit`); then it has none. */
  ground?: GroundHook;
```

i dopisz po `ambience?: AmbienceSpec;`:

```ts
  /** This entry stands in a country: see `InheritSpec`. */
  inherit?: InheritSpec;
```

W `validateLibrary` zamień dwie linie:

```ts
    if (!biome?.ground) errors.push(`${where}: needs a ground hook`);
    else hookType(`${where}.ground`, biome.ground, GROUND_TYPES);
```

na:

```ts
    if (biome?.inherit !== undefined) {
      // An entry that stands in a country is painted and sown by it. A ground
      // or a scatter of its own would never be read, and a field nothing reads
      // is a promise nobody keeps.
      const trees = (biome.inherit as { trees?: unknown } | null)?.trees;
      if (typeof trees !== 'number' || !(trees >= 0 && trees <= 1))
        errors.push(`${where}.inherit.trees: ${String(trees)} is not a share of 0..1`);
      if (biome.ground) errors.push(`${where}: stands in a country and paints no ground of its own`);
      if (biome.populate) errors.push(`${where}: stands in a country and sows nothing of its own`);
      if (biomes[0] === biome)
        errors.push(`${where}: the first biome takes unclaimed ground and cannot stand in a country`);
    } else if (!biome?.ground) errors.push(`${where}: needs a ground hook`);
    else hookType(`${where}.ground`, biome.ground, GROUND_TYPES);
```

- [ ] **Krok 4: shader gruntu**

W `src/engine/terrain/TerrainMesh.ts` zamień:

```ts
  const hooks = biomes.map((biome) => resolveGround(biome.ground));
```

na:

```ts
  // An entry that stands in a country has no ground of its own and no branch:
  // its share of a fragment is handed to the country beside it below.
  const hooks = biomes.map((biome) => (biome.ground ? resolveGround(biome.ground) : null));
  const inherits = biomes.map((biome) => biome.inherit !== undefined);
```

W gałęzi `else` (po `const share = [weights.y, weights.z, weights.w];`) zamień pętlę `biomes.forEach(...)` na:

```ts
      // How much of this fragment is a country at all. A slot naming an entry
      // that stands in one -- a settlement -- is counted out, and the rest is
      // spread back over one, which is `countryOf` (terrain/Country.ts) in
      // nodes: the ring sows by that function, and a ground that disagreed
      // with it would paint a meadow under a wood.
      const countryOf = (slot: number) =>
        inherits.reduce(
          (acc: Node<'float'>, inherit, k) => (inherit ? acc.sub(step(id[slot]!.sub(k).abs(), 0.5)) : acc),
          float(1),
        );
      const country = share
        .map((w, slot) => w.mul(countryOf(slot)))
        .reduce((a, b) => a.add(b))
        .toVar();
      // Nobody here is a country: the first biome takes it, the sampler's own
      // rule for ground no presence claims.
      const unclaimed = float(1).sub(step(0.0001, country));
      const total = float(0).toVar();
      biomes.forEach((_biome, k) => {
        const hook = hooks[k];
        if (!hook) return;
        // this fragment's share of this biome: the slots that name it, added
        // up, as a share of the country rather than of the whole fragment
        const mask = share
          .map((w, slot) => w.mul(step(id[slot]!.sub(k).abs(), 0.5)))
          .reduce((a, b) => a.add(b))
          .div(country.max(0.0001))
          .toVar();
        if (k === 0) mask.addAssign(unclaimed);
        If(mask.greaterThan(BRANCH_FLOOR), () => {
          const out = hook({ ...context, weight: mask, params: biomeParams[k]! } as GroundCtx);
          ground.addAssign(out.albedo.mul(mask));
          total.addAssign(mask);
          if (biomes[k]!.snow !== false) snowShare.addAssign(mask);
        });
      });
```

Istniejące `const total = float(0).toVar();` przed pętlą usuń; teraz stoi w bloku powyżej. `ground.divAssign(total.max(0.0001))` i `snowShare.divAssign(...)` zostają bez zmian.

- [ ] **Krok 5: uruchom testy i typecheck**

Uruchom: `npx vitest run tests/unit/contract.test.ts && npm run typecheck && npm run lint`
Oczekiwane: PASS. Biblioteka jeszcze nie używa `inherit`, więc cały świat maluje się jak dotąd.

- [ ] **Krok 6: commit**

```bash
git add library/contract.ts src/engine/terrain/TerrainMesh.ts tests/unit/contract.test.ts
git commit -m "An entry may stand in a country, and the ground under it is the country's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 3: Ring, trawa, dźwięk i mgła czytają kraj

**Pliki:**
- Zmień: `src/engine/scenery/Ring.ts` (definicja `cell`, ok. wiersze 305–345; pętla w `rebuild`, ok. wiersze 530–575)
- Zmień: `src/engine/scenery/Grass.ts` (tablica `sown`, ok. wiersz 297; pętla kafla, ok. wiersze 387–401)
- Zmień: `src/engine/World.ts` (ok. wiersze 304–321)
- Test: `tests/unit/ring.test.ts`, `tests/unit/grass.test.ts`

**Interfejsy:**
- Konsumuje: `standingOf`, `countryOf` (zadanie 1); `Biome.inherit` (zadanie 2).
- Produkuje: w Ring `cell.share` dla biomu kraju = waga kraju × polana; `cell.weight`, `cell.mix` i `cell.blend` czytają kraj, a `cell.mix` jest mnożone przez polanę. Grass bierze gęstość i odcień z kraju.

- [ ] **Krok 1: test Ring, który nie przejdzie**

W `tests/unit/ring.test.ts`, pod helperem `asker`, dopisz:

```ts
/** A country that remembers what share of each cell it was handed. */
const recorder = (id: string, presence: number, shares: Array<{ x: number; z: number; share: number }>): Biome =>
  defineBiome({
    id,
    name: id,
    params: {},
    presence: () => presence,
    ground,
    populate: (cell) => {
      shares.push({ x: cell.center.x, z: cell.center.z, share: cell.share });
    },
  });

/** A settlement 150 m across the middle of the world, standing in whatever is there. */
const camp = defineBiome({
  id: 'camp',
  name: 'camp',
  params: {},
  presence: (f) => (Math.hypot(f.x, f.z) < 150 ? 1 : 0),
  inherit: { trees: 0.4 },
});
```

i w `describe('the streamed ring')`:

```ts
  it('sows a settlement with the country it stands in, thinned to its clearing', () => {
    // The wood claims a quarter everywhere and the camp all of its disc, so the
    // camp holds 0.8 of a cell and the wood 0.2. The wood used to sow 0.2 of
    // that cell and the camp its own trees; now the wood has the whole cell,
    // cleared by the camp's share: 1 - 0.8 * (1 - 0.4).
    const shares: Array<{ x: number; z: number; share: number }> = [];
    const r = ring(library([recorder('woods', 0.25, shares), camp]), { radius: 300 });
    r.ring.update(0, 0, false);
    const inside = shares.filter((s) => Math.hypot(s.x, s.z) < 100);
    const outside = shares.filter((s) => Math.hypot(s.x, s.z) > 250);
    expect(inside.length).toBeGreaterThan(0);
    expect(outside.length).toBeGreaterThan(0);
    for (const s of inside) expect(s.share).toBeCloseTo(0.52, 5);
    for (const s of outside) expect(s.share).toBeCloseTo(1, 5);
  });
```

- [ ] **Krok 2: test trawy, który nie przejdzie**

W `tests/unit/grass.test.ts` zmień helper `grassOver`, żeby przyjmował bibliotekę:

```ts
const grassOver = (density: number, heightfield = flat(), library = meadow(density)) =>
  createGrass({
    seed: 42,
    library,
    heightfield,
    materials: { grass: () => ({ dispose() {} }) } as unknown as SceneryMaterials,
    shade: { aoNode: (node: unknown) => node } as unknown as GroundShade,
    uniforms: { uWorldOrigin: uniform(new Vector2(0, 0)) } as unknown as SkyUniforms,
  });
```

dopisz importy `Color` (z `three`) i `swatchColor` (z `../../library/contract`), a w `describe('createGrass')`:

```ts
  it("grows the country's grass on a settlement's ground, in the country's colour", () => {
    // The settlement holds eight tenths of every texel and has no grass of its
    // own: the meadow is the whole country, so the meadow's grass stands at the
    // meadow's own thickness, exactly as if the settlement were not there.
    const settled = meadow(0.2);
    settled.biomes.push(
      defineBiome({ id: 'camp', name: 'camp', params: {}, presence: () => 1, inherit: { trees: 0.4 } }),
    );
    const under: Heightfield = {
      ...flat(),
      weightsAt: (_x: number, _z: number, ids: Uint8Array, weights: Float32Array) => {
        ids[0] = 1;
        ids[1] = 0;
        ids[2] = 0;
        weights[0] = 0.8;
        weights[1] = 0.2;
        weights[2] = 0;
      },
    } as unknown as Heightfield;
    const origin = createOrigin();
    const open = grassOver(0.2);
    open.update(0, 0, 120, origin, false);
    const village = grassOver(0.2, under, settled);
    village.update(0, 0, 120, origin, false);
    expect(village.count).toBe(open.count);
    const mesh = village.mesh.children[0] as unknown as { instanceColor: { array: Float32Array } };
    const want = new Color(swatchColor('grassCool'));
    expect(mesh.instanceColor.array[0]).toBeCloseTo(want.r, 5);
    expect(mesh.instanceColor.array[1]).toBeCloseTo(want.g, 5);
    expect(mesh.instanceColor.array[2]).toBeCloseTo(want.b, 5);
    open.dispose();
    village.dispose();
  });
```

(`meadow` zwraca obiekt z tablicą `biomes`, a `push` dopisuje osadę jako biom 1.)

- [ ] **Krok 3: uruchom i sprawdź, że oba nie przechodzą**

Uruchom: `npx vitest run tests/unit/ring.test.ts tests/unit/grass.test.ts -t "settlement"`
Oczekiwane: FAIL. W Ring `share` w środku wynosi ok. 0,2 zamiast 0,52; w trawie liczba kępek jest ok. 5 razy mniejsza.

- [ ] **Krok 4: Ring**

W `src/engine/scenery/Ring.ts` dodaj import:

```ts
import { countryOf, standingOf } from '../terrain/Country';
```

Pod `const slotWeights = new Float32Array(4);` dopisz:

```ts
  // The country under the cell. A settlement's slot is its presence and its
  // plateau, not a planting: its share goes to the biomes beside it, and what
  // they sow is thinned by `clearing` (terrain/Country.ts).
  const standing = standingOf(biomes);
  const countryIds = new Uint8Array(4);
  const countryWeights = new Float32Array(4);
  let clearing = 1;
```

W obiekcie `cell` zamień w `weight`, `mix` i `blend` każde `slotIds` na `countryIds`, a `slotWeights` na `countryWeights`. `mix` zwraca `sum * clearing`:

```ts
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
```

W `rebuild` pod `heightfield.weightsAt(ccx, ccz, slotIds, slotWeights);` dopisz:

```ts
        clearing = countryOf(slotIds, slotWeights, standing, countryIds, countryWeights);
```

a pętlę sadzenia zamień na:

```ts
        for (let s = 0; s < SLOTS; s++) {
          // The floor is the country's own share: which biomes get a say in a
          // cell is not changed by a village standing on it, only how much of
          // what they sow comes up.
          const weight = countryWeights[s]!;
          if (weight < POPULATE_FLOOR) continue;
          const entry = sown[countryIds[s]!];
          if (!entry) continue;
          share = weight * clearing;
          roll = stream(biomeSalt[countryIds[s]!]!);
          entry.hook(cell, kit);
        }
```

- [ ] **Krok 5: trawa**

W `src/engine/scenery/Grass.ts` dodaj import `import { countryOf, standingOf } from '../terrain/Country';`. Pod tablicą `sown` dopisz:

```ts
  // A settlement grows the grass of the country it stands in, at the country's
  // own thickness: trodden ground is the road, and the road is not grass.
  const standing = standingOf(library.biomes);
  const countryIds = new Uint8Array(4),
    countryWeights = new Float32Array(4);
```

W pętli kafla, pod `heightfield.weightsAt(midX, midZ, slotIds, slotWeights);`, dopisz `countryOf(slotIds, slotWeights, standing, countryIds, countryWeights);`, a w pętli po slotach czytaj kraj:

```ts
        for (let s = 0; s < SLOTS; s++) {
          const weight = countryWeights[s]!,
            grass = sown[countryIds[s]!];
```

- [ ] **Krok 6: dźwięk i mgła (World)**

W `src/engine/World.ts` dopisz nad `ambienceSpecs` pomocniczą funkcję (usunie ją zadanie 4, gdy zniknie `ambience.inherit`):

```ts
  // Who stands in a country, for the sound and the air: the entry's own flag,
  // or the older one on its ambience while the library still says that.
  const inherits = (biome: Biome) => biome.inherit !== undefined || biome.ambience?.inherit === true;
```

Zamień budowę `ambienceSpecs` i `hazeSpecs`:

```ts
  const ambienceSpecs = library.biomes.map((biome) =>
    biome.ambience || inherits(biome)
      ? { layers: biome.ambience?.layers, inherit: inherits(biome) }
      : undefined,
  );
```

```ts
  const hazeSpecs = library.biomes.map((biome) =>
    biome.ambience?.fogTint === undefined && !inherits(biome)
      ? undefined
      : {
          color: new Color(biome.ambience?.fogTint === undefined ? 0 : swatchColor(biome.ambience.fogTint)),
          amount: biome.ambience?.fogTint === undefined ? 0 : (biome.ambience.fogTintAmount ?? 0.2),
          inherit: inherits(biome),
        },
  );
```

Jeśli `Biome` nie jest jeszcze importowane w `World.ts`, dodaj `type Biome` do importu z `../../library/contract`. Jeśli `layers` w spec AmbienceModel nie jest opcjonalne, typecheck to wskaże: wtedy podaj `layers: biome.ambience?.layers ?? {}`.

- [ ] **Krok 7: uruchom testy**

Uruchom: `npx vitest run tests/unit/ring.test.ts tests/unit/grass.test.ts tests/unit/ambienceModel.test.ts tests/unit/haze.test.ts && npm run typecheck && npm run lint`
Oczekiwane: PASS, łącznie z dotychczasowymi testami Ring (bez osad `countryOf` zwraca te same wagi i polanę 1).

- [ ] **Krok 8: commit**

```bash
git add src/engine/scenery/Ring.ts src/engine/scenery/Grass.ts src/engine/World.ts tests/unit/ring.test.ts tests/unit/grass.test.ts
git commit -m "The ring, the grass, the sound and the air read the country a settlement stands in

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 4: osady stoją w kraju, wiosek jest więcej

**Pliki:**
- Zmień: `library/settlements/settlement.js`, `library/settlements/village.js`, `library/settlements/town.js`
- Zmień: `library/contract.ts` (usuń `AmbienceSpec.inherit` i jego walidację, ok. wiersze 544–551 i 828–829)
- Zmień: `src/engine/World.ts` (uprość `inherits`)
- Zmień: `library/standard/presence.js` (komentarz przy `minTemp`: tylko uwaga, że osady biblioteki z niego nie korzystają)
- Test: `tests/unit/contract.test.ts`, nowy `tests/unit/settlementFrequency.test.ts`

**Interfejsy:**
- Konsumuje: `InheritSpec` (zadanie 2), odczyt kraju w silniku (zadanie 3).
- Produkuje: `SettlementParams` bez `paint`, `scenery` i `ground.minTemp`, z nowym `clearing: number`; `VILLAGE.odds === 0.75`.

- [ ] **Krok 1: test częstości, który nie przejdzie**

`tests/unit/settlementFrequency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { settlement } from '../../library/settlements/settlement.js';
import { planVillage } from '../../library/settlements/plan.js';
import { VILLAGE } from '../../library/settlements/village.js';
import type { Library } from '../../library/contract';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createSites } from '../../src/engine/scenery/Sites';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/** Every village seated within `reach` of the middle of seed 42's world, by id. */
const villages = (library: Library, reach: number) => {
  const sampler = createWorldSampler(42, { biomes: library.biomes });
  const sites = createSites({
    library,
    sampler,
    heightfield: createHeightfield(sampler),
    overrides: createOverrides([]),
  });
  return new Set(
    sites
      .near(0, 0, reach, [])
      .filter((s) => s.biome === 'village')
      .map((s) => s.id),
  );
};

describe('how often a village stands', () => {
  it('stands half again as many villages, and every one that stood before still stands', () => {
    // The carry draw is one number per cell against the odds, so raising the
    // odds only ever adds a village -- and dropping `minTemp` adds the cold
    // ones. Measured before the change: one village per 90 km2 of land, 9.4 km
    // apart; at 0.75 that is about 7.7 km.
    const now = createLibrary();
    const before: Library = {
      ...now,
      biomes: now.biomes.map((b) =>
        b.id === 'village'
          ? settlement({ ...VILLAGE, odds: 0.5, ground: { ...VILLAGE.ground, minTemp: 0.2 } }, planVillage)
          : b,
      ),
    };
    const was = villages(before, 60000),
      is = villages(now, 60000);
    expect(was.size).toBeGreaterThan(50);
    for (const id of was) expect(is.has(id), id).toBe(true);
    expect(is.size / was.size).toBeGreaterThan(1.3);
    expect(is.size / was.size).toBeLessThan(1.8);
  });
});
```

`settlement` w wersji z tego zadania ignoruje `minTemp`. Test i tak przekazuje go do „przed", bo `presence` go czyta; w kroku 3 `settlement.js` podaje hookowi `minTemp: params.ground.minTemp` (`undefined` znaczy „bez limitu"). Dzięki temu „przed" odtwarza dawne liczby.

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/settlementFrequency.test.ts`
Oczekiwane: FAIL na `is.size / was.size > 1.3` (dziś stosunek wynosi 1).

- [ ] **Krok 3: `settlement.js`**

Zamień typedef i treść funkcji w `library/settlements/settlement.js`. Typedef:

```js
/**
 * @typedef {object} SettlementParams
 * @property {string} id
 * @property {string} name
 * @property {{ cell: number, salt: number }} lattice
 * @property {number} odds
 * @property {[number, number]} radius
 * @property {{ strength: number, feather: number }} plateau
 * @property {{ land: number, maxSlope: number, maxCut?: number, minTemp?: number }} ground `minTemp` is for a settlement that refuses the cold; none in this library does.
 * @property {number} clearing The share of the country's trees and props that stands on its ground, 0..1.
 * @property {Record<string, number>} buildings
 * @property {string} [landmark] The one building placed by name rather than drawn by weight.
 * @property {import('../contract').SceneryColor[]} [palette]
 */
```

Usuń stałą `PAINT` i `const paint = ...`. Wpis:

```js
  return defineBiome({
    id: params.id,
    name: params.name,
    params: {},
    presence: {
      type: 'lattice',
      cell,
      salt,
      // (keep the existing comment about the range)
      radius: params.radius,
      feather: params.plateau.feather,
      odds: params.odds,
      land: params.ground.land,
      minTemp: params.ground.minTemp,
      maxSlope: params.ground.maxSlope,
      maxCut: params.ground.maxCut,
    },
    height: { /* unchanged */ },
    // It stands in a country and is painted and sown by it. It used to paint a
    // disc of its own -- clay for a village, grey-green for a town -- and sow
    // its own three species, and from the air that read as a patch cut out of
    // the country rather than a place in it: the owner's words were that the
    // separate ground under the houses did not look good. Now its weight is its
    // presence and its plateau, and everything that grows or is painted there
    // is the country's, its trees and props thinned to a clearing.
    inherit: { trees: params.clearing },
    // A settlement sounds like its country with a bell in it -- more of one
    // where there is a landmark to hang it in -- and its air is the country's.
    ambience: { layers: { bells: params.landmark ? 0.6 : 0.3 } },
    sites: {
      cell,
      salt,
      radius: params.radius,
      // (keep the existing comment about the landmark)
      structures: params.landmark ? { ...params.buildings, [params.landmark]: 0 } : params.buildings,
      palette: params.palette,
      // The same numbers the presence hook above reads, asked of the same point.
      fits: (f) =>
        f.baseHeight >= params.ground.land && (params.ground.minTemp === undefined || f.temp >= params.ground.minTemp),
      build: (site, kit) => plan(site, params, kit),
    },
  });
```

Pola `populate` i `ground` znikają całkowicie. Komentarz nagłówkowy pliku uzupełnij o jedno zdanie: „It stands in a country: the ground, the grass and the trees under it are the country's (`inherit`)".

- [ ] **Krok 4: `village.js` i `town.js`**

W `village.js`:
- `odds: 0.5` → `odds: 0.75` z komentarzem: „Three in four cells of the lattice that can seat one carry a village: one per 60 km² of land, about 7.7 km apart -- the owner asked for more of them than one per 90 km² at 9.4 km. The carry draw is one number per cell, so raising the odds only adds villages; every village that stood at 0.5 still stands.";
- `ground: { land: 10, minTemp: 0.2, maxSlope: 0.45 }` → `ground: { land: 10, maxSlope: 0.45 }`; komentarz nad nim uzupełnij: „No `minTemp`: a village stands in any country, the frozen ones included, on the country's own snow.";
- usuń całe pole `scenery` razem z komentarzem i dodaj:

```js
  /**
   * The share of the country's trees and props that stands on a village's
   * ground: a clearing. It used to sow its own oaks and blossoms at 0.3, and
   * measured that was 0.5 trees a hectare inside against 1.4 outside; the
   * country's own density times 0.4 keeps the same ratio in a wood, and a
   * steppe village has its handful of acacias rather than somebody's orchard.
   */
  clearing: 0.4,
```

- komentarz przy `hedges` („`offset` clears the lots: a house sits `lots.setback` from the axis and reserves `lots.depth * 0.7` around itself...") zamień na: „`offset` clears the gardens: a house sits `lots.setback` from the axis and is about 7 m deep, so 34 m is behind it with room for a garden."

W `town.js`:
- `ground: { land: 12, minTemp: 0.25, maxSlope: 0.45, maxCut: 120 }` → `ground: { land: 12, maxSlope: 0.45, maxCut: 120 }`;
- usuń `scenery` i `paint` razem z komentarzami i dodaj `clearing: 0.4` z komentarzem: „The country's trees between the buildings and along the streets, at a clearing's share: a town is not a wood, and it is not the pale disc it was when it painted a kilometre of its own ground."

- [ ] **Krok 5: usuń `ambience.inherit`**

W `library/contract.ts` usuń pole `inherit` z `AmbienceSpec` (i jego komentarz) oraz dwie linie walidatora `if (air.inherit !== undefined && ...)`. W `src/engine/World.ts` zamień helper na:

```ts
  // Who stands in a country, for the sound and the air.
  const inherits = (biome: Biome) => biome.inherit !== undefined;
```

- [ ] **Krok 6: popraw testy kontraktu**

W `tests/unit/contract.test.ts`:
- ok. wiersz 88: `biome({ id: 'fine', ambience: { layers: { birds: 0.5 }, fogTint: 'frost', inherit: true } })` → bez `inherit: true`;
- w teście z `expect(Object.keys(biome.params)).toEqual(['base', 'alt', 'rock'])` zamień tę linię na:

```ts
      // an entry standing in a country paints nothing, so it has nothing to paint with
      if (biome.inherit) expect(biome.params).toEqual({});
      else expect(Object.keys(biome.params)).toEqual(['base', 'alt', 'rock']);
```

- w teście „ships nine species and two props" pętlę `for (const biome of library.biomes)` zacznij od `if (biome.inherit) continue;`, a fragment od `// and a settlement grows less than the country` do końca pętli po `settled` zamień na:

```ts
    // A settlement sows nothing of its own: it stands in a country, and the
    // country's trees come up on it at a clearing's share -- neither the wood
    // around it nor the bare disc of paint it was when it sowed for itself.
    const settled = library.biomes.filter((b) => b.sites);
    expect(settled.map((b) => b.id)).toEqual(['village', 'town']);
    for (const biome of settled) {
      expect(biome.populate).toBeUndefined();
      expect(biome.ground).toBeUndefined();
      expect(biome.inherit!.trees).toBeGreaterThan(0);
      expect(biome.inherit!.trees).toBeLessThan(1);
    }
```

- w teście o dźwiękach: `expect(biome.ambience?.inherit, ...).toBe(true)` → `expect(biome.inherit, \`${biome.id} stands in a country\`).toBeDefined();`;
- w teście „paints every biome out of the swatch book" pętlę zacznij od `if (biome.inherit) continue;`.

- [ ] **Krok 7: pełny zestaw testów**

Uruchom: `npm run typecheck && npm run lint && npm test`
Oczekiwane: PASS. Jeśli padnie test z wartościami złotymi okna (np. `worldSampler.test.ts` lub `hookCost.test.ts`) dlatego, że w mierzonym miejscu stanęła nowa wioska, sprawdź, czy różnica pochodzi z plateau nowej wioski: porównaj `sites.near` w tym punkcie dla `odds` 0,5 i 0,75. Tylko wtedy zaktualizuj wartość świadomie, z komentarzem „a village seated at odds 0.75 levels this ground". Każdą inną przyczynę zbadaj, zamiast nadpisywać liczbę.

- [ ] **Krok 8: punkt bez wiosek w e2e**

`tests/e2e/smoke.spec.ts` trzyma `VILLAGE_FREE = { x: 6000, z: 6000 }` z opisem „the nearest is over 3.2 km away". Przy szansie 0,75 może tam stanąć nowa wioska. Dopisz do `tests/unit/settlementFrequency.test.ts`:

```ts
  it("keeps the browser test's village-free wood free of villages", () => {
    // tests/e2e/smoke.spec.ts VILLAGE_FREE: the ring there must see no site.
    const lib = createLibrary();
    const sampler = createWorldSampler(42, { biomes: lib.biomes });
    const sites = createSites({
      library: lib,
      sampler,
      heightfield: createHeightfield(sampler),
      overrides: createOverrides([]),
    });
    expect(sites.near(6000, 6000, 2600, [])).toEqual([]);
  });
```

Jeśli test nie przejdzie, znajdź nowy punkt: przejdź po `x, z` od 4000 do 20000 co 1000 m i wybierz pierwszy, dla którego `sites.near(x, z, 3200, [])` jest puste, a `heightAt(x, z) > 20`, tak żeby nie trafić w morze. Wpisz go w obu miejscach: `VILLAGE_FREE` w `smoke.spec.ts` i ten test. Tak samo sprawdź `VILLAGE` i `NEXT_VILLAGE`: `sites.near(1525, 1588, 300, [])[0]` musi mieć `biome === 'village'`. `NEXT_VILLAGE` jest opisane jako „następna wioska, 8,3 km dalej"; jeśli teraz bliżej stoi inna, popraw tylko opis w komentarzu, bo test używa jej jako punktu poza oknem wysokości.

- [ ] **Krok 9: commit**

```bash
git add library/ src/engine/World.ts tests/unit/contract.test.ts tests/unit/settlementFrequency.test.ts tests/e2e/smoke.spec.ts
git commit -m "Settlements stand in their country, and there are more villages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 5: `Claims`, czyli budynek zajmuje tyle gruntu, ile ma

**Pliki:**
- Utwórz: `src/engine/scenery/Claims.ts`
- Test: `tests/unit/claims.test.ts`
- Zmień: `src/engine/scenery/Ring.ts` (usuń `Claim`, `claims`, `claim`, `indexPlans` i `occupied`, ok. wiersze 64–80 i 244–302; rozproszone rekwizyty w `rebuild`; `RingDeps`)
- Zmień: `library/settlements/plan.js` (wiersz 177), `library/settlements/plan-town.js` (wiersze 308 i 418)
- Test: `tests/unit/ring.test.ts`, `tests/unit/settlementPlan.test.ts`, `tests/unit/townPlan.test.ts`

**Interfejsy:**
- Konsumuje: `SitePlan`, `LotSpec` z `library/contract.ts`; `OBSTACLE_CELL` z `./Obstacles`.
- Produkuje:

```ts
export const TREE_MARGIN = 3;
export const GRASS_ROAD_MARGIN = 0.5;
export const GRASS_WALL_MARGIN = 1;
export const PROP_CLAIM = 2;
export interface ClaimShapes {
  building(id: string, floors: number): { radius: number; footprint?: [number, number] } | null;
}
export interface PlanBounds { id: string; x0: number; z0: number; x1: number; z1: number }
export interface Claims {
  clear(): void;
  add(plan: SitePlan, shapes: ClaimShapes): void;
  trees(x: number, z: number): boolean;
  grass(x: number, z: number): boolean;
  readonly plans: ReadonlyArray<PlanBounds>;
}
export function createClaims(): Claims;
```

- `RingDeps.claims?: Claims` (bez niego Ring tworzy własny).

- [ ] **Krok 1: test `Claims`, który nie przejdzie**

`tests/unit/claims.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LotSpec, SitePlan } from '../../library/contract';
import {
  GRASS_ROAD_MARGIN,
  GRASS_WALL_MARGIN,
  PROP_CLAIM,
  TREE_MARGIN,
  createClaims,
  type ClaimShapes,
} from '../../src/engine/scenery/Claims';

const shapes: ClaimShapes = {
  building: (id) => (id === 'cottage' ? { radius: 9, footprint: [14, 10] } : null),
};
const lot = (over: Partial<LotSpec> = {}): LotSpec => ({ x: 100, z: 50, yaw: 0, structure: 'cottage', floors: 1, ...over });
const plan = (over: Partial<SitePlan> = {}): SitePlan => ({
  id: 'village:0,0',
  x: 0,
  z: 0,
  radius: 250,
  roads: [],
  lines: [],
  lots: [],
  reservations: [],
  ...over,
});

describe('createClaims', () => {
  it('claims nothing, and answers so for free, before a plan is added', () => {
    const claims = createClaims();
    expect(claims.trees(0, 0)).toBe(false);
    expect(claims.grass(0, 0)).toBe(false);
    expect(claims.plans).toEqual([]);
  });

  it("keeps a tree off a house by the house's own reach and a margin, and no further", () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot()] }), shapes);
    const edge = 9 + TREE_MARGIN;
    expect(claims.trees(100 + edge - 0.1, 50)).toBe(true);
    expect(claims.trees(100 + edge + 0.1, 50)).toBe(false);
  });

  it('keeps grass off the walls and eaves only, turned with the house', () => {
    const claims = createClaims();
    // turned a quarter: the 14 m side now runs along z
    claims.add(plan({ lots: [lot({ yaw: Math.PI / 2 })] }), shapes);
    const long = 7 + GRASS_WALL_MARGIN,
      short = 5 + GRASS_WALL_MARGIN;
    expect(claims.grass(100, 50 + long - 0.1)).toBe(true);
    expect(claims.grass(100, 50 + long + 0.1)).toBe(false);
    expect(claims.grass(100 + short - 0.1, 50)).toBe(true);
    expect(claims.grass(100 + short + 0.1, 50)).toBe(false);
    // a corner of the circle a tree keeps off is garden to the grass
    expect(claims.grass(100 + short + 1, 50 + long + 1)).toBe(false);
    expect(claims.trees(100 + short + 1, 50 + long + 1)).toBe(true);
  });

  it('keeps both off a road, the grass right up to its edge', () => {
    const claims = createClaims();
    claims.add(
      plan({
        roads: [
          {
            points: [
              [-100, 0],
              [100, 0],
            ],
            width: 6,
          },
        ],
      }),
      shapes,
    );
    expect(claims.trees(0, 2.9)).toBe(true);
    expect(claims.trees(0, 3.1)).toBe(false);
    expect(claims.grass(0, 3 + GRASS_ROAD_MARGIN - 0.1)).toBe(true);
    expect(claims.grass(0, 3 + GRASS_ROAD_MARGIN + 0.1)).toBe(false);
    // a road ends where its last point does
    expect(claims.trees(110, 0)).toBe(false);
  });

  it('keeps a square the plan reserved clear of trees, and a prop the plan asked for clear of both', () => {
    const claims = createClaims();
    claims.add(
      plan({
        reservations: [{ x: -50, z: -50, radius: 30 }],
        lots: [lot({ x: 40, z: -40, floors: 0, structure: 'well' })],
      }),
      shapes,
    );
    expect(claims.trees(-50, -21)).toBe(true);
    expect(claims.grass(-50, -21)).toBe(false);
    expect(claims.trees(40 + PROP_CLAIM - 0.1, -40)).toBe(true);
    expect(claims.grass(40 + PROP_CLAIM - 0.1, -40)).toBe(true);
  });

  it('claims nothing for a building nobody baked, since nothing will stand there', () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot({ structure: 'castle' })] }), shapes);
    expect(claims.trees(100, 50)).toBe(false);
  });

  it('reports each plan with the box its claims cover, and forgets all of it on clear', () => {
    const claims = createClaims();
    claims.add(plan({ lots: [lot()] }), shapes);
    const [bounds] = claims.plans;
    expect(bounds!.id).toBe('village:0,0');
    expect(bounds!.x0).toBeLessThanOrEqual(100 - 9 - TREE_MARGIN);
    expect(bounds!.x1).toBeGreaterThanOrEqual(100 + 9 + TREE_MARGIN);
    claims.clear();
    expect(claims.plans).toEqual([]);
    expect(claims.trees(100, 50)).toBe(false);
  });
});
```

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/claims.test.ts`
Oczekiwane: FAIL, brak modułu.

- [ ] **Krok 3: implementacja `Claims`**

`src/engine/scenery/Claims.ts`:

```ts
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
  hw: number;
  hd: number;
}
type Record = Capsule | Box;

const inside = (c: Record, x: number, z: number) => {
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

/** One layer of the index: records filed under every cell they touch. */
function createGrid() {
  const cells = new Map<string, Record[]>();
  const file = (record: Record, x0: number, z0: number, x1: number, z1: number) => {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++)
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const key = `${cx},${cz}`,
          bucket = cells.get(key);
        if (bucket) bucket.push(record);
        else cells.set(key, [record]);
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
      file({ kind: 1, x, z, cos: Math.cos(yaw), sin: Math.sin(yaw), hw, hd }, x - reach, z - reach, x + reach, z + reach);
    },
    has(x: number, z: number) {
      // A world with no settlements pays one comparison for the question.
      if (cells.size === 0) return false;
      const bucket = cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
      if (!bucket) return false;
      for (const record of bucket) if (inside(record, x, z)) return true;
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
```

Uwaga do obrotu w `inside`: dla `yaw = π/2` bok 14 m (lokalne x) leży wzdłuż świata z. Sprawdza to test z kroku 1; jeśli nie przechodzi, zamień znaki `sin` w obu wyrażeniach i uruchom test ponownie. Test jest tu źródłem prawdy, bo trzyma zgodność z `Object3D.rotation.y`.

- [ ] **Krok 4: uruchom testy `Claims`**

Uruchom: `npx vitest run tests/unit/claims.test.ts`
Oczekiwane: PASS, 7 testów.

- [ ] **Krok 5: testy Ring, które nie przejdą**

W `tests/unit/ring.test.ts`, w `describe('the streamed ring')`:

```ts
  it("keeps a tree off a house by the house's own reach, and lets one stand in its garden", () => {
    // metrics says a cottage reaches 6 m; the margin is 3 (scenery/Claims.ts)
    const house = lotAt(40, -20);
    const answers: boolean[] = [];
    const probes: Array<[number, number]> = [
      [house.x + 9 - 0.5, house.z],
      [house.x + 9 + 0.5, house.z],
    ];
    const r = ring(library([asker(probes, answers)]), {
      sites: oneSite(planOf({ x: 0, z: 0, lots: [house] })),
    });
    r.ring.update(0, 0, false);
    expect(answers).toEqual([true, false]);
  });

  it('keeps a scattered prop off the plan, and still stands the one the plan asked for', () => {
    const road: RoadSpec = {
      points: [
        [-300, 0],
        [300, 0],
      ],
      width: 40,
    };
    const well = lotAt(0, 120, 0, 'stones');
    const r = ring(library([everywhere('woods', 0, { stones: 1 })], [stones]), {
      sites: oneSite(planOf({ x: 0, z: 0, roads: [road], lots: [well] })),
    });
    r.ring.update(0, 0, false);
    const scattered = r.props.filter((p) => !(p.x === well.x && p.z === well.z));
    expect(scattered.length).toBeGreaterThan(10);
    expect(scattered.filter((p) => toRoad(road, p.x, p.z) <= road.width / 2)).toEqual([]);
    expect(r.props.some((p) => p.x === well.x && p.z === well.z)).toBe(true);
  });
```

Uruchom: `npx vitest run tests/unit/ring.test.ts -t "garden|scattered prop"`
Oczekiwane: FAIL. Pierwszy test daje `[false, false]`, bo lot dziś niczego nie zajmuje; drugi znajduje rekwizyty na drodze.

- [ ] **Krok 6: Ring używa `Claims`**

W `src/engine/scenery/Ring.ts`:
- dodaj `import { createClaims, type ClaimShapes, type Claims } from './Claims';`;
- usuń `CLAIM_CELL`, interfejs `Claim` i import `OBSTACLE_CELL`, jeśli nic poza nimi go nie używa;
- w `RingDeps` dopisz:

```ts
  /** The ground the plans speak for; shared with the grass. The ring fills it. */
  claims?: Claims;
```

- w `createRing` zastąp `claims`, `nearby`, `claim`, `indexPlans` i `occupied` przez:

```ts
  const claims = deps.claims ?? createClaims();
  const nearby: Site[] = [];
  const footprints = new Map((library.structures ?? []).map((entry) => [entry.id, entry.footprint]));
  // A house claims its ground by its baked shape, as its obstacle does.
  const shapes: ClaimShapes = {
    building(id, floors) {
      const shape = metrics.structure(id, floors);
      if (!shape) return null;
      const footprint = footprints.get(id);
      return footprint ? { radius: shape.radius, footprint } : { radius: shape.radius };
    },
  };

  /** Reads the plans in reach into the index, from nothing, at every rebuild. */
  const indexPlans = (x: number, z: number) => {
    claims.clear();
    if (!sites) return;
    for (const site of sites.near(x, z, radius, nearby)) {
      // A site still in the queue has no plan yet, so it speaks for no ground:
      // the same frame has nothing of it to build either.
      const plan = sites.planFor(site);
      if (plan) claims.add(plan, shapes);
    }
  };

  const occupied = (x: number, z: number) => claims.trees(x, z);
```

  Jeśli `footprint` w kontrakcie jest typowane jako `[number, number]`, mapa przejdzie typecheck bez rzutowania; w innym wypadku użyj `entry.footprint as [number, number]`.
- w pętli rekwizytów w `rebuild` zamień:

```ts
          for (const put of entry.place(cell, propKit) ?? []) standProp(entry.id, put);
```

  na:

```ts
          // A scattered prop keeps off a plan as a tree does. A prop the plan
          // asked for is the plan's own and is stood by `raise`, not here.
          for (const put of entry.place(cell, propKit) ?? [])
            if (!occupied(put.x, put.z)) standProp(entry.id, put);
```

- [ ] **Krok 7: plany przestają rezerwować działki**

W `library/settlements/plan.js` usuń linię `kit.reserve(x, z, params.lots.depth * 0.7);` (wiersz 177). W `library/settlements/plan-town.js` usuń `kit.reserve(landmarkX, landmarkZ, depth * 0.7);` razem z komentarzem nad nią (wiersze 306–308) oraz `kit.reserve(lot.x, lot.z, depth * 0.7);` (wiersz 418). `kit.reserve(site.x, site.z, params.plaza.radius);` zostaje. W komentarzu hedges w `plan.js` („the offset clears the lots' own reservations") zamień „reservations" na „gardens".

W `tests/unit/settlementPlan.test.ts` zamień test „speaks for the ground it built on: every house is inside a reservation" na:

```ts
  it('reserves no ground for its houses: a house claims its own by its baked shape', () => {
    // The ring measures a house the way it measures its obstacle
    // (scenery/Claims.ts). A plan that reserved 16.8 m round every lot closed
    // the whole street to trees, lots being 24 m apart.
    expect(plan().reservations).toEqual([]);
  });
```

W `tests/unit/townPlan.test.ts` zamień test „speaks for the ground it built on: the plaza and every building" na:

```ts
  it('reserves the plaza and nothing else: a building claims its own ground by its baked shape', () => {
    const { reservations } = plan();
    expect(reservations).toHaveLength(1);
    expect(Math.hypot(reservations[0]!.x, reservations[0]!.z)).toBe(0);
    expect(reservations[0]!.radius).toBe(TOWN.plaza.radius);
  });
```

(Jeśli `TOWN` nie jest importowany w `townPlan.test.ts`, dodaj `import { TOWN } from '../../library/settlements/town.js';`.)

- [ ] **Krok 8: pełny zestaw testów**

Uruchom: `npm run typecheck && npm run lint && npm test`
Oczekiwane: PASS. Test „keeps the scatter off a plan: nothing in a reservation, nothing on a road" przechodzi bez zmian, bo rezerwacje i drogi są w `Claims.trees`.

- [ ] **Krok 9: commit**

```bash
git add src/engine/scenery/Claims.ts src/engine/scenery/Ring.ts library/settlements/plan.js library/settlements/plan-town.js tests/unit/claims.test.ts tests/unit/ring.test.ts tests/unit/settlementPlan.test.ts tests/unit/townPlan.test.ts
git commit -m "A house claims the ground its shape takes, so trees stand between houses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 6: trawa omija drogi i domy

**Pliki:**
- Zmień: `src/engine/scenery/Grass.ts` (`GrassDeps`, pętla kafla, `rebuild`, `update`)
- Zmień: `src/engine/scenery/Scenery.ts` (jeden `Claims` dla Ring i Grass)
- Test: `tests/unit/grass.test.ts`

**Interfejsy:**
- Konsumuje: `createClaims`, `Claims`, `PlanBounds` (zadanie 5).
- Produkuje: `GrassDeps.claims?: Claims`. Kafel pomija kępki w `claims.grass`, a kafle pod planem, który pojawił się po ich zapisaniu, są pisane od nowa.

- [ ] **Krok 1: test, który nie przejdzie**

W `tests/unit/grass.test.ts` dopisz import `import { createClaims } from '../../src/engine/scenery/Claims';` oraz `type SitePlan` z kontraktu. Helper `grassOver` rozszerz o `claims`:

```ts
const grassOver = (
  density: number,
  heightfield = flat(),
  library = meadow(density),
  claims?: ReturnType<typeof createClaims>,
) =>
  createGrass({
    seed: 42,
    library,
    heightfield,
    materials: { grass: () => ({ dispose() {} }) } as unknown as SceneryMaterials,
    shade: { aoNode: (node: unknown) => node } as unknown as GroundShade,
    uniforms: { uWorldOrigin: uniform(new Vector2(0, 0)) } as unknown as SkyUniforms,
    claims,
  });
```

Funkcję `tufts` z testu „holds the same meadow" wynieś na poziom pliku (obok `standing`), żeby oba testy mogły jej używać. Dopisz test:

```ts
  it('keeps off a road, and a plan that arrives late rewrites only the tiles under it', () => {
    const road: SitePlan = {
      id: 'village:0,0',
      x: 0,
      z: 0,
      radius: 200,
      roads: [
        {
          points: [
            [-200, 10],
            [200, 10],
          ],
          width: 8,
        },
      ],
      lines: [],
      lots: [],
      reservations: [],
    };
    const shapes = { building: () => null };
    const origin = createOrigin();
    // The plan was there when the window was written.
    const early = createClaims();
    early.add(road, shapes);
    const first = grassOver(0.2, flat(), meadow(0.2), early);
    first.update(0, 0, 120, origin, false);
    // The plan arrived after: the window was written, then the queue built it.
    const late = createClaims();
    const second = grassOver(0.2, flat(), meadow(0.2), late);
    second.update(0, 0, 120, origin, false);
    const before = second.count;
    late.add(road, shapes);
    second.update(0, 0, 120, origin, false);
    // the same meadow either way, and nothing on the road in it
    expect(second.count).toBe(first.count);
    expect(tufts(second)).toEqual(tufts(first));
    expect(second.count).toBeLessThan(before);
    // and the arrival paid for the tiles under the road, not for the window
    expect(second.written).toBeGreaterThan(0);
    expect(second.written).toBeLessThan(second.count / 4);
    for (const child of second.mesh.children) {
      const mesh = child as unknown as { count: number; getMatrixAt(i: number, m: Matrix4): void };
      const m = new Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        const z = m.elements[14]!;
        const x = m.elements[12]!;
        if (Math.abs(x) < 200) expect(Math.abs(z - 10)).toBeGreaterThan(4 + 0.5 - 1e-6);
      }
    }
    first.dispose();
    second.dispose();
  });
```

(`origin` na starcie ma zero, więc `m.elements[12]` i `[14]` to współrzędne świata.)

- [ ] **Krok 2: uruchom i sprawdź, że nie przechodzi**

Uruchom: `npx vitest run tests/unit/grass.test.ts -t "keeps off a road"`
Oczekiwane: FAIL, `second.count` równe `before`, bo kępki stoją na drodze i nic nie jest przepisywane.

- [ ] **Krok 3: implementacja w Grass**

W `src/engine/scenery/Grass.ts`:
- `import type { Claims } from './Claims';`;
- w `GrassDeps` dopisz:

```ts
  /**
   * The ground the plans speak for. A tuft keeps off a road and off a house,
   * and a tile is the same set of tufts whether its plan was built before the
   * tile was written or after -- the late one is written again.
   */
  claims?: Claims;
```

- w `createGrass` wyciągnij `claims` z `deps`; pod deklaracją `live`/`wanted` dopisz:

```ts
  /** Plans the window has written its tiles around, and tiles a new plan has made stale. */
  const accounted = new Set<string>();
  const stale = new Set<number>();
  /**
   * A tile is a function of its own coordinates and of the plans built over
   * it, and plans are built in a queue: one that arrives after its tiles were
   * written has them written again, once, and only those. A plan that leaves
   * the index is forgotten, so coming back to it rechecks it.
   */
  const account = () => {
    if (!claims) return;
    const present = new Set<string>();
    for (const plan of claims.plans) {
      present.add(plan.id);
      if (accounted.has(plan.id)) continue;
      accounted.add(plan.id);
      for (let tz = Math.floor(plan.z0 / TILE); tz <= Math.floor(plan.z1 / TILE); tz++)
        for (let tx = Math.floor(plan.x0 / TILE); tx <= Math.floor(plan.x1 / TILE); tx++) {
          const key = keyOf(tx, tz);
          if (live.has(key)) stale.add(key);
        }
    }
    for (const id of accounted) if (!present.has(id)) accounted.delete(id);
  };
```

(`keyOf` jest zdefiniowane niżej jako `const`; przenieś definicję `keyOf` nad `account` albo zamień `account` na deklarację używaną dopiero w `update`. Obie wersje działają, bo `account` jest wywoływane po inicjalizacji.)
- w `rebuild`, w pętli usuwania, warunek zatrzymania kępki zmień z `if (wanted.has(mine[i]!))` na `if (wanted.has(mine[i]!) && !stale.has(mine[i]!))`; bezpośrednio po tej pętli (przed `let placed = ...`) dopisz:

```ts
    // A stale tile's tufts are gone above; forget it was held, so it is
    // written again below like any arrival.
    for (const key of stale) live.delete(key);
    stale.clear();
```

- w pętli prób, po `if (!keep) continue;`, dopisz:

```ts
          // Off the road and out of the house. Every attempt still drew its six
          // numbers above, so the tufts that stand are the same ones whether
          // the plan was there or not.
          if (claims?.grass(px, pz)) continue;
```

- w `update`, przed `const visible = ...`, dopisz `account();`, a warunek wczesnego wyjścia zmień na:

```ts
      if (!jumped && stale.size === 0 && ix === atX && iz === atZ) return;
```

  Przy `whole` (skok origin) dopisz w `rebuild` w bloku `if (whole)` także `stale.clear();`.

- [ ] **Krok 4: jeden `Claims` w Scenery**

W `src/engine/scenery/Scenery.ts`: `import { createClaims } from './Claims';`, przed `createGrass` dopisz `const claims = createClaims();` i przekaż `claims` do `createGrass({ ..., claims })` oraz `createRing({ ..., claims })`. Kolejność w `update` (najpierw `sites.work`, potem `ring.update`, potem `grass.update`) już zapewnia, że trawa widzi indeks z tej samej klatki.

- [ ] **Krok 5: uruchom testy**

Uruchom: `npx vitest run tests/unit/grass.test.ts && npm run typecheck && npm run lint && npm test`
Oczekiwane: PASS, łącznie z testem „holds the same meadow whether it was flown to or jumped to" (bez planów `account` nic nie robi).

- [ ] **Krok 6: commit**

```bash
git add src/engine/scenery/Grass.ts src/engine/scenery/Scenery.ts tests/unit/grass.test.ts
git commit -m "Grass keeps off the road and out of the house, whenever the plan arrives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Zadanie 7: dokumentacja, przeglądarka i obraz

**Pliki:**
- Zmień: `AGENTS.md`, `docs/superpowers/specs/2026-09-14-dreamfall-design.md` (sekcja 8), `tests/e2e/smoke.spec.ts` (tylko jeśli e2e tego wymaga)

- [ ] **Krok 1: AGENTS.md**

- W „Rules" na liście czystych modułów CPU dopisz `terrain/Country.ts`, `scenery/Claims.ts`.
- W „Layout", przy `scenery/`, dopisz „claims" do wyliczenia.
- W „Settlements" punkt zaczynający się od „`cell.occupied` reads the plans' reservations" zastąp:

```markdown
- `scenery/Claims.ts` is the one answer to "may something stand here", asked
  two ways: a tree or a scattered prop keeps off a road, a reservation (a
  plaza) and a house by the house's **baked reach plus 3 m**; a tuft of grass
  keeps off the road and the house's footprint and nothing else. A plan
  reserves no ground for its lots: 16.8 m round every lot closed the whole
  street to trees. The ring fills the index at every rebuild and the grass
  reads the same one; a plan that arrives after its grass tiles were written
  has those tiles written again, once.
```

- Punkt „A settlement **sows the ground it claims**..." zastąp:

```markdown
- A settlement **stands in its country** (`inherit: { trees }`): its weight
  is its presence and its plateau, and the ground, the snow, the grass, the
  trees and the props, the sound and the air under it are the country's
  beside it (`terrain/Country.ts`, and the same sums in nodes in
  `TerrainMesh`). Its trees and props are the country's thinned to `trees`
  (0.4, a clearing). It used to paint its own disc and sow its own species,
  and the owner read that as a patch cut out of the country. The first biome
  of the registry may not inherit: it takes the ground no presence claims,
  which is also where a texel with no country in its slots goes.
```

- W punkcie o `ambience.inherit` („An entry that stands **in** a country -- a settlement -- says `ambience.inherit`...") zamień `ambience.inherit` na `inherit`.

- [ ] **Krok 2: specyfikacja główna**

W `docs/superpowers/specs/2026-09-14-dreamfall-design.md`, na początku sekcji 8, dopisz akapit:

```markdown
> **Zmiana z 2026-09-24:** osada stoi w kraju (grunt, trawa, drzewa i rekwizyty
> są krajowe, drzewa przerzedzone do polany), działki nie są rezerwowane, a
> szansa wioski wynosi 0,75. Szczegóły:
> `2026-09-24-osady-w-kraju-i-drogi-design.md`.
```

- [ ] **Krok 3: pełne sprawdzenie**

Uruchom: `npm run check`
Oczekiwane: PASS (typy, lint, format, testy, build). Jeśli nie przechodzi `format:check`, uruchom `npx prettier --write` na plikach z listy i powtórz.

- [ ] **Krok 4: testy w przeglądarce**

Uruchom: `npm run test:e2e`
Oczekiwane: PASS, w szczególności:
- „the village is a clearing with its own trees in it, not a bald patch and not a wood": `inside < outside * 0.6` i `inside.canopy > 0`;
- „the flight does not fly through the village";
- testy na `VILLAGE_FREE` (buildings 0).

Jeśli test polany pokaże `inside ≥ outside × 0,6`, podnieś tylko liczbę `clearing` w dół (0,4 → 0,3) w `village.js` i `town.js` i zapisz zmierzone liczby w komentarzu `clearing`. Nie ruszaj progu testu.

- [ ] **Krok 5: obraz przed i po**

Uruchom podgląd przez `preview_start` z nazwą `dev` (`.claude/launch.json`). Otwórz `http://localhost:5173/?seed=42&dev=1` i przez `javascript_tool` ustaw lot nad wioską z testów e2e:

```js
const w = window.__world;
w.state.x = 1525; w.state.z = 1588;
w.state.y = w.heightAt(1525, 1588) + 350; w.state.vy = 0;
w.step(0.05);
```

Poczekaj, aż `w.scenery.buildings > 0` (odpytuj co sekundę, najwyżej 30 s), potem zrób zrzut ekranu. Sprawdź:
- pod domami nie ma krążka gliny;
- grunt jest taki jak wokół;
- między domami i przed nimi stoją drzewa kraju.

To samo zrób z wysokości 60 m (`+ 60` zamiast `+ 350`): trawa nie stoi na drodze. Pokaż oba zrzuty właścicielowi. Zamknij kartę po zakończeniu.

- [ ] **Krok 6: commit**

```bash
git add AGENTS.md docs/superpowers/specs/2026-09-14-dreamfall-design.md tests/e2e/smoke.spec.ts
git commit -m "Say that a settlement stands in its country, and what claims the ground

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Samokontrola planu wobec specyfikacji

| Spec | Zadanie |
| --- | --- |
| 4.1 kontrakt `inherit`, walidator | 2 (+ usunięcie `ambience.inherit` w 4) |
| 4.2 udział kraju, zapas dla braku kraju | 1 (CPU), 2 (GPU) |
| 4.3 grunt w shaderze, śnieg kraju | 2 |
| 4.4 drzewa i rekwizyty, rekwizyty odrzucane na zajętym gruncie | 3, 5 |
| 4.5 `Claims`, bez rezerwacji działek, plac zostaje | 5 |
| 4.6 trawa kraju, omijanie, przepisywanie kafli | 3, 6 |
| 4.7 `settlement.js`, `clearing`, szansa 0,75, bez `minTemp` | 4 |
| 4.8 testy etapu 1 | 1–6, e2e w 7 |
| 6 dokumentacja | 7 |
| 8 ryzyka: gęstość polany, koszt przepisywania kafli | 7 (krok 4), 6 (tylko kafle pod planem) |

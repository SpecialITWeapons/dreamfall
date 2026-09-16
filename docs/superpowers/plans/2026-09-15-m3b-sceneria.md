# M3b Sceneria: pierścień, pule, drzewa, propsy, trawa — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na ziemi, którą M3a oddał biomom, staje sceneria. Pierścień komórek 96 m o promieniu 1,9 km przebudowywany przy przekroczeniu komórki; pule instancji o stałej pojemności, kurczące się w podstawę na krawędzi pierścienia; dziewięć gatunków drzew oryginału z morfingiem koron; dwa propsy jako wzorzec dla każdego obiektu, który stoi; trawa w oknie 260 m; arkusz cienia pod drzewami; pusta warstwa nadpisań; rejestr przeszkód karmiony z pierścienia, więc lot i kamera omijają drzewa. Wynik: ziarno 42 ma las tam, gdzie klimat go chce, a lot go widzi.

**Architecture:** Zgodnie ze specyfikacją `docs/superpowers/specs/2026-09-14-dreamfall-design.md` (sekcje 5.2, 5.3, 5.4, 5.5, 7, 18.2) i z planem M3a, który zostawił kontrakt gotowy: `defineSpecies`, `defineProp`, `PopulateHook`, `Cell`, `SceneryKit`, `BUDGET` istnieją jako typy i nic ich jeszcze nie woła. M3b jest pierwszym, który je woła.

Podział na czysty CPU i prezentację jest ten sam co w całym silniku. Czysty CPU (testowany w Vitest, bez `three/webgpu`, bez TSL, bez DOM): `library/standard/populate.js`, `library/species/**`, `library/props/**` w części `place`, `src/engine/scenery/Ring.ts`, `src/engine/scenery/Overrides.ts`, `src/engine/terrain/SnowLine.ts`. Prezentacja (sprawdzana Playwrightem): `Painted.ts`, `TreeKit.ts`, `Pools.ts`, `GroundShade.ts`, `Grass.ts`, `Scenery.ts`. Granica przebiega tam, gdzie pierścień decyduje **co i gdzie** stoi (CPU) i oddaje to do ujścia (`ScenerySink`), które w teście jest tablicą, a w przeglądarce pulą instancji.

**Tech Stack:** bez nowych zależności. Vite 8.3.0, TypeScript 5.9.3, three 0.185.1 (`three` → `three/webgpu`), @types/three 0.185.4, Vitest 4.1.11, Playwright 1.63.0.

## Global Constraints

- Gałąź robocza `claude/epic-hypatia-ufoge4` od `main` po scaleniu M3a. Kod, identyfikatory, komentarze, komunikaty commitów i dokumentacja repozytorium po angielsku; plan i specyfikacja po polsku. Każdy commit kończy się linią `Co-Authored-By: <model z przypomnienia o atrybucji sesji> <noreply@anthropic.com>`.
- **Pola bazowe i wagi biomów są zamrożone.** M3b nie dotyka `WorldSampler.sample`, `baseFields` ani `sampleWindow`; wartości wzorcowe ziarna 42 w `tests/unit/worldSampler.test.ts`, `noise.test.ts` i `biomeWeights.test.ts` mają przejść bez zmian. Jedyna zmiana w `terrain/` poza nowym `SnowLine.ts` to zasolenie `Fields.hash` i `Fields.noise` ziarnem świata (Task 2) — to naprawa błędu, nie zmiana terenu.
- **Świat jest w podwójnej precyzji, scena w lokalnym układzie `Origin`.** Pierścień liczy pozycje w świecie (bo rejestr przeszkód i lot są w świecie), a do macierzy instancji zapisuje `origin.localX/localZ`. Origin przeskakuje dopiero po 4 km dryfu (`Origin.threshold`), więc jest to zdarzenie rzadsze niż przebudowa pierścienia, ale **musi** ją wymusić: `Scenery.update` przebudowuje, gdy zmieni się komórka 96 m **albo** gdy `origin.shiftFor` zwróci `true`. Pominięcie tego daje drzewa odsunięte o 4 km i jest najłatwiejszym sposobem zepsucia tego kamienia milowego.
- **Czas shaderów to czas symulacji.** Kołysanie liści i traw liczy się z `uniforms.time`, nigdy z `time` z TSL — pauza ma zamrażać las tak samo jak chmury (reguła w `AGENTS.md`).
- Budżety ze spec §5.5, już zapisane w `BUDGET`: `crownCards` 200 (sprawdzane przy pieczeniu gatunku), `propTriangles` 6000 i `propInstances` 2000 (`validateBaked` i pojemność puli), `speciesScale` 3 (górna granica `scale[1]`). Nic nie wchodzi do pierścienia bez przejścia przez walidator.
- `uncapturederror` nadal śmiertelny; nowy shader, który tylko ostrzega, nie wchodzi. Budżet pikseli 2 000 000 i DPR 1,5 bez zmian.
- Koperta kolorów obowiązuje wszystkie nowe kolory: `validateBaked` mierzy kolory wierzchołków każdej wypieczonej geometrii, a neutralna prawie-biel jest nośnikiem odcienia per instancja (pnie i liście tak właśnie działają).
- **Poza zakresem M3b** (nie budować): stanowiska, `sites`, `RoadKit`, `StructureKit`, osady (M4); śnieg jako warstwa świata, Droga Mleczna, szafa, panel dev, `bench`, `parity` (M5); haki `ambience` (M5); zasięg widzenia i „wyspa we mgle" (poza M3, ustalenie właściciela); ptaki, upierzenia i wzory z oryginału (nie ma ich w tej wizji).
- **Obiekty liniowe (płoty ciągnące się przez pole) są poza M3b świadomie.** Wstęga wzdłuż łamanej to ten sam mechanizm co droga; `RoadKit` powstaje w M4 i to tam dokłada się `line kit` dla płotów, murków i żywopłotów. Props potrafi postawić słupek albo przęsło, ale nie poprowadzi ich linią i nie należy tego udawać rozrzutem. Notatka: `docs/superpowers/notes/2026-09-15-m3b-punkt-startu.md`.

---

## Liczby portowane z fly-with-me

Wszystkie z commita `38857e6`, `src/main.js`. Wpisuj je **na sztywno**, tak jak zrobiły plany M1, M2 i M3a — `fly-with-me` nie jest częścią tego repozytorium i nie będzie dostępne przy wykonaniu.

| Co | Wartość | Skąd |
| --- | --- | --- |
| komórka pierścienia | `TREE_CELL = 96` m | ~1607 |
| promień pierścienia | `TREE_RADIUS = 1900` m | ~1608 |
| sufit instancji drzew | `MAX_TREES = 4000` (wspólny licznik) | ~1410 |
| pasmo morfingu korony | `CROWN_FADE = [540, 680]` m | ~1363 |
| kurczenie na krawędzi | `RING_FADE = [1680, 1850]` m | ~1364 |
| marginesy przypisania koron | `NEAR_CROWN = 830`, `FAR_CROWN = 400` m | ~1610 |
| rzadka korona | `keepEvery = max(1, round(cards / 35))`, `distantScale = 1 + 0.85 * ((keepEvery - 1) / 4)` | ~1538 |
| kępa | `grove = 2 + 4 * sstep(-0.25, 0.3, perlin(x/370, z/370))` | ~1790 |
| linia drzew | `treeline = snowLine + 60`, przerzedzenie przez ostatnie 120 m | ~1788 |
| sztuk na komórkę | `count = min(3, floor(density * grove * (1 - sstep(treeline - 120, treeline, h0))))` | ~1792 |
| odrzucenia | komórka `h0 < 3`; drzewo `h < 4` lub `slope > 0.6` | ~1735, ~1805 |
| skala drzewa | `sc = scale[0] + u * (scale[1] - scale[0])`, `tall = sc * (0.9 + u2 * 0.4)` | ~1812 |
| linia śniegu | `SNOW_LINE = { base: 200, slope: 380 }`, `base + slope * baseTemp` | ~93 |
| pojemność puli propsa | `min(BUDGET.propInstances, entry.budget.instances ?? 500)` | ~1642 |
| arkusz cienia | canvas 512, `AO_SPAN = 4096`, gradient `#0006 → #0004 @0.3 → #0000`, `r = tree.radius * 0.6`, `flipY = false`, wygaszenie brzegu `smoothstep(0.45, 0.5)` | ~1646–1676 |
| kora | canvas 512×1024, `bumpScale 0.015`, kołysanie `sin(t*0.8 + x*0.05) * y * 0.018` | ~1490, ~1372 |
| liść | `DoubleSide`, `alphaTest 0.04`, `alphaToCoverage`, emisja `tekstura * 0.025` | ~1385 |
| `paintedSample` | mieszanie z własną średnią `0.38`, `bias(0.8)` | ~831 |
| trawa | canvas 256 (96 źdźbeł, `#638c37 #7ca448 #8cae50 #a2bb61`), `InstancedMesh` 20 000, płaszczyzna 2,6×1 przesunięta o (0, 0,5, 0), kafel 64 m, 11×11 kafli, promień 260 m, 256 losowań na kafel, skala `0.55 + u * 0.8`, `h` w 2..480, `slope <= 0.65`, widoczna gdy `camera.y - ground < 250`, wygaszenie `smoothstep(120, 190, dist)`, kołysanie `sin(t*1.4 + x*0.08) * y² * 0.16` | ~1945–1965 |

Dane scenerii dziesięciu biomów (do `populate` w Tasku 4; w oryginale pola `species`, `density`, `grass`, `props` wpisu biomu):

| biom | gatunki (waga) | gęstość | trawa (odcień, gęstość) | propsy (waga) |
| --- | --- | --- | --- | --- |
| wildsong | oak 1 | 0,75 | white, 1 | boulders 0,15 |
| elderwood | elder 1, pine 0,25 | 1,15 | grassCool, 0,5 | boulders 0,3 |
| steppe | acacia 1, cypress 0,12 | 0,3 | grassGold, 0,9 | boulders 0,25 |
| badlands | deadwood 1 | 0,2 | grassGold, 0 | boulders 1, cairns 0,3 |
| dunes | palm 1 | 0,08 | grassGold, 0 | boulders 0,1 |
| frostpines | pine 1 | 0,9 | grassCool, 0,15 | boulders 0,5, cairns 0,5 |
| moor | pine 1, deadwood 0,3 | 0,12 | grassCool, 0,4 | boulders 0,8, cairns 1 |
| autumn | birch 1, oak 0,3 | 0,85 | grassGold, 0,7 | boulders 0,2 |
| jungle | palm 1, elder 0,6 | 1,2 | white, 0,8 | boulders 0,15 |
| blossom | blossom 1, oak 0,2, cypress 0,15 | 0,7 | white, 1 | boulders 0,1 |

Pole `ruins` oryginału **nie wchodzi** — ruiny to stanowiska, czyli M4.

---

## Struktura plików po M3b

```
library/
  contract.ts                 zmiana: SpeciesSpec, PropSpec, TreeKit, PropKit, Placement, ScatterSpec;
                              Cell.fields/mix/blend; walidacja gatunków, propsów i odwołań do nich
  standard/populate.js        nowy: scatter, resolvePopulate
  standard/snowLine.js        nowy: SNOW_LINE, snowLineAt (linia drzew dziś, śnieg w M5)
  standard/math.js            nowy: sstep i clamp01, dziś prywatne w presence.js
  species/acacia.js birch.js blossom.js cypress.js deadwood.js elder.js oak.js palm.js pine.js
  props/boulders.js props/cairns.js
  biomes/*.js                 zmiana: dziesięć wpisów dostaje populate: { type: 'scatter', ... }
  index.js                    zmiana: rejestr niesie species i props
src/engine/
  terrain/Fields.ts           zmiana: hash i noise zasolone ziarnem świata
  terrain/TerrainMesh.ts      zmiana: ziemia czyta arkusz cienia
  scenery/Overrides.ts        nowy: pusta warstwa nadpisań
  scenery/Ring.ts             nowy: pierścień komórek, strumienie, kit, limity, rekordy przeszkód
  scenery/Painted.ts          nowy: kora, liście, trawa, paintedSample
  scenery/TreeKit.ts          nowy: pieczenie gatunku (pień, konary, korona z kart)
  scenery/Pools.ts            nowy: pule instancji, kurczenie na krawędzi, morfing koron
  scenery/GroundShade.ts      nowy: arkusz cienia pod drzewami
  scenery/Grass.ts            nowy: okno trawy
  scenery/Scenery.ts          nowy: agregat — pule + pierścień + trawa + cień, jedno update
  World.ts                    zmiana: buduje scenerię, aktualizuje ją, karmi przeszkody
  page/Debug.ts, src/main.ts  zmiana: liczniki i czasy scenerii, etap zasłony „scenery"
index.html                    zmiana: data-stage-scenery
tests/unit/                   populate.test.ts, ring.test.ts, overrides.test.ts, snowLine.test.ts,
                              contract.test.ts (+), fields.test.ts (+)
tests/e2e/smoke.spec.ts       rozszerzony: las stoi, przeszkody żyją, pierścień przeżywa skok origin
AGENTS.md, CONTRIBUTING.md, README.md, docs/superpowers/specs/2026-09-14-dreamfall-design.md
```

---

### Task 1: Kontrakt scenerii — wpisy, zestawy, walidacja

**Files:**

- Modify: `library/contract.ts`
- Test: `tests/unit/contract.test.ts` (rozszerzenie)

**Interfaces:**

- `Species` i `Prop` przestają być workiem `[key: string]: unknown`. Nowe kształty, portowane z `fly-with-me/library/contract.js` i z tego, co czyta `bakeSpecies`:

```ts
export interface TrunkSpec { height: number; radius: number; lean: number; tint: SceneryColor }
export interface LimbsSpec { count: number; spread?: number; rise?: number; from?: number }
export interface CrownSpec {
  shape: 'dome' | 'cone' | 'fan' | 'bare';
  cards?: number; size?: number; radius?: number; height?: number; from?: number;
}
/** What a species grows through; a custom bake(kit) gets the same two verbs the built-in kit uses. */
export interface TreeKit {
  THREE: typeof import('three');
  random(): number;
  branch(a: Vector3, b: Vector3, r1: number, r2: number): CatmullRomCurve3;
  card(p: Vector3, normal: Vector3, rotation: Euler | Matrix4, size: number): void;
  matrix(x, y, z, sx?, sy?, sz?, rx?, ry?, rz?): Matrix4;
  spec: Species;
}
export interface Species {
  kind?: 'species';
  id: string; name: string;
  trunk?: TrunkSpec; limbs?: LimbsSpec; crown?: CrownSpec;
  leaf?: keyof typeof LEAVES;
  tint: { cold: SceneryColor; warm: SceneryColor; dry: SceneryColor };
  /** Metres of scale, [min, max]; max is capped by BUDGET.speciesScale. */
  scale: [number, number];
  /** A species that grows its own way; the kit is the same one the built-in generator uses. */
  bake?(kit: TreeKit): void;
}
export interface Placement {
  x: number; z: number;
  yaw?: number;
  /** One number or [sx, sy, sz]. */
  scale?: number | [number, number, number];
  sink?: number;
  tint?: SceneryColor | Color;
}
export interface PropKit {
  THREE: typeof import('three');
  random(name: string): () => number;
  merge(parts: Array<{ geometry: BufferGeometry; matrix?: Matrix4; color?: Color | number }>): BufferGeometry;
  matrix(x, y, z, sx?, sy?, sz?, rx?, ry?, rz?): Matrix4;
  sstep(a: number, b: number, x: number): number;
  color(value: SceneryColor): Color;
}
export interface Prop {
  kind?: 'prop';
  id: string; name: string;
  budget?: { instances?: number; triangles?: number };
  obstacle?: { radius: number; height: number };
  bake(kit: PropKit): BufferGeometry;
  place(cell: Cell, kit: PropKit): Placement[] | void;
}
```

- `Cell` dostaje trzy rzeczy, których spec §5.2 nie przewidział, a bez których standardowy `scatter` i porty propsów nie mają z czego liczyć (każda z nich to poprawka do zapisania w specyfikacji, Task 14):
  - `fields: Fields` — pola bazowe w środku komórki. Linia drzew czyta `baseTemp`, odcień drzewa czyta `temp` i `moist`, a kępa czyta `noise`. Jeden obiekt przepisywany w miejscu, jak w `createFields` — hak może go czytać, nie wolno go trzymać.
  - `mix(id: string): number` — suma po biomach `waga_biomu · (props[id] wpisu scatter ?? 0)`. To jest pytanie „jak bardzo ta komórka chce tego propsa"; port `cell.mix` z oryginału.
  - `blend(param: string): Color` — kolor z `params` biomów zmieszany wagami, np. `cell.blend('rock')`. W oryginale był to callback po wpisie biomu; w v2 kolory biomu siedzą w `params`, więc wystarczy nazwa. Jeden `Color` przepisywany w miejscu.
- `SceneryKit` bez zmian w kształcie (`tree`, `prop`, `structure`, `color`), ale to jest teraz kontrakt, który ktoś spełnia: `structure` w M3b **rzuca** `Error('structures land in M4')`, żeby biom, który go zawoła, nie milczał.
- `validateLibrary` dostaje trzy nowe bloki, wszystkie po nazwie wpisu:
  - gatunki: identyfikator (te same reguły co biom), duplikaty, `tint` w kopercie, `scale` rosnące i `scale[1] <= BUDGET.speciesScale`, `crown.cards <= BUDGET.crownCards` gdy podane, `leaf` będący kluczem `LEAVES`, obecność `trunk` **albo** `bake`;
  - propsy: identyfikator, duplikaty, `bake` i `place` jako funkcje, `budget.triangles <= BUDGET.propTriangles`, `budget.instances <= BUDGET.propInstances`, `obstacle` z dodatnimi liczbami;
  - odwołania: każdy identyfikator gatunku i propsa wymieniony w `populate` biomu musi istnieć w rejestrze (spec §5.6: „znane identyfikatory gatunków, propsów i budynków"). To jest jedyna walidacja, która patrzy między wpisami, i to ona łapie literówkę w `species: { oka: 1 }`.
- `PopulateHook` zyskuje wariant deskryptorowy: `export type PopulateHook = ((cell: Cell, kit: SceneryKit) => void) | PopulateDescriptor;` gdzie `PopulateDescriptor` to na razie wyłącznie `ScatterSpec` (`{ type: 'scatter', species, density, props?, grass? }`).

- [ ] **Step 1: Test, który nie przechodzi**

Dopisz do `tests/unit/contract.test.ts`:

```ts
const species = (over = {}) => defineSpecies({
  id: 'oak', name: 'oak',
  trunk: { height: 6.4, radius: 0.9, lean: 0.65, tint: 'white' },
  limbs: { count: 5, spread: 6, rise: 8.8, from: 0.55 },
  crown: { shape: 'dome', cards: 35, size: 3.8, radius: 5, height: 2.8 },
  leaf: 'broad', tint: { cold: 'canopyCold', warm: 'white', dry: 'canopyDry' }, scale: [1.15, 2.4],
  ...over,
});
```

Przypadki: pusta biblioteka gatunków przechodzi; duplikat identyfikatora po nazwie; `scale: [1, 4]` odrzucone z `the budget is 3`; `crown.cards: 260` odrzucone z `the crown budget is 200`; `leaf: 'nosuch'` odrzucone; gatunek bez `trunk` i bez `bake` odrzucony; props bez `place` odrzucony; `budget: { triangles: 9000 }` odrzucone; biom z `populate: { type: 'scatter', species: { nosuch: 1 } }` odrzucony komunikatem zawierającym `biome x.populate: unknown species "nosuch"`; prawdziwy rejestr (`createLibrary()`) przechodzi z dziewięcioma gatunkami i dwoma propsami (ten przypadek zaczyna przechodzić dopiero po Tasku 4 — zostaw go `it.todo` do tamtego czasu albo napisz go tam).

- [ ] **Step 2: Implementacja**

Typy i walidacja w `contract.ts`. Trzymaj `validateLibrary` płaską listą bloków, jak dziś — jeden `for` na rodzaj wpisu, ta sama pomocnicza `idProblem`, ta sama konwencja `${kind} ${id}${gdzie}`. Odwołania sprawdzaj **po** zbudowaniu zbiorów identyfikatorów, żeby komunikat o nieznanym gatunku nie zależał od kolejności wpisów w rejestrze.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add library/contract.ts tests/unit/contract.test.ts
git commit -m "feat: the contract says what a species and a prop are, and the validator checks them

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 2: Linia śniegu i pola zasolone ziarnem

**Files:**

- Create: `library/standard/snowLine.js`
- Modify: `src/engine/terrain/Fields.ts`
- Test: `tests/unit/snowLine.test.ts`, `tests/unit/fields.test.ts` (rozszerzenie)

**Interfaces:**

- `export const SNOW_LINE = { base: 200, slope: 380 };` i `export function snowLineAt(baseTemp)` — `base + slope * baseTemp`. W oryginale funkcja brała temperaturę schłodzoną i sama cofała ochłodzenie (`temp + max(0, h) / 2600`); w v2 `Fields.baseTemp` jest dokładnie tą liczbą i po to powstało, więc hak podaje ją wprost. Moduł jest czysty (zero importów) i istnieje po to, żeby warstwa śniegu z M5 czytała tę samą linię co linia drzew z M3b — dwie linie śniegu w jednym świecie to błąd, którego nikt nie zauważy przez pół roku. **Mieszka w `library/`, nie w `src/`**, bo pierwszym konsumentem jest `library/standard/populate.js`, a biblioteka nigdy nie importuje z `src/`; precedens jest obok, w `library/standard/presence.js`, gdzie leżą stałe `CLIMATE`.
- `createFields(sampler)` miesza `sampler.seed` do `hash` i `noise`:

```ts
const salted = (salt: number) => (salt ^ Math.imul(sampler.seed, 0x9e3779b1)) >>> 0;
hash: (salt) => hash2(ix, iz, salted(salt)) / u32,
noise: (scale, salt, octaves = 3) => fbm(fields.x / scale, fields.z / scale, salted(salt), octaves),
```

  Dziś obie funkcje ignorują ziarno świata: pola bazowe idą przez `fieldSeeds(seed)`, ale hak biomu, który zapyta o `noise(370, 1)`, dostanie ten sam wzór w każdym ziarnie. Do M3a to nie miało konsumenta. W M3b kępy drzew liczą się właśnie z tego szumu, więc bez tej poprawki wszystkie światy mają lasy w tych samych miejscach. To jest naprawa, nie zmiana terenu — `baseFields` i wartości wzorcowe zostają nietknięte.

- [ ] **Step 1: Testy, które nie przechodzą**

`snowLine.test.ts`: linia rośnie z temperaturą (`snowLineAt(0) === 200`, `snowLineAt(1) === 580`), jest liniowa, i `SNOW_LINE` ma wartości oryginału. `fields.test.ts`: dwa ziarna dają różny `noise(370, 1)` i różny `hash(7)` w tym samym punkcie, a to samo ziarno dwa razy daje tę samą liczbę (istniejące asercje determinizmu zostają bez zmian).

- [ ] **Step 2: Implementacja i commit**

```bash
npm run check
git add src/engine/terrain/SnowLine.ts src/engine/terrain/Fields.ts tests/unit
git commit -m "feat: one snow line for the tree line to follow, and fields that know their seed

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 3: Standardowy hak rozmieszczania (`scatter`)

**Files:**

- Create: `library/standard/populate.js`
- Modify: `library/standard/index.js`
- Test: `tests/unit/populate.test.ts`

**Interfaces:**

- `scatter(spec)` zwraca `(cell, kit) => void`, gdzie `spec` to `{ species: Record<string, number>, density: number, props?: Record<string, number>, grass?: { tint, density } }`. Hak **stawia tylko drzewa**: `props` to wagi, które czyta `cell.mix(id)` w `place()` propsa, a `grass` to dane, które czyta okno trawy. Taki podział jest świadomy i wynika ze spec §5.4 (`defineProp` ma własne `place`) — dwa modele rozmieszczania w jednym silniku byłyby jednym za dużo, a ten jest portem: biom mówi **ile i czego chce**, props mówi **jak stoi**.
- `resolvePopulate(populate)` zwraca `{ hook, scatter }`: `hook` zawsze, `scatter` tylko gdy wpis był deskryptorem. Silnik potrzebuje deskryptora osobno, bo trawa i wagi propsów są danymi, nie wywołaniem; biom z hakiem w kodzie nie ma trawy ani propsów i to jest do udokumentowania, nie do obejścia.
- Arytmetyka portu, co do liczby (linie ~1788–1815 oryginału):

```js
const grove = 2 + 4 * sstep(-0.25, 0.3, f.noise(370, 0xc071, 1));
const treeline = snowLineAt(f.baseTemp) + 60;
const thin = 1 - sstep(treeline - 120, treeline, h0);
const count = Math.min(CELL_TREES, Math.floor(spec.density * cell.weight(biomeId) * grove * thin));
```

  Jedna różnica wobec oryginału, wymuszona przez v2: oryginał sumował gęstości wszystkich biomów w jednej pętli i losował gatunek z jednej mieszanki; tutaj `populate` biegnie **osobno dla każdego biomu z wagą > 0,05** (spec §7), więc gęstość każdego biomu jest przemnożona przez jego własną wagę. Wartość oczekiwana liczby drzew w komórce wychodzi ta sama (`Σ wᵢ · densityᵢ · grove`); rozkład gatunków też, bo każdy biom sieje tylko swoje. Limit trzech drzew na komórkę przestaje być limitem jednej pętli i staje się limitem **kitu** (Task 6): trzy biomy nie mają prawa postawić dziewięciu drzew.
- Wybór gatunku: ruletka po wagach `species` biomu, jednym losowaniem ze strumienia komórki (`cell.roll()`), w kolejności kluczy obiektu — deterministycznie, bo strumień jest z hasha komórki i wpisu.
- Miejsce drzewa: `(gx + u) * 96`, `(gz + u) * 96` z dwóch losowań; odrzucenie gdy `!cell.land(x, z)` (port: `h < 4`), gdy `cell.slope(x, z) > 0.6` i gdy `cell.occupied(x, z)` (rezerwacje stanowisk z M4 — dziś zawsze `false`, ale wywołanie ma tu być od początku, żeby M4 nie musiał wracać do `scatter`).
- `kit.tree(id, x, z, { scale, yaw, tint })`: skala `scale[0] + u·(scale[1]-scale[0])`, `yaw = u·2π`. Odcień liczy silnik z `tint.cold/warm/dry` gatunku (Task 6), bo to on ma `Color` — hak podaje tylko `tint`, jeśli chce go wymusić.

- [ ] **Step 1: Test, który nie przechodzi**

`populate.test.ts` z atrapą komórki (deterministyczny `roll`, płaska ziemia, jedna waga) sprawdza: zero drzew przy `density: 0`; nie więcej niż trzy przy `density: 10`; sadzi mniej wysoko nad linią drzew i nic ponad nią; nie sadzi na stoku ponad 0,6 ani na wodzie; wybiera gatunki w proporcjach wag przy tysiącu losowań (tolerancja 15 %); mnoży gęstość przez wagę biomu; `resolvePopulate` przepuszcza funkcję i buduje deskryptor, a nieznany typ nazywa po imieniu.

- [ ] **Step 2: Implementacja i commit**

Plik jest JavaScriptem z JSDoc i **nie importuje TSL ani three** (reguła `AGENTS.md`). `sstep` i `clamp01` siedzą dziś jako prywatne pomocniki w `library/standard/presence.js`; przenieś je do `library/standard/math.js` i zaciągnij w obu miejscach. Nie sięgaj po `src/engine/terrain/noise.ts` — `library/` nie ma prawa importować z `src/` i ta jedna linijka wygodnictwa odwróciłaby zależność całej biblioteki.

```bash
npm run check
git add library/standard tests/unit/populate.test.ts
git commit -m "feat: the standard scatter hook: density from weights, species from the mix, three per cell

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 4: Dziewięć gatunków, dwa propsy, dziesięć biomów z rozmieszczaniem

**Files:**

- Create: `library/species/{acacia,birch,blossom,cypress,deadwood,elder,oak,palm,pine}.js`, `library/props/{boulders,cairns}.js`
- Modify: `library/index.js`, `library/biomes/*.js` (dziesięć plików)
- Test: `tests/unit/contract.test.ts` (przypadek z prawdziwym rejestrem z Taska 1)

**Interfaces:**

- Gatunki to **port co do liczby** z `fly-with-me/library/species/*.js`. Osiem jest danymi dla wbudowanego generatora; `cypress` ma własne `bake(kit)` i jest jedynym dowodem, że kontrakt na to pozwala — nie zamieniaj go na dane. Korony: `dome` (acacia, birch, blossom, elder, oak), `cone` (pine, 120 kart), `fan` (palm, 13 kart), `bare` (deadwood), własny (cypress). Kolory odcieni i liści zostają nazwami próbek — `SWATCH` i `LEAVES` są już w `contract.ts` z M3a, razem z siedmioma paletami liści (`broad`, `elder`, `needle`, `acacia`, `autumn`, `frond`, `blossom`).
- Propsy to port `boulders.js` i `cairns.js`. `boulders` nie ma `obstacle` (leżą nisko, lot ich nie potrzebuje), `cairns` ma `{ radius: 1.2, height: 2.4 }`. Zmiana wobec oryginału: `tint: cell.blend('rock')` zamiast `cell.blend((biome) => biome.ground.rock)`, bo w v2 kolory biomu siedzą w `params`.
- Dziesięć biomów dostaje `populate: { type: 'scatter', species, density, props, grass }` z tabeli wyżej. Nic więcej się w nich nie zmienia — obecność, wysokość i ziemia zostają takie, jakie wyszły z M3a.
- `createLibrary()` zwraca `species: [...]` i `props: [...]` zamiast pustych tablic.

- [ ] **Step 1: Wpisy i test**

Przenieś pliki po jednym, porównując liczby z oryginałem; każdy plik ma komentarz nagłówkowy w tym samym duchu co biomy (czym jest ten gatunek w świecie, nie co robi kod). Test z Taska 1 na prawdziwym rejestrze przechodzi: dziewięć gatunków, dwa propsy, `validateLibrary` czysty, każdy gatunek wymieniony w biomach istnieje.

- [ ] **Step 2: Sprawdzenie i commit**

```bash
npm run check
git add library tests/unit/contract.test.ts
git commit -m "feat: nine species and two props as data, and ten biomes that say what grows in them

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 5: Warstwa nadpisań

**Files:**

- Create: `src/engine/scenery/Overrides.ts`
- Test: `tests/unit/overrides.test.ts`

**Interfaces:**

- `createOverrides(entries?: Override[])` z `for(key: string): Override | null` i `size`. Klucz komórki to `cell:${gx},${gz}`, klucz stanowiska `site:${id}`. `Override` na dziś: `{ key: string; skip?: boolean; placements?: Placement[] }` — „nie stawiaj tu nic" i „postaw dokładnie to".
- W M3b warstwa jest **pusta**: `createOverrides()` bez argumentów, `for` zawsze `null`. Spec §18.2 mówi wprost, że pierwsza wersja odpowiada pusto, a warstwa istnieje po to, żeby edytor z M6 miał gdzie wejść i żeby pierścień od początku pytał. Pierścień pyta raz na komórkę, przed wywołaniem haków, i **sam trzyma bramkę `size === 0`** (Task 6).
- Koszt: jedna `Map`, jedno zapytanie na komórkę na przebudowę (1681 zapytań co 96 m). Pusta warstwa ma nie kosztować nic, a sprawdzenie rozmiaru **wewnątrz** `for(key)` tego nie załatwia — klucz jest już wtedy zbudowany. Dlatego `size` jest publiczne i to pierścień pyta o nie pierwszy: `overrides.size === 0 ? null : overrides.for(cellKey(gx, gz))`. `for` sprawdza rozmiar drugi raz, więc wywołujący, który zapomni, płaci tylko za własny string.

- [ ] **Step 1: Test, implementacja, commit**

Test: pusta warstwa zwraca `null` dla dowolnego klucza i nie alokuje klucza (sprawdzalne przez licznik wywołań w atrapie); warstwa z wpisem zwraca go po kluczu i `null` po innym; `skip` i `placements` przechodzą w nienaruszonym kształcie.

```bash
npm run check
git add src/engine/scenery/Overrides.ts tests/unit/overrides.test.ts
git commit -m "feat: the override layer the editor will fill, empty and asked from the first cell

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 6: Pierścień — komórki, strumienie, kit, limity, przeszkody

To jest serce M3b i jedyny duży moduł czystego CPU w tym kamieniu milowym. Wszystko, co decyduje **co i gdzie stoi**, mieszka tutaj i jest testowane w Node; wszystko, co decyduje **jak to wygląda**, jest po drugiej stronie `ScenerySink`.

**Files:**

- Create: `src/engine/scenery/Ring.ts`
- Test: `tests/unit/ring.test.ts`

**Interfaces:**

```ts
export const TREE_CELL = 96;
export const TREE_RADIUS = 1900;
export const MAX_TREES = 4000;
/** Trees one 96 m cell may hold, whatever how many biomes claim it. */
export const CELL_TREES = 3;
/** A biome under this weight in the cell's centre does not get to populate it (spec 7). */
export const POPULATE_FLOOR = 0.05;

export interface TreeInstance { species: string; x: number; z: number; scale: number; tall: number; yaw: number; tint: Color }
export interface PropInstance { prop: string; x: number; z: number; scale: [number, number, number]; yaw: number; sink: number; tint: Color }
/** Where the placements go: an array in a test, instanced pools in the browser. */
export interface ScenerySink {
  begin(): void;
  /** False when that pool is full; the ring stops offering to it. */
  tree(t: TreeInstance): boolean;
  prop(p: PropInstance): boolean;
  end(): void;
}
/** What the baked geometry knows about itself; the ring needs it for the obstacle records. */
export interface SceneryMetrics {
  species(id: string): { top: number; radius: number } | null;
  prop(id: string): { radius: number; height: number } | null;
}
export interface Ring {
  update(x: number, z: number, forced: boolean): boolean;   // true when it rebuilt
  readonly cells: number; readonly trees: number; readonly props: number; readonly ms: number;
}
export function createRing(deps: {
  seed: number; library: Library; heightfield: Heightfield; sampler: WorldSampler;
  overrides: Overrides; obstacles: Obstacles; metrics: SceneryMetrics; sink: ScenerySink;
}): Ring;
```

- **Współrzędne są światowe.** Pierścień liczy w świecie, bo rejestr przeszkód i lot są w świecie; przeliczenie na układ lokalny należy do ujścia (Task 9), które jedno zna `Origin`.
- **Przebudowa** zachodzi, gdy zmieni się komórka `Math.floor(x / 96)`, `Math.floor(z / 96)`, **albo** gdy wywołujący poda `forced` (skok origin, podmiana biblioteki). Poza tym `update` zwraca `false` i nie robi nic — to jest ta sama bramka co `placeTrees` oryginału, tylko z drugim wejściem.
- **Strumienie losowe.** Każda komórka i każdy wpis mają własny: `mulberry32(hash2(gx, gz, seed ^ idHash(entryId)))`, gdzie `idHash` haszuje **cały** identyfikator (`[...id].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7) >>> 0`). Oryginał haszował długość identyfikatora (`hash2(id.length, 7, 0x51)`), co zderza `boulders` z każdym innym ośmioznakowym wpisem — to jest świadoma poprawka portu i dla ziarna 42 zmienia jedynie, które kamienie wypadną, nie ile ich jest. Dzięki temu dodanie biomu nie przetasowuje propsów, a dodanie propsa nie przetasowuje drzew (spec §7).
- **Komórka** (`Cell` z kontraktu) jest jednym obiektem przepisywanym w miejscu przez całą przebudowę. `fields` liczy się **leniwie**, przez getter: komórka odrzucona na wodzie albo poza promieniem nie płaci za `baseFields`. `weight(id)` czyta trzy sloty z `heightfield.weightsAt` w środku komórki. `height`/`slope` to `heightfield.heightAt`/`slopeAt`. `land(x, z)` to `height > 3` (port). `occupied` zwraca `false` — rezerwacje przychodzą z M4, ale pytanie ma tu być od początku. `mix(id)` sumuje `waga · scatter.props[id]`, `blend(param)` miesza kolory z `params` biomów wagami, oba w obiekty przepisywane w miejscu.
- **Kit** (`SceneryKit`) pilnuje limitów, bo haki tego nie zrobią: licznik drzew w komórce (`CELL_TREES`), licznik globalny (`MAX_TREES`), pojemność puli (odpowiedź `false` z ujścia wyłącza dalsze oferty do tej puli w tej przebudowie). `structure()` rzuca `Error('structures land in M4')`. Wysokość drzewa (`tall = scale · (0.9 + 0.4 · roll())`) i odcień z `tint.cold/warm/dry` gatunku liczy kit ze strumienia i `fields` komórki — hak podaje `scale`, `yaw` i ewentualnie własny `tint`.
- **Kolejność w komórce**: nadpisania → propsy (każdy wpis ze swoim strumieniem, przez `place(cell, kit)`) → biomy z wagą > 0,05 (każdy ze swoim strumieniem, przez `populate(cell, kit)`). Taka sama jak w oryginale, więc limit trzech drzew działa na to samo.
- **Przeszkody**: `obstacles.clear()` na początku przebudowy, potem rekord na każde drzewo (`ground: h`, `top: h + metrics.top · tall`, `radius: scale · metrics.radius`) i na każdy props z `obstacle` (`top: h - sink + height · sy`, `radius: radius · max(sx, sz)`). To jedyna droga, którą sceneria dociera do lotu (`AGENTS.md`), więc test jednostkowy ma to sprawdzać wprost, nie przez przeglądarkę.
- **Koszt.** 41×41 = 1681 komórek na przebudowę, co 96 m, czyli około co 2,4 s przy 40 m/s. Najdroższe jest `baseFields` (M3a zmierzył wypełnienie okna: 313 600 texeli w ~530 ms, czyli ~1,7 µs na punkt) → ~2,9 ms, gdy każda komórka o nie zapyta, plus odczyty okna i haki. **Budżet: 6 ms na przebudowę**, mierzone do `ring.ms` i wystawiane w `__world.timings`. Jeśli pomiar wyjdzie wyżej, kolejność ratunku jest ustalona: (1) sprawdź, czy `fields` naprawdę jest leniwe i czy woda odpada przed nim; (2) potnij przebudowę na pasy wierszy po `RING_SLICE` komórek na klatkę, trzymając stare instancje do końca (liczniki puli commituje się dopiero w `end()`); (3) dopiero na końcu zmniejszaj promień. Nie zaczynaj od cięcia — port ma prawo być szybki.

- [ ] **Step 1: Test, który nie przechodzi**

`tests/unit/ring.test.ts`, na prawdziwym samplerze i heightfieldzie ziarna 42 (wypełnionym `fillAll`), z atrapą ujścia zbierającą placementy do tablic i atrapą `metrics` (`{ top: 8, radius: 3 }`):

1. **Stoi las tam, gdzie klimat go chce**: w miejscu, gdzie `weightsAt` daje `elderwood` powyżej 0,5, przebudowa stawia drzewa; w środku `dunes` stawia ich mniej niż dziesiątą tego.
2. **Limit komórki**: żadna komórka nie dostaje więcej niż `CELL_TREES` drzew, nawet gdy trzy biomy mają w niej wagę > 0,05 (zbuduj taką bibliotekę ręcznie: trzy biomy o `presence: () => 1` i `density: 10`).
3. **Sufit globalny**: przy bibliotece z `density: 100` liczba drzew zatrzymuje się na `MAX_TREES`.
4. **Ten sam świat dwa razy**: dwie przebudowy w tym samym miejscu dają identyczne listy; przejście o jedną komórkę i powrót też.
5. **Bramka przebudowy**: `update` w tej samej komórce zwraca `false` i nie dotyka ujścia; `update(..., true)` przebudowuje mimo to.
6. **Przeszkody**: po przebudowie `obstacles.size` równa się liczbie drzew plus propsów z `obstacle`; `floorAt` pod pniem zwraca `h + top · tall`; `clear` poprzedniej przebudowy nie zostawia duchów (dwie przebudowy 10 km od siebie → rozmiar nie rośnie w nieskończoność).
7. **Nadpisania**: warstwa z `skip` na jednej komórce zostawia ją pustą; z `placements` stawia dokładnie to, co podała.
8. **Strumienie nie mieszają się**: dołożenie propsa do rejestru nie zmienia ani jednej pozycji drzewa (porównanie list z rejestru bez propsa i z propsem).
9. **Linia drzew**: powyżej `snowLineAt(baseTemp) + 60` nie ma drzew, a przez 120 m pod nią jest ich mniej.

- [ ] **Step 2: Implementacja**

Bez alokacji w pętli: jeden `Cell`, jeden `Color` na odcień, jedna tablica trzech wag i trzech identyfikatorów, jeden `Fields` z `createFields`. Placementy oddawane są do ujścia od razu (nie zbierane do tablicy) — w teście ujście je zbiera, w przeglądarce zapisuje macierz.

- [ ] **Step 3: Sprawdzenie i commit**

```bash
npm run check
git add src/engine/scenery/Ring.ts tests/unit/ring.test.ts
git commit -m "feat: the streamed ring decides what stands where, and the flight learns about it

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 7: Malowane tekstury i materiały scenerii

**Files:**

- Create: `src/engine/scenery/Painted.ts`
- Gate: `npm run typecheck`, `npm run build`, test przeglądarkowy z Taska 13 (tekstury z `<canvas>` nie mają testów w Node — reguła z M1)

**Interfaces:**

- `createPaintedTextures()` → `{ bark, barkRelief, leaf(form), grass, dispose() }`. Kora: canvas 512×1024 z oryginału (słoje, dwa pociągnięcia, `globalAlpha 0.42` i `#92947a` na wierzchu), `SRGBColorSpace`, `RepeatWrapping`; ta sama teksura drugi raz bez przestrzeni barw jako mapa wypukłości. Liść: `leafTexture(LEAVES[form])` z oryginału, cztery kształty (`broad`, `needle`, `frond`, `petal`), 512×512, pamiętane po formie (siedem palet, cztery kształty — nie piecz tego samego dwa razy). Trawa: canvas 256 z 96 źdźbłami.
- `paintedSample(map)` → `Node<'vec4'>`: port z oryginału. Liczy średnią barwę tekstury ważoną alfą, w przestrzeni liniowej, i miesza z nią próbkę (`0.38`) przy `bias(0.8)`. To jest to, co sprawia, że korona z dystansu jest plamą koloru, a nie migoczącą siatką; bez tego drzewa iskrzą na krawędzi pierścienia.
- Materiały: `createSceneryMaterials({ litMaterial, uniforms })` →
  - `wood(tint)`: `litMaterial(barkSample.rgb.mul(uniform(tint)))` z `bumpMap`/`bumpScale 0.015`,
  - `leaf(map, visible, position)`: `DoubleSide`, `alphaTest 0.04`, `alphaToCoverage`, `emissiveNode = tekstura · 0.025`, `normalNode = transformNormalToView(normalLocal)`, `opacityNode = visible`,
  - `prop()`: `litMaterial(attribute('color', 'vec3'))` — kolor z geometrii, przyciemniany per instancja przez `instanceColor`,
  - `grass()`: jak w oryginale, z `aoNode` z arkusza cienia (Task 10) i wygaszeniem `smoothstep(120, 190, dist)`.
- **Kołysanie liczy się z `uniforms.time`**, nie z `time` z TSL: `sin(uniforms.time.mul(0.8).add(positionWorld.x.mul(0.05)))`. Pauza zatrzymuje las.
- Ryzyko kompilacji: to jest kilkanaście nowych materiałów (9 gatunków × pień + korona + daleka korona, propsy, trawa), a program materiału węzłowego kompiluje się osobno dla każdego. M3a zmierzył, że pierwsza klatka to dziś ~2,1 s na prawdziwym GPU i ~4,9 s na SwiftShaderze (`docs/perf-notes.md`). **Zmierz to po Tasku 9 i zapisz w `perf-notes.md`.** Jeśli etap scenerii przekroczy 1,5 s na prawdziwym sprzęcie, droga wyjścia jest jedna i konkretna: **atlas liści** — jedna tekstura 2048² z siedmioma paletami w kafelkach, uv kart mapowane w kafelek przy pieczeniu, jeden materiał korony na cały świat zamiast dziewięciu. Nie rób tego zawczasu; port najpierw, pomiar potem.

- [ ] **Step 1: Implementacja i ręczne sprawdzenie**

```bash
npm run typecheck && npm run build
npm run dev   # oczami: kora ma słoje, liście mają kształt, trawa ma źdźbła
git add src/engine/scenery/Painted.ts
git commit -m "feat: the painted textures of the scenery: bark, leaves, grass, and their distant mean

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 8: Zestaw drzewa — pieczenie gatunku

**Files:**

- Create: `src/engine/scenery/TreeKit.ts`
- Gate: `npm run typecheck`, `npm run build`, test przeglądarkowy

**Interfaces:**

- `bakeSpecies(species, deps)` → `{ id, wood: BufferGeometry, crown: BufferGeometry | null, distant: BufferGeometry | null, leaf: Texture | null, top: number, radius: number, tint: { cold, warm, dry }, cards: number }`.
- Port `bakeSpecies` z oryginału, co do liczby: `branch(a, b, r1, r2)` buduje `TubeGeometry` po `CatmullRomCurve3` z czterema segmentami i siedmioma bokami, przeskalowaną promieniami wzdłuż krzywej; `addCard(p, normal, rotation, size)` wiesza kartę. Cztery kształty koron: `dome` (chmura kart na każdym konarze, rozkład `u, v, r^0.35`), `cone` (karty wzdłuż pnia, `t = from + (1-from)·(k/cards)^0.85`, kąt złoty 2,39996), `fan` (wieniec liści od szczytu, każdy malowany od stopy karty), `bare` (bez kart). `spec.bake(kit)` zamiast tego, gdy gatunek ma własny generator (cypress).
- **Budżet koron** sprawdzany tutaj i rzucający po nazwie: `if (cards.length > BUDGET.crownCards) throw new Error(...)`. `validateBaked(entry, geometry)` na każdej wypieczonej geometrii — pnia i koron — bo to on mierzy trójkąty i kolory wierzchołków w kopercie.
- **Rzadka korona**: `keepEvery = max(1, round(cards / 35))`, `distantScale = 1 + 0.85·((keepEvery - 1) / 4)`; karty zachowane trafiają drugi raz do `distantParts`, powiększone. Atrybut `card` niesie `(center.xyz, kept)` — to z niego shader morfuje koronę bliską w daleką.
- `top` i `radius` liczą się z `boundingBox` wypieczonej geometrii (`radius = max(|min.x|, |max.x|, |min.z|, |max.z|) + 2`), nigdy z danych wpisu — „clearance from the baked shape itself, so any generator is honest". To one lądują w rekordach przeszkód.
- `mergeParts(parts)` (port) scala części w jedną geometrię nieindeksowaną z kolorami wierzchołków, uv i opcjonalnym atrybutem `card`. Ten sam pomocnik obsługuje propsy, więc mieszka tutaj i jest eksportowany.

- [ ] **Step 1: Implementacja**

Uwaga na typowanie: `TubeGeometry` i `CatmullRomCurve3` pochodzą z `three`, nie z `three/webgpu` — to jest czysta geometria, więc importy z `three` są w porządku i nie łamią reguły o rdzeniu.

- [ ] **Step 2: Sprawdzenie i commit**

```bash
npm run typecheck && npm run build
git add src/engine/scenery/TreeKit.ts
git commit -m "feat: the tree kit: a trunk, its limbs, a crown of cards, and the kept cards enlarged

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 9: Pule — instancje, kurczenie na krawędzi, morfing koron

**Files:**

- Create: `src/engine/scenery/Pools.ts`
- Gate: `npm run typecheck`, `npm run build`, test przeglądarkowy

**Interfaces:**

- `createPools({ library, materials, litMaterial, uniforms, scene })` → `{ sink: ScenerySink, metrics: SceneryMetrics, setOrigin(origin), meshes, dispose() }`. To jest **ujście** pierścienia po stronie GPU i jedyne miejsce w M3b, które zamienia świat na układ lokalny: `sink.tree(t)` zapisuje macierz w `origin.localX(t.x)`, `origin.localZ(t.z)`.
- Trzy pule na gatunek z koroną (pień, korona bliska, korona daleka) i jedna na gatunek bez (`deadwood`); po jednej na props. Pojemność: `MAX_TREES` dla drzew (jak w oryginale; 27 siatek × 4000 instancji to ~10 MB po stronie CPU i tyle samo na GPU — to jest cena portu i jest do zapisania w `perf-notes.md`), `min(BUDGET.propInstances, entry.budget?.instances ?? 500)` dla propsów.
- Atrybut `base` (vec3) per instancja we wszystkich pulach; w puli korony bliskiej `base` i `spin` (vec4: `cos(yaw)`, `sin(yaw)`, skala pozioma, skala pionowa) leżą w **jednym przeplecionym buforze**, bo WebGPU daje osiem buforów wierzchołkowych na materiał, a korona zjada już cztery.
- Węzły odległości, wspólne dla wszystkich pul (policz raz, w module):

```ts
const treeBase = attribute('base', 'vec3');
const baseDistance = length(treeBase.sub(cameraPosition));
const crownBand = smoothstep(CROWN_FADE[0], CROWN_FADE[1], baseDistance);
const distantCrown = step(CROWN_FADE[1], baseDistance);
const ringScale = float(1).sub(smoothstep(RING_FADE[0], RING_FADE[1], baseDistance));
const grown = (position) => treeBase.add(position.sub(treeBase).mul(ringScale));
```

  `cameraPosition` w TSL jest pozycją kamery w scenie, a scena jest w układzie lokalnym — `base` też, więc różnica jest poprawna bez żadnej poprawki na origin. To działa **tylko** dlatego, że przebudowa jest wymuszana przy skoku origin (Global Constraints); bez tego `base` i kamera rozjeżdżają się o 4 km.
- Morfing korony: `cardScale = mix(1 - crownBand, mix(1, distantScale, crownBand), cardKept)`, pozycja `cardWorld.add(positionLocal.sub(cardWorld).mul(cardScale))`, gdzie `cardWorld` odtwarza środek karty ze `spin` (instancjonowanie już przesunęło wierzchołek, więc środek trzeba złożyć z powrotem). Korona bliska jest widoczna do `CROWN_FADE[1]`, daleka od niego; obie istnieją przez całe pasmo, więc przebudowa nigdy nie zmienia tego, co jest rysowane.
- Przypisanie koron przy przebudowie: bliska dla drzew bliżej niż `NEAR_CROWN` (830 m), daleka dla dalszych niż `FAR_CROWN` (400 m) — marginesy z oryginału, policzone tak, żeby przebudowa zdarzyła się najwyżej jedną komórkę po przekroczeniu i żeby kamera na orbicie mieściła się w zapasie.
- `castShadow` na pniach i koronach bliskich, `receiveShadow` na wszystkim, `frustumCulled = false` (pule są większe niż ich zawartość), `DynamicDrawUsage` na macierzach i `base`.
- `sink.end()` ustawia `count` każdej puli i podnosi `needsUpdate` na macierzach, `base`, `spin` i `instanceColor`. `begin()` zeruje liczniki. Ta para jest jedynym miejscem, w którym liczniki się zmieniają, więc pocięcie przebudowy na klatki (fallback z Taska 6) nie wymaga zmian tutaj.

- [ ] **Step 1: Implementacja i ręczne sprawdzenie**

Oczami w `npm run dev`: las stoi, drzewa na krawędzi pierścienia wrastają w ziemię zamiast znikać, korona daleka nie migocze w paśmie 540–680 m, cień pada.

- [ ] **Step 2: Commit**

```bash
npm run typecheck && npm run build
git add src/engine/scenery/Pools.ts
git commit -m "feat: instanced pools that shrink into the ground and morph their crowns with distance

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 10: Arkusz cienia pod drzewami

**Files:**

- Create: `src/engine/scenery/GroundShade.ts`
- Modify: `src/engine/terrain/TerrainMesh.ts`
- Gate: `npm run typecheck`, `npm run build`, test przeglądarkowy

**Interfaces:**

- `createGroundShade()` → `{ aoNode(worldXZ): Node<'float'>, update(records, cx, cz), map, dispose() }`. Canvas 512×512 przykrywający `AO_SPAN = 4096` m wokół środka pierścienia; biały spód, pod każdym drzewem gradient radialny `#0006 → #0004 (0,3) → #0000` o promieniu `record.radius · 0.6`; `flipY = false`, bo arkusz jest malowany w kolejności świata, a odwrócone wgranie lustrzanie odbija każdy cień w osi z i przy każdym przesunięciu arkusza cienie skaczą o dwie komórki (komentarz oryginału, wart przepisania).
- `aoNode(worldXZ)` = `mix(texture(map, uv).r, 1, smoothstep(0.45, 0.5, edge))`, gdzie `uv = worldXZ.sub(uOrigin).div(AO_SPAN).add(0.5)` a `edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5))`. **`worldXZ` to `positionWorld.xz.add(uniforms.uWorldOrigin)`** — ten sam węzeł, którego używa shader ziemi z M3a. Arkusz jest zakotwiczony w świecie, nie w scenie, więc skok origin go nie rusza.
- `TerrainMesh` przyjmuje `shade?: GroundShade` i ustawia `material.aoNode = shade.aoNode(worldXZ)`. Trawa (Task 11) czyta ten sam węzeł, zmieszany z `attribute('uv').y`, żeby czubek źdźbła nie był przyciemniony.
- Arkusz przemalowuje się raz na przebudowę pierścienia, ze środka komórki (`cx · 96`, `cz · 96`), z rekordów drzew — czyli z tego samego, co poszło do przeszkód.

- [ ] **Step 1: Implementacja, sprawdzenie i commit**

```bash
npm run typecheck && npm run build
git add src/engine/scenery/GroundShade.ts src/engine/terrain/TerrainMesh.ts
git commit -m "feat: a streamed shade sheet anchors the trunks to the ground

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 11: Trawa

**Files:**

- Create: `src/engine/scenery/Grass.ts`
- Gate: `npm run typecheck`, `npm run build`, test przeglądarkowy

**Interfaces:**

- `createGrass({ heightfield, library, materials, shade, uniforms, scene })` → `{ update(x, z, cameraY, origin), count, dispose() }`. Port `placeGrass`: jedna `InstancedMesh` na 20 000 źdźbeł, płaszczyzna 2,6×1 przesunięta w górę o pół, kafle 64 m, 11×11 kafli wokół lecącego, odrzucenie kafla dalszego niż 260 m, 256 losowań na kafel ze strumienia `mulberry32(hash2(tx, tz, seed ^ 0x6a455))`, źdźbło zostaje z prawdopodobieństwem `thickness`, odrzucenie gdy `h < 2`, `h > 480` albo `slope > 0.65`.
- Gęstość i odcień z biomów: `thickness = Σ waga · scatter.grass.density`, kolor `Σ waga · barwa(scatter.grass.tint)`. Biom z hakiem `populate` w kodzie (nie deskryptorem) nie ma danych trawy i nie wnosi jej wcale — to jest do zapisania w `CONTRIBUTING.md`, nie do obejścia.
- Przebudowa przy zmianie komórki 16 m (`CELL`), czyli co ~0,4 s przy 40 m/s — częściej niż pierścień. To jest najcięższa pętla w M3b (121 kafli × 256 losowań, każde z `heightAt` i `slopeAt`). **Budżet: 4 ms**, mierzone do `grass.ms`. Jeśli wyjdzie wyżej: podnieś próg przebudowy do 32 m (`CELL * 2`) — okno ma 260 m promienia, więc opóźnienie o pół komórki jest niewidoczne — i dopiero potem zmniejszaj liczbę losowań.
- Trawa gaśnie z wysokości: `grass.visible = cameraY - heightAt(x, z) < 250`, a materiał wygasza źdźbła między 120 a 190 m od kamery. Razem znaczy to, że w normalnym locie (300+ m) trawy nie ma wcale i nie kosztuje nic — dlatego wolno jej być tak gęstą przy ziemi.
- Macierze instancji są w układzie lokalnym, jak w pulach; przy skoku origin okno przebudowuje się tak samo jak pierścień (`forced`).

- [ ] **Step 1: Implementacja, sprawdzenie i commit**

```bash
npm run typecheck && npm run build
npm run dev   # oczami: przy ziemi rośnie trawa, z wysokości znika, przy pauzie nie faluje
git add src/engine/scenery/Grass.ts
git commit -m "feat: a local window of grass, thick where the biomes want it and gone from altitude

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 12: Spięcie — agregat scenerii, świat, zasłona, debug

**Files:**

- Create: `src/engine/scenery/Scenery.ts`
- Modify: `src/engine/World.ts`, `src/page/Debug.ts`, `src/main.ts`, `src/page/Veil.ts`, `index.html`
- Test: `npm run check` plus testy przeglądarkowe z Taska 13

**Interfaces:**

- `createScenery(deps)` → `{ update(x, z, cameraY, moved), stats, dispose() }`, gdzie `deps` to `{ seed, library, sampler, heightfield, obstacles, litMaterial, uniforms, scene, origin }`. W środku: tekstury, materiały, pieczenie gatunków i propsów, pule, pierścień, arkusz cienia, trawa. `update` woła `ring.update(x, z, moved)` i `grass.update(x, z, cameraY, moved)`; po przebudowie pierścienia przemalowuje arkusz cienia.
- `stats`: `{ trees, props, grass, cells, rebuilds, ringMs, grassMs, bakeMs }`. To jest jedyne okno na scenerię dla testu przeglądarkowego i dla `?profile=1`.
- `World`:
  - `createWorld` przyjmuje `deferScenery?: boolean` (domyślnie `false`) i wystawia `plant()`. Bez `deferScenery` `plant()` woła się samo na końcu `createWorld` — świat bez scenerii nie zdarza się przypadkiem. `main.ts` ustawia `deferScenery: true` i woła `world.plant()` między etapami zasłony, żeby pieczenie miało własny etap i własny pomiar.
  - `place(dt)`: `const moved = origin.shiftFor(state.x, state.z);` — dziś wynik jest ignorowany — a po `heightfield.update(...)` i przed `terrain.update(...)` wchodzi `scenery.update(state.x, state.z, camera.position.y, moved)`. Kolejność jest istotna: okno wysokości musi być wypełnione, zanim pierścień zacznie pytać o `heightAt`.
  - `dispose()` zwalnia scenerię (geometrie, tekstury, materiały, `scene.remove` pul).
- `Veil`: `VeilStage` dostaje `'scenery'`, `index.html` dostaje `data-stage-scenery="Planting the world…"` (tekst po angielsku, jak reszta interfejsu; tekst interfejsu żyje tylko w `index.html` i `Hud.ts`).
- `main.ts`: `mark('scenery')` wokół `world.plant()`, wpis w `timings`, linia `?profile=1` niesie cztery etapy zamiast trzech.
- `WorldDebug` dostaje `readonly scenery: SceneryStats` i `scenerySample(i: number): { world: [number, number]; local: [number, number] } | null` — i-te drzewo pierścienia w obu układach. To jest oczko, przez które test przeglądarkowy sprawdza, że przeliczenie na układ lokalny zgadza się z `Origin` po skoku o 9 km, bez czytania pikseli.

- [ ] **Step 1: Implementacja**

- [ ] **Step 2: Sprawdzenie i commit**

```bash
npm run check
git add src/engine/scenery/Scenery.ts src/engine/World.ts src/page src/main.ts index.html
git commit -m "feat: the world plants itself: one scenery aggregate, one update, one veil stage

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 13: Testy przeglądarkowe

**Files:**

- Modify: `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Testy**

Wszystkie na pauzie (`paused(page)`), bo capture z biegnącą pętlą kupuje rekompilację (reguła z `AGENTS.md`), i wszystkie z twardo wpisanym punktem ziarna 42, bo szukanie biomu w locie już raz wysadziło budżet czasu (notatka o wadach planu M3a).

1. **Las stoi**: w miejscu, gdzie `weightsAt` daje biom leśny, `__world.scenery.trees` jest większe od stu, a `__world.obstacles` (rozmiar) nie mniejsze od liczby drzew.
2. **Pustynia jest pusta**: w środku `dunes` drzew jest mniej niż dziesiąta tego, co w lesie — dowód, że wagi biomów naprawdę rządzą rozmieszczeniem, a nie tylko kolorem.
3. **Lot omija las**: po minucie lotu nad lasem `state.y - flight.floorAt(state.x, state.z) >= MIN_CLEARANCE - 0.5` w każdej próbce (co sekundę). To jest jedyny test, który sprawdza, że rekordy przeszkód docierają do kontrolera.
4. **Skok origin nie gubi lasu**: przestaw `state.x` o 9 km (dwa progi origin), przepuść klatkę, sprawdź, że `__world.scenery.rebuilds` wzrosło, `trees > 0`, a `scenerySample(0)` ma `local.x === world.x - origin.x` z dokładnością do 1e-3. To łapie błąd, który wygląda jak „las został z tyłu".
5. **Trawa jest przy ziemi**: nisko nad ziemią `scenery.grass > 0`, po podniesieniu na 1000 m `=== 0`.
6. **Brak błędów konsoli** we wszystkich powyższych — to jest dowód, że materiały koron, pni, propsów i trawy skompilowały się na WebGL2.
7. **Zwolnienie pamięci**: rozszerz istniejący test `dispose` o liczniki geometrii i tekstur — po `dispose` mają spaść, nie do zera (renderer trzyma swoje).

- [ ] **Step 2: Uruchomienie i commit**

```bash
npm run test:e2e
git add tests/e2e/smoke.spec.ts
git commit -m "test: the forest stands where the climate wants it, and the flight clears it

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

### Task 14: Dokumentacja i poprawki specyfikacji

**Files:**

- Modify: `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/perf-notes.md`, `docs/superpowers/specs/2026-09-14-dreamfall-design.md`

- [ ] **Step 1: Reguły silnika (`AGENTS.md`)**

Nowa sekcja „Scenery”, cztery zdania, nie więcej:

- Pierścień 96 m / 1,9 km przebudowuje się przy przekroczeniu komórki **i przy skoku origin**; pozycje liczy się w świecie, macierze pisze w układzie lokalnym.
- Limit trzech drzew na komórkę należy do kitu, nie do haka: `populate` biegnie osobno dla każdego biomu z wagą > 0,05.
- `Obstacles` karmi wyłącznie pierścień; `top` i `radius` biorą się z wypieczonej geometrii, nie z danych wpisu.
- Kołysanie liści i traw liczy się z `uniforms.time`, więc pauza zatrzymuje las.

- [ ] **Step 2: Kontrakt prozą (`CONTRIBUTING.md`)**

Dopisz „Adding a species” i „Adding a prop”: plik plus linia w `index.js`, co znaczą `trunk`, `limbs`, `crown` i cztery kształty koron, kiedy sięgnąć po własne `bake(kit)` (cypress jako przykład), czym różni się `place()` propsa od `populate` biomu i dlaczego wagi propsów są w biomie, a reguła stawiania w propsie. Jedno zdanie o tym, że biom z hakiem `populate` w kodzie nie ma trawy ani propsów, bo to są dane deskryptora.

- [ ] **Step 3: Specyfikacja — sześć poprawek, każda z datą**

1. §5.2 `Cell` dostaje `fields`, `mix(id)` i `blend(param)` — z jednym zdaniem dlaczego (linia drzew, odcień, wagi propsów i kolor skały nie dają się policzyć z samych wag).
2. §5.3 `scatter` stawia **tylko drzewa**; `props` w deskryptorze to wagi czytane przez `place()` propsa, `grass` to dane okna trawy.
3. §7 limit trzech drzew na komórkę należy do kitu, bo `populate` biegnie raz na biom.
4. §7 przebudowa pierścienia zachodzi także przy skoku `Origin` — konsekwencja lokalnego układu sceny, której §7 nie przewidywał.
5. §7 strumień losowy wpisu haszuje cały identyfikator, nie jego długość (poprawka wobec portu).
6. §16 / §15.5: obiekty liniowe (płoty, murki, żywopłoty) należą do `RoadKit`-a z M4 jako „line kit”, nie do rozrzutu propsów. To jest odpowiedź na pytanie właściciela z 15 września.

- [ ] **Step 4: `perf-notes.md` i README**

Do `perf-notes.md`: koszt pieczenia scenerii (etap `scenery`), koszt przebudowy pierścienia i okna trawy, pamięć pul, oraz — jeśli pomiar tego zażąda — decyzja o atlasie liści z Taska 7. README: linijka statusu `M3b Scenery: a streamed ring of 96 m cells, instanced pools with crown morphing, nine tree species, props, grass, and the shade under the trees.`

```bash
npx prettier --write AGENTS.md CONTRIBUTING.md README.md docs && npm run format:check
git add AGENTS.md CONTRIBUTING.md README.md docs
git commit -m "docs: the scenery rules, how to add a species, and six spec amendments

Co-Authored-By: <model> <noreply@anthropic.com>"
```

---

## Samoprzegląd planu

- **Pokrycie M3 ze spec** (§15 punkt 4), część b: streaming komórek (Task 6), pule z kurczeniem i morfingiem koron (Task 9), pusta warstwa nadpisań (Task 5), port zestawu drzewa (Task 8) i **dziewięć** gatunków zamiast czterech ze spec §15.4 (ustalenie właściciela z 15 września), propsy (Task 4, 6, 9), cień pod drzewami (Task 10), trawa (Task 11). Z §7: komórki 96 m w pierścieniu 1,9 km, `populate` biomów z wagą > 0,05, własny strumień na komórkę i wpis, przeszkody w siatce 64 m z drzew i propsów. Z §5.4 i §5.5: `defineSpecies`, `defineProp`, budżety koron, trójkątów i instancji, `validateBaked` na każdej wypieczonej geometrii (Task 1, 8).
- **Poza M3b, celowo**: stanowiska, drogi, budynki i osady (M4, i to tam wchodzą płoty jako obiekty liniowe); śnieg jako warstwa świata (M5, ale `SnowLine.ts` powstaje już teraz, żeby linia drzew i śnieg czytały tę samą liczbę); `ambience` (M5); zasięg widzenia (poza M3); cztery wady sylwetki postaci (`docs/superpowers/notes/2026-09-15-postac-do-poprawy.md`) — nie mieszaj ich z tym kamieniem milowym.
- **Zgodność nazw między taskami**: `TREE_CELL`/`TREE_RADIUS`/`MAX_TREES`/`CELL_TREES`/`POPULATE_FLOOR`, `CROWN_FADE`/`RING_FADE`/`NEAR_CROWN`/`FAR_CROWN`, `SNOW_LINE`/`snowLineAt`; `ScenerySink` (`begin`/`tree`/`prop`/`end`), `SceneryMetrics` (`species`/`prop`), `TreeInstance`/`PropInstance`, `createRing`/`createPools`/`createGrass`/`createGroundShade`/`createScenery`/`createOverrides`; `scatter`/`resolvePopulate`; `Species`/`Prop`/`Placement`/`TreeKit`/`PropKit`/`ScatterSpec`; `World.plant()` i `deferScenery`; `WorldDebug.scenery`/`scenerySample`.
- **Ryzyka wykonania**, w kolejności prawdopodobieństwa:
  1. **Skok origin.** Pierścień i trawa liczą w świecie, rysują lokalnie. Zapomniany `forced` daje las odsunięty o 4 km, widoczny dopiero po ~100 s lotu — czyli nie w testach jednostkowych. Dlatego test przeglądarkowy nr 4 jest obowiązkowy, a nie miły.
  2. **Czas pierwszej klatki.** Kilkanaście nowych materiałów węzłowych to kilkanaście nowych programów; M3a już zapłacił 2,1 s na prawdziwym GPU za samo niebo. Zmierz po Tasku 9, zanim zaczniesz Task 11, i jeśli etap scenerii przekroczy 1,5 s — atlas liści z Taska 7, nie „jakoś to będzie”.
  3. **Koszt przebudowy.** 1681 komórek co 2,4 s i 121 kafli trawy co 0,4 s. Budżety (6 ms i 4 ms) są w Taskach 6 i 11 razem z kolejnością ratunku; zacięcie co dwie sekundy jest gorsze niż mniej trawy.
  4. **Dwa modele rozmieszczania.** Biom mówi ile, props mówi jak. Kto tego nie przeczyta, doda `kit.prop` do `scatter` i dostanie kamienie dwa razy. Task 3 mówi to wprost, `CONTRIBUTING.md` powtarza.
  5. **`Fields` bez ziarna.** Poprawka z Taska 2 musi wejść **przed** Taskiem 3, bo inaczej kępy drzew wyglądają poprawnie na ziarnie 42 i identycznie na każdym innym — błąd, którego test ziarna 42 nigdy nie złapie.
  6. **Pamięć pul.** 27 siatek po 4000 instancji to ~10 MB po obu stronach. To jest cena wierności portowi; jeśli okaże się bolesna na słabszym sprzęcie, pojemność puli gatunku schodzi do 1500 przy zachowanym suficie 4000 — ale dopiero z pomiarem w ręku.

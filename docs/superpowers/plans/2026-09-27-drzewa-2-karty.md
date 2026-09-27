# Drzewa, krok 2: karty do 8,2 km — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drzewa za 2,6 km aż do 8,2 km, rysowane kartami ze zdjęć gatunków, z tym samym rozrzutem co pierścień i jednym przejściem pełne drzewo → karta.

**Architecture:** Trzy nowe moduły i wpięcie w istniejące. `scenery/ImpostorBake.ts` (czysty CPU) rasteryzuje wypieczoną geometrię gatunku do atlasu (kolor + normalna, z boku i z góry) z mipmapami zachowującymi pokrycie. `scenery/FarTrees.ts` (czysty CPU) trzyma komórki od `TREE_RADIUS` do `FAR_TREE_RADIUS`, sieje je przez `Sowing` na `SampledGround` z kolejką i budżetem. `scenery/Cards.ts` (GPU) to jedna siatka instancji z materiałem karty. Pula kart dostaje drzewa pierścienia (lustro ujścia) i dali; pełne drzewa i karty dzielą uniform `uTreeLimit`.

**Tech Stack:** TypeScript, three 0.185.1 (`three/webgpu`, TSL), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-drzewa-daleko-i-w-osadach-design.md` (4.3, 4.4, 4.5, 5, 6, 7 krok 2).

## Global Constraints

- Do 2,6 km nic się nie zmienia: pełne drzewa, korony i rozpływanie na `RING_FADE = [2300, 2560]` jak dziś.
- `FAR_TREE_RADIUS = 8200`; `FAR_TREES_BUDGET_MS = 2`, sprawdzany przed komórką; `MAX_CARDS = 32000`.
- Czyste moduły CPU (`ImpostorBake.ts`, `FarTrees.ts`) nie importują `three/webgpu`, `three/tsl` ani DOM.
- Siatka kart wiąże najwyżej osiem buforów wierzchołków.
- Nic na CPU nie czyta dalekiego okna; wysokość za 4,2 km czyta shader karty (`surfaceHeight(farTerrain.loadCell, FAR_CELL)`).
- Kod i komentarze po angielsku, plan po polsku; `npm run check` zielony po każdym zadaniu.

## Rulings wobec specu (zapisane przed startem)

- **Zdjęcia robi rasteryzator na CPU, nie render GPU** (spec 4.4 mówi o kamerze ortograficznej). Sceneria nie ma renderera, odczyt pikseli z GPU jest asynchroniczny, a render do własnego celu kompilowałby materiały drugi raz (jak `capture`). Rasteryzator 9 × 2 ujęć po ~1 000 trójkątów to milisekundy, jest deterministyczny i testowalny w Node. Koszt, jeśli źle: ujęcia wyglądają inaczej niż render (np. brak mapy wypukłości kory) — do oceny na zdjęciach.
- **Kolor klimatu barwi całą kartę, nie tylko liście** (spec 4.4). Pełne drzewo dziś barwi `instanceColor` i drewno, i koronę (`Pools.write` na obu pulach), więc karta ma robić to samo, żeby przejście było niewidoczne. Maska liści niepotrzebna; przepuszczanie światła (`translucency`) dostaje cała karta.
- **Ujęcie wypełnia cały kafelek** (skala niejednorodna), a proporcje przywraca rozmiar karty; dzięki temu shader nie potrzebuje tablicy prostokątów gatunków.

## Review Focus

1. Drzewo na granicy pierścienia (komórka o środku tuż przed/za 2 600 m względem pozycji ostatniej przebudowy) — ma być w dokładnie jednym z dwóch zbiorów; test w zadaniu 2.
2. Skok origin — pozycje kart przepisane bez ponownego siania; test w zadaniu 2 (wersja nie siewu) i w przeglądarce (zadanie 4).
3. Teleport (skok okna) — kolejka od nowa od najbliższej komórki, stare komórki zapomniane; test w zadaniu 2.
4. Pusta pula po skoku do morza (0 drzew) — karta nie może rysować śmieci z poprzednich instancji (`count`); test w zadaniu 3.
5. `uTreeLimit` z `x == y` — `smoothstep` z zerową szerokością to NaN; wartości zawsze z `y ≥ x + 1`; test w zadaniu 3.

---

### Task 1: `scenery/ImpostorBake.ts` — zdjęcia gatunków na CPU

**Files:** Create `src/engine/scenery/ImpostorBake.ts`; Test `tests/unit/impostorBake.test.ts`.

**Interfaces — Produces:**
```ts
export interface Picture { width: number; height: number; data: Uint8ClampedArray } // sRGB RGBA bytes
export interface BakeSource {
  wood: { position: ArrayLike<number>; normal: ArrayLike<number>; uv: ArrayLike<number> };
  crown: { position: ArrayLike<number>; normal: ArrayLike<number>; uv: ArrayLike<number> } | null;
  bark: Picture; barkTint: [number, number, number]; // linear rgb
  leaf: Picture | null;
}
export interface ImpostorShape { width: number; height: number; bottom: number } // m at scale one: side width, height, y of the image's foot
export const TILE = 128, ATLAS_COLUMNS = 16, ATLAS_ROWS = 2;
export const LEAF_CUTOFF = 0.04;
export function bakeView(src: BakeSource, view: 'side' | 'top', size: number): { color: Float32Array; normal: Float32Array; coverage: number } // linear rgb+alpha, camera-space normal+1, per texel
export function shapeOf(src: BakeSource): ImpostorShape
export function buildAtlas(tiles: Array<{ side: ReturnType<typeof bakeView>; top: ReturnType<typeof bakeView> }>): { color: Uint8Array[]; normal: Uint8Array[]; width: number; height: number } // mip levels, level 0 first
export function coverageScale(alpha: Float32Array, cutoff: number, target: number): number
export function tileOf(index: number, view: 'side' | 'top'): { u: number; v: number; w: number; h: number }
```

- [ ] Testy (napisz najpierw, zobacz FAIL):
  - `bakeView` pojedynczego pionowego czworokąta drewna 2 × 4 m daje w ujęciu `side` pokrycie ~ 2·4 / (W·H) i normalną kamery (0,0,1) w środku; w ujęciu `top` ten sam czworokąt jest kreską (pokrycie < 5 %).
  - Kartka liścia z teksturą przezroczystą w lewej połowie: pokryta jest tylko prawa połowa (`LEAF_CUTOFF`).
  - Bufor głębokości: dwa czworokąty jeden za drugim — widać kolor bliższego (`+z` w `side`, `+y` w `top`).
  - `coverageScale` zwraca skalę, dla której udział `alpha·s > cutoff` jest równy celowi (±1/n); `buildAtlas` utrzymuje udział pokrycia każdego kafelka na poziomach 1..4 w ±15 % poziomu 0.
  - `buildAtlas` ma 12 poziomów dla 2048 × 256 (do 1 × 1), a piksele przezroczyste poziomu 0 niosą kolor sąsiada (dylatacja), nie czerń.
- [ ] Implementacja: rasteryzacja trójkątów w ortografii z supersamplingiem 2× (256 → 128 filtrem pudełkowym), bufor głębokości, tekstury próbkowane najbliższym sąsiadem z zawijaniem (kora) i progiem alfa (liście), kolor liniowy (tablica sRGB→linear), drewno = kora × `barkTint`, liść = kolor liścia zmieszany ze średnią liścia jak `paintedSample` (`PAINTED_MEAN = 0.38`). Kadr: `r = max |x|, |z|` całej geometrii, `side` x∈[−r, r], y∈[bottom, top]; `top` x∈[−r, r], z∈[−r, r] (obraz w górę = −z). Normalna kamery: `side` (nx, ny, nz), `top` (nx, −nz, ny). Mipmapy: średnia ważona alfą dla koloru, zwykła dla normalnej, skala pokrycia per kafelek per poziom (Castaño), sRGB kodowane na końcu.
- [ ] `npx vitest run tests/unit/impostorBake.test.ts` → PASS; format, lint; commit „Photograph a species on the CPU for its card”.

### Task 2: `scenery/FarTrees.ts` — dalekie komórki z kolejką

**Files:** Create `src/engine/scenery/FarTrees.ts`; Test `tests/unit/farTrees.test.ts`.

**Interfaces — Consumes:** `createSowing`, `TreeInstance`, `saltOf` (krok 1), `createSampledGround`, `TREE_CELL`, `TREE_RADIUS`, `Claims`. **Produces:**
```ts
export const FAR_TREE_RADIUS = 8200, FAR_TREES_BUDGET_MS = 2;
export interface FarTree { species: string; x: number; y: number; z: number; scale: number; tall: number; yaw: number; tint: [number, number, number] }
export interface FarTrees {
  update(x: number, z: number): void;      // where the ring last rebuilt; sets what is wanted
  work(budgetMs: number): void;            // sows queued cells, nearest first
  readonly version: number;                // grows when the set of trees changes
  readonly queued: number; readonly cells: number; readonly trees: number; readonly ms: number;
  forEach(fn: (tree: FarTree) => void): void;
}
export function createFarTrees(deps: { seed; library; sampler; ground: GroundQuery; claims?: Claims; baked(id: string): boolean; radius?: number; inner?: number; cell?: number; now?: () => number }): FarTrees
```

- [ ] Testy:
  - Podział z pierścieniem: `createRing` o promieniu 600 i `createFarTrees({ inner: 600, radius: 1500 })` na tym samym oknie, oba z tego samego `(x, z)`: każda komórka ma drzewa w jednym zbiorze, suma drzew = drzewa pierścienia o promieniu 1500 (ten sam test co granica pierścienia; `ring.test.ts` robi tak samo dla komórek).
  - Ten sam las niezależnie od trasy: `update(A); work(∞); update(B); work(∞)` daje ten sam zbiór co `update(B); work(∞)` (porównanie posortowanych wierszy).
  - Budżet: z zegarem `now` przesuwanym o 1 ms na wywołanie, `work(2)` sieje najwyżej 2–3 komórki i zostawia resztę w `queued`; kolejność od najbliższej.
  - Teleport: po `update` 50 km dalej stare komórki znikają (`cells` z samych nowych) bez czekania na `work`.
  - Plan w `claims`: po `claims.add(plan)` i `update` z tego samego miejsca komórki pod planem są siane ponownie i drzewo w obrysie domu znika.
- [ ] Implementacja: klucz komórki `ix * 2^22 + iz` (jak w trawie), `wanted` z kwadratu wokół `(x, z)` filtrowanego odległością środka `(inner, radius]`, kolejka posortowana po odległości, `live: Map<key, FarTree[]>`, `account()` nad `claims.plans` jak w `Grass.ts`, `Sowing` z `admit: () => true`, `emit` kopiujące kolor do krotki.
- [ ] PASS; commit „Sow the land past the ring a cell at a time”.

### Task 3: `scenery/Cards.ts`, `uTreeLimit` i wpięcie w scenerię

**Files:** Create `src/engine/scenery/Cards.ts`, `src/engine/scenery/cardPack.ts` (czyste pakowanie instancji); Modify `Pools.ts` (drzewa czytają `uTreeLimit`), `Scenery.ts` (lustro ujścia, `FarTrees`, `settle`, statystyki, grupa warstwy), `World.ts` (loader dalekiego okna i kotwica dla kart, `plant` woła `settle`, grupa `far trees`), `src/main.ts` + `src/page/Debug.ts` (`settleScenery`); Test `tests/unit/cardPack.test.ts`.

**Interfaces — Produces:**
```ts
// cardPack.ts (pure)
export const CARD_FLOATS = { a: 4, b: 4, c: 3 };
export function packCard(out: { a: Float32Array; b: Float32Array; c: Float32Array }, i: number,
  tree: { x: number; y: number; z: number; scale: number; tall: number; yaw: number; tint: ArrayLike<number> | { r: number; g: number; b: number } },
  local: { x(v: number): number; z(v: number): number }, tile: number, shape: ImpostorShape): void
// a = (lx, y, lz, tile * 2 + mirror), b = (width, height, topSize, bottom), c = tint
export function treeLimitOf(near: number, far: number, k: number): [number, number] // y >= x + 1
// Cards.ts (GPU)
export interface Cards { mesh: Mesh; write(trees: Iterable<...>, origin): void; count: number; refused: number; dispose(): void }
```

- [ ] Testy (`cardPack.test.ts`): pakowanie (lustro z `yaw`, rozmiary × `scale`/`tall`, lokalne współrzędne); `treeLimitOf(2300, 2560, 1)` → `[0, 1]`, nigdy `y < x + 1`; geometria kart ma ≤ 8 atrybutów (budowana przez funkcję eksportowaną z `Cards.ts` bez materiału — `cardGeometry(capacity)`).
- [ ] Materiał karty: `litMaterial(color × tint, { alphaTest: LEAF_ALPHA_TEST, alphaToCoverage: true, translucency: 1.1, side: DoubleSide })`, `positionNode` z osi karty (prawo = poziome ⊥ do kamery, góra = przechył z elewacją), wysokość `mix(y, surfaceHeight(far)(xz), rim)`, `normalNode` z atlasu normalnych w bazie karty, `opacityNode = alfa × smoothstep(limit) × (1 − smoothstep(7900, 8150, d))`. Ujęcia `side`/`top` mieszane po `smoothstep(0.35, 0.85, sin elewacji)`.
- [ ] `Pools`: `uTreeLimit = uniform(vec2(RING_FADE))`; drewno i obie korony biorą `1 − smoothstep(uTreeLimit.x, uTreeLimit.y, d)` zamiast `ringFade`; rekwizyty i domy zostają przy `ringFade`.
- [ ] `Scenery`: ujście drzew zapisuje każde przyjęte drzewo pierścienia do listy lustra; po przebudowie pierścienia `farTrees.update(x, z)` z tą samą pozycją; `farTrees.work(FAR_TREES_BUDGET_MS)` co klatkę; karty przepisywane, gdy zmieni się lustro, wersja dali (najwyżej co 250 ms w trakcie kolejki, od razu gdy kolejka pusta) albo origin. `settle()` przerabia kolejkę do końca i przepisuje karty. Statystyki: `farTrees`, `farCells`, `farQueued`, `farMs`, `cards`, `cardsRefused`.
- [ ] `World.plant()` woła `scenery.settle(state.x, state.z)` (pierwsze wypełnienie za zasłoną); `__world.settleScenery()` dla testów.
- [ ] `npm run check` → PASS; commit „Stand every tree out to the far terrain as a card”.

### Task 4: przeglądarka, zdjęcia, pomiar, dokumenty

**Files:** Modify `tests/e2e/smoke.spec.ts`; Create `tools/trees/look.mjs`; Modify `docs/perf-notes.md`, `AGENTS.md`.

- [ ] Test e2e: seed 42, las `(-48000, -42000)`, `step` + `settleScenery()`: `scenery.farTrees > 5000`, `cards >= trees + farTrees`, `cardsRefused == 0`, brak błędów konsoli; po skoku origin (przelot 3 km) karty nadal są (`cards > 0`).
- [ ] `tools/trees/look.mjs OUT [X] [Z]`: zdjęcia na 150, 500, 900 i 1 300 m nad terenem w stronę dalekiego lasu, plus zbliżenie pasa 2,3–2,6 km; `OFF=far trees` do porównania.
- [ ] Pomiar: `npm run bench` przed (commit kroku 1) i po, trójkąty i klatka; start (`timings`) na GPU tej maszyny; zapis w `docs/perf-notes.md`.
- [ ] `AGENTS.md`: sekcja Scenery — karty do `FAR_TREE_RADIUS`, `uTreeLimit`, lustro ujścia, zdjęcia na CPU; lista czystych modułów.
- [ ] Commit „Measure the far trees and say how they stand”.

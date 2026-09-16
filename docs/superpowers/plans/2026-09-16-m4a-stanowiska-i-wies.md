# M4a Stanowiska i wieś: plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Świat dostaje miejsca, które ktoś zbudował. Krata stanowisk na `Fields.lattice`; obecność i płaskowyż z tej samej kraty, więc ziemia pod osadą jest płaska, zanim cokolwiek na niej stanie; plan osady jako **czysta funkcja** `(ziarno, komórka kraty, parametry) → {drogi, parcele, rezerwacje}`, trzymany w pamięci podręcznej szerszej niż pierścień i budowany w kolejce z budżetem na klatkę; `RoadKit` robiący wstęgi dróg z łamanych; `StructureKit` wypiekający rodzaje budynków; pule instancji, które stawiają parcele planu; rezerwacje, dzięki którym `cell.occupied` przestaje kłamać i las nie rośnie na rynku; przeszkody z każdego budynku. Wynik: w ziarnie 42 da się znaleźć wieś, przelecieć nad nią i jej nie przeciąć.

**Architecture:** Zgodnie ze specyfikacją `docs/superpowers/specs/2026-09-14-dreamfall-design.md` (sekcje 5.2, 5.3, 5.4, 7, 8, 15.5) i z tym, co M3b już postawiło. Granica jest ta sama, co przy scenerii i sprawdziła się: **wszystko, co decyduje co i gdzie stoi, jest czystym CPU i ma test w Node**; wszystko za `ScenerySink` to instancjonowanie i sprawdza je przeglądarka. Plan osady jest czystą funkcją nie dlatego, że tak ładniej, tylko dlatego, że inaczej nie da się go przetestować — spec §8 mówi to wprost.

**Tech Stack:** bez nowych zależności. Vite 8.3.0, TypeScript 5.9.3, three 0.185.1, Vitest 4.1.11, Playwright 1.63.0.

## Podział: dlaczego M4a i M4b

Spec §8 opisuje **dwa** zestawy: wieś (krata 6 km, 30–150 budynków, drogi organiczne) i miasteczko (krata 20 km, 500–2000 budynków, siatka z jitterem, obwodnica, plac, dominanta, przedmieścia). Różnią się nie skalą, tylko liczbą rzeczy, które mogą pójść nie tak naraz.

- **M4a (ten plan)**: cała maszyneria — krata, obecność, płaskowyż, plan jako czysta funkcja, kolejka, rezerwacje, drogi, budynki, przeszkody, spięcie — i **jedna wieś** w rejestrze, żeby maszyneria miała co obsłużyć.
- **M4b (po scaleniu)**: miasteczko (siatka z jitterem, obwodnica, plac, dominanta do 60 m, kondygnacje malejące od centrum, przedmieścia), propsy wzdłuż dróg, **płoty i sady jako obiekty liniowe** (`kit.line`, odpowiedź na pytanie właściciela z 15 września), paleta osady.

Gdyby właściciel chciał M4 w jednym kawałku, sekcja „Co bierze M4b" na końcu rozwija się w zadania 15–21 tego samego planu; kolejność zadań 1–14 nie zmienia się w żadnym wariancie.

## Global Constraints

- Gałąź robocza od `main` po scaleniu M2.2. Kod, identyfikatory, komentarze, komunikaty commitów i dokumentacja repozytorium po angielsku; plan i specyfikacja po polsku. Każdy commit kończy się linią `Co-Authored-By: <model z przypomnienia o atrybucji sesji> <noreply@anthropic.com>`.
- **Pola bazowe zamrożone.** M4a nie dotyka `sample`, `baseFields` ani wartości wzorcowych ziarna 42. Osada zmienia teren **wyłącznie** przez hak `height` swojego biomu, czyli przez tę samą drogę, którą chodzą wszystkie biomy — i podlega temu samemu przycięciu do `MAX_HEIGHT_DELTA` (300 m).
- **Jedna krata, trzy czytelniki.** Obecność biomu osady, jego płaskowyż i generator stanowiska czytają `Fields.lattice(cell, salt)` z **tymi samymi** `cell` i `salt`. Rozjazd o jeden hash daje wieś na zboczu obok płaskiego placu i jest najdroższym możliwym błędem w tym kamieniu: widać go dopiero z powietrza, a wygląda jak błąd terenu. `Fields.lattice` jest już zasolone ziarnem świata (commit z 16 września).
- **Plan przed geometrią.** `build(site, kit)` produkuje dane: łamane dróg, listę parcel, listę rezerwacji. Nie tworzy ani jednej geometrii. Geometrię robią pule z tych danych, tak jak drzewa z rozrzutu. To jest warunek testowalności w Node i warunek tego, żeby M6 mógł kiedykolwiek te dane edytować.
- **Świat w podwójnej precyzji, scena lokalnie** — jak w M3b: pozycje liczone w świecie, macierze pisane przez `Origin.localX/localZ`, przebudowa wymuszona przy skoku origin. Plan stanowiska jest w świecie i **nie** przebudowuje się przy skoku origin; przebudowuje się to, co z niego instancjonuje.
- **Budżety** ze spec §5.5, już w `BUDGET`: `siteInstances` 4 (stanowiska jednego biomu w pierścieniu), `propTriangles` 6000 (trójkąty budynku), 60 000 trójkątów dróg na stanowisko, promień stanowiska ≤ 900 m.
- **Kolejka z budżetem.** Budowa planu jest kolejkowana, nie robiona w klatce, w której komórka weszła w zasięg (spec §7). Budżet: 4 ms na klatkę. Plan raz zbudowany żyje w pamięci podręcznej o promieniu większym niż pierścień, więc zawrócenie nad wsią nie buduje jej drugi raz.
- **Poza zakresem M4a** (nie budować): miasteczko i wszystko z listy M4b; malowane pola na ziemi, mosty, rzeki, wnętrza (spec §8 wymienia je jako świadomie pominięte); śnieg jako warstwa świata, panel dev, `bench`, `parity` (M5); szkielet postaci (następny kamień po M4, ustalenie właściciela z 16 września).

---

## Liczby: co jest portem, a co jest nowe

Port z `fly-with-me` (commit `38857e6`, `src/main.js`) dotyczy **mechaniki znajdowania stanowiska**, nie osady — oryginał ma ruiny, nie wsie. Klonuj `github.com/kunchenguid/fly-with-me` (publiczne, MIT) i wpisz liczby na sztywno, jak poprzednie plany.

| co | wartość | gdzie |
| --- | --- | --- |
| krata stanowisk | `SITE_CELL = 1200` m, `SITE_ODDS = 0.22` | ~311 |
| zasięg szukania | `TREE_RADIUS + SITE_CELL`, odcięcie przy `TREE_RADIUS + SITE_CELL * 0.7` | ~2074, ~2085 |
| szansa ważona biomem | `r() > SITE_ODDS * welcome` → pomiń, gdzie `welcome = Σ waga · biome.ruins` | ~2091 |
| próby posadowienia | 4 próby w `(gx + 0.2 + u*0.6)` komórki | ~2105 |
| warunki gruntu | `h >= 8`, `slope <= type.slope`, sonda ośmiu punktów o 90 m: płaskie `|Δh| < 12`, wzgórze `wokół <= h + 3` | ~2108–2117 |
| posadowienie | `scale 0.85 + u*0.4`, `sink 0.3 + u*0.9`, `yaw` losowy albo ku wschodowi słońca | ~2101 |
| pule stanowisk | `BUDGET.siteInstances`, `base` per instancja, kurczenie jak drzewa | ~2051–2066 |

Wartości osady ze spec §8, bez oryginału — to jest połowa nowa:

| wieś | wartość |
| --- | --- |
| krata / szansa | 6000 m, `odds` 0,5 |
| promień | 120..250 m |
| drogi | organiczne: główna wzdłuż warstwicy przez centrum, boczne ścieżki, `spacing` 60..80 m |
| budynki | 30..150, kondygnacje 1..2, dominanta opcjonalna (młyn albo wieża) |
| płaskowyż | `strength` 0,3, `feather` 100..200 m |
| grunt | ląd > 10 m, nachylenie < 0,25 w centrum, `shoreBonus` |
| parcele | `lotDepth`, `density(r)` malejąca od centrum, `setback` |
| drogi (wstęga) | próbkowanie `heightAt` co 4 m, uniesienie 0,15 m, budżet 60 000 trójkątów na stanowisko |

---

## Struktura plików po M4a

```
library/
  contract.ts                 zmiana: StructureSpec, StructureKit, SitePlan, RoadSpec, LotSpec,
                              SiteKit.line; walidacja budynków i odwołań do nich
  standard/presence.js        zmiana: hak lattice (obecność z kraty) -- M3a odłożyło go tutaj
  standard/height.js          zmiana: hak plateau (płaskowyż z tej samej kraty)
  settlements/settlement.js   nowy: settlement(params) -> wpis biomu z sites
  settlements/village.js      nowy: parametry wsi
  settlements/plan.js         nowy: plan osady jako czysta funkcja (drogi, parcele, rezerwacje)
  structures/cottage.js  barn.js  mill.js   nowe: trzy rodzaje budynków wsi
  index.js                    zmiana: rejestr niesie structures i biom osady
src/engine/scenery/
  Sites.ts                    nowy: krata stanowisk, dopasowanie gruntu, pamięć podręczna, kolejka 4 ms
  RoadKit.ts                  nowy: wstęgi z łamanych
  StructureKit.ts             nowy: pieczenie rodzajów budynków
  Ring.ts                     zmiana: cell.occupied pyta plan; parcele planu idą do pul
  Pools.ts                    zmiana: pule budynków i dróg
  Scenery.ts                  zmiana: stanowiska w agregacie, statystyki, kolejka na klatkę
tests/unit/                   sites.test.ts, settlementPlan.test.ts, roadKit.test.ts,
                              standardHooks.test.ts (+), contract.test.ts (+)
tests/e2e/smoke.spec.ts       rozszerzony: wieś stoi, drogi się trzymają ziemi, las jej nie zarasta
AGENTS.md, CONTRIBUTING.md, README.md, docs/perf-notes.md, spec
```

---

### Task 1: Kontrakt budynków, planu i zestawu stanowiska

**Files:** Modify `library/contract.ts`; Test `tests/unit/contract.test.ts`

**Interfaces:**

- `Structure` przestaje być workiem, tak jak `Species` i `Prop` przestały nim być w M3b:

```ts
export interface StructureSpec {
  kind?: 'structure';
  id: string; name: string;
  /** Plan of the building at ground level, m. */
  footprint: [number, number];
  floors: [number, number];
  floorHeight?: number;            // default 2.8
  roof: 'gable' | 'hip' | 'flat';
  roofPitch?: number;              // default 0.7
  chimney?: boolean;
  /** Wall, roof, trim and window colours, as swatches. */
  palette: { wall: SceneryColor; roof: SceneryColor; trim?: SceneryColor; window?: SceneryColor };
  /** How much sky it takes; the flight reads this, so it comes from the bake. */
  obstacle?: { radius: number; height: number };
  bake?(kit: StructureKit): BufferGeometry;
}
export interface StructureKit extends PropKit {
  /** A box with vertex colours, the only primitive a recipe needs. */
  box(w: number, h: number, d: number, color: SceneryColor): BufferGeometry;
  /** A gable, hip or flat roof over a footprint. */
  roof(kind: StructureSpec['roof'], w: number, d: number, rise: number, color: SceneryColor): BufferGeometry;
  /**
   * A band of windows around a floor: vertex colour on the wall, and a `glow`
   * attribute of 1 on exactly those vertices. The colour is what you see by
   * day; the glow is what the night reads.
   */
  windows(geometry: BufferGeometry, y: number, height: number, color: SceneryColor): void;
}
```

- **Okna świecą w nocy, i decyduje się to tutaj, nie później.** Budynek niesie
  atrybut wierzchołka `glow` (0 albo 1, pisany przez `windows`), a instancja
  niesie `lit` (0..1, z hasha parceli), więc nie każdy dom świeci i nie każdy
  tak samo. Materiał składa z tego jedną linijkę:
  `emissiveNode = kolorOkna · glow · lit · uNight`. `uNight` jest już
  uniformem nieba, a `emissiveNode` obsługuje materiał świata — dokładanie tego
  po wypieczeniu znaczyłoby przepiec wszystkie budynki, a teraz kosztuje cztery
  bajty na wierzchołek ścian.

- Plan stanowiska — dane, nie geometria:

```ts
export interface RoadSpec { points: Array<[number, number]>; width: number; color?: SceneryColor }
export interface LotSpec {
  x: number; z: number; yaw: number;
  structure: string;                 // id of a structure entry
  floors: number;
  tint?: SceneryColor;
}
export interface Reservation { x: number; z: number; radius: number }
export interface SitePlan {
  id: string; x: number; z: number; radius: number;
  roads: RoadSpec[];
  lots: LotSpec[];
  reservations: Reservation[];
}
```

- `SiteKit` dostaje `line(points, kind, opts?)` — wstęga wzdłuż łamanej, która nie jest drogą (płot, murek, żywopłot). W M4a **istnieje w typach i rzuca `Error('lines land in M4b')`**, dokładnie tak, jak `structure` rzucał w M3b. Powód: to jest odpowiedź na pytanie właściciela i ma być widoczna w kontrakcie od momentu, w którym wiadomo, gdzie należy — a nie zbudowana na zapas.
- `validateLibrary` dostaje blok budynków (identyfikator, duplikaty, `footprint` i `floors` rosnące i dodatnie, `palette` w kopercie, `roof` ze znanego zbioru, `obstacle` dodatni) i sprawdza odwołania: każdy identyfikator budynku wymieniony przez osadę musi istnieć w rejestrze — ta sama reguła, która w M3b złapała literówkę w gatunku.

- [x] **Step 1: Test, który nie przechodzi** — przypadki jak w M3b: budżety, brakujące pola, kolor poza kopertą, nieznany rodzaj dachu, osada wskazująca budynek, którego nikt nie wypiekł.
- [x] **Step 2: Implementacja.** Trzymaj `validateLibrary` płaskie: jeden `for` na rodzaj wpisu, ta sama pomocnicza `colorAt`, ten sam kształt komunikatu.
- [x] **Step 3:** `npm run check` **do pliku, z odczytem kodu wyjścia** (nie przez `grep` — potok zwraca kod `grep`-a i zjada porażkę; ta sesja dała się na tym złapać). Commit.

---

### Task 2: Jedna krata, dwa haki — obecność i płaskowyż

**Files:** Modify `library/standard/presence.js`, `library/standard/height.js`; Test `tests/unit/standardHooks.test.ts`

**Interfaces:**

- `lattice({ cell, radius, feather, odds, salt, land, maxSlope, shoreBonus })` → hak obecności (spec §5.3). Czyta `f.lattice(cell, salt)`, przepuszcza komórkę przez `odds` (własny strumień `hit.u(k)`), i zwraca 1 w promieniu, gasnąc przez `feather`. `land` i `maxSlope` odrzucają miejsce po `f.baseHeight` i po nachyleniu policzonym z pól, `shoreBonus` podbija szansę blisko brzegu (`f.shore`).
- `plateau({ cell, salt, radius, feather, strength })` → hak wysokości. Ta sama krata, ten sam salt; w promieniu ciągnie wysokość do wysokości **środka** kraty, z siłą `strength`, gasnąc przez `feather`. Wysokość środka bierze się z `f.baseHeight` **w środku**, więc hak musi umieć zapytać o pole gdzie indziej niż stoi — dlatego dostaje ją z `hit`, a nie z drugiego próbkowania: **`LatticeHit` zyskuje `h`**, wysokość bazową swojego środka, liczoną raz przy trafieniu.
- To jest jedyna zmiana w `Fields` w tym kamieniu i jest konieczna: bez niej płaskowyż musiałby wołać sampler rekurencyjnie w trakcie próbkowania texela.

- [x] **Step 1: Test, który nie przechodzi.** Obecność: jedna komórka na `1/odds` niesie stanowisko; ta sama komórka zawsze to samo; dwa ziarna nie zgadzają się (krata jest zasolona); poza promieniem zero, w `feather` monotonicznie. Płaskowyż: w środku wysokość dokładnie środka; przy `strength: 0` teren nietknięty; przy 1 płasko; w `feather` gładko; **i test, który przechodzi tylko wtedy, gdy obie funkcje trafiają w ten sam środek** — to jest ten błąd, który plan nazywa najdroższym.
- [x] **Step 2: Implementacja i commit.**

---

### Task 3: Krata stanowisk (`Sites.ts`, czysty CPU)

**Files:** Create `src/engine/scenery/Sites.ts`; Test `tests/unit/sites.test.ts`

**Interfaces:**

```ts
export const SITE_REACH_PAD = 1.0;   // cells of slack beyond the ring
export interface Site { id: string; biome: string; x: number; z: number; radius: number; yaw: number; fields: Fields; random(): number }
export interface Sites {
  /** The sites whose plans the ring may need, nearest first; pure lookup, no building. */
  near(x: number, z: number, reach: number, out: Site[]): Site[];
  /** The plan of a site, or null while it is still queued. */
  planFor(site: Site): SitePlan | null;
  /** Builds at most `budgetMs` worth of queued plans; called once a frame. */
  work(budgetMs: number): void;
  readonly built: number;
  readonly queued: number;
}
export function createSites(deps: { seed; library; sampler; heightfield }): Sites;
```

- **Znajdowanie**: dla każdej komórki kraty w zasięgu — strumień z `hash2(gx, gz, seed ^ idHash(biome.id))`, `odds` biomu, `fits(fields)` wpisu, i cztery próby posadowienia z warunkami gruntu (port z oryginału, liczby w tabeli). Stanowisko, które nie mieści się w czterech próbach, **nie istnieje** — i nie próbuje się go szukać drugi raz przy następnym wejściu w zasięg, bo wynik jest funkcją komórki, nie chwili.
- **Pamięć podręczna**: `Map` planów po kluczu `${biome}:${gx},${gz}`, czyszczona po odległości większej niż `pierścień + 2 komórki kraty`. Osada zbudowana raz nie buduje się drugi raz przy zawróceniu.
- **Kolejka**: `work(budgetMs)` bierze z kolejki najbliższe stanowiska i buduje ich plany, aż wyczerpie budżet. `planFor` zwraca `null`, dopóki plan nie jest gotowy — pierścień ma wtedy po prostu nic do postawienia, co jest poprawne: wieś pojawia się o klatkę później, nie połowicznie.
- **Nadpisania**: przed budową `overrides.for(siteKey(...))`; `skip` znaczy „tu nie ma osady".

- [x] **Step 1: Test, który nie przechodzi.** Na prawdziwym samplerze ziarna 42 i sztucznej bibliotece z jednym biomem osady: ta sama komórka zawsze to samo stanowisko; dwa ziarna różne miejsca; stanowisko stoi na lądzie powyżej progu i na nachyleniu poniżej; `near` zwraca tylko to, co w zasięgu; `work(0)` nie buduje nic, `work(100)` buduje wszystko, `planFor` przed budową jest `null`; pamięć podręczna nie rośnie w nieskończoność przy locie 50 km w linii prostej (to jest test na wyciek, nie na wydajność).
- [x] **Step 2: Implementacja i commit.**

---

### Task 4: Plan wsi jako czysta funkcja

**Files:** Create `library/settlements/{settlement,village,plan}.js`; Test `tests/unit/settlementPlan.test.ts`

**Interfaces:**

- `settlement(params)` → wpis biomu: `presence` z haka `lattice`, `height` z haka `plateau` (oba z parametrów), `ground` malujący ubitą ziemię i drogi w kolorze osady, `sites: { cell, odds, radius, fits, build }`. To jest „biom z kodu nad standardowymi hakami" ze spec §8 i jedyny taki wpis w rejestrze.
- `build(site, kit)` woła `planVillage(site, params)` z `plan.js` i oddaje wynik przez `kit`: `kit.road(points, width)`, `kit.structure(id, x, z, {yaw, floors})`, `kit.reserve(x, z, radius)`. Kit **zbiera** te wywołania w `SitePlan` — nic nie rysuje.
- `planVillage(site, params)` jest czystą funkcją. Kolejność, którą trzeba zachować, bo od niej zależy powtarzalność: (1) główna droga wzdłuż warstwicy przez centrum — kierunek z gradientu wysokości w środku, spróbkowanego czterema punktami o 40 m; (2) boczne ścieżki co `spacing`, po obu stronach, skracane tam, gdzie nachylenie rośnie ponad próg; (3) parcele wzdłuż dróg z `setback`, z gęstością malejącą od centrum; (4) rodzaj i obrót budynku z hasha parceli; (5) rezerwacje: krąg wokół każdej parceli i pas wzdłuż każdej drogi.
- Żaden krok nie czyta `heightAt` — plan dostaje wysokości przez `site.fields` i przez sondy, które podaje mu silnik. Inaczej nie da się go policzyć w Node bez okna terenu.

- [x] **Step 1: Test, który nie przechodzi.** Plan tej samej komórki dwa razy jest identyczny; liczba budynków mieści się w 30..150; żadna parcela nie leży bliżej niż `setback` od osi drogi; żadne dwie parcele nie zachodzą na siebie; rezerwacje pokrywają wszystkie parcele; plan dla promienia 120 m ma mniej budynków niż dla 250 m; wszystkie identyfikatory budynków są w rejestrze.
- [x] **Step 2: Implementacja i commit.**

---

### Task 5: Rezerwacje — `cell.occupied` przestaje kłamać

**Files:** Modify `src/engine/scenery/Ring.ts`; Test `tests/unit/ring.test.ts` (rozszerzenie)

**Interfaces:**

- `createRing` przyjmuje `sites: Sites`. `cell.occupied(x, z)` pyta plany stanowisk, które sięgają tej komórki: punkt jest zajęty, gdy leży w rezerwacji albo w pasie drogi. Dziś zwraca `false` i to jedyne miejsce w silniku, które świadomie kłamie od M3b.
- Koszt: komórka pierścienia pyta najwyżej o stanowiska w swoim zasięgu (zwykle zero), a `occupied` woła się raz na drzewo, nie raz na komórkę. Rezerwacje trzymane są w siatce haszującej o komórce 64 m, jak przeszkody.
- Standardowy `scatter` już to woła (M3b, Task 3) — to jest ta linijka, która wtedy nic nie robiła.

- [x] **Step 1: Test, który nie przechodzi.** Pierścień z jednym stanowiskiem: żadne drzewo nie stoi w rezerwacji ani na drodze; ten sam pierścień bez stanowiska ma tam drzewa; liczba drzew poza osadą nie zmienia się.
- [x] **Step 2: Implementacja i commit.**

---

### Task 6: `RoadKit` — wstęga wzdłuż łamanej

**Files:** Create `src/engine/scenery/RoadKit.ts`; Test `tests/unit/roadKit.test.ts`

**Interfaces:**

- `buildRoads(roads: RoadSpec[], deps: { heightAt, lift, triangles })` → `BufferGeometry | null`: jedna scalona geometria na stanowisko, kolory wierzchołków z koloru nawierzchni.
- Wstęga: łamana próbkowana **co 4 m**, w każdej próbce dwa wierzchołki na szerokość, wysokość z `heightAt` **uniesiona o 0,15 m**, normalna z terenu. Na łuku wierzchołki idą po dwusiecznej, żeby wstęga nie zwężała się w zakręcie.
- Budżet: 60 000 trójkątów na stanowisko; przekroczenie rzuca po nazwie stanowiska, jak każdy inny budżet.
- Droga **nie jest maską na terenie**: 16 m texela nie oddałoby ulicy (spec §7). To jest powód, dla którego wstęga w ogóle istnieje, i warto go zostawić w komentarzu, bo wygląda na redundancję wobec malarza ziemi.
- Geometria jest w **układzie świata stanowiska**, a instancja przesuwa ją do układu sceny — jak wszystko inne w M3b.

- [x] **Step 1: Test, który nie przechodzi** (to jest czysta geometria, więc idzie w Node): odcinek prosty o długości 100 m i szerokości 6 m ma tyle wierzchołków, ile mówi próbkowanie; każdy wierzchołek leży 0,15 m nad tym, co zwraca atrapa `heightAt`; wstęga na zakręcie 90° nie ma szerokości mniejszej niż zadana w żadnej próbce; przekroczenie budżetu rzuca.
- [x] **Step 2: Implementacja i commit.**

---

### Task 7: `StructureKit` — pieczenie rodzajów budynków

**Files:** Create `src/engine/scenery/StructureKit.ts`; Create `library/structures/{cottage,barn,mill}.js`; Gate: typecheck, build, test przeglądarkowy

**Interfaces:**

- `bakeStructure(spec, floors, kit)` → `{ geometry, top, radius }`: ściany jako pudełko `footprint × (floors · floorHeight)`, dach `gable | hip | flat` o `roofPitch`, opcjonalny komin, pasy okien jako kolor wierzchołków **plus atrybut `glow`** na tych samych wierzchołkach. `validateBaked` na wyniku — budżet 6000 trójkątów. Kolor okna jest w kopercie jak każdy inny, więc świeci ciepło, a nie neonowo.
- Jedna wypieczona geometria **na rodzaj i na liczbę kondygnacji** (spec §8): przy wsi to trzy rodzaje × dwie kondygnacje = sześć geometrii.
- `top` i `radius` z pudełka otaczającego, nigdy z danych wpisu — ta sama reguła, co przy drzewach, i z tego samego powodu: rekordy przeszkód budują się z tych liczb.
- Trzy rodzaje wsi: `cottage` (mały, dwuspadowy, komin), `barn` (dłuższy, niższy, bez okien), `mill` (wąski, wysoki, czterospadowy — kandydat na dominantę). Każdy z paletą z próbek.

- [x] **Step 1: Implementacja**, sprawdzenie liczby trójkątów wszystkich sześciu geometrii skryptem jednorazowym w piaskownicy (jak przy zestawie drzewa), **skasowanym po odczytaniu**.
- [x] **Step 2: Commit.**

---

### Task 8: Pule budynków i dróg, i stawianie planu

**Files:** Modify `src/engine/scenery/Pools.ts`, `src/engine/scenery/Ring.ts`

**Interfaces:**

- `createPools` piecze budynki i zakłada pulę na (rodzaj, kondygnacje) o pojemności `BUDGET.propInstances`; materiał ten sam, co propsy (kolor z geometrii, odcień per instancja), `positionNode = grown(positionLocal)`, więc budynek na krawędzi pierścienia kurczy się w ziemię jak drzewo.
- **Światło w oknach**: pula pisze atrybut instancji `lit` obok `base` — ta sama maszyneria, jedna liczba więcej — z hasha parceli, żeby część domów była ciemna. Materiał budynku dostaje `emissiveNode = attribute('color') · attribute('glow') · attribute('lit') · uNight`. Nic nie pulsuje i nic się nie zapala z opóźnieniem: świeci to, co ma świecić, wtedy, kiedy `uNight` rośnie.
- Drogi: jedna siatka **nieinstancjonowana** na stanowisko, budowana raz przy pierwszym wejściu planu w pierścień i trzymana z planem; usuwana ze sceny, gdy plan wypada z pamięci podręcznej. Nie ma sensu instancjonować czegoś, czego jest jedno.
- Pierścień, po przejściu przez propsy i biomy, stawia **parcele planów**, których stanowiska leżą w jego zasięgu: `sink.structure(...)` obok `sink.tree` i `sink.prop`. Limit trzech drzew na komórkę nie dotyczy budynków — parcela jest z planu, nie z rozrzutu.
- Każdy budynek zostawia rekord przeszkody z `top` i `radius` swojej wypieczonej geometrii.

- [x] **Step 1: Implementacja**, rozszerzenie testu pierścienia o parcele (stanowisko z atrapy planu → instancje i przeszkody), **Step 2: commit.**

---

### Task 9: Spięcie — stanowiska w agregacie, kolejka na klatkę

**Files:** Modify `src/engine/scenery/Scenery.ts`, `src/engine/World.ts`, `src/page/Debug.ts`, `src/main.ts`

**Interfaces:**

- `createScenery` zakłada `createSites(...)` i woła `sites.work(4)` **raz na klatkę, przed** `ring.update` — plan gotowy w tej klatce jest do postawienia w tej samej przebudowie.
- `SceneryStats` zyskuje `sites`, `sitesQueued`, `sitesMs`, `buildings`.
- `WorldDebug` zyskuje `siteNear(x, z)`: najbliższe stanowisko z jego promieniem i liczbą parcel, albo `null`. To jest oczko, przez które test przeglądarkowy znajduje wieś, nie czytając pikseli.
- Zasłona: pieczenie budynków dokłada się do etapu `scenery`; jeśli przekroczy on 3 s w kontenerze, **zmierz i zapisz**, zanim cokolwiek z tym zrobisz.

- [x] **Step 1: Implementacja, Step 2: `npm run check` do pliku, commit.**

---

### Task 10: Testy przeglądarkowe

**Files:** Modify `tests/e2e/smoke.spec.ts`

- [ ] **Step 1: Testy** (wszystkie na pauzie, z twardo wpisanym miejscem ziarna 42 — szukanie wsi w locie kosztuje wypełnienie okna na próbę):

1. **Wieś stoi**: w miejscu, gdzie `siteNear` zwraca stanowisko, `scenery.buildings > 20`, a przeszkody rosną o tyle samo.
2. **Ziemia pod nią jest płaska**: `heightAt` w środku i w ośmiu punktach o 80 m różni się mniej niż o kilka metrów — to jest test na to, że płaskowyż i krata trafiają w ten sam środek.
3. **Las jej nie zarasta**: liczba drzew w promieniu osady jest zerowa albo bliska zeru, a tuż poza nim wraca do normalnej.
4. **Lot jej nie przecina**: minuta lotu nad wsią trzyma `state.y - floorAt >= MIN_CLEARANCE - 0.5`, jak nad lasem.
5. **Kolejka nie zacina klatki**: `scenery.sitesMs` nie przekracza 8 ms w żadnej próbce (budżet 4 ms plus tolerancja na wolny rasteryzator).
6. **Brak błędów konsoli** — dowód, że materiały dróg i budynków się skompilowały.

- [ ] **Step 2: Uruchomienie** (`npx playwright test`, a w tym kontenerze z `--config pw.local.config.ts`, bo przypięty Playwright chce przeglądarki, której obraz nie ma) **i commit.**

---

### Task 11: Dokumentacja i poprawki specyfikacji

**Files:** `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/perf-notes.md`, spec

- [x] **Step 1: `AGENTS.md`** — sekcja „Settlements", nie więcej niż cztery zdania: jedna krata dla obecności, płaskowyża i stanowiska; plan jest danymi i czystą funkcją, geometrię robią pule; plan buduje się w kolejce z budżetem i żyje w pamięci podręcznej szerszej niż pierścień; `cell.occupied` czyta rezerwacje i dlatego las nie rośnie na rynku.
- [x] **Step 2: `CONTRIBUTING.md`** — „Adding a structure" i „Adding a settlement": czym jest przepis budynku, czym plan osady, dlaczego plan nie tworzy geometrii, i gdzie przebiega granica między osadą (co gdzie stoi) a budynkiem (jak wygląda).
- [x] **Step 3: spec** — poprawki z datą: `LatticeHit` zyskuje `h`; `SiteKit.line` istnieje w kontrakcie od M4a, działa od M4b; każda różnica planu wsi wobec §8, jeśli wykonanie jakąś wymusi.
- [x] **Step 4: `perf-notes.md`** — koszt budowy planu wsi, koszt pieczenia budynków, koszt wstęg dróg, i wpływ osady na przebudowę pierścienia. **Mierz, nie szacuj.**

---

## Co bierze M4b

Miasteczko (krata 20 km, `odds` 0,6, promień 400..900 m, siatka z jitterem, obwodnica, plac, dominanta do 60 m, kondygnacje malejące od centrum, przedmieścia rzednące, 500..2000 budynków), propsy wzdłuż dróg (latarnie, drzewa przyuliczne), **płoty, murki i żywopłoty jako `kit.line`** — wstęgi wzdłuż łamanej, ten sam mechanizm co droga, i odpowiedź na pytanie właściciela z 15 września — sady wsi, oraz paleta osady jako parametr.

Dwie rzeczy, które M4b odziedziczy jako ryzyko i lepiej je wypisać teraz niż odkryć potem:

1. **2000 budynków to nie 150.** Pojemność puli (`BUDGET.propInstances` = 2000) wystarcza na jedno miasteczko i na nic więcej. Albo miasteczko dostanie własny sufit, albo pierścień będzie musiał przycinać parcele po odległości — decyzja do podjęcia z pomiarem, nie z góry.
2. **Plan miasteczka jest o rząd wielkości droższy** niż plan wsi, a budżet kolejki to nadal 4 ms na klatkę. Albo plan buduje się w kawałkach (dzielnicami), albo miasteczko pojawia się sekundę po wejściu w zasięg. To pierwsze jest prawdziwą pracą; to drugie jest uczciwe i wystarczy, jeśli pomiar to potwierdzi.

---

## Samoprzegląd planu

- **Pokrycie spec §8**: obecność z kraty i płaskowyż (Task 2), grunt i szansa (Task 3), plan jako czysta funkcja z drogami, parcelami i rezerwacjami (Task 4), `RoadKit` (Task 6), `StructureKit` i pule na rodzaj × kondygnacje (Task 7, 8), przeszkody z budynków (Task 8), kolejka z budżetem i pamięć podręczna szersza niż pierścień (Task 3, 9), `Overrides` pytane przed budową (Task 3). Z §7: rezerwacje, które widzi `cell.occupied` (Task 5).
- **Świadomie odłożone**: miasteczko i wszystko z „Co bierze M4b"; malowane pola, mosty, rzeki, wnętrza (spec §8 wymienia je jako pominięte w pierwszej wersji); `kit.line` istnieje w typach i rzuca.
- **Zgodność nazw**: `SITE_CELL`/`SITE_ODDS`; `Sites` (`near`/`planFor`/`work`/`built`/`queued`), `Site`, `SitePlan`, `RoadSpec`, `LotSpec`, `Reservation`; `lattice` (obecność) i `plateau` (wysokość); `settlement(params)`, `planVillage`; `buildRoads`, `bakeStructure`; `StructureSpec`/`StructureKit`; `SceneryStats.sites`/`sitesQueued`/`sitesMs`/`buildings`; `WorldDebug.siteNear`.
- **Ryzyka wykonania**, w kolejności prawdopodobieństwa:
  1. **Krata rozjeżdża się między obecnością, płaskowyżem a stanowiskiem.** Trzy czytelniki, jeden hash. Objaw — wieś na zboczu obok płaskiego placu — wygląda jak błąd terenu i nie ma nic wspólnego z terenem. Test z Taska 2 istnieje wyłącznie po to.
  2. **`MAX_HEIGHT_DELTA` przycina płaskowyż.** Osada na zboczu, które trzeba ściąć o więcej niż 300 m, dostanie pochyły plac i nikt nie zobaczy dlaczego. Albo `fits` odrzuca takie miejsca (tanio, i tak ich nie chcemy), albo przycięcie przestaje obowiązywać osady (drogo i niebezpiecznie). Plan wybiera pierwsze: `maxSlope` w `fits` ma być dobrane tak, żeby płaskowyż nigdy nie sięgał budżetu.
  3. **Kolejka zacina klatkę.** 4 ms to budżet, nie obietnica: plan wsi może okazać się droższy. Mierz `sitesMs` od pierwszego dnia i tnij plan na kawałki, zanim zaczniesz obwiniać kolejkę.
  4. **Rezerwacje kosztują w każdej komórce pierścienia.** `occupied` woła się raz na drzewo, czyli do trzech razy na komórkę, 1681 razy na przebudowę. Siatka haszująca, nie pętla po planach.
  5. **Okna świecą, ale nie oświetlają.** Silnik ma jeden model światła, jedno światło kierunkowe i jedną mgłę (spec §5.7): rozświetlone okno jest jasnym pikselem, a nie źródłem, więc nie rzuci plamy na ulicę ani nie podświetli ściany obok. Z powietrza, skąd się na tę wieś patrzy, to jest dokładnie to, co trzeba — rozsypane ciepłe punkty. Z bliska to jest świecący pas, nie szyba. Prawdziwe światła punktowe są poza tym silnikiem; tanie udawanie (malowana plama pod oknem) należy do M5, razem z resztą dopieszczenia.
  6. **Drogi jako geometria, nie instancje.** Jedna siatka na stanowisko żyje tak długo, jak plan; łatwo ją przeciec przy wypadaniu z pamięci podręcznej. Test na wyciek jest w Tasku 3 i ma objąć też siatki dróg.

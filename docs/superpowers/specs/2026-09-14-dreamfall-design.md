# Dreamfall: projekt aplikacji

Data: 2026-09-14. Status: projekt zatwierdzony w rozmowie, do przeglądu w pliku.
Nazwa `dreamfall` jest robocza (lot ze snu, poza swobodnego spadania).

## 1. Cel

Strona przeglądarkowa do zostawienia otwartej obok pracy: człowiek w pozie
swobodnego spadania leci sam nad nieskończonym, proceduralnym światem
generowanym z ziarna. Dużo pustej przestrzeni, rzadkie gęstsze miejsca
(wioski, miasteczka), dzień trwający minuty, noc z gwiazdami. Wzorem jest
`D:\repos\jsapps\fly-with-me` (Kun Chen, MIT): przenosimy jego architekturę
i to, co ma już dobrze rozwiązane, ale budujemy nowy projekt, bo dwie rzeczy
muszą być inne od podstaw: postać zamiast ptaka i biblioteka biomów, w której
biom jest modułem z funkcjami, a nie rekordem danych.

Raport z rekonesansu fly-with-me: artefakt „Rekonesans Fly With Me”
(https://claude.ai/code/artifact/4b911f7a-5503-4482-91e9-1ee13ac762e0).

## 2. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Co fizycznie robi postać | Lot ze snu: poza spadochroniarza, stała prędkość, brak grawitacji, lot bez końca. Wysokością steruje autopilot; sterowanie w pionie jest opcją od pierwszego dnia, w granicach `minClearance`, `minAltitude`, `maxAltitude`. |
| Co biom może definiować | Wszystko poza tym, co rozbija spójność świata: obecność jako funkcja, lokalny kształt terenu, własny kod koloru ziemi (TSL) wewnątrz jednego materiału, rozmieszczanie, stanowiska, tło dźwiękowe. Oświetlenie, mgła, cienie, post-process i normalizacja wag zostają w silniku. |
| Kto wrzuca biomy | Na razie tylko autor, statycznie (plik plus linia w rejestrze). Kontrakt jest projektowany pod przyszły edytor parametrów i podmianę biomów w działającej aplikacji. |
| Widok FPP | Zamiana kamery: kamera w oku postaci, ograniczone rozglądanie wracające do kursu, co najwyżej przedramiona na skraju kadru. Jeden kontroler lotu dla obu widoków. |
| Model postaci | Proceduralny z brył teraz, przez interfejs `Avatar`, który pozwala później podstawić model szkieletowy. |
| Osady | Jeden generator osad; wioska i miasteczko to dwa zestawy jego parametrów. |
| Stack | Vite, TypeScript w silniku, JavaScript z JSDoc w `library/`, Vitest, Playwright, Three.js z npm przypięty do jednej wersji, CI/CD na GitHub Actions z publikacją na GitHub Pages. |
| Podejście | Nowy projekt w `D:\repos\jsapps\dreamfall` z przenoszeniem modułów z fly-with-me; nie fork. |

Założenia niepotwierdzone wprost, przyjęte jako domyślne: desktop jest głównym
celem, WebGPU z fallbackiem na WebGL2, hosting statyczny, telefon ma działać,
ale nie jest strojony. Domyślnie postać leci sama, użytkownik tylko przejmuje
stery.

## 3. Zasady

Przeniesione z fly-with-me bez zmian:

1. Okno wysokości na CPU jest jedyną prawdą o terenie; GPU tylko je czyta.
   Wysokość interpoluje się barycentrycznie po tym samym trójkącie, który jest
   rysowany.
2. Jeden kolor horyzontu (`horizonTint`) dla nieba, mgły, wody i chmur.
3. Czas shaderów to czas symulacji: pauza zatrzymuje fale i chmury, testy
   krokują świat deterministycznie.
4. Stałe alokacje: instancing całych obiektów, pule o stałej pojemności,
   lokalne okna; geometria świata nigdy nie rośnie z czasem.
5. Zasłona schodzi dopiero po zakończeniu pracy GPU pierwszej klatki; za bramą
   Begin nie ma pętli renderowania; pauza i ukrycie karty zatrzymują wszystko;
   `dispose` zwalnia wszystko.
6. Koszt jest mierzony, nie zgadywany: benchmark w trzymanych punktach
   widokowych i porównanie gotowych pikseli przed i po zmianie.

Nowe:

7. Żadnych singletonów na poziomie modułu. Cały stan wisi na obiekcie
   `World`, który potrafi przebudować lub zwolnić każdy podsystem osobno.
8. `Simulation` (czysty CPU) jest oddzielona od `Presentation` (Three.js) i nie
   importuje renderera, więc lot, streaming i generator osad testują się w
   Node.
9. Biom to parametry (JSON) plus haki. Parametry są edytowalne w locie; haki
   czytają je przez uniformy w shaderze i przez obiekt w kodzie CPU.
10. Współrzędne świata żyją w `Simulation` w podwójnej precyzji; prezentacja
    dostaje współrzędne względem ruchomego początku układu (18.2).
11. Teren stoi za wąskim interfejsem; nikt poza `terrain/` nie zna jego
    reprezentacji (18.1).

## 4. Architektura i struktura modułów

```
dreamfall/
  index.html
  src/
    main.ts                     start: strona -> Engine -> World
    engine/
      Engine.ts                 renderer WebGPU/WebGL2, budżet pikseli, post-chain, pętla klatek, dispose
      World.ts                  właściciel ziarna, biblioteki i podsystemów; rebuild(biomeId), setLibrary(), dispose()
      sim/Simulation.ts         agregat CPU: sampler, okno, streaming, lot, zegar, pamięć; step(dt)
      time/DayClock.ts          dayPhase, solar(), klucze palety -> wartości uniformów
      terrain/noise.ts          port 1:1 z fly-with-me
      terrain/WorldSampler.ts   pola bazowe + obecność biomów + modyfikatory wysokości
      terrain/Heightfield.ts    okno toroidalne, heightAt, slopeAt, weightsAt, tekstury dla GPU
      terrain/TerrainMesh.ts    siatka + materiał składany z haków ground biomów + warstwy świata (piasek, śnieg)
      sky/SkyDome.ts, Fog.ts, Lights.ts, Clouds.ts, CloudSea.ts, Plumes.ts, MilkyWay.ts, GalaxyMatter.ts
      water/Water.ts            port
      render/SoftLighting.ts    model oświetlenia i litMaterial (port)
      render/Post.ts            pass 4xMSAA -> bloom -> ACES -> miękka rekonstrukcja -> FXAA (port)
      render/ColorGrade.ts      port
      scenery/Streaming.ts      pierścień komórek, kolejka stanowisk, pule, rejestr przeszkód
      scenery/Obstacles.ts      rekordy {x, z, ground, top, radius} i zapytania
      scenery/pools/InstancePool.ts
      scenery/kits/TreeKit.ts, PropKit.ts, MasonryKit.ts, StructureKit.ts, RoadKit.ts
      avatar/Avatar.ts          interfejs
      avatar/ProceduralHuman.ts pierwsza implementacja
      avatar/Outfits.ts         przebarwianie ról i wzory (port idei plumage)
      flight/FlightController.ts, Steering.ts, ChaseCamera.ts
      audio/Ambience.ts         synteza Web Audio + warstwy dla haków biomów
      page/Gate.ts, Memory.ts, Hud.ts, Failure.ts, Wardrobe.ts
    library/                    JavaScript z JSDoc, typy z contract.ts przez checkJs
      contract.ts               typy, koperta, budżety, walidatory (jedyny plik TS w library/)
      standard/                 standardowe haki dla biomów z danych
      biomes/  species/  props/  structures/  settlements/  outfits/  patterns/
      index.js                  rejestr
  tools/                        bench, parity, dev-panel (nigdy w bundlu produkcyjnym)
  tests/                        unit (Vitest), e2e (Playwright), references/ (PNG wzorców)
  docs/                         perf-notes.md, superpowers/specs, superpowers/plans
  .github/workflows/            ci.yml, pages.yml
```

Zależności między modułami płyną w jedną stronę: `page` -> `Engine` ->
`World` -> (`sim`, `render`, `scenery`, `avatar`, `flight`); `library/`
importuje wyłącznie `contract.ts` i pomocniki ze `standard/`; `sim/` nie
importuje niczego z `render/` ani z Three.js poza klasami matematycznymi.

## 5. Kontrakt biblioteki v2

### 5.1 Wpis biomu

```ts
export interface Biome {
  kind: 'biome';
  id: string;                 // [a-z][a-z0-9-]*
  name: string;
  params: BiomeParams;        // JSON: kolory, gęstości, wagi, parametry haków
  presence: Presence;         // funkcja albo deskryptor standardowego haka
  height?: HeightHook;        // funkcja albo deskryptor
  ground: GroundHook;         // funkcja TSL albo deskryptor
  populate?: PopulateHook;    // funkcja albo deskryptor
  sites?: SitesSpec;          // stanowiska budowane raz (osady, duże ruiny)
  ambience?: AmbienceSpec;    // warstwy dźwięku i odcień mgły
  snow?: boolean;             // domyślnie true: warstwa śniegu świata
  shore?: boolean;            // domyślnie true: piasek przy poziomie morza
}
```

`defineBiome(spec)` tylko taguje obiekt. Każdy hak może być funkcją (biom z
kodu) albo deskryptorem `{ type, ...params }` rozwiązywanym przez `standard/`
(biom z danych). Biom z danych jest w całości zapisywalny do JSON, co jest
formatem przyszłego edytora.

### 5.2 Haki i ich konteksty

```ts
// CPU, na texel okna (co 16 m) i na zapytanie
export interface Fields {
  x: number; z: number;
  cont: number;                       // kontynentalność 0..1
  temp: number;                       // z ochłodzeniem wysokościowym, 0..1
  baseTemp: number;                   // bez ochłodzenia (linia śniegu)
  moist: number; region: number;      // 0..1
  baseHeight: number;                 // m, przed modyfikatorami
  shore: number;                      // 0..1 bliskość brzegu, z wysokości bazowej
  hash(salt: number): number;         // 0..1, deterministyczny per texel
  noise(scale: number, salt: number, octaves?: number): number;  // fbm -1..1
  lattice(cell: number, salt: number): LatticeHit;  // najbliższe centrum kraty
}
export interface LatticeHit { cx: number; cz: number; d: number; u(k: number): number }

export type Presence = ((f: Fields) => number) | PresenceDescriptor;           // 0..1
export type HeightHook = ((f: Fields, base: number) => number) | HeightDescriptor;  // nowa wysokość w m

// GPU, w shaderze terenu; wszystkie pola to węzły TSL
export interface GroundCtx {
  worldXZ; height; slope; normal; sunDir; weight;
  params: Record<string, Node>;       // uniformy z biome.params
  noise(scale: number, salt: number): Node;
  hash(salt: number): Node;
}
export interface GroundOut { albedo: Node; normalTilt?: Node; emissive?: Node }
export type GroundHook = ((g: GroundCtx) => GroundOut) | GroundDescriptor;

// CPU, na komórkę 96 m w pierścieniu streamingu
export interface Cell {
  size: number; corner: { x: number; z: number }; center: { x: number; z: number };
  weight(biomeId: string): number;    // wagi w środku komórki
  height(x, z): number; slope(x, z): number; land(x, z): boolean;
  roll(): number;                     // własny strumień komórki
  occupied(x, z): boolean;            // parcela lub droga stanowiska
}
export interface SceneryKit {
  tree(speciesId, x, z, opts?: { scale?, yaw?, tint? }): void;
  prop(propId, x, z, opts?: { scale?, yaw?, sink?, tint? }): void;
  structure(kindId, x, z, opts?: { yaw?, floors?, tint? }): void;
  color(swatchOrHex): Color;          // odrzuca kolor poza kopertą
}
export type PopulateHook = ((cell: Cell, kit: SceneryKit) => void) | PopulateDescriptor;

// stanowiska
export interface SitesSpec {
  cell: number;                       // bok kraty, m
  odds: number;                       // 0..1 szansa na komórkę kraty
  radius: [number, number];           // m
  fits(f: Fields): boolean;           // np. ląd > 10 m, łagodny teren
  build(site: Site, kit: SiteKit): void;
}
export interface Site { id: string; x: number; z: number; radius: number; yaw: number; random(): number; fields: Fields }
export interface SiteKit extends SceneryKit {
  road(points: Array<[number, number]>, width: number, opts?: { color? }): void;
  reserve(x, z, radius): void;        // zajmuje teren dla cell.occupied
}

export interface AmbienceSpec {
  layers?: Partial<Record<'crickets' | 'birds' | 'surf' | 'bells' | 'wind-high', number>>;
  fogTint?: SceneryColor; fogTintAmount?: number;   // 0..0.35
}
```

### 5.3 Standardowe haki (`library/standard/`)

- Obecność: `climatePoint({ point: [t, m, r], radius })`, `lattice({ cell, radius, feather, odds, salt, land?, maxSlope?, shoreBonus? })`, `heightBand({ from, to, feather })`, kombinatory `mul([...])`, `max([...])`.
- Wysokość: `plateau({ lattice, radius, feather, strength })`, `terraces({ step, sharpness })`, `offset({ meters })`.
- Ziemia: `layers([{ color, mask: 'base' | 'slope' | 'height' | 'noise' | 'weight', ...params }])` — malarz warstw, każda warstwa mieszana maską.
- Rozmieszczanie: `scatter({ species: {id: w}, density, props: {id: w}, grass })`.

Pomocnik `lattice(cell, salt)` w `Fields` jest jednym źródłem centrów dla
obecności, modyfikatora wysokości i stanowisk, więc plateau, granica biomu i
plan osady wychodzą z tego samego hasha.

### 5.4 Pozostałe wpisy

`defineSpecies` (port kontraktu drzewa: pień, konary, korona `dome | cone |
fan | bare`, paleta liści, odcienie klimatyczne, skala; opcjonalny własny
`bake(kit)`), `defineProp` (port: `bake`, `place`, `budget`, `obstacle`),
`defineStructure` (nowe: przepis budynku dla `StructureKit` lub własny
`bake(kit)`, `floors: [min, max]`, `obstacle` zawsze), `defineOutfit` (pięć
kolorów ról: `suit`, `trim`, `helmet`, `skin`, `boots`, plus `accent`),
`definePattern` (reguła nad wierzchołkiem postaci, pierwszy wzór nie maluje
nic).

### 5.5 Koperta kolorów i budżety

Koperta jak w fly-with-me: saturacja HSL <= 0,62, jasność 0,18..0,93,
mierzone w sRGB; nazwane próbki przechodzą po nazwie; neutralna prawie-biel
jest nośnikiem odcienia.

| Budżet | Wartość startowa |
| --- | --- |
| karty korony drzewa | 200 |
| trójkąty propsa lub budynku | 6 000 |
| instancje jednego rodzaju propsa lub budynku w pierścieniu | 2 000 |
| stanowiska jednego biomu w pierścieniu | 4 |
| trójkąty dróg jednego stanowiska | 60 000 |
| promień stanowiska | <= 900 m |
| trójkąty postaci | 4 000 |
| `MAX_HEIGHT_DELTA` modyfikatora wysokości | 300 m |
| koszt haka `ground` (miękki, mierzony narzędziem) | 1 ms GPU przy 2 MP |
| koszt haka `height` (miękki, mierzony w panelu dev) | 2 µs na texel |

### 5.6 Walidacja

`validateLibrary(registry)` przy starcie: kształt wpisów, identyfikatory,
duplikaty, kolory w kopercie, zakresy parametrów, obecność wymaganych haków,
znane identyfikatory gatunków, propsów i budynków. `validateBaked(entry,
geometry)`: trójkąty i kolory wierzchołków każdej wypieczonej geometrii.
Oba odrzucają po nazwie wpisu i zatrzymują start z komunikatem w konsoli, jak
w oryginale. Koszty shadera i modyfikatora wysokości nie dają się zwalidować
statycznie; mierzy je `tools/bench` i panel dev.

### 5.7 Świadome ograniczenia silnika

- Teren jest heightfieldem: jedna wysokość na punkt, więc brak jaskiń, nawisów,
  naturalnych łuków i tuneli. Mosty są możliwe jako obiekty nad terenem
  (odłożone: wymagają rzek, przeszkód z dołem i pokładu w `RoadKit`).
- Jeden model oświetlenia, jedna mgła, jedne cienie i jeden post-process; biom
  może je odcieniować w dozwolonym zakresie, nie podmienić.
- W jednym punkcie mieszają się najwyżej trzy biomy.
- Koszt shadera ziemi rośnie z liczbą biomów w rejestrze (każdy pod gałęzią
  warunkową). Przy około dziesięciu jest w porządku; przy kilkudziesięciu
  potrzebny byłby podział terenu na kafle z osobnymi materiałami.
- Promień stanowiska w pierwszej wersji do 900 m; plan stanowiska jest
  oddzielony od geometrii (18.2), więc później limitem jest koszt planu, nie
  pierścień streamingu.

## 6. Teren i klimat

### 6.1 Próbkowanie (`WorldSampler`), na texel co 16 m

1. Pola bazowe: port `sampleWorld` z fly-with-me ze wszystkimi stałymi
   (kontynentalność, wzgórza, masyw ridged multifractal z piramidalnymi
   szczytami, szelf, temperatura, wilgotność, region, ochłodzenie z
   wysokością), plus `shore` z wysokości bazowej i `hash`. Ziarno 42 daje ten
   sam teren co oryginał, dopóki żaden biom nie zmieni wysokości; to pozwala
   porównywać port obok oryginału.
2. Obecność: `presence(fields)` każdego biomu, przycięcie do 0..1,
   normalizacja do sumy 1, trzy najwyższe wagi zostają i są renormalizowane.
   Gdy wszystkie są zerem, pierwszy biom rejestru dostaje wagę 1.
3. Wysokość: `h = base + Σ wᵢ · clamp(heightᵢ(fields, base) − base,
   ±MAX_HEIGHT_DELTA)`. Modyfikatory widzą wysokość bazową, nie wynik
   sąsiada, więc kolejność w rejestrze nie ma znaczenia.
4. Zapis: `heightTex` RGBA32F `(h, w0, w1, w2)` i `biomeTex` RGBA8 `(i0, i1,
   i2, spare)`. Bajt zapasowy jest zarezerwowany na wodę stojącą.

### 6.2 Okno wysokości (`Heightfield`)

Port okna toroidalnego: `N = 560` komórek po `16 m` (około 9 km), texel `(ix
mod N, iz mod N)` zawsze trzyma komórkę świata `(ix, iz)`; przyrostowe
dopełnianie kolumn i wierszy przy ruchu (synchroniczne, małe); pełne
wypełnienie po starcie i po skoku, dzielone na porcje z budżetem czasu (4 ms
na klatkę) za zasłoną lub z widoczną klatką postoju. `heightAt`
barycentrycznie po diagonali siatki; `slopeAt` z różnic centralnych;
`weightsAt(x, z)` zwraca trzy sloty w środku komórki.

### 6.3 Shader ziemi (`TerrainMesh`)

Składany raz przy starcie i po każdej podmianie biomu (rekompilacja materiału
jest akceptowalna: od ułamka sekundy do kilku sekund). Pozycja wierzchołka z
`heightTex`, normalna z różnic centralnych, trzy próbki trójkąta w stopniu
fragmentu jak w oryginale (kolor należy do trójkąta). Dla każdego biomu z
rejestru: maska = suma pasujących slotów z trzech wierzchołków; `ground(ctx)`
wywołane pod `If(mask > 0.01)`, wynik ważony maską i akumulowany. Na wierzchu
dwie warstwy świata: piasek przy poziomie morza i śnieg nad globalną linią
śniegu (port reguły himalajskiej z bramkowaniem kosztu), obie wyłączalne
parametrami `shore: false`, `snow: false`. Materiał to `litMaterial` z
modelem oświetlenia, cieniem i mgłą silnika; hak zwraca albedo, opcjonalnie
odchylenie normalnej i emissive.

### 6.4 Woda

Port morza na poziomie 0: osobna siatka 132 komórek po 64 m, jeden
nieprzezroczysty draw, głębia z dokładnego trójkąta terenu, odbicie nieba w
emissive z tej samej palety doby. Jeziora później przez bajt zapasowy.

### 6.5 Niebo i doba

Porty: dwa zegary (doby i słońca), 11 kluczy palety w fazie słonecznej,
uniformy nieba, kopuła rysowana jako ostatnia z nieprzezroczystych,
`fogNode` z mgłą odległościową, lokalnym powietrzem, zakryciem dalekim,
mgłą wysokościową nad pokładem i bielą przejścia; jedno światło kierunkowe
zamieniane słońce/księżyc przy zerowej intensywności, światło hemisferyczne,
mapa cieni 2048² przesuwana w texelach; malowane chmury, kłęby, morze chmur,
pióropusze, Droga Mleczna (M5).

## 7. Streaming scenerii

Dwa poziomy:

- **Komórki 96 m** w pierścieniu 1,9 km, przebudowa przy przekroczeniu
  komórki (port). Dla każdej komórki `populate(cell, kit)` biomów z wagą > 0,05
  w jej środku. Każda komórka i każdy rodzaj wpisu mają własny strumień
  losowy z hasha, więc zmiana jednego wpisu nie przetasowuje innych.
  Standardowy `scatter` odtwarza logikę drzew z oryginału: gęstość z wag,
  gatunek z mieszanki, do 3 drzew na komórkę, linia drzew z linii śniegu.
- **Stanowiska** na kracie biomu (`sites`). Gdy komórka kraty wchodzi w zasięg
  `pierścień + promień`, silnik sprawdza `odds` i `fits`, woła `build(site,
  kit)` raz, trzyma wynik (drogi, rezerwacje, rozmieszczenia) do wyjścia poza
  zasięg. Budowa jest kolejkowana z budżetem 4 ms na klatkę.

Pule: jedna `InstancedMesh` na wypieczoną geometrię o stałej pojemności,
atrybut `base` per instancja, kurczenie w podstawę na krawędzi pierścienia,
morfing koron drzew (port: trzy pule na gatunek, `CROWN_FADE`, `RING_FADE`).
Cień pod drzewami jako arkusz canvas (port, `flipY = false`). Trawa jako
lokalne okno (port).

Przeszkody: `Obstacles` trzyma rekordy `{x, z, ground, top, radius, kind}` z
drzew, propsów z `obstacle`, budynków i stanowisk w siatce haszującej o
komórce 64 m; lot i kamera pytają `floorAt(x, z)` i `aheadAlong(arc)`, które
czytają tylko komórki na trasie.

Stanowiska: `build(site, kit)` produkuje plan (drogi, rezerwacje, lista
rozmieszczeń) trzymany w pamięci podręcznej dla promienia większego niż
pierścień; geometrię instancjonują komórki z planu, tak jak drzewa z
`scatter`. Przed rozmieszczeniem komórka i stanowisko pytają
`Overrides.for(key)`; w pierwszej wersji odpowiedź jest pusta (18.2).

Drogi: `RoadKit` buduje wstęgi z łamanych, próbkuje `heightAt` co 4 m,
unosi o 0,15 m, kolor nawierzchni z parametrów w kopercie, jedna scalona
geometria na stanowisko z budżetem trójkątów. Drogi nie są maską na terenie,
bo 16 m texela nie oddałoby ulicy.

## 8. Generator osad (`library/settlements/`)

Biom z kodu nad standardowymi hakami, jeden moduł `settlement(params)`
zwracający wpis biomu. Parametry:

| Grupa | Parametry |
| --- | --- |
| obecność | `lattice.cell`, `odds`, `radius: [min, max]`, wymóg lądu > 10 m i nachylenia < 0,25 w centrum, `shoreBonus` |
| wysokość | `plateau.strength` 0..1, `feather` 100..200 m |
| drogi | `roads: 'organic' \| 'grid'`, `spacing` 60..80 m, `jitter`, `ringRoad`, `radials`, `plaza` |
| parcele | `lotDepth`, `density(r)` malejąca od centrum, `setback` |
| budynki | wagi rodzajów, `floors(r)` 1..4, `landmark` (rodzaj i wysokość do 60 m), paleta osady |
| dodatki | propsy wzdłuż dróg (latarnie, drzewa), płoty i sady dla wsi |

Dwa zestawy w rejestrze:

- **wioska**: krata 6 km, odds 0,5, promień 120..250 m, drogi organiczne
  (główna droga wzdłuż warstwicy przez centrum, boczne ścieżki), 30..150
  budynków, plateau słabe (0,3), 1..2 kondygnacje, dominanta opcjonalna
  (młyn lub wieża);
- **miasteczko**: krata 20 km, odds 0,6, promień 400..900 m, siatka z
  jitterem, obwodnica, plac z dominantą, 500..2 000 budynków, plateau pełne
  (1,0), kondygnacje 1..4 malejące od centrum, przedmieścia rzednące.

Budynki: `StructureKit` wypieka rodzaje z przepisów (obrys, kondygnacje, dach
dwuspadowy, czterospadowy lub płaski, komin, pasy okien jako kolor
wierzchołków albo malowana na canvasie fasada); jedna pula na rodzaj i liczbę
kondygnacji; parcela wybiera hashem rodzaj, obrót i odcień. Każdy budynek
zostawia rekord przeszkody. Wynik generatora dla stanowiska jest czystą
funkcją `(seed, komórka kraty, params)`, więc testuje się w Node.

Pierwsza wersja świadomie bez: malowanych pól na ziemi, mostów (po rzekach w
M6: przeszkody z `bottom`, `kit.bridge(from, to, width)` z filarami, wykrywanie
wąwozu wzdłuż drogi po `heightAt`), wnętrz.

## 9. Postać

```ts
export interface FlightPose {
  x: number; y: number; z: number; heading: number; bank: number; pitch: number;
  vy: number; speed: number; windPhase: number; gust: number; view: 'tpp' | 'fpp';
}
export interface Avatar {
  object: Object3D;
  update(pose: FlightPose, dt: number): void;
  readonly eye: Vector3;                       // punkt oka w układzie postaci
  readonly bounds: { below: number; radius: number };
  setOutfit(outfit: Outfit, pattern: Pattern): void;
  dispose(): void;
}
```

`ProceduralHuman`: tułów, miednica, głowa z kaskiem i goglami, ramiona i
przedramiona w łuku do tyłu, uda i podudzia zgięte, buty; elipsoidy i walce
w kolorach wierzchołków, budżet 4 000 trójkątów mierzony walidatorem.
Zawiasy w barkach, łokciach, biodrach i kolanach falują od `windPhase` i
wolnego szumu; `bank` obraca ciało, `pitch` je unosi lub opuszcza; w skręcie
ręka po wewnętrznej stronie schodzi niżej; `gust` to krótka seria mocniejszego
falowania (zastępuje machnięcia skrzydeł i napędza dźwięk łopotu). W FPP
ciało jest ukryte poza opcjonalnymi przedramionami (`fppHands`, domyślnie
włączone).

Stroje i wzory: port mechaniki upierzeń i znaczeń. Katalog stroje × wzory,
wzór przypisany regułą, kafelki SVG z tych samych liczb co geometria,
„szafa” za przyciskiem w rogu po Begin, zapamiętana w ustawieniach.

## 10. Lot

Port kontrolera ptaka ze zmianami. Stałe startowe: `SPEED 40 m/s` (do
strojenia pod odczucie postaci), `CLIMB 11`, `DESCENT 16`, `minClearance 25
m` nad ziemią i przeszkodami, `minAltitude` bezwzględne domyślnie brak,
`maxAltitude 1 400 m`.

- Kurs: wolny szum plus przyciągania do wschodu, zachodu, księżyca i jądra
  galaktyki (port `SKY_EVENTS`, `updateSunward`, `updateNightward`);
  sterowanie zwalnia przyciągania.
- Wysokość docelowa = `clamp(cruise, minAltitude, maxAltitude)`, gdzie
  `cruise` to port: `terrainAhead(520)` po łuku skrętu z korytarzem
  `radius + 18`, `climbAhead(2200)`, harmonogram przejść przez pokład (300 s,
  ostatnie 100 s wysoko), niskie przeloty nad łagodnym terenem, szum
  wysokości. Podłoga: `Obstacles.floorAt + minClearance + bounds.below`.
- Sterowanie w pionie: port `aim` i `aimHold` (prawy przycisk i dotyk), w tych
  samych granicach; przyszłe klawisze do wysokości to drugie źródło dla tego
  samego `aim`.
- Pozycja: przechył wyprzedza skręt, pochylenie podąża za wznoszeniem (port).

## 11. Kamera (`ChaseCamera`)

Jeden stan lotu, dwa widoki, przełączane klawiszem `V` i przyciskiem HUD,
zapamiętane w ustawieniach, przełączenie natychmiastowe.

- TPP: port sztywnej orbity bez sprężyny (yaw, pitch, dystans), podnoszenie
  nad ziemię i przeszkody z prześwitem 9 m; dystans domyślnie 10 m w zakresie
  5..30, pitch domyślnie 0,3 w zakresie −0,5..1,2, FOV 55°, look-at 0,4 m nad
  środkiem postaci.
- FPP: kamera w `eye`, orientacja z kursu i pochylenia, przechył tłumiony do
  40 %; rozglądanie z lewego przycisku lub dotyku ±110° w poziomie i ±60° w
  pionie, powrót do kursu w 1,5 s po puszczeniu; FOV 75°, bliska płaszczyzna
  0,1 m; kołysanie głowy z `windPhase` (amplituda 2 cm), wyłączane przez
  `prefers-reduced-motion`.

Sterowanie: lewy przycisk orbita (TPP) lub rozglądanie (FPP); prawy przycisk
i dotyk sterują kursem i pionem; kółko dystans (TPP); strzałki szturchnięcia
kursu i wysokości z zanikaniem; spacja pauza; `V` widok. Konwencje i
współczynniki z fly-with-me (0,004 rad na piksel).

## 12. Strona

Port wzorców jeden do jednego: biała zasłona z tekstem, zdejmowana po fence
GPU i jednej klatce przeglądarki; brama Begin bez pętli za nią; pastylka HUD
przygaszana po 2,8 s bezczynności z linkiem do świata, dźwiękiem i
głośnością, pauzą, przełącznikiem widoku, szafą i nazwą backendu; hook awarii
w HTML przed modułem z ponowieniem na `?webgl=1`; pauza przy ukryciu karty;
pełny `dispose`.

Pamięć w localStorage: `dreamfall-settings` (głośność, wyciszenie, kamera
TPP, widok, strój, wzór) i `dreamfall-resume` (ziarno, poza, czas, pora dnia,
harmonogramy). Pola walidowane funkcją `finite(v, min, max)`; `?seed` zawsze
wygrywa; adres jest przepisywany, żeby niósł ziarno; link do udostępnienia to
origin, ścieżka i ziarno. Parametry adresu: `seed`, `webgl=1`, `profile=1`,
`dev=1` (dynamiczny import panelu Tweakpane).

Dostępność: `inert` przed Begin, etykiety ARIA, cele 44 px, safe-area,
preferencja ograniczonego ruchu startuje w pauzie i wyłącza kołysanie oraz
przejścia.

Otwarcie: port skryptowanego wschodu (bokiem, skręt, wznoszenie przez chmury,
postój, nurkowanie) z własną kartą tytułową, jako kamień M5.

Dźwięk: port syntezy (różowy szum wiatru za wysokością i podmuchami, woda przy
brzegu, dzwonki pentatoniczne z opóźnieniem, łopot kombinezonu przy `gust`)
plus warstwy dla haków `ambience` biomów (świerszcze, ptaki, przybój, dzwony,
wysoki wiatr) mieszane wagami biomów pod postacią.

## 13. Testy, narzędzia, CI

Warstwy:

1. Vitest bez GPU, zawsze w CI: szum, pola bazowe, normalizacja obecności,
   przycinanie modyfikatorów, niezmienniki okna toroidalnego, `heightAt`,
   walidatory, generator osad, kontroler lotu na syntetycznym terenie (nigdy
   poniżej `minClearance`, nigdy powyżej `maxAltitude`, ściana podnosi
   wcześniej, `aim` przycięty), sześć symulowanych minut lotu w `Simulation`,
   ciągłość zegara, pamięć.
2. Playwright w Chromium: w CI na WebGL2 z renderowaniem programowym, małe
   okno, test dymny (zasłona, Begin, brak błędów konsoli, `__world`,
   przełączenie widoków, `dispose` do zera) i testy pikselowe w pięciu
   trzymanych punktach z wzorcami PNG w `tests/references/`; lokalnie ta sama
   macierz na WebGPU i trzech ziarnach.
3. Ręcznie przed wydaniem: benchmark, pełna doba, przejścia przez chmury,
   telefon.

Narzędzia poza bundlem: `tools/bench.ts` (port), `tools/parity.ts` (port, z
zapisem wzorców do plików), panel `?dev=1` (parametry biomów na żywo, skok do
ziarna i punktu, warstwy, statystyki), `window.__world`.

CI/CD: `ci.yml` (PR i push: `npm ci`, `tsc --noEmit` z `checkJs`, ESLint,
Prettier, Vitest, `vite build`, Playwright WebGL2 z artefaktami) i
`pages.yml` (`main`: build i deploy na GitHub Pages, ścieżki względne).
Three.js przypięty; aktualizacja to osobny PR z różnicą parity.

## 14. Dokumentacja w repozytorium

`VISION.md` (człowiek, pustka, rzadkie osady, zostaw otwarte obok pracy),
`AGENTS.md` (reguły silnika; startuje jako lista reguł przeniesionych z
fly-with-me, które nadal obowiązują), `CONTRIBUTING.md` (proza kontraktu v2 i
komendy), `docs/perf-notes.md` (pomiary), `README.md`. Każdy plik ma jedną
rolę, bez powtórzeń.

## 15. Kamienie milowe

Każdy z własnym planem implementacji, kończy się zielonym CI i wdrożoną
wersją.

1. **M0 Szkielet.** Projekt Vite z TypeScriptem, `Engine` z rendererem i
   budżetem pikseli, pusty `World`, zasłona i brama, `ci.yml`, `pages.yml`.
   Wynik: płaska ziemia pod niebem w jednym kolorze, dostępna pod adresem.
2. **M1 Świat.** Porty: szum, pola bazowe, okno wysokości, siatka terenu z
   jednym wbudowanym kolorem ziemi, woda, zegar doby z paletą, kopuła nieba,
   mgła, światła, model oświetlenia, post-process, grade; ruchomy początek
   układu i sampler jako czysta funkcja testowana w Node. Wynik: ziarno 42
   wygląda jak w fly-with-me, kamera leci po prostej ścieżce.
3. **M2 Lot i postać.** Kontroler z `minClearance` i `maxAltitude`, rejestr
   przeszkód z siatką haszującą, kamera TPP i FPP, `ProceduralHuman`,
   sterowanie, pamięć, HUD. Wynik: spokojny lot ze sterowaniem i wznowieniem.
4. **M3 Kontrakt v2 i sceneria.** `contract.ts`, walidatory, standardowe haki,
   złożony shader ziemi z trzema slotami, streaming komórek z pulami i pustą
   warstwą nadpisań, port zestawu drzewa z morfingiem koron i cztery
   gatunki, propsy, cień pod drzewami, trawa; dziesięć biomów oryginału jako
   biomy z danych.
5. **M4 Osady.** Stanowiska z planem oddzielonym od geometrii, `RoadKit`,
   `StructureKit`, generator z parametrami wioski i miasteczka, przeszkody.
   Wynik: pierwsza osada znaleziona w locie.
6. **M5 Dopieszczenie.** Porty Drogi Mlecznej i śniegu, otwarcie z kartą
   tytułową, szafa, haki `ambience`, panel dev, porty `bench` i `parity`,
   przegląd wydajności.
7. **M6 Później.** Edytor biomów, dynamiczne ładowanie biomów z adresu,
   jeziora, pola uprawne.

## 16. Poza zakresem

Pełny lot ręczny jako tryb, spadochron i lądowanie, VR, wielu użytkowników,
tunele i nawisy (niemożliwe na heightfieldzie), wnętrza, telemetria
użytkowników, drugi wygląd na stronie. Mosty i rzeki nie są poza zakresem,
tylko odłożone do M6.

## 17. Ryzyka

- API WebGPU i TSL w Three.js zmienia się między wydaniami; wersja przypięta,
  aktualizacja z różnicą parity.
- Koszt złożonego shadera ziemi rośnie z liczbą biomów; mierzony od M3, kafle
  jako plan awaryjny.
- Precyzja float32 współrzędnych świata: rozwiązana ruchomym początkiem
  układu (18.2); ryzykiem pozostaje pominięcie jakiegoś odczytu pozycji poza
  `World.toLocal`, dlatego test w Node leci 200 km i porównuje wynik z lotem
  od zera.
- Postać proceduralna z bliska jest umowna; interfejs `Avatar` pozwala na
  model szkieletowy bez zmian w silniku.
- WebGPU w CI bez GPU jest niestabilne; testy pikselowe w CI na WebGL2, pełna
  macierz lokalnie.
- Rekompilacja materiału terenu przy podmianie biomu może trwać sekundy; w
  edytorze parametry przez uniformy nie wymagają rekompilacji.

## 18. Granice rozwoju i furtki projektowe

Projekt ma być rozwijany w stronę bardziej złożonego świata, więc poniżej
jest zapisane, co jest twardym sufitem, co trzeba zaprojektować teraz, a co
skaluje się przez dodanie.

### 18.1 Twardy sufit

Jedna wysokość na punkt (x, z). Niemożliwe: jaskinie, nawisy, naturalne łuki,
tunele, wielopoziomowe wnętrza w skale. Możliwe jako obiekty nad terenem:
mosty, estakady, ruiny z wnętrzami, wiszące wyspy, udawane wejścia do jaskiń.
Wyjściem byłby teren wolumetryczny (SDF lub voxele), czyli nowy moduł terenu.
Zobowiązanie: teren stoi za wąskim interfejsem (`groundAt`, `slopeAt`,
`weightsAt`, `Obstacles`) i żaden inny moduł nie zna jego reprezentacji, więc
nawet ta wymiana zostaje w jednym module.

### 18.2 Zobowiązania projektowe od pierwszej wersji

1. **Ruchomy początek układu.** `Simulation` trzyma pozycje w podwójnej
   precyzji (liczby JS), `Presentation` dostaje współrzędne względem
   `worldOrigin`, przesuwanego skokowo, gdy postać oddali się od niego o
   więcej niż 4 km. Wszystkie współrzędne świata przechodzą przez jedno
   miejsce (`World.toLocal`), a szumy w shaderach czytają pozycję lokalną plus
   uniform przesunięcia o ograniczonej wielkości. Wprowadzane w M1.
2. **Plan stanowiska oddzielony od geometrii.** `build(site, kit)` produkuje
   plan (drogi, rezerwacje, listę rozmieszczeń) jako dane trzymane w pamięci
   podręcznej dla promienia większego niż pierścień streamingu; komórki
   instancjonują geometrię z planu. Limit promienia stanowiska (900 m w
   pierwszej wersji) staje się limitem kosztu planu, nie pierścienia, i ta
   sama droga prowadzi do dróg między miastami i dzielnic. Wprowadzane w M4.
3. **Rejestr przeszkód z siatką haszującą** (komórka 64 m), zapytania
   `floorAt` i `aheadAlong` czytają tylko komórki na trasie. Wprowadzane w M2.
4. **Sampler i generatory gotowe na Web Workery.** `WorldSampler`, standardowe
   haki CPU i generator osad są czystymi funkcjami bez DOM, bez renderera i
   bez stanu modułu, więc przeniesienie ich do wątku roboczego z transferem
   buforów jest mechaniczne. Sprawdzane testem w Node od M1.
5. **Warstwa nadpisań.** Komórka i stanowisko pytają `Overrides.for(key)`
   przed rozmieszczeniem; w pierwszej wersji odpowiedź jest zawsze pusta.
   Trwałe zmiany świata (zniszczenia, budowle użytkownika, edytor świata)
   dochodzą później bez ruszania streamingu. Wprowadzane w M3.

### 18.3 Skaluje się przez dodanie

Dalekie góry i osady na horyzoncie (drugie, rzadsze okno wysokości jako
pierścień dalekiego terenu; impostory osad), jeziora na dowolnej wysokości
(bajt zapasowy), pogoda i pory roku (parametry palety i haków), inni ludzie
w tym samym niebie (świat z ziarna jest identyczny u wszystkich, synchronizują
się pozycje), chodzenie po ziemi w FPP (kolizja z heightfieldem; budynki
potrzebują brył kolizyjnych z przepisów).

Najtrudniejsza naturalna cecha to rzeki: płyną w dół aż do morza, czego nie
da się wyliczyć lokalnie z szumu per texel. Potrzebna jest hydrologia na
regionie (drenaż na zgrubnej siatce per kafel około 10 km, deterministyczny
i cachowany jak plan stanowiska). Wykonalne w tej architekturze, większe niż
osady; razem z mostami w M6.

## 19. Stałe startowe

| Stała | Wartość |
| --- | --- |
| `CELL`, `N`, `TERRAIN_CELLS` | 16 m, 560, 528 |
| `WATER_CELLS`, `WATER_CELL` | 132, 64 m |
| `SEA_LEVEL`, `DECK_Y` | 0, 520 m |
| `DAY_SECONDS`, `NIGHT_SHARE` | 600 s, 0,25 |
| `SPEED`, `CLIMB`, `DESCENT` | 40, 11, 16 m/s |
| `minClearance`, `maxAltitude` | 25 m, 1 400 m |
| `TREE_CELL`, `TREE_RADIUS` | 96 m, 1 900 m |
| `CROWN_FADE`, `RING_FADE` | 540..680 m, 1 680..1 850 m |
| `MAX_HEIGHT_DELTA` | 300 m |
| budżet pikseli | 2 000 000, DPR <= 1,5 |
| budżet czasu na klatkę dla wypełniania i stanowisk | 4 ms |
| kamera TPP | dystans 10 (5..30), pitch 0,3, FOV 55° |
| kamera FPP | FOV 75°, rozglądanie ±110°/±60°, powrót 1,5 s, przechył 40 % |
| wioska | krata 6 km, odds 0,5, promień 120..250 m |
| miasteczko | krata 20 km, odds 0,6, promień 400..900 m |

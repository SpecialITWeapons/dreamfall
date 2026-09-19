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
| Co fizycznie robi postać | Lot ze snu: poza spadochroniarza, brak grawitacji, lot bez końca. Prędkość zmienia się z pochyleniem (nurkowanie ją kupuje, wznoszenie wydaje; 2026-09-15, zamiast pierwotnej stałej 40 m/s). Wysokością steruje autopilot; sterowanie w pionie jest opcją od pierwszego dnia, w granicach `minClearance`, `minAltitude`, `maxAltitude`. |
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
// 2026-09-16: `h` i `t` — wysokość bazowa i temperatura centrum komórki,
// próbkowane raz na komórkę kraty i zapamiętane. Bez nich `plateau` musiałby
// w środku wypełniania okna pytać sampler o texel inny niż swój własny;
// komórka kraty ma kilometry boku, więc jedna zapamiętana odpowiedź starcza
// niemal na całe wypełnienie, a hak rozstrzyga całą komórkę bez drugiego
// próbkowania — i rozstrzyga ją tak samo na jej środku, co na jej brzegu.
export interface LatticeHit { cx: number; cz: number; d: number; h: number; t: number; u(k: number): number }

export type Presence = ((f: Fields) => number) | PresenceDescriptor;           // 0..1
export type HeightHook = ((f: Fields, base: number) => number) | HeightDescriptor;  // nowa wysokość w m

// GPU, w shaderze terenu; wszystkie pola to węzły TSL
export interface GroundCtx {
  worldXZ; height; slope; normal; sunDir; weight;
  params: Record<string, Node>;       // uniformy z biome.params
  noise(scale: number, salt: number): Node;
  hash(salt: number): Node;
  // 2026-09-15: pomocniki silnika, żeby hak nie importował TSL i dał się
  // przeczytać testem w Node na atrapie kontekstu (tak działa `layers`).
  color(value: SceneryColor): Node;
  mix(a: Node, b: Node, t: Node | number): Node;
  ramp(v: Node, from: number, to: number): Node;
}
export interface GroundOut { albedo: Node; normalTilt?: Node; emissive?: Node }
export type GroundHook = ((g: GroundCtx) => GroundOut) | GroundDescriptor;

// CPU, na komórkę 96 m w pierścieniu streamingu
export interface Cell {
  size: number; corner: { x: number; z: number }; center: { x: number; z: number };
  // 2026-09-16: hak biegnie raz na biom, więc pyta o swój udział przez `share`,
  // a o sąsiadów przez `weight(id)`; `fields` (leniwe) niesie temperaturę pod
  // linię drzew i odcień, `mix` wagi propsów złożone po biomach, `blend` kolor
  // z `params`. Bez tej trójki standardowy `scatter` i porty propsów nie mają
  // z czego liczyć.
  readonly share: number;
  readonly fields: Fields;
  mix(id: string): number;
  blend(param: string): Color;
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
  // 2026-09-16: `odds` tu nie ma. O tym, czy komórka niesie osadę, decyduje hak
  // obecności biomu, a `Sites` sadza osadę, wołając ten hak w środku komórki
  // kraty. Dwie loterie o jednej komórce zgadzają się w połowie przypadków
  // (zmierzone: 625 komórek ziarna 42, zgoda 50 %). `salt` jest tu po to, żeby
  // wskazać tę samą kratę, co hak.
  salt?: number;                      // domyślnie tyle, co w haku (0x5117)
  radius: [number, number];           // m
  // 2026-09-16: wagi rodzajów budynków; walidator sprawdza po nich
  // identyfikatory w rejestrze, tak jak gatunki biomu.
  structures?: Record<string, number>;
  fits(f: Fields): boolean;           // np. ląd > 10 m, łagodny teren
  build(site: Site, kit: SiteKit): void;
}
export interface Site { id: string; x: number; z: number; radius: number; yaw: number; random(): number; fields: Fields }
// 2026-09-16: `height` i `slope` — plan czyta grunt przez kit, nie przez okno
// terenu, i tylko dlatego zostaje czystą funkcją z testem w Node. `line` to
// wstęga, która nie jest drogą (płot, murek, żywopłot): w M4a jest w kontrakcie
// i rzuca, buduje ją M4b.
export interface SiteKit extends SceneryKit {
  height(x, z): number; slope(x, z): number;
  road(points: Array<[number, number]>, width: number, opts?: { color? }): void;
  line(points: Array<[number, number]>, kind: string, opts?: { height? }): void;
  reserve(x, z, radius): void;        // zajmuje teren dla cell.occupied
}

export interface AmbienceSpec {
  layers?: Partial<Record<'crickets' | 'birds' | 'surf' | 'bells' | 'wind-high', number>>;
  fogTint?: SceneryColor; fogTintAmount?: number;   // 0..0.35
}
```

### 5.3 Standardowe haki (`library/standard/`)

- Obecność: `climatePoint({ point: [t, m, r], radius })`, `lattice({ cell, radius, feather, odds, salt, land?, minTemp?, maxSlope?, shoreBonus? })`, `heightBand({ from, to, feather })`, kombinatory `mul([...])`, `max([...])`.
- Wysokość: `plateau({ cell, salt, radius, feather, strength })`, `terraces({ step, sharpness })`, `offset({ meters })`.
  2026-09-16: `plateau` bierze parę (bok kraty, salt), a nie jeden parametr
  `lattice`, jak stało tu wcześniej: dokładnie tę samą parę dostaje hak
  obecności `lattice`, a wspólny domyślny salt `0x5117` jest po to, żeby
  pominięty parametr nie rozjechał obu haków po cichu. Wysokość, do której
  hak ciągnie ziemię, bierze się z `hit.h`.
- Ziemia: `layers([{ color, mask: 'base' | 'slope' | 'height' | 'noise' | 'weight', ...params }])` — malarz warstw, każda warstwa mieszana maską.
- Rozmieszczanie: `scatter({ species: {id: w}, density, props: {id: w}, grass })`.
  2026-09-16: `scatter` stawia **wyłącznie drzewa**. `props` to wagi, które czyta
  `place()` danego propsa przez `cell.mix(id)`, a `grass` to dane okna trawy —
  biom mówi, ile czego chce, props mówi, jak stoi. Biom z hakiem `populate`
  napisanym w kodzie nie ma więc ani propsów, ani trawy: jedno i drugie czyta
  się z deskryptora (`resolvePopulate` zwraca hak **i** deskryptor), a nie woła.

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

2026-09-16: `obstacle` w przepisie budynku jest opcjonalny, nie „zawsze” —
prześwit mierzy wypieczony kształt, a `obstacle` wpisu może prosić o więcej
miejsca, nigdy o mniej.

### 5.5 Koperta kolorów i budżety

Koperta jak w fly-with-me: saturacja HSL <= 0,62, jasność 0,18..0,93,
mierzone w sRGB; nazwane próbki przechodzą po nazwie; neutralna prawie-biel
jest nośnikiem odcienia.

| Budżet | Wartość startowa |
| --- | --- |
| karty korony drzewa (dla `dome`: `limbs.count x crown.cards`) | 200 |
| trójkąty propsa lub budynku | 6 000 |
| instancje jednego rodzaju propsa lub budynku w pierścieniu | 2 000 |
| stanowiska jednego biomu w pierścieniu | 4 |
| trójkąty dróg jednego stanowiska | 60 000 |
| promień stanowiska | <= 900 m |
| trójkąty postaci | zniesiony 2026-09-18 (dziś 1 960) |
| `MAX_HEIGHT_DELTA` modyfikatora wysokości | 300 m |
| koszt haka `ground` (miękki, mierzony narzędziem) | 1 ms GPU przy 2 MP |
| koszt haka `height` (miękki, mierzony w panelu dev) | 2 µs na texel |

> **Poprawka 2026-09-18: sufit postaci zniesiony.** Właściciel kazał go znieść i
> miał rację: 4 000 nigdy nie było w tym repozytorium zmierzone, tylko przepisane
> z tabeli *wartości startowych*. Teren rysuje 557 568 trójkątów na klatkę, a
> postać jest jednym obiektem rysowanym dwa razy — dziś 1 960 trójkątów, czyli
> trzy dziesiąte procenta klatki. Dłonie z palcami i buty z piętą są warte
> więcej niż ta oszczędność. Zostaje podłoga (test żąda > 700), bo profil
> zestrugany do patyka to prawdziwa usterka, a sufit nigdy jej nie łapał.

> **Uzupełnienie 2026-09-18: koszt haka `height` jest mierzalny.**
> `measureHeightHooks` (panel dev, przycisk „measure hooks”) mierzy
> `sampleWindow` — dokładnie tę pracę, którą okno wykonuje na texel — przeciwko
> samplerowi bez rejestru; różnica to koszt obecności i wysokości razem, bo hak
> wysokości nie ruszy, póki obecność nie powie, czyja to ziemia. Udział jednego
> biomu to koszt krańcowy: mierzony przez wyjęcie go z rejestru, bo na jednym
> texelu głos mają trzy z dziesięciu.

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
   i2, baseTemp)`. Czwarty bajt to temperatura klimatyczna, na której rysowana
   jest linia śniegu (`packBaseTemp`/`unpackBaseTemp`, zakres dwóch stopni).
   Był zarezerwowany na wodę stojącą; ta rezerwacja nie mogła zadziałać, bo
   jezioro potrzebuje wysokości lustra, a bajt rozciągnięty na relief tego
   świata to cztery metry na krok.

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
`heightTex`, normalna z różnic centralnych. Dla każdego biomu z rejestru:
maska = suma pasujących slotów **komórki fragmentu**; `ground(ctx)` wywołane
pod `If(mask > 0.01)`, wynik ważony maską i akumulowany.

Zmiana z 2026-09-15 wobec pierwotnego „trzy próbki trójkąta”: w v2 wagi liczy
CPU i są własnością komórki, więc trzy rogi jednego trójkąta niosą te same trzy
wagi — suma z nich byłaby tą samą liczbą za cenę trzech odczytów tekstury.
Sprawdzone w locie nad czterema biomami: krawędzie komórek nie są widoczne, bo
kolory wewnątrz biomu zmieniają się szumem i nachyleniem, nie komórką. Gdyby
kiedyś było widać kwadraty 16 m, wracamy do wersji z trójkątem. Na wierzchu
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
  Trzy poprawki z 2026-09-16, wszystkie z wykonania: (1) limit trzech drzew na
  komórkę należy do **kitu**, bo `populate` biegnie raz na biom i trzy biomy
  postawiłyby dziewięć; (2) przebudowa zachodzi także przy skoku `Origin` —
  instancje są zapisane w układzie lokalnym, więc po skoku wskazują na początek
  układu, którego już nie ma; (3) strumień wpisu haszuje **cały** identyfikator,
  nie jego długość jak w oryginale, bo długość zderza `boulders` z każdym innym
  ośmioznakowym wpisem.
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

Poprawki z 2026-09-16, z wykonania M4a (wieś; miasteczko idzie do M4b):

- **Jedna loteria, jeden środek.** To jest największa poprawka M4a i została
  zmierzona. `Sites.seat` losował własnym ziarnem, na własnej soli, i sadzał
  wieś w losowym punkcie komórki — a hak obecności losował swoim, malował ziemię
  i uruchamiał płaskowyż wokół swojego środka. Na 625 komórkach ziarna 42: 64
  komórki, gdzie obie strony mówiły „wieś", 247, gdzie obie mówiły „nic", 72
  płaskie place wydeptanej gliny bez jednego domu i 242 wsie na gruncie, którego
  nikt dla nich nie spłaszczył. Zgoda 50 % — tyle, co dwie monety. Teraz decyzja
  jest jedna: `seat` woła hak obecności biomu w środku kraty i stawia osadę
  właśnie tam. Po poprawce: 132 komórki niosą wieś, 132 są posadzone, odstęp
  między siedziskiem a środkiem 0,00 m. Dlatego `SitesSpec` nie ma własnych
  `odds` ani własnej linii lądu — trzyma je hak, i nie mają jak się rozjechać.
- **Krata a okno wysokości.** Sadzanie czyta sampler, który odpowiada wszędzie,
  więc okno nie decyduje już o tym, które komórki istnieją. Czyta je dopiero
  **plan**: dalej niż okno `heightAt` zawija się po torusie i odpowiada drugą
  stroną świata, więc stanowisko, o które okno nie umie zapytać, czeka w
  kolejce na swoją kolej zamiast położyć ulicę po drugiej stronie świata.
- **Drogi wsi.** Nie ma przełącznika `roads: 'organic' | 'grid'`: kształt ulic
  jest kodem planu (`settlements/plan.js`), a parametry niosą `spacing`, `width`
  oraz `reach` i `maxSlope` bocznej ścieżki. `jitter`, `ringRoad`, `radials` i
  `plaza` należą do miasteczka i nie powstały.
- **Parcele i kondygnacje.** `lotDepth` to `lots.depth`, a `density(r)` nie jest
  funkcją: parametrem jest jedna liczba, a rzednięcie ku krawędzi `(1 - (r/R)^2)`
  siedzi w planie. Nie ma `floors(r)` — liczbę kondygnacji daje rodzaj (młyn 3)
  i losowanie strumienia stanowiska (2 z szansą 0,3, inaczej 1). Nie ma też
  parametru `landmark`: młyn jest wagą w mieszance (0,05), więc wieś może mieć
  kilka młynów albo żaden. Paleta osady jako parametr czeka na M4b.
- **Co wybiera hash parceli.** Rodzaj i kondygnacje losuje strumień stanowiska
  w ustalonej kolejności (to ona jest powtarzalnością wsi), obrót bierze się
  z ulicy, przy której parcela stoi, a hash samej parceli decyduje wyłącznie
  o `lit` — jak bardzo świecą jej okna po zmroku. Odcienia parcela nie dostaje.
- **Okna.** Pas okien jest **wcinany** w ścianę (pudełko nie ma wierzchołków
  tam, gdzie mają być okna) i niesie atrybut `glow`; w nocy materiał mnoży
  kolor · `glow` · `lit` instancji · `uNight`. Malowanej na canvasie fasady nie
  ma, a przepis bez koloru okna nie ma okien i nie świeci — po tym z góry
  poznaje się stodołę.
- **Jedne liczby na grunt.** Do wymogów z tabeli dochodzi `minTemp` (nikt nie
  stawia wsi na lodowcu), a hak obecności i `fits` czytają te same trzy:
  `land`, `minTemp`, `maxSlope`. Inaczej ziemia byłaby malowana i spłaszczana
  pod wieś, której osadnik nie posadzi. `shoreBonus` jest w haku obecności, ale
  wieś go nie ustawia.
- **Wieś staje w całości albo wcale.** Pierścień nie przycina parcel planu
  odległością. Wstęga drogi powstaje z planu, a nie z zasięgu pierścienia, więc
  przycinanie parcela po parceli pokazywało całą ulicę z ośmioma domami przy
  niej — dokładnie tę pół-wieś, przed którą broni się ten punkt. Plan ma najwyżej
  `SITE_RADIUS` średnicy, więc wystawanie poza pierścień jest ograniczone.
- **Budynki i kondygnacje w pulach.** Pule pieką każdy rodzaj raz na każdą
  liczbę kondygnacji z jego zakresu, nie tylko na jego końce, bo parcela może
  poprosić o dwupiętrowy dom z przepisu `[1, 3]`. `BUDGET.floorSpan` ogranicza
  ten zakres, a plan, który nazwie budynek spoza rejestru albo liczbę pięter
  spoza przepisu, mówi to od razu — w kolejce, nie w pętli klatki.
- **Ile wsi naraz.** `BUDGET.siteInstances` przestał być martwą liczbą:
  walidator liczy kratę przeciw zasięgowi pierścienia (`BUDGET.siteReach`)
  i odrzuca kratę tak gęstą, że przed lotem stanęłyby więcej niż cztery osady.
  To już miasteczko, a miasteczko jest osobnym wpisem.
- **Czystość planu i dodatki.** `build(site, kit)` jest czystą funkcją
  stanowiska, parametrów i tego, co kit odpowie o gruncie (`kit.height`,
  `kit.slope`); grunt wchodzi przez kit właśnie po to, żeby plan liczył się
  w Node bez okna terenu. Propsów wzdłuż dróg, płotów i sadów nie ma —
  `kit.line` rzuca do M4b.

Poprawki z 2026-09-16, z wykonania M4b (miasteczko):

- **Jeden wpis, dwie osady.** `settlement()` miał zaszyte słowo „village" w id,
  nazwie i wywołaniu planu. Bierze teraz parametry i plan; parametry niosą
  własne `id`, `name`, `landmark` i malowanie gruntu. Miasteczko to te same haki
  co wieś, inne liczby i inny plan — `plan-town.js`.
- **Miasteczko nie jest wsią z większymi liczbami**, i to zmierzono, zanim
  powstało: układ wsi to jedna ulica wzdłuż warstwicy z bocznymi ścieżkami, co
  wypełnia wstęgę. Rozciągnięta do promienia 900 m daje **147 parcel**, a nie
  500–2000. Dysk wypełnia tylko siatka, więc miasteczko ma własny generator.
- **`maxSlope` a `maxCut`.** Tabela wyżej żąda nachylenia < 0,25 w centrum,
  a plan M4b zakładał dla miasteczka próg jeszcze ostrzejszy, bo jego plateau
  jest pełne. Pomiar to obalił: na 895 stanowiskach ziarna 42 zaostrzenie
  z 0,45 do 0,06 przesuwa medianę ucieczki gruntu od środka w promieniu 900 m
  ze 167 m na 146 m — czyli o nic — i odrzuca dwa stanowiska na trzy (41 km
  między miasteczkami robi się 78). Na setkach metrów to jest rzeźba terenu,
  nie pochodna w jednym punkcie. Hak `lattice` ma więc dwie osobne liczby:
  `maxSlope` odrzuca komórkę o stromym środku (mierzone przez 125 m),
  a `maxCut` mówi w metrach, jak daleko grunt może uciec, zanim osada zgaśnie.
  Wieś nie podaje `maxCut` i zachowuje się dokładnie jak przedtem.
- **Ile budynków.** Nie `density(r)` i nie sufit: pierwszy przebieg planu zbiera
  wszystkie parcele, jakie oferuje siatka, i sumuje ich wagi `1 - (r/R)²`,
  a drugi przyjmuje taki ich udział, żeby liczba wypadła w `lots.count`. Sufit
  obciąłby miasteczko przestrzennie — ulice chodzi się w kolejności, w jakiej je
  położono, więc sufit buduje miasteczko bez jednego boku.
- **Kondygnacje 1..4 malejące od centrum** — tak, ale liczba jest potem
  **przycinana do zakresu, w którym dany przepis ma wypiek**: prośba o piętro
  bez wypieku rzuca w kolejce. Parametry niosą ten zakres w `storeys`, bo plan
  jest czystą funkcją i nie może zapytać kitu. Chata dostała trzecią
  kondygnację, bo jedyne inne wypieki na trzy piętra to młyn i wieża.
- **Dominanta.** Jest parametrem (`landmark: 'tower'`) i stawia się ją **raz,
  po imieniu**, a nie wagą — waga nie umie powiedzieć „jeden". Stoi na obrzeżu
  placu i obchodzi go, jeśli wylosowany kierunek postawiłby ją na jezdni
  (na 120 miasteczek zdarzało się to jednemu na sześć). Wieża ma 46,2 albo
  57,0 m — **nie 60**, bo lot omija tylko to, o czym wie na 70 m przed sobą.
- **Miasteczko buduje się w całości.** `build` biegnie atomowo, a budżet
  kolejki to 4 ms na klatkę; zmierzony koszt planu to 4,3 / 10,3 / 18,8 ms przy
  400 / 650 / 900 m. Przyjęto jedną długą klatkę raz na 41 km lotu zamiast
  maszynerii, która by ją usunęła. Próg, poniżej którego ta decyzja obowiązuje,
  to 25 ms i jest zapisany w `docs/perf-notes.md`.
- **Dodatki, których M4a nie miało.** `kit.line` istnieje i wieś go używa: sady
  są żywopłotem wokół działki na obrzeżu, a żywopłot nie zajmuje gruntu, więc
  w środku rośnie własny scatter wsi. Propsów wzdłuż dróg nadal nie ma.
- **Promień osady losuje krata, nie parametr.** Haki obecności i plateau
  dostawały `radius[1]` — najszerszą osadę, jaką zakres dopuszcza — więc
  miasteczko wylosowane na 400 m stało w pięciuset metrach wyrównanej,
  pomalowanej pustki. Oba haki biorą teraz parę `[min, max]` i losują szerokość
  ze strumienia `SITE_STREAM.radius`, tego samego, z którego losuje ją
  `Sites.seat`. To jest ta sama zasada co „jedna loteria" z M4a, tylko o jedną
  liczbę dalej.
- **Plateau miasteczka to 0,5, nie 1,0** — i to jest największa poprawka
  wybrana ze zdjęcia. Przy pełnej sile cały dysk o promieniu ośmiuset metrów
  idzie do wysokości środka; miasteczko posadzone na nadmorskim wzgórzu ma ten
  środek dziewięćdziesiąt metrów nad wodą, więc z 1,5 km czyta się jako blada
  mesa z domami na wierzchu — zjawisko geologiczne, nie miejsce. Przy połowie
  grunt wewnątrz rusza się o 5–10 m zamiast 10–24 (zmierzone) i dalej czyta się
  jako grunt, a od tego, żeby ulica była pozioma, jest jej własna reguła
  nachylenia. Specyfikacja mówiła „plateau pełne (1,0)" i to było po prostu
  za dużo.
- **Grunt miasteczka i sady.** Dwie rzeczy wybrane ze zdjęcia, nie z argumentu.
  (1) Malowanie kamień-na-glinie czyta się z 1,5 km jako piasek; miasteczko ma
  teraz grunt **zielony**, a kamień jest tym, co ludzie wydeptali — od kraju
  dookoła ma je odróżniać dach i ulica, a nie kilometrowa zmiana koloru ziemi.
  (2) Sad jako żywopłot obrysowany wokół działki, z założeniem, że scatter go
  wypełni, wychodzi pustą zieloną ramką na glinie. Wieś kładzie żywopłoty
  **wzdłuż dróg**, za ogrodami — płot przy drodze nie potrzebuje niczego
  w środku, żeby się czytać.
- **Czego zdjęcie nie potwierdziło.** Próbowano wygaszać osadę przy linii wody
  (`dry`), żeby plateau nie wynosiło półki nad plażę. Wyszło odwrotnie: zamiast
  złagodzić krawędź, ścisnęło ją w schodkowy mur, i eksperyment został cofnięty.
  Zmierzone potem: najostrzejszy uskok przy krawędzi miasteczka to 5,7 m na 8 m,
  a takie same uskoki są w paśmie 1300–1600 m, czyli **poza** jego zasięgiem.
  Ta ząbkowana krawędź to naturalna linia brzegowa cypla, nie plateau.
- **Osada sieje.** Tego w specyfikacji nie było i okazało się konieczne:
  własna waga osady wypycha biomy kraju z gruntu, który osada zajmuje, więc
  osada bez haka `populate` jest dyskiem malowanej gliny szerokim jak jej
  obecność, z domami pośrodku. Obie osady mają teraz `populate`, a rezerwacje
  parcel załatwiają przerzedzenie w zabudowie za darmo.

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
przedramiona w pozycji pudełkowej (ramiona w bok i do przodu, łokieć zgięty
80°), uda odchylone do tyłu, kolana zgięte 57°, stopy na własnym zawiasie
kostki (bez niego but jest tylko grubszą łydką); w kolorach wierzchołków,
bez sufitu trójkątów (poprawka w §5.5).

> **Poprawka 2026-09-17: skóra na kościach zamiast brył.** Spec mówił
> „elipsoidy i walce”, i przez cztery commity naprawcze to było dwadzieścia
> osobnych brył, które przenikają się na twardych granicach koloru. Szew w
> barku był nie do usunięcia pozą, bo nie był kwestią pozy. Postać jest dziś
> **jedną skórą na szkielecie szesnastu kości** (`Skin.ts` + `SkinnedMesh`),
> nadal proceduralną i z tych samych liczb: 2 rysunki zamiast 20, 1 120
> trójkątów zamiast 3 528, ten sam koszt CPU na klatkę (`docs/perf-notes.md`).
> §2 i §17 przewidywały to wprost — interfejs `Avatar` był po to, żeby
> podmiana nie dotknęła silnika, i nie dotknęła: materiał świata sam dokłada
> `skinning(object)` dla siatki skinowanej.
>
> **Poprawka 2026-09-17 (druga): pięć kształtów zamiast dwóch.** Ten akapit
> opisuje jedną pozę i kąt wznoszenia, który ją odchyla — czyli kształt jako
> **skutek** tego, jak autopilot zdecydował lecieć. Spadochroniarz robi
> odwrotnie: zmienia kształt, **żeby** lecieć inaczej. Postać ma dziś pudełko,
> deltę, track, wznoszenie i zakręt, wybierane z trzech osi (kąt lotu, prędkość
> powietrzna, przechył) zamiast z jednej. Progi wyboru muszą leżeć wewnątrz
> obwiedni kontrolera — `pitch -0,42..+0,56`, `rush 0,75..1,48`, `bank 0,47` —
> i pilnuje tego test, bo pierwszy próg napisany „jak u spadochroniarza"
> wypadał piątą część za najstromszym nurkowaniem tego świata.
Zawiasy w barkach, łokciach, biodrach, kolanach i kostkach falują od `windPhase` i
wolnego szumu; `bank` obraca ciało, `pitch` je unosi lub opuszcza; w skręcie
ręka po wewnętrznej stronie schodzi niżej; kąt wznoszenia odchyla ręce (w
nurkowaniu do tyłu jak w tracku, przy wznoszeniu do przodu i szerzej);
`gust` to krótka seria mocniejszego
falowania (zastępuje machnięcia skrzydeł i napędza dźwięk łopotu). W FPP
ciało jest ukryte poza opcjonalnymi przedramionami (`fppHands`, domyślnie
włączone).

Stroje i wzory: port mechaniki upierzeń i znaczeń. Katalog stroje × wzory,
wzór przypisany regułą, kafelki SVG z tych samych liczb co geometria,
„szafa” za przyciskiem w rogu po Begin, zapamiętana w ustawieniach.

> **Zrobione 2026-09-19.** Sześć strojów i pięć znaczeń w
> `avatar/Outfits.ts`. Znaczenie jest **czystą funkcją miejsca na łańcuchu** —
> `along` i `around`, zapisywane przy każdym wierzchołku przez `Skin.ts`, bo
> wie o nich tylko ten przebieg, który ten wierzchołek postawił — i wolno mu
> przemalować **wyłącznie kombinezon**, wyłącznie na kolor, który ten strój już
> ma. Inaczej katalog prędzej czy później pomaluje gogle. Kafelki SVG w panelu
> rysuje ta sama funkcja, którą chodzi `repaint`, więc kafelek nie umie pokazać
> znaczenia, którego postać by nie nosiła. To, co pokrywa postać, mieści się w
> kopercie palety; gogle, buty i rękawice siedzą pod jej podłogą celowo (wizjer
> ma czytać jako ciemny ze stu metrów) i test trzyma obie połowy. Reguła: wzoru
> nikt nie wybrał → bierze go ziarno (`patternForSeed`), a wybrany jest
> **czyjś** — zapisuje się jako wybór i jedzie do następnego świata, podczas gdy
> niewybrany należy do świata.

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
  samych granicach.
- Prędkość: `speed` jest stanem, `clamp(SPEED − 1,2·vy, 30, 62)` z opóźnieniem
  około sekundy. Zasięg `terrainAhead` i `climbAhead` skaluje się z nią, żeby
  szybszy lot patrzył proporcjonalnie dalej; drążek nadal prosi o prędkość
  wznoszenia, więc końce `aim` zostają przy nominalnym `SPEED`.
- Tryb ręczny (2026-09-15): strzałki wyłączają autopilota (przyciągania puszczają,
  harmonogram pokładu i niskie przeloty stoją), trzymane skręcają i wznoszą,
  puszczone trzymają kurs i wysokość; pion odwrócony jak w drążku samolotu
  (`ArrowDown` podnosi nos). Wraca tylko przyciskiem HUD. To nie jest „pełny
  lot ręczny” z §16: koperta (prześwit, sufit, ucieczka przed ścianą) działa
  w obu trybach.
- Ucieczka: gdy `climbAhead` żąda więcej niż sufit, lot skręca w stronę tańszą
  z dwóch sond (±0,7 rad). To jedyna „krawędź świata”, jaka istnieje — teren
  jest nieskończony, a okno wysokości jedzie z postacią.
- Pozycja: przechył wyprzedza skręt, pochylenie podąża za wznoszeniem (port).

## 11. Kamera (`ChaseCamera`)

Jeden stan lotu, dwa widoki, przełączane klawiszem `V` i przyciskiem HUD,
zapamiętane w ustawieniach, przełączenie natychmiastowe.

- TPP: port sztywnej orbity bez sprężyny (yaw, pitch, dystans), podnoszenie
  nad ziemię i przeszkody z prześwitem 9 m; dystans domyślnie 7 m w zakresie
  3..30 (2026-09-15; przedtem 10 w zakresie 5..30 — z tyłu długość postaci jest
  skrócona perspektywą, więc 5 m to wciąż dziesiąta część kadru), pitch
  domyślnie 0,3 w zakresie −0,5..1,2, FOV 55°, look-at 0,4 m nad
  środkiem postaci.
- FPP: kamera w `eye`, orientacja z kursu i pochylenia, przechył tłumiony do
  40 %; rozglądanie z lewego przycisku lub dotyku ±110° w poziomie i ±60° w
  pionie, powrót do kursu w 1,5 s po puszczeniu; FOV 75°, bliska płaszczyzna
  0,1 m; kołysanie głowy z `windPhase` (amplituda 2 cm), wyłączane przez
  `prefers-reduced-motion`.

Sterowanie: lewy przycisk orbita (TPP) lub rozglądanie (FPP); prawy przycisk
i dotyk sterują kursem i pionem; kółko dystans (TPP); strzałki to tryb ręczny
z §10 (nie szturchnięcia — te zniknęły razem z `nudgeYaw` i `nudgeAlt`);
spacja pauza; `V` widok. Konwencje i
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
`dev=1` (dynamiczny import panelu dev).

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

Narzędzia poza bundlem: `tools/bench/` (**zrobione 2026-09-18**: `npm run
bench`, pięć stanowisk jednego ziarna, piąty percentyl okna klatek, minimum z
rund), `tools/parity/` (**zrobione 2026-09-18**: `npm run parity:write` i `npm
run parity`, te same pięć stanowisk jako zdjęcia), panel `?dev=1` (statystyki,
warstwy, skok do ziarna i punktu, doba, koszt haków), `window.__world`.

> **Poprawka 2026-09-18: panel jest własny i czyta `WorldDebug`.** Tweakpane
> byłoby zależnością w `dependencies` — ładowaną tylko przez stronę, którą
> otwiera wyłącznie ten, kto to buduje. Panel to 280 wierszy DOM-u w
> `src/dev/Panel.ts`, własny chunk za `?dev=1`, i **widok na `WorldDebug`** —
> tę samą powierzchnię, którą czytają testy przeglądarkowe. Dzięki temu panel
> nie pokaże liczby, której nie umie sprawdzić żaden test, a test nie sprawdzi
> liczby, której nikt nie widzi. Uwaga przy edycji: importy wartości z silnika
> trzymać jako `import type`, bo jeden import wartości wyciąga wspólny chunk z
> głównego pakietu i strona płaci drugie żądanie za panel, o który nie prosiła.
>
> **Poprawka 2026-09-18: wzorce parity nie idą do repozytorium.** Spec mówił o
> „wzorcach PNG w `tests/references/`" i testach pikselowych w CI. Wzorzec PNG
> jest zdjęciem jednego rasteryzatora: albo przypinamy repozytorium do tego
> SwiftShadera, którego akurat niesie `ubuntu-latest` — i w dniu, w którym obraz
> się zmienia, wszystkie wzorce są nieaktualne naraz i nikt nie odróżni regresji
> od aktualizacji sterownika — albo do GPU jednego człowieka, co jest gorsze.
> Lokalnie ten sam rasteryzator jest identyczny co do bitu sam ze sobą
> (zmierzone: dwa zdjęcia jednej klatki różnią się o 0), a to jest dokładnie to,
> czego potrzebuje porównanie „przed i po". Więc: wzorce w
> `tools/parity/references/`, poza repozytorium, brane na commicie, z którym
> porównujesz. CI zostaje przy testach, które pytają o liczby, a nie o piksele.
>
> **Parametry biomów na żywo odłożone.** Materiał ziemi jest komponowany raz z
> rejestru, jedna gałąź na biom, i parametry siedzą w nim jako stałe. Na żywo
> znaczy albo rekompilacja materiału przy każdym suwaku (a to sekundy i
> rekompilacja *wszystkiego*, bo program węzłowy jest kluczowany na tone
> mappingu renderera), albo uniform na każdy parametr każdego biomu — czyli
> setki uniformów w gałęziach bramkowanych na setnej części fragmentu. Panel
> zamiast tego mierzy to, co da się zmierzyć, i przełącza warstwy.

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

Język: kod, identyfikatory, komentarze w kodzie, komunikaty commitów i
dokumentacja repozytorium (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`,
`VISION.md`) po angielsku; specyfikacje i plany w `docs/superpowers/` po
polsku. `CLAUDE.md` w korzeniu zapisuje tę zasadę dla agentów.

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
6. **M5 Dopieszczenie** (**kamień zamknięty 2026-09-19**). Porty Drogi Mlecznej (**zrobione 2026-09-17**: pole
   pyłu i światło gwiazd rosną proceduralnie w `sky/GalaxyMatter.ts`, atlas
   piecze się w wątku roboczym, bo to 3,5 s, a `GALAXY_HEADING` jest odczytem z
   pieczenia, nie zgadywanką — było o trzy stopnie obok) i śniegu (**zrobione
   2026-09-17**: warstwa świata nad `snowLineAt`, z nagą skałą alpejską pod
   linią; `baseTemp` jedzie do shadera czwartym bajtem slotów — tym, który był
   zarezerwowany dla stojącej wody i nigdy nie mógł jej obsłużyć, bo jezioro
   potrzebuje wysokości lustra, a bajt na tym reliefie to cztery metry na
   krok), otwarcie z kartą
   tytułową (**zrobione 2026-09-18**: pięć aktów jako czysta funkcja czasu w
   `sim/Opening.ts`, sterujące lotem tymi samymi czasownikami co strzałki, więc
   koperta lotu obowiązuje przez całe otwarcie; świt zmierzony, nie zgadnięty --
   słońce wychodzi zza krawędzi przy fazie 0,126), szafa (**zrobione
   2026-09-19**: sześć strojów, pięć znaczeń, kafelki z tej samej funkcji co
   malowanie postaci — szczegóły przy §9), haki `ambience` (**zrobione 2026-09-18**: pięć warstw
   syntezowanych w `Ambience.ts`, mieszanych wagami trzech slotów okna
   wysokości pod postacią; bramkowanie po słońcu i po wysokości jest decyzją
   silnika, nie bioma -- inaczej każdy biom pisałby te same dwie reguły),
   panel dev (**zrobione 2026-09-18**: `src/dev/Panel.ts` za `?dev=1`, własny
   chunk i widok na `WorldDebug`; statystyki strony, lotu i scenerii, przełączniki
   jedenastu warstw, skok do punktu, do osady i do ziarna, suwak doby i pomiar
   kosztu haków; przełącznik warstwy **tylko zabiera** — silnik co klatkę sam
   decyduje, co widać, więc `layers.apply()` idzie na końcu aktualizacji świata),
   porty `bench` i `parity` (**zrobione 2026-09-18**: oba na Playwrighcie, bo
   mierzą i fotografują klatkę prawdziwej strony, obok siebie na jednym
   zestawie stanowisk w `tools/vantages.ts`; `npm run bench` i `npm run
   parity`, nigdy w CI, bo współdzielony runner mierzy własną pogodę),
   przegląd wydajności (**zrobione 2026-09-19**: pięć stanowisk w
   `docs/perf-notes.md`; noc nad wsią jest o 35 % droższa od południa i robią
   to drzewa z trawą, a pora dnia sama z siebie nie kosztuje nic. Liczby
   bezwzględne są SwiftShadera — udział CPU to 15 + 20 ms na klatkę trwającą
   3,3 s — więc czekają na przebieg na sprzęcie z WebGPU; dwie pułapki po
   drodze, obie w notatkach: klatki nie da się pędzić z ręki, a piąty percentyl
   ze speca wyławiał artefakty próbkowania).
7. **M6 Później.** Edytor biomów, dynamiczne ładowanie biomów z adresu,
   jeziora, pola uprawne.

## 16. Poza zakresem

Pełny lot ręczny jako tryb (rozumiany jako lot poza kopertą: przeciągnięcie,
zwrot o pełnej mocy, lądowanie; tryb ręczny z §10 zostaje w kopercie),
spadochron i lądowanie, VR, wielu użytkowników,
tunele i nawisy (niemożliwe na heightfieldzie), wnętrza, telemetria
użytkowników, drugi wygląd na stronie. Mosty i rzeki nie są poza zakresem,
tylko odłożone do M6.

Obiekty liniowe (płoty przez pole, murki, żywopłoty) nie są propsami rzucanymi
rzadko: to wstęgi wzdłuż łamanej, czyli ten sam mechanizm co droga. Wchodzą
razem z `RoadKit`-em w M4 (2026-09-16, odpowiedź na pytanie właściciela).

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
| `AIRSPEED` (min, max, na m/s wznoszenia) | 30, 62, 1,2 |
| `MANUAL.turn`, `ESCAPE` (margines, sonda) | 0,35 rad/s; 120 m, 0,7 rad |
| `minClearance`, `maxAltitude` | 25 m, 1 400 m |
| `TREE_CELL`, `TREE_RADIUS` | 96 m, 1 900 m |
| `CROWN_FADE`, `RING_FADE` | 540..680 m, 1 680..1 850 m |
| `MAX_HEIGHT_DELTA` | 300 m |
| budżet pikseli | 2 000 000, DPR <= 1,5 |
| budżet czasu na klatkę dla wypełniania i stanowisk | 4 ms |
| kamera TPP | dystans 7 (3..30), pitch 0,3, FOV 55° |
| kamera FPP | FOV 75°, rozglądanie ±110°/±60°, powrót 1,5 s, przechył 40 % |
| wioska | krata 6 km, odds 0,5, promień 120..250 m |
| miasteczko | krata 20 km, odds 0,6, promień 400..900 m |

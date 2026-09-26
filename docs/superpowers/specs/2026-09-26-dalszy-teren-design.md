# Dalszy teren: grube okno za 4,2 km i suwaki, które mówią, czemu milczą

Data: 2026-09-26. Status: kierunek zatwierdzony w rozmowie, do przeglądu w pliku.
Uzupełnia sekcję o terenie w `2026-09-14-dreamfall-design.md`; nie zmienia
zasady, że wysokość z CPU jest jedyną prawdą o terenie.

## 1. Cel

Dwie rzeczy zgłoszone przez właściciela:

1. **Zasięg widzenia.** Po wyłączeniu wszystkich warstw chmur i nieba ląd
   w oddali nadal rozpływa się w kolorze horyzontu. To nie mgła powietrza,
   tylko kurtyna `farCover` w `sky/Fog.ts` (3,6 → 4,2 km od kamery), która
   zakrywa krawędź okna terenu: siatka ma 528 komórek po 16 m, czyli kończy się
   4,2 km od lotnika. Za nią nie ma geometrii. Ląd ma być widoczny do ok. 8 km.
2. **Suwaki `sea` i `fog`** w sekcji „deck & air” panelu dev nic nie zmieniają,
   gdy ich warstwa jest wyłączona albo kamera jest pod poziomem morza chmur.
   To poprawne zachowanie, ale wygląda jak błąd. Suwak ma to powiedzieć.

## 2. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Zasięg | **~8 km**: drugie okno 64 m na komórkę, siatka ±8,2 km. |
| Technika | **Grube okno z płynnym przejściem (A)**. Odrzucone: jedno większe okno 1024 × 16 m (4× trójkątów, ~2 s wypełnienia) i namalowana panorama (góry nie zgadzałyby się z tym, do czego się doleci). |
| Pułap lotu | **Bez zmian** (`MAX_ALTITUDE = 2000`). Podniesienie to osobna zmiana, po obejrzeniu efektu. |
| Suwaki | Wyszarzone z powodem, ale **dalej przesuwalne**, żeby dało się ustawić wartość przed wzniesieniem się. |

## 3. Stan wyjściowy

- `terrain/Heightfield.ts`: toroidalne okno `N = 560` texeli po `CELL = 16` m,
  `update(x, z)` przewija wiersze i kolumny, skok o więcej niż ćwierć okna
  wypełnia całość. Pełne wypełnienie ~530 ms (`sampleWindow`, ~1,9 µs na texel).
- `terrain/TerrainMesh.ts`: `buildGrid(TERRAIN_CELLS = 528, CELL)`, wysokość
  i normalna z tekstury w shaderze wierzchołków, grunt składany z rejestru
  biomów, kotwica przyciągana do 16 m (`World.place`).
- `water/Water.ts`: `buildGrid(WATER_CELLS = 132, WATER_CELL = 64)`, ±4,2 km;
  głębokość z `loadCell` bliskiego okna (`groundAt`, ta sama przekątna).
- `sky/Fog.ts`: `farCover = smoothstep(3600, 4200, distance)`.
- `sky/CloudSea.ts`: `SEA_GRID.reach = 4500`, krycie gaśnie na 3400–4400 m.
- `PerspectiveCamera(…, far = 14 000)`.

## 4. Projekt

### 4.1 Grube okno

Druga instancja tej samej fabryki:
`createHeightfield(sampler, { cell: FAR_CELL = 64, size: FAR_WINDOW = 264 })`,
tworzona w `createWorld`, wypełniana przy starcie i skoku tak jak bliskie okno
i przewijana w `place` tym samym `update(state.x, state.z)`.

- Texel grubego okna w punkcie świata `(64i, 64j)` jest **tym samym wywołaniem**
  `sampleWindow` co texel bliskiego okna `(4i, 4j)`, więc wysokości i wagi
  w punktach wspólnych są identyczne co do bitu.
- Koszt: 264² ≈ 70 tys. texeli, ~130 ms przy starcie i skoku; przewijanie to
  264 texele (~0,5 ms) na każde 64 m lotu.
- **Grube okno służy tylko do rysowania.** Nic na CPU go nie czyta: lot
  (`heightAt`, `terrainAhead`, obwiednia), sceneria, trawa, drogi i dźwięk
  pytają wyłącznie bliskie okno. Ta zasada trafia do `AGENTS.md`.

### 4.2 Wspólna kotwica co 64 m

Obie siatki terenu i siatka wody dostają **jedną kotwicę** przyciąganą do
64 m: `anchorOf(x) = round(x / 64) · 64`.

- Bliska siatka odsuwa się od środka swojego okna (przyciąganego do 16 m)
  najwyżej o 2 komórki; jej zasięg z normalną to 264 + 2 + 1 = 267 komórek
  od środka okna, a okno ma 280. Test to trzyma.
- Krawędź bliskiej siatki leży na `anchor ± 4224 m`, a 4224 = 66 · 64,
  więc **zawsze na liniach grubej siatki**.

### 4.3 Gruba siatka z dziurą

`buildRingGrid(FAR_CELLS = 256, FAR_CELL, HOLE = 66)`: siatka jak `buildGrid`
(ta sama przekątna), bez trójkątów w środkowych 132 × 132 komórkach. Skoro
kotwica jest wspólna, dziura stoi zawsze w tym samym miejscu siatki i jest
wycięta raz, w buforze indeksów: bez `discard` i bez nakładki.

- ±128 · 64 = ±8192 m; (256² − 132²) · 2 ≈ 96 tys. trójkątów.
- Okno 264 texeli mieści siatkę ±128 komórek z normalną (±129).
- `createTerrain` dostaje parametry: okno, rozmiar komórki, liczbę komórek
  i opcjonalną dziurę. Materiał gruntu (gałęzie biomów, śnieg, skała, piasek,
  pędzel) jest **składany z tej samej funkcji**, więc kolor po obu stronach
  szwu jest liczony tak samo. Grubej siatce brakuje tylko `GroundShade`.
- `castShadow = false`; mapa cienia i tak obejmuje tylko okolicę lotnika.
- Przełącznik warstwy `terrain` obejmuje obie siatki.

### 4.4 Szew: przejście w pasie `MORPH`

W ostatnich `MORPH = 320` m przed krawędzią (5 grubych komórek) bliska siatka
w shaderze wierzchołków miesza swoją wysokość z wysokością grubej siatki
w tym samym punkcie (`coarseAt`: interpolacja trójkąta grubej siatki, ta sama
przekątna co `buildGrid`), wagą `smoothstep` rosnącą do 1 na samej krawędzi.
Normalna miesza się tak samo.

- Na krawędzi wierzchołki bliskiej siatki leżą na krawędziach trójkątów
  grubej, które biegną wzdłuż tej linii, a ich wysokość to interpolacja
  grubej: obie powierzchnie są tą samą łamaną. Szczeliny zostają tylko
  na poziomie zaokrągleń float.
- Jeśli na zdjęciu widać jasne punkciki z tych zaokrągleń, gruba siatka
  dostaje fartuch: jeden pierścień komórek w dziurze, opuszczony o kilka
  metrów.
- `heightAt` na CPU **nie** zna przejścia. Pas zaczyna się 3,9 km od lotnika;
  sceneria kończy się na 2,6 km, a nic, co pyta o wysokość, nie sięga dalej.
  Ta rozbieżność jest świadoma i zapisana przy stałej.

### 4.5 Woda

Siatka wody: `WATER_CELLS = 256` komórek po 64 m, ±8192 m jak gruby teren, ~131 tys. trójkątów,
na wspólnej kotwicy. `groundAt` czyta bliskie okno wewnątrz bliskiego kwadratu,
w pasie `MORPH` miesza je z grubym tą samą wagą co teren, a dalej czyta grube.
Linia brzegu leży więc tam, gdzie rysuje ją teren.

### 4.6 Mgła i morze chmur

- `farCover`: z 3600–4200 na **7400–8200 m**.
- Morze chmur ma sięgać tak daleko jak ląd, bo inaczej znad pokładu ląd za
  4,4 km byłby widoczny bez morza nad nim: `SEA_GRID.reach` do 8200 m (więcej
  kroków za `coreReach`, żeby pierścienie siatki nie zgrubiały), wygaszanie
  z 3400–4400 na 7400–8200 m.
- Mgła morza chmur na ziemi, cienie chmur i spód pokładu na kopule są liczone
  na fragment, więc działają na grubej siatce bez zmian.

### 4.7 Moduł CPU `terrain/Lod.ts`

Czysty moduł (bez `three/webgpu`, `three/tsl` i DOM; wpis w liście w
`AGENTS.md`):

- stałe: `FAR_CELL`, `FAR_CELLS`, `FAR_WINDOW`, `HOLE`, `MORPH`;
- `anchorOf(x)`;
- `morphWeight(dx, dz)`: waga przejścia dla punktu względem kotwicy;
- `buildRingIndices(cells, hole)`: indeksy siatki z dziurą (geometrię składa
  `TerrainMesh`);
- `coarseHeightAt(hf, x, z)`: interpolacja grubej siatki na CPU, dla testów.

### 4.8 Suwaki `sea` i `fog`

- `WorldDebug` dostaje `look.seaSeen`: 0..1, ile morza chmur widać spod
  kamery (`SEA_SEEN` wobec poziomu morza w regionie pod kamerą, liczone na
  CPU z `cover.baseAt`), tak jak `seaSeenAt` liczy to w shaderze.
- W panelu suwak `sea` jest wyszarzony z dopiskiem **„deck off”**, gdy warstwa
  `deck` jest wyłączona, a suwak `fog` z dopiskiem **„deck fog off”**, gdy
  wyłączona jest `deck fog`. Obydwa pokazują **„under the sea”**, gdy
  `seaSeen < 0.01`. Pierwszeństwo ma wyłączona warstwa.
- Suwaki zostają przesuwalne. Tekst należy do panelu dev, nie do strony
  gracza, więc reguła o `Hud.ts` go nie dotyczy.

## 5. Testy

Jednostkowe (Vitest, Node):

- grube okno i bliskie dają identyczne texele w punktach wspólnych;
- `buildRingIndices`: liczba trójkątów, żaden trójkąt w dziurze, brzeg dziury
  to dokładnie krawędź bliskiej siatki przy każdej kotwicy;
- `anchorOf` i przewijanie: bliska siatka z normalną nigdy nie wychodzi poza
  bliskie okno, gruba poza grube (seria przelotów w różnych kierunkach);
- `morphWeight` jest 0 wewnątrz, 1 na krawędzi, a wysokość po przejściu na
  krawędzi to `coarseHeightAt`;
- panel: dopiski i wyszarzenie dla wyłączonej warstwy i dla `seaSeen = 0`.

W przeglądarce (Playwright):

- grube okno jest wypełnione, a gruba siatka jest w scenie i rysowana;
- test `dispose` nadal widzi spadek liczników pamięci po zwolnieniu świata;
- zrzut z wysokości przy `air = 0`: piksele między 4,2 a 7 km w kierunku lądu
  nie mają koloru horyzontu.

Pomiary: `npm run bench` przed i po, wyniki w `docs/perf-notes.md`.

## 6. Ryzyka

- **Schodki na granicach biomów.** Wagi w grubym oknie są na komórkę, co 64 m;
  na 4–8 km to kilkanaście pikseli. Do sprawdzenia na zdjęciu. Jeśli widać
  schodki, grunt grubej siatki interpoluje wagi tam, gdzie narożniki trójkąta
  mają te same trzy biomy.
- **Koszt fragmentów.** Gruba siatka używa pełnego materiału gruntu, ale na
  ekranie zajmuje mały pas przy horyzoncie. Bench to rozstrzygnie.
- **Start.** +~130 ms wypełnienia przed pierwszą klatką.

## 7. Poza zakresem

- pułap lotu;
- drzewa, trawa, budynki i drogi dalej niż teraz;
- cienie na grubej siatce;
- chmury-sprite'y dalej niż teraz.

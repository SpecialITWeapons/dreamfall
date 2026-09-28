# Drzewa daleko i w osadach: karty do końca lądu, tryb wysokościowy, drzewa w planach

Data: 2026-09-27. Status: projekt, do przeglądu przez właściciela.
Uzupełnia sekcję o scenerii w `2026-09-14-dreamfall-design.md`,
`2026-09-26-dalszy-teren-design.md` (daleki teren) i
`2026-09-24-osady-w-kraju-i-drogi-design.md` (osady w kraju). Nie zmienia
zasady, że wysokość z CPU jest jedyną prawdą o terenie, ani zasady, że nic na
CPU nie czyta dalekiego okna.

## 1. Cel

Trzy rzeczy zgłoszone przez właściciela:

1. **Drzewa za 2,6 km.** Ląd jest rysowany do 8,2 km, a drzewa kończą się na
   2,6 km, więc dalszy ląd jest łysy. Mgła tego nie ukrywa: przy 8 km zasłania
   ~28 % w południe i ~47 % o świcie. Za 2,6 km drzewa mają się rysować w
   uproszczonej wersji, **do 2,6 km nic się nie zmienia** -- ani wygląd, ani
   poziomy szczegółów.
2. **Tryb wysokościowy.** Wysoko nad ziemią wszystkie drzewa mogą być w
   uproszczonej wersji: mniej trójkątów, bez widocznej różnicy.
3. **Drzewa w osadach.** W wioskach i miastach mają się pojawiać drzewa,
   losowo, **rzadziej niż w okolicy, w zwykłym rozmiarze**.

Wygląd kart jest ustawiany liczbami, które da się stroić; właściciel ocenia go
po zdjęciach z `tools/trees/look.mjs` i dopiero wtedy decyduje o poprawkach.

## 2. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Co do 2,6 km | **Bez zmian.** Odrzucone: tańsze drewno za 680 m (niewidoczne, ale zmienia coś przed granicą). |
| Technika dalekich drzew | **Wariant 1: ten sam rozrzut co pierścień, rysowany kartami.** Odrzucone: drzewa wymyślane w shaderze (druga kopia logiki sadzenia, drzewa podmieniałyby się na 2,6 km) i las namalowany w terenie (na 2,6 km trójwymiarowe drzewa przechodziłyby w dywan). |
| Wątek | **Kolejka na wątku głównym z budżetem**, jak `sites.work`. Worker potrzebowałby własnej biblioteki, a świat przyjmuje wstrzykniętą (`createWorld({ library })`), której funkcji nie da się wysłać. |
| Osady | **A i B razem**: gęściej drzew krainy (A) i pojedyncze drzewa z planu (B). |
| „Mniejsza skala” | **Tylko rzadziej.** Rozmiar drzew w osadach jest zwykły. |

## 3. Stan wyjściowy i pomiary

- `scenery/Ring.ts`: komórki 96 m do `TREE_RADIUS = 2600`, przebudowa całości
  przy przekroczeniu komórki i skoku origin, najwyżej `CELL_TREES = 3` drzewa
  na komórkę, ziarno komórki z `hash2(ix, iz, seed ^ idHash('biome:' + id))`.
- `scenery/Pools.ts`: na gatunek trzy `InstancedMesh` (drewno, korona, korona
  rzadka) po `MAX_TREES = 4000`; korona przechodzi w rzadką na
  `CROWN_FADE = [540, 680]`, wszystko co stoi na ziemi rozpływa się na
  `RING_FADE = [2300, 2560]` (`ringFade`, wspólne dla drzew, rekwizytów, domów).
  **Drewno jest zawsze pełne**: 240–336 trójkątów na drzewo, także na 2,5 km.
- `terrain/Heightfield.ts`: bliskie okno 560 × 16 m (siatka ±4,2 km), jedyna
  prawda o terenie na CPU. Daleko: okno 264 × 64 m (siatka ±8,2 km), czytane
  tylko przez GPU (`surfaceHeight(coarse, FAR_CELL)` w `TerrainMesh.ts`).
  Bliska siatka przechodzi w daleką na ostatnich `MORPH = 320` m
  (`max(|dx|, |dz|)` od kotwicy).
- `sky/Fog.ts`: `farCover = smoothstep(7400, 8200, distance)`.
- `FlightController.MAX_ALTITUDE = 2000` m nad morzem.

Pomiar w Node (seed 42, prawdziwa biblioteka, cztery miejsca: las
(−48 000, −42 000), origin, (20 000, −15 000), (−30 000, 25 000)), pierścień
dzisiejszym kodem przy różnych promieniach:

| promień | drzewa | przebudowa całości |
| --- | --- | --- |
| 2,6 km (dziś) | 1 300 – 2 550 | 3 – 10 ms |
| 4 km | 3 000 – 4 800 | 7 – 14 ms |
| 8,2 km | 17 700 – 18 900 | 35 – 48 ms |

Trójkąty wszystkich drzew w klatce (instancje nie są odcinane pojedynczo, więc
to jest to, co dostaje GPU):

| | las | origin | (20k, −15k) | (−30k, 25k) |
| --- | --- | --- | --- | --- |
| dziś | 912 k | 279 k | 700 k | 775 k |
| dzisiejsze LOD do 8,2 km | 5 911 k | 5 886 k | 4 644 k | 5 310 k |
| dziś + karty 2 trójkąty 2,6–8,2 km | ~945 k | ~313 k | ~731 k | ~807 k |

Karta dokłada **31–34 tys. trójkątów**, ok. 3 % klatki (~1,1 mln). Drzewo o
medianie wysokości ~29 m ma na ekranie (55°, ~1060 px) ~20 px na 1,5 km,
~11 px na 2,6 km, ~7 px na 4 km i ~4 px na 8 km.

Drzewa w osadach dziś (przybliżone zasięgi domów):

| osada | domy | drzewa w środku | gęstość w osadzie / w okolicy |
| --- | --- | --- | --- |
| wioska 0,0 (r 243 m) | 43 | 12 | 65 / 173 na km² |
| wioska −1,0 (r 166 m) | 23 | 0 | 0 / 39 |
| wioska −2,0 (r 206 m) | 27 | 0 | 0 / 0 (kraina bez drzew) |
| miasto −1,−1 (r 824 m) | 1 474 | 206 | 97 / 143 |
| miasto 1,0 (r 799 m) | 1 358 | 46 | 23 / 81 |
| miasto 1,−2 (r 516 m) | 551 | 56 | 67 / 112 |

`clearing = 0,4`, a domy i drogi zjadają część tego udziału: w praktyce
osada ma 0–0,7 gęstości okolicy, a w krainie bez drzew nic.

## 4. Projekt

### 4.1 `scenery/Sowing.ts`: jedno sianie dla pierścienia i dla dali

Z `Ring.ts` wychodzi to, co sieje **drzewa jednej komórki**: kraina pod
środkiem (`weightsAt` + `countryOf`, `clearing`), próg `POPULATE_FLOOR`,
strumień komórki na biom, hook `populate` z jego `Cell` (`height`, `slope`,
`fields`, `occupied`, `share`, `roll`), `climateTint`, losowanie `scale`,
`tall`, `yaw`. Wejście: współrzędne komórki i **grunt** (interfejs
`GroundQuery`: `heightAt`, `slopeAt`, `weightsAt`); wyjście: drzewa do ujścia.
Czysty CPU, bez three poza klasami matematyki.

- Pierścień woła `Sowing` dla każdej komórki i dalej sam robi rekwizyty,
  nadpisania (`Overrides`), przeszkody, plany i drogi. Zachowuje się
  **identycznie jak dziś**: test porównuje drzewa przed i po wydzieleniu na
  kilku miejscach seeda 42.
- Rekwizyty zostają w pierścieniu: za 2,6 km nie ma rekwizytów.
- Komórka z nadpisaniem (`Overrides`) w dali: `skip` jest uszanowany, a
  `placements` sadzą tylko swoje drzewa (bez rekwizytów). Nadpisania są dziś
  narzędziem deweloperskim, więc to wystarczy.

### 4.2 `terrain/SampledGround.ts`: grunt poza oknem

`GroundQuery`, który odpowiada **dokładnie tak jak bliskie okno**, także tam,
gdzie okna nie ma. Punkt siatki 16 m `(ix, iz)` to jedno wywołanie
`sampler.sampleWindow(ix · 16, iz · 16)` -- to samo, którym okno wypełnia swój
texel -- więc wysokość, wagi i sloty zgadzają się co do bitu. Między punktami
ta sama interpolacja po trójkącie (ta sama przekątna co `buildGrid`) i ten sam
spadek co `slopeAt`.

- Wewnątrz bliskiego okna czyta okno (szybka ścieżka), poza nim próbkuje i
  trzyma punkty w pamięci podręcznej kluczowanej współrzędnymi, czyszczonej
  z tego, co wypadło z zasięgu.
- Test: dla losowych punktów wewnątrz okna `SampledGround` z oknem i bez okna
  daje to samo co `Heightfield`.
- **Nie czyta dalekiego okna.** Zasada z `AGENTS.md` zostaje.

### 4.3 `scenery/FarTrees.ts`: pierścień od 2,6 do 8,2 km

Śledzi komórki 96 m, których środek leży w `(TREE_RADIUS, FAR_TREE_RADIUS]`,
`FAR_TREE_RADIUS = 8200`. Czysty CPU, testowany w Node.

- **Wynik komórki zależy tylko od jej współrzędnych** (i od planów -- niżej).
  Nic w sianiu nie czyta, gdzie jest lotnik, więc dolot z dowolnej strony daje
  ten sam las. To ta sama zasada co przy kafelkach trawy.
- Przy przekroczeniu komórki: komórki, które weszły w zasięg, idą do kolejki
  **od najbliższej**; komórki, które wyszły (także te, które weszły w zasięg
  pierścienia), są zapominane. Kolejka jest przerabiana `work(budgetMs)` raz na
  klatkę, **z budżetem sprawdzanym przed komórką**, nie w trakcie
  (`FAR_TREES_BUDGET_MS = 2`).
- Ziemia zajęta: `occupied` pyta ten sam `claims`, który pierścień wypełnia
  przy każdej przebudowie. Plan osady, która przecina granicę 2,6 km, jest w
  nim, więc karty za granicą nie stoją na jej domach i drogach. Kiedy pierścień
  wypełni `claims` nowym planem, komórki dali, które ten plan pokrywa, są
  siane ponownie (jak kafelki trawy pod spóźnionym planem).
- Pierwsze wypełnienie (start, wznowienie) odbywa się **za zasłoną**, w etapie
  `scenery`. Skok origin nie sieje ponownie, tylko przepisuje pozycje kart w
  lokalnym układzie. Skok w przestrzeni świata (narzędzia dev) to nowa kolejka
  od najbliższej komórki.

### 4.4 `scenery/Impostors.ts`: karty

**Zdjęcia przy starcie, za zasłoną.** Dla każdego gatunku biorę jego wypieczoną
geometrię (drewno i **pełna** korona) i renderuję ją kamerą ortograficzną do
małego celu, dwa ujęcia: **z boku** i **z góry**, po 128 × 128 px, dopasowane
do bryły gatunku. Dwa zapisy na ujęcie:

- kolor z przezroczystością, bez światła i bez koloru klimatu,
- kierunek powierzchni (normalna w układzie ujęcia) i **maska liści**.

Zdjęcia robią **dwa własne, proste materiały** (kolor; normalna i maska), nie
materiały sceny: render do własnego celu kompilowałby scenę drugi raz, jak
`capture`. Piksele wracają na CPU, mipmapy są liczone tam **z zachowaniem
pokrycia** (korona na 4 px zasłania tyle co na 30 px, zamiast łysieć) i atlas
18 ujęć idzie na GPU jako tekstura z gotowymi mipmapami. Funkcja mipmap jest
czysta i ma test w Node. Atlas: ~3 MB z mipmapami.

**Karta w locie.** Jedna pula instancji dla wszystkich gatunków,
`MAX_CARDS = 32 000`, po 2 trójkąty. Instancja niesie pozycję, `scale`,
`tall`, ujęcie gatunku, lustro i kolor klimatu, spakowane w wektory tak, by
siatka wiązała najwyżej osiem buforów wierzchołków (test liczy).

- Rozmiar i proporcje z bryły gatunku razy `scale`/`tall` tego drzewa.
- Obraca się wokół pionu do kamery; im bardziej kamera patrzy z góry, tym
  bardziej karta się kładzie, a ujęcie z boku przechodzi w ujęcie z góry.
- Połowa drzew gatunku ma ujęcie odbite w lustrze (bit z losowania drzewa).
- Światło: normalna z atlasu obrócona do świata, ten sam model światła co
  pełne drzewa (`SoftLighting`, `translucency` dla liści). Kolor klimatu tylko
  na liściach (maska). Mgła jak wszędzie. Karta się nie kołysze i nie rzuca
  cienia.
- `alphaToCoverage` (scena ma MSAA): krawędzie i rozpływanie przez pokrycie,
  bez sortowania. Kolejność instancji jest dowolna.
- **Wysokość:** CPU daje `y` z `SampledGround`, czyli z bliskiej powierzchni.
  Shader robi to co bliska siatka terenu:
  `y = mix(yCPU, surfaceHeight(coarse, FAR_CELL)(xz), rim)`, gdzie `rim` to
  przejście bliskiej siatki w daleką (`MORPH`, kwadrat wokół kotwicy). Za
  4,2 km karta stoi więc na dalekiej siatce, którą widać, i idzie za nią, gdy
  dalekie okno się przewija. Dopuszczalna różnica względem narysowanej
  powierzchni: poniżej piksela.
- Na zewnętrznej krawędzi karta rozpływa się w pasie 7 900–8 150 m, żeby
  komórki wchodzące w zasięg nie wyskakiwały (i tak są pod `farCover`).

### 4.5 Pełne drzewo i jego karta: jedno przejście

Ujście pierścienia wysyła każde drzewo **także do puli kart**, więc w puli są
wszystkie drzewa od 0 do 8,2 km: pierścienia (do 2,6 km) i dali (dalej). To
samo drzewo ma więc pełną postać i kartę w jednym miejscu.

- Jedna para liczb `limit = [a, b]` (uniform `uTreeLimit`): pełne drzewo ma
  krycie `1 − smoothstep(a, b, d)`, karta `smoothstep(a, b, d)`, `d` to
  odległość kamery od podstawy drzewa. Przy ziemi `limit = RING_FADE =
  [2300, 2560]`, czyli dokładnie dzisiejsze rozpływanie.
- Drzewa pierścienia w pasie 2,56–2,67 km (komórka o środku w zasięgu) są
  dziś niewidoczne; od teraz są kartami.
- `ringFade` rekwizytów i domów **zostaje stałe**: tryb wysokościowy dotyczy
  tylko drzew.

### 4.6 Tryb wysokościowy

`alt` = wysokość kamery nad terenem pod nią (`heightAt` bliskiego okna).
`t = sstep(TREE_LIMIT.from, TREE_LIMIT.to, alt)`, start `from = 700`,
`to = 1100` m, i `limit = RING_FADE · (1 − t)`. Czysta funkcja w
`scenery/TreeLimit.ts` z testem.

- Przy `t = 1` pełne pule drzew dostają `visible = false` (brak rysowania i
  cieni), a GPU rysuje same karty: ~36 tys. trójkątów zamiast 280–910 tys.
  Warstwy (`layers.apply`) dalej działają na końcu aktualizacji.
- Pierścień dalej sadzi pełne drzewa: lot potrzebuje przeszkód, trawa
  `claims`. Na wysokości to nie jest koszt (przebudowa co 96 m jak dziś).
- `?dev=1`: suwaki `from` i `to`, „print” wypisuje nowe domyślne. Nowa
  warstwa „far trees” (może tylko zabierać).

### 4.7 Osady A: gęściej drzew krainy

`clearing` w `library/settlements/village.js` i `town.js`: 0,4 → 0,6. Cel:
w osadzie **40–70 % gęstości okolicy**; test w Node mierzy to na osadach
seeda 42, które stoją w krainie z drzewami.

### 4.8 Osady B: pojedyncze drzewa z planu

- Plan dostaje `kit.tree(species, x, z, opts?)`, gdzie `species = null`
  znaczy „drzewo krainy”. Dziś to wywołanie rzuca błędem
  (`Sites.ts`, „a site plants through its cells”); od teraz zapisuje drzewo
  w nowej liście planu `plan.trees`. **Plan nadal nie sieje**: nie ma gęstości
  ani pola, tylko pojedyncze drzewa w miejscach, które plan wybrał.
- Gatunek dla `null` wybiera `Sites` przy budowie planu: z gatunków
  `populate` krain wokół osady (sloty i wagi w środku osady, ta sama logika
  `countryOf`), z ich wagami. Każda kraina ma gatunki, także ta prawie bez
  lasu, więc wioska na stepie ma akacje, na wydmach palmy.
- **Osobny strumień losowy**: `hash2(round(x), round(z), seed ^ SALT)` z
  pozycji działki, **nie** `site.random()`. Inaczej każde dodane losowanie
  przesunęłoby domy istniejących osad. Istniejące testy układu wiosek i miast
  mają przejść bez zmian.
- Gdzie: w `plan.js` (wioska) drzewo w ogrodzie za domem, przy
  `gardenTrees = 0,25` działek; w `plan-town.js` (miasto) przy
  `gardenTrees = 0,12` działek, plus 2–4 drzewa na skraju placu. Liczby w
  parametrach osady, do strojenia. Pozycja z geometrii działki, poza obrysem
  domu i poza drogą; test sprawdza to na wszystkich osadach seeda 42
  (odstęp ≥ 1 m od obrysu, ≥ 1 m od krawędzi drogi).
- Rozmiar zwykły: `scale` i `tall` z zakresu gatunku, z tego samego strumienia.
- Silnik stawia je w `raise` razem z domami: przeszkoda dla lotu, pełne pule,
  pula kart. Jeśli pula gatunku jest pełna, liczy to `SceneryStats`
  (`treesRefused`), jak domy.

## 5. Budżety

| co | limit |
| --- | --- |
| trójkąty przy niskim locie, pięć stanowisk benchu | ≤ +5 % |
| trójkąty na wysokości (stanowisko `far`) | mniej niż dziś |
| `FarTrees.work` | ≤ 2 ms na klatkę, sprawdzane przed komórką |
| pula kart | 32 000; odrzucone w `SceneryStats.cardsRefused`, test w przeglądarce żąda zera na stanowiskach benchu |
| bufory wierzchołków siatki kart | ≤ 8 |
| start (do zdjęcia zasłony) | zmierzone i zapisane; zdjęcia gatunków + pierwsze wypełnienie dali |

Pomiar przed i po (`npm run bench`, start przez `window.__world.timings` na
GPU tej maszyny) trafia do `docs/perf-notes.md`.

## 6. Testy

Node (Vitest):

- `Sowing`: pierścień sieje te same drzewa co przed wydzieleniem.
- `SampledGround` zgadza się z `Heightfield` w oknie i poza nim (na punktach
  siatki co do bitu, między nimi ta sama interpolacja).
- `FarTrees`: ten sam las niezależnie od trasy dolotu; na granicy z
  pierścieniem nie ma dziury ani dubla (każda komórka jest albo pierścienia,
  albo dali); budżet przerywa kolejkę przed komórką; plan w `claims` powoduje
  ponowne sianie komórek, które pokrywa.
- `TreeLimit`: przy ziemi `RING_FADE`, od `to` zero, monotonicznie.
- Mipmapy atlasu zachowują pokrycie.
- Osady: drzewa planu poza domami i drogami, domy nie przesunięte, gęstość
  40–70 % okolicy, gatunki z krainy.
- Siatka kart ma ≤ 8 buforów wierzchołków.

Przeglądarka (Playwright, WebGL2):

- za 2,6 km stoją karty (liczba instancji > 0 na stanowisku `far`),
  `cardsRefused = 0`;
- na 1 200 m nad terenem pełne pule drzew są ukryte;
- brak błędów WebGPU/WebGL w konsoli;
- `dispose` zmniejsza liczniki pamięci renderera.

Oglądanie: `tools/trees/look.mjs` robi zdjęcia na 150, 500, 900 i 1 300 m
nad terenem, w stronę lasu i nad miastem, plus zbliżenie pasa 2,3–2,6 km --
do oceny przez właściciela.

## 7. Kolejność

Każdy krok to osobny PR z własnym planem w `docs/superpowers/plans/`:

1. `Sowing.ts` i `SampledGround.ts`. Bez zmian wizualnych; pierścień sieje
   identycznie.
2. `Impostors.ts` i `FarTrees.ts`: karty do 8,2 km, przejście na 2,6 km,
   zdjęcia do oceny, pomiar.
3. Tryb wysokościowy (`TreeLimit`, ukrywanie pełnych pul, suwaki).
4. Drzewa w osadach (A i B).

## 8. Znane ograniczenia

- Plany osad istnieją tylko dla osad w zasięgu pierścienia (plan czyta
  bliskie okno). Drzewa z planu pojawiają się więc razem z domami osady, a za
  2,6 km w osadzie stoją tylko drzewa krainy -- także na miejscach, gdzie po
  zbudowaniu planu stanie dom. Przejście na 2,6 km to ukrywa (drzewo ma tam
  ~11 px); kilka kart w mieście zamieni się miejscami.
- Karta nie ma paralaksy: przy najbliższych kartach w trybie wysokościowym
  (~25 px na 1 100 m) płaskość może być widoczna. Progi `TREE_LIMIT` są do
  ustawienia na oko.

## 9. Zmiany w `AGENTS.md`

- Scenery: drzewa rysowane są do `FAR_TREE_RADIUS` kartami; pełne drzewo i
  jego karta dzielą `uTreeLimit`; w puli kart są wszystkie drzewa; `ringFade`
  rekwizytów i domów zostaje stałe.
- Settlements: plan może postawić pojedyncze drzewo (`kit.tree`, osobny
  strumień z pozycji), nadal nie sieje.
- Pure CPU: `scenery/Sowing.ts`, `terrain/SampledGround.ts`,
  `scenery/FarTrees.ts`, `scenery/TreeLimit.ts`.

## 10. Poza zakresem

- Las namalowany w dalekim terenie (za ~6 km). Do rozważenia po obejrzeniu
  kart.
- Rekwizyty i domy za 2,6 km.
- Drzewa planów w dali.
- Tańsze drewno pełnych drzew za 680 m (−55 % trójkątów drzew, niewidoczne) --
  odłożone na prośbę właściciela, osobna decyzja.
- Cienie kart.

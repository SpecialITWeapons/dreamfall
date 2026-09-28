# Klify nadmorskie

Data: 2026-09-28. Status: kierunek wybrany po dwóch probe; spec do przeglądu
właściciela. Dokłada do terenu z sekcji 6 projektu
(`2026-09-14-dreamfall-design.md`) jedną warstwę świata: miejscami morze
podcina ląd i zostawia po sobie ścianę.

## 1. Cel

Gdzieniegdzie, nie na każdym wybrzeżu, ląd kończy się nad morzem urwiskiem,
które z lotu czyta się jak prawdziwy klif: pionowa ściana, u jej stóp woda,
nad nią zielony stok z drzewami, i klif, który wzdłuż brzegu rośnie, maleje
i przechodzi w plażę. Z 45 m nad wodą, z 300 m i z 1000 m.

Nie jest celem: nawisy, jaskinie, łuki, ostańce jako osobne obiekty (sufit
heightfieldu, 18.1), klify nad jeziorami, wąwozy rzeczne.

## 2. Stan wyjściowy

- Teren to heightfield o komórce 16 m (`CELL`), dalekie okno 64 m. Wysokość
  punktu to wynik `sampleWindow`: baza z `baseFields` plus haki biomów.
- Brzeg jest łagodny z założenia: „półka” w `baseFields` rozciąga plaże,
  nachylenie przy linii wody to kilka procent.
- Piasek maluje `TerrainMesh` poniżej 7,5 m bez względu na nachylenie; skała
  to warstwa `slope 0.32..0.55` każdego biomu; szum gruntu czyta `worldXZ`,
  więc na ścianie rozmazuje się w pionowe smugi.
- Hak `terraces` umie robić stopnie, żaden biom go nie używa.

## 3. Co pokazały dwa probe

Kod trzech probe jest do wyrzucenia (stash `spike: klify nadmorskie`);
zostają liczby i wnioski.

**Probe 1: podnoszenie lądu, hak biomu `seaCliff`** (moor, elderwood). Ląd
przy linii wody podniesiony o 45–110 m, ściana tam, gdzie odległość od linii
wody przechodzi przez zero.

- Ściana wychodzi czysto: −8 m do +93 m na 16 m. Lot bez skoku.
- Ale: (a) hak biomu jest ważony udziałem biomu, który na granicy spada na
  100–200 m, więc klif kończy się jak ucięty klocek; (b) mały cypel robi się
  płaską mesą; (c) podniesienie wygasa tylko z wysokością bazy, więc w
  obszarze maski podnosi całą nizinę, także daleko od morza, a staw staje się
  lejem ze ścianami dookoła. (b) i (c) wynikają z modelu, nie z liczb.

**Probe 2: morze podcina ląd, warstwa świata.** Ląd w pasie W od linii wody
schodzi do płytkiego dna; ściana stoi na końcu pasa i jest tak wysoka, jak
ląd w tym miejscu.

- Klify wyrastają same tam, gdzie wysoki ląd dochodzi do morza, płaskie
  plaże zostają plażami, wierzch jest nietknięty (zielony stok z drzewami),
  a klif zanika wzdłuż brzegu razem z maską. Zdjęcia z 45 i 300 m wyglądają
  jak klify kredowe.
- Odległość liczona w jednym punkcie (`h / |∇h|`) jest za mocno zaszumiona
  dalej niż kilkanaście metrów od wody: w profilu podcięte punkty na
  przemian z nietkniętymi co 16–32 m, czyli dziury. Rozwiązanie z probe:
  **siatka węzłów co 64 m**, w każdym węźle odległość liczona krokami
  Newtona, między węzłami interpolacja. Profile czyste: dno −3/−7 m, ściana
  do 55–58 m i do 48 m, jedno przejście.
- Koszt pełnego wypełnienia okna: +90..130 ms (+15–20%). Za dużo; §9.
- Widoczne wady: „piła” tam, gdzie front biegnie ukośnie do siatki (szum
  frontu o skali 45 m jest za drobny na komórkę 16 m), blade mielizny tam,
  gdzie podcięcie wyszło częściowe, płaski szarawy kolor ściany.
- Lot prosto na ścianę z 30 m nad wodą: autopilot 0,15 m na krok, pilot
  0,60 m na krok (w probe 1 było 0,15); do wyjaśnienia testem (§10).

**Probe 3: wygląd ściany** (po przeglądzie zdjęć z probe 2 przez
właściciela: „widzę trójkąty i jednolity kolor”). Ten sam model, te same
miejsca, zdjęcia przed i po.

- Trójkąty w cieniowaniu brały się z normalnej: liczona w wierzchołku z
  różnic przez dwie komórki, na ścianie szerokiej na jedną komórkę skacze
  między sąsiednimi wierzchołkami (jeden u góry, drugi u dołu). Normalna z
  czterech komórek na ścianie usuwa to całkowicie.
- Piła na krawędzi to aliasing: skok wysokości węższy niż dwie komórki
  zawsze się piłuje, gdy biegnie ukośnie do siatki. Ściana na 32 m (dwie
  komórki) ją usuwa, a dalej jest stroma: 60 m klifu to 62°, 100 m to 72°.
  Niskie ściany (poniżej ok. 25 m) i tak wychodziły jak rampy, więc
  `minFace` idzie w górę.
- Pas mielizny wzdłuż dawnego brzegu: dawny szelf przed klifem zostawał
  płytki. Dno pod klifem musi sięgać kawałek w morze (§5.6), a do tego punkt
  morza musi wiedzieć, jak wysoka jest ściana obok, więc wysokość czoła
  liczy węzeł, nie punkt (§5.5).
- Kolor: warstwy, ławice, spękania, zacieki, porost i mokra stopa w szumie
  3D, do tego rzeźba skały jako zaburzenie normalnej (§8). Spękania liczone
  po x, z wiły się jak pismo, bo nachylona ściana przesuwa się w poziomie,
  gdy rośnie; liczone we współrzędnej wzdłuż ściany biegną w dół.

Pomiar pomocniczy (seed 42, kwadrat 60 km, siatka 60 m, flood fill jako
prawda): ciągłość (`cont`) nie odróżnia brzegu morza od jeziora (mediana
0,505 w obu). Średnia głębokość na pierścieniach wokół punktu też nie: małe
stawy leżą zwykle tuż za plażą i ich pierścienie widzą morze. Rozróżnia to
dopiero próbka w dół stoku, za linią wody (§5.3).

## 4. Decyzje

| Pytanie | Decyzja |
| --- | --- |
| Model | Podcinanie (probe 2), nie podnoszenie. |
| Kto o tym decyduje | Warstwa świata w silniku, jak śnieg. Nie hak biomu: udział biomu urywa klif na granicy. Kontrakt biblioteki się nie zmienia. |
| Gdzie | Wolna maska szumu, niezależna od biomu i klimatu. Klif nad pustynią czy dżunglą istnieje w naturze. |
| Jeziora | Bez klifów. Sonda za linią wody odrzuca płytką wodę. |
| Osady | Klif ustępuje osadzie: wioska przy brzegu stoi w zatoczce między klifami. |
| Drogi | Worker tras widzi klify (inaczej droga wjedzie na ścianę). |

## 5. Model

Nowy czysty moduł CPU `src/engine/terrain/SeaCliffs.ts` (bez `three`, test w
Node; dopisany do listy czystych modułów w `AGENTS.md`). Stałe w
`SEA_CLIFF`; wartości startowe to te z probe 2, dopasowane w trakcie
implementacji zdjęciami (§11).

`cliffs.at(x, z, b, share)` zwraca zmianę wysokości w metrach dla punktu o
wysokości bazowej `b`; `share` to część punktu, którą wolno podciąć (§5.7).
Warstwa działa tylko dla `SEA_CLIFF.low <= b <= maxFace[1]`; poza tym
przedziałem zwraca 0 bez żadnego próbkowania.

### 5.1 Maska: gdzie w ogóle

`m = sstep(cover[0], cover[1], fbm(x / scale, z / scale, salt, 2))`, skala
3,5 km, `cover` start `[0.05, 0.3]`. Zanikanie maski to jedyne, co klif
wzdłuż brzegu kończy, więc przejście trwa setki metrów, nie komórkę. Ile
wybrzeża dostaje klif, reguluje `cover` (cel w §10).

### 5.2 Odległość od linii wody

Siatka węzłów co `COAST_NODE = 64 m`. W węźle: trzy kroki Newtona w dół
gradientu bazy (różnice centralne ±12 m, krok przycięty do ±400 m, stop przy
`|h| < 0,5 m`); odległość to długość drogi do punktu końcowego, ze znakiem
wysokości węzła (+ na lądzie). Węzeł trzyma trzy liczby: odległość, `sea`
(§5.3) i `front` (§5.5). Dla punktu: interpolacja dwuliniowa czterech
węzłów, wszystkich trzech liczb.

Wartość węzła to czysta funkcja jego indeksów, więc wynik punktu jest czystą
funkcją punktu, niezależnie od kolejności wypełniania i od cache. Na tym stoi
`SampledGround` (odpowiada co do bitu jak okno) i dalekie okno. Cache: tablica
haszowana po indeksach węzła (4096 miejsc w probe), wypierana bez
konsekwencji dla wyniku; test tego pilnuje (§10).

### 5.3 Czy to morze

W węźle, oprócz odległości: wysokość bazy w punkcie `probe = 300 m` dalej w
dół stoku od znalezionej linii wody. `sea = sstep(deep[0], deep[1], -h)`,
`deep = [3, 10]`. Staw jest płytki (mediana maks. głębokości zbiornika do
0,1 km² to 7 m), morze za pasem przybrzeżnym jest głębsze. Interpolowane jak
odległość.

### 5.4 Front i ściana

`d = dist + jag · fbm(x / 160, z / 160)`, `jag = 22 m`; szerokość pasa
`W` z wolnego szumu (skala 1,4 km) w `width = [70, 190] m`. Podcięcie:
`cut = 1 - sstep(W - face, W, d)`, czyli 1 od strony morza, 0 za frontem, a
ściana to szerokość `face`.

**`face = 32 m`, dwie komórki, i nie mniej.** Węższy skok piłuje się na
siatce 16 m (probe 3). Szum frontu ma jeden składnik o skali 160 m:
drobniejszy (45 m w probe 2) jest bliski rozdzielczości siatki i też rysuje
piłę.

### 5.5 Jak wysoka ściana

Ściana ma wysokość lądu na froncie. Liczy ją węzeł: od znalezionej linii
wody idzie `W` (szerokość pasa w węźle) w górę stoku i czyta tam bazę. Jedna
próbka więcej na węzeł. Dzięki temu wysokość czoła znają też punkty morza
przed klifem (§5.6), a szacunek nie zaniża ściany na stoku wklęsłym, jak
szacunek liniowy z punktu w probe 2.

`worth = sstep(minFace) · (1 - sstep(maxFace))`, `minFace = [18, 34] m`,
`maxFace = [140, 190] m`: poniżej plaża zostaje plażą (niższa ściana przy
`face = 32 m` to rampa, nie klif), powyżej nie tniemy gór.

Mielizny z probe biorą się z częściowego `worth · sea`: podcięcie w połowie
zostawia płaski ląd tuż pod wodą. `worth · sea` przechodzi więc przez
wyostrzenie (`sstep(0.35, 0.65, ·)`), a maska `m` nie, bo ona ma zanikać
łagodnie. Test liczy wysepki (§10).

### 5.6 Dno

Klif stoi w głębokiej wodzie. Dno to `target = min(b, -floor ·
sstep(-160, -40, d))`, `floor = 7 m`: −7 m pod ścianą, w całym pasie i
jeszcze 40 m w morze, a potem wraca do szelfu do 160 m od dawnej linii
wody. Obejmuje to także punkty morza, więc `SEA_CLIFF.low = -40 m` (dno
szelfu to ok. −46 m). Bez tego dawny szelf zostawał przed klifem jasnym
pasem mielizny. Wynik: `k = m · cut · sharp(worth · sea)`, zmiana
`k · (target - b)`.

### 5.7 Osady

`share = 1 - (udział slotów, których wpis ma inherit)`, liczony w
`sampleWindow` z wag, które już tam są. Osada przy brzegu stoi w zatoczce,
na jej krawędzi klif rośnie przez szerokość jej feathera (150 m). `plateau`
czyta wysokość środka z `baseFields`, a tam klifu nie ma, więc się zgadza.

## 6. Gdzie w silniku

- `WorldSampler.sampleWindow`: po hakach biomów `out[0] = h + cliffs.at(x, z,
  base, share)`; także w gałęziach „bez biblioteki” i „nikt nie wziął”
  (`share = 1`). Warstwa nie podlega `MAX_HEIGHT_DELTA`, bo ma własne
  granice (`maxFace`, `floor`).
- `sample` i `baseFields` się nie zmieniają, więc złote wartości
  `WorldSampler` dla seeda 42 zostają.
- Bliskie i dalekie okno, `SampledGround`, `Sites` i `heightAt` dostają
  klify za darmo, bo wszystkie idą przez `sampleWindow`. Dalekie okno
  (64 m) rysuje ścianę jako stok ok. 45–55°; to akceptowalne.
- Seed warstwy: `S3 + 101` przez `fieldSeeds`, żeby każdy świat miał inne
  wybrzeża.

## 7. Co jeszcze czyta teren

- **Drogi.** `routes.worker.ts` liczy trasę po samym `baseFields`. Dostaje
  `cliffs.at(..., share)`, gdzie `share` zanika wokół obu końców trasy, żeby
  zatoczki osad były dostępne. `RouteJob.a/b` dostają `radius` osady (Sites
  go zna). Ściana ma nachylenie ponad `ROUTE.cliff` (60%), więc A* ją omija
  sam.
- **Woda.** `WaterLook` czyta dalekie okno, a więc już z klifami; pas
  podcięcia poszerza morze o W, co ledwo rusza otwartość (pierścienie 250 i
  500 m). Przybój wg głębokości zwęzi się przy ścianie sam.
- **Lot.** Czyta `heightAt`; nic do zmiany, sprawdza to test (§10).
- **Sianie, trawa, głazy.** `FOOTING.slope 0.6` i `Grass.MAX_SLOPE 0.65`
  trzymają drzewa i trawę z dala od ściany; głazy lubią stoki.
- **Śnieg.** Klify leżą za nisko; `SNOW.hold` i tak nie trzyma śniegu na
  ścianie.
- **Dźwięk.** Bez zmian: przybój zależy od biomu pod lotem, nie od ściany.

## 8. Wygląd ściany

Wszystko w `TerrainMesh`, na bliskiej siatce. Waga ściany:
`wall = smoothstep(0.42, 0.7, slope) · (1 - smoothstep(180, 240, h))`, żeby
nie ruszać gór. Każdy szum ściany siedzi w gałęzi `If(wall > 0.01)`, więc
reszta terenu nie płaci za nic.

**Światło, bez trójkątów:**

- **Normalna ściany z czterech komórek.** W wierzchołku obok dzisiejszej
  normalnej (różnice przez ±1 komórkę) druga, przez ±2 komórki, i mieszanie
  do niej tam, gdzie teren jest stromy (`smoothstep(0.3, 0.55)` nachylenia,
  poniżej 180–240 m). Ta normalna idzie tylko do światła; nachylenie dla
  warstw biomów i śniegu liczy się jak dziś. Na krawędzi bliskiej siatki
  przechodzi w normalną dalekiej, jak dziś.
- **Rzeźba skały.** Pole wysokości skały w metrach, szum 3D po `(x, h, z)`:
  ławice, warstwy, spękania (wklęsłe) i drobny szum. Normalna ściany
  zaburzona różnicami skończonymi tego pola wzdłuż ściany i w górę jej, krok
  0,5 m, wygaszana z odległością od kamery (300–1200 m), żeby z daleka nie
  migotała. Różnice skończone, a nie pochodne ekranowe: pochodna w gałęzi
  `If` jest w GLSL niezdefiniowana.

**Kolor, nie jeden:**

- **Piasek nie oblepia ściany:** mieszanie piasku bierze
  `max(smoothstep(1.5, 7.5, h), smoothstep(0.3, 0.5, slope))`.
- **Warstwy:** szum 3D `(x·0,01, h·0,16, z·0,01)`, szybki w pionie i wolny
  wzdłuż ściany; przesuwa barwę między ciepłą a chłodną odmianą skały biomu
  i jasność o ±10%.
- **Ławice:** ostre poziome pasy co 4,5 m (`fract(h / 4,5)` z wolnym
  zafalowaniem), ±8% jasności.
- **Spękania i zacieki** we współrzędnej wzdłuż ściany (`run`: rzut
  `worldXZ` na kierunek poziomy ściany z normalnej światła), nie po x, z:
  inaczej wiją się na nachylonej ścianie. Spękania to cienkie ciemne linie
  prawie pionowe, zacieki to szersze pionowe smugi.
- **Porost:** plamy jasnej żółtawej szarości, do 30%.
- **Mokra stopa:** ściemnienie do połowy w dolnych 1,5–7 m.

Kolor skały zostaje kolorem biomu (`rock` z warstwy `slope`); warstwa świata
go tylko moduluje, więc klif nad dżunglą i nad wrzosowiskiem są różne. Liczby
jasności i barw dobieramy zdjęciami (`tools/cliffs/look.mjs`). Normalna na
piksel z heightfieldu jest poza zakresem: zmienia światło całego terenu.

## 9. Koszt

Budżet: **pełne wypełnienie okna rośnie najwyżej o 8%** przy klifowym
wybrzeżu seeda 42 (probe: +15–20%). Dźwignie, w kolejności:

1. warstwa zwraca 0 przed węzłami, gdy maska jest zerem albo `b` poza
   przedziałem (jest w probe);
2. dwa kroki Newtona zamiast trzech i różnice jednostronne w pierwszym;
3. rzadsze węzły (96 m), jeśli profile zostaną czyste;
4. cache przeżywający cały wiersz okna (probe: 4096 miejsc).

Shader: nowy vantage `cliff` w `tools/vantages.ts` (klif seeda 42 z 45 m),
żeby `npm run bench` mierzył koszt ramki z gałęzią ściany na ekranie.

Liczby idą do `docs/perf-notes.md`, metodą z tego pliku (mediana, minimum z
rund).

## 10. Testy

- `tests/unit/seaCliffs.test.ts` (Node, sztuczna baza: rampa do morza, staw,
  cypel):
  - ściana od 80% do 20% swojej wysokości mieści się w 2 komórkach;
  - za frontem wysokość jest nietknięta co do bitu;
  - punkty morza bez zmian; płytki staw bez klifu;
  - `share = 0` i maska zero dają 0;
  - ten sam wynik przy dowolnej kolejności zapytań i po wyparciu cache.
- **Seed 42** (prawdziwy sampler z biblioteką):
  - bez dziur: na przekrojach prostopadłych do brzegu podcięcie zmienia się
    najwyżej raz na 400 m;
  - bez mielizn: w pasie podcięcia żadnej wysepki lądu (`h > 0`) mniejszej
    niż 3×3 komórki;
  - udział linii brzegu morza z czołem ≥ 20 m: 10–20% (cel „gdzieniegdzie”;
    `cover` go ustawia); ściany między `minFace` a `maxFace`.
- **Lot** (`FlightController` nad sztuczną ścianą 80 m, pilot i autopilot,
  30 m nad wodą): prześwit nigdy poniżej `MIN_CLEARANCE`, zmiana `y` na krok
  w granicy tego, co kontroler sam umie wznieść. Tu wyjaśni się 0,60 m na
  krok pilota z probe 2.
- **Drogi:** `heightAt` workera zawiera klify i zanika wokół końców.
- Zmiany świadome: `ringGolden` (4 snapshoty), punkt startu w smoke teście,
  jeśli klif go dosięga; złote wartości `WorldSampler.sample` bez zmian.
- Browser: istniejący zestaw e2e na WebGL2 bez nowych błędów.

## 11. Narzędzia i dokumentacja

- `tools/cliffs/look.mjs`, na wzór `tools/trees/look.mjs`: klif seeda 42 z
  morza z 45 m, z bliska (200 m od ściany, 35 m), z boku z 70 m, z 300 m i
  z 1000 m. Tym dobieramy `cover` i jasności ściany. Dwa miejsca z probe:
  (3584, −2992) i (2720, 2240).
- `AGENTS.md`: wpis w „Terrain, sky and time” (model, siatka węzłów,
  czystość funkcji, osady, drogi) i `terrain/SeaCliffs.ts` na liście czystych
  modułów.
- Panel `?dev=1`: bez suwaków w tej wersji; każda zmiana to pełne
  przeliczenie okien (ok. 0,6 s).

## 12. Poza zakresem

Ostańce i łuki jako obiekty, nawisy, klify jezior, podcięte ujścia rzek,
normalna na piksel, osobny kolor skały klifu w bibliotece, suwaki w panelu.

## 13. Ryzyka do obejrzenia

- `front` w węźle czyta bazę W w górę stoku od linii wody, w kierunku
  gradientu z ostatniego kroku Newtona; na krętym brzegu ten kierunek może
  nie trafić w ląd za frontem. Widać to na zdjęciach, nie w teście.
- Osada z `shoreBonus` przy brzegu w masce: zatoczka zamiast klifu. Jeśli
  wioska w zatoczce będzie wyglądać źle, alternatywą jest odsuwanie osad od
  maski.
- Start lotu (0, 0): klif może stanąć 900 m od startu (probe 2). Scena
  otwarcia leci pod pokładem chmur; do obejrzenia, czy klif jej nie psuje.

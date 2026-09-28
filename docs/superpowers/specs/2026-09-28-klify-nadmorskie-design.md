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

Kod obu probe jest do wyrzucenia (stash `spike: klify nadmorskie`); zostają
liczby i wnioski.

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
wysokości węzła (+ na lądzie). Dla punktu: interpolacja dwuliniowa czterech
węzłów.

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

`d = dist + jag · fbm(x / 140, z / 140)`, `jag = 22 m`; szerokość pasa
`W` z wolnego szumu (skala 1,4 km) w `width = [70, 190] m`. Podcięcie:
`cut = 1 - sstep(W - face, W, d)`, czyli 1 od strony morza, 0 za frontem, a
ściana to szerokość `face`. W probe `face = 12 m` i drugi składnik szumu o
skali 45 m; drugi składnik odpada (piła), a `face` wybieramy w 12–24 m
zdjęciami: szersza ściana to mniej piły i mniej pionu.

### 5.5 Jak wysoka ściana

Ściana ma wysokość lądu na froncie. Szacunek w punkcie:
`front = b + (b / dist) · (W - d)` dla `dist > 0`. `worth =
sstep(minFace) · (1 - sstep(maxFace))`, `minFace = [12, 28] m`,
`maxFace = [140, 190] m`: poniżej plaża zostaje plażą, powyżej nie tniemy
gór. Punkty morza (`dist <= 0`) nie zmieniają się.

Mielizny z probe biorą się z częściowego `worth · sea`: podcięcie w połowie
zostawia płaski ląd tuż pod wodą. `worth · sea` przechodzi więc przez
wyostrzenie (`sstep(0.35, 0.65, ·)`), a maska `m` nie, bo ona ma zanikać
łagodnie. Test liczy wysepki (§10).

### 5.6 Dno

Podcięty ląd schodzi do `target = min(b, -floor · sstep(0, 40, d))`,
`floor = 7 m`: przy dawnej linii wody dno jest na zerze, więc łączy się z
morzem bez progu, a od 40 m w głąb pasa ma −7 m. Wynik:
`k = m · cut · sharp(worth · sea)`, zmiana `k · (target - b)`.

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

W `TerrainMesh`, wszystko wagowane `wall = smoothstep(0.45, 0.72, slope) ·
(1 - smoothstep(180, 240, h))`, żeby nie ruszać gór:

- **Piasek nie oblepia ściany:** mieszanie piasku bierze
  `max(smoothstep(1.5, 7.5, h), smoothstep(0.3, 0.5, slope))`.
- **Warstwy skały:** szum 3D po `(x·0,012, h·0,22, z·0,012)`, zmienny szybko
  z wysokością i wolno wzdłuż ściany.
- **Zacieki:** szum 3D po `(x·0,2, h·0,015, z·0,2)`, ściemnia w pionowych
  pasach.
- **Mokra stopa:** ściemnienie `wall` w pierwszych kilku metrach nad wodą.

Kolor skały zostaje kolorem biomu (`rock` z warstwy `slope`), warstwa świata
go tylko moduluje. Liczby jasności ustalamy zdjęciami. Normalna na piksel
(ostrzejsza krawędź) jest poza zakresem: zmienia światło całego terenu.

## 9. Koszt

Budżet: **pełne wypełnienie okna rośnie najwyżej o 8%** przy klifowym
wybrzeżu seeda 42 (probe: +15–20%). Dźwignie, w kolejności:

1. warstwa zwraca 0 przed węzłami, gdy maska jest zerem albo `b` poza
   przedziałem (jest w probe);
2. dwa kroki Newtona zamiast trzech i różnice jednostronne w pierwszym;
3. rzadsze węzły (96 m), jeśli profile zostaną czyste;
4. cache przeżywający cały wiersz okna (probe: 4096 miejsc).

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
  morza z 45 m, z boku z 70 m, z 300 m i z 1000 m. Tym dobieramy `face`,
  `cover` i jasności ściany.
- `AGENTS.md`: wpis w „Terrain, sky and time” (model, siatka węzłów,
  czystość funkcji, osady, drogi) i `terrain/SeaCliffs.ts` na liście czystych
  modułów.
- Panel `?dev=1`: bez suwaków w tej wersji; każda zmiana to pełne
  przeliczenie okien (ok. 0,6 s).

## 12. Poza zakresem

Ostańce i łuki jako obiekty, nawisy, klify jezior, podcięte ujścia rzek,
normalna na piksel, osobny kolor skały klifu w bibliotece, suwaki w panelu.

## 13. Ryzyka do obejrzenia

- Szacunek wysokości frontu (`front`) jest liniowy; na stoku wklęsłym może
  zaniżyć ścianę. Widać to na zdjęciach, nie w teście.
- Osada z `shoreBonus` przy brzegu w masce: zatoczka zamiast klifu. Jeśli
  wioska w zatoczce będzie wyglądać źle, alternatywą jest odsuwanie osad od
  maski.
- Start lotu (0, 0): klif może stanąć 900 m od startu (probe 2). Scena
  otwarcia leci pod pokładem chmur; do obejrzenia, czy klif jej nie psuje.

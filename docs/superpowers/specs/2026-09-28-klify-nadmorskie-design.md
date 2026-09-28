# Klify nadmorskie

Data: 2026-09-28. Status: kierunek wybrany po dwóch probe; spec do przeglądu
właściciela. Zaktualizowany po implementacji: §5.2, §5.3, §5.5, §5.6, §8, §9,
§10 i §13 opisują to, co zbudowano, a nie to, co planowano. Dokłada do
terenu z sekcji 6 projektu (`2026-09-14-dreamfall-design.md`) jedną warstwę
świata: miejscami morze podcina ląd i zostawia po sobie ścianę.

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

Siatka węzłów co `COAST_NODE = 64 m`. Z każdego węzła wychodzi **marsz** w
stronę linii wody: z wysokości węzła i nachylenia wziętego z wysokości czterech
sąsiednich węzłów (różnice centralne na siatce), jeden krok Newtona, a potem
sieczne po tej samej prostej, razem do czterech próbek; krok przycięty do
±400 m, stop przy `|h| < 0,5 m`. Marsz, któremu nachylenie każe szukać linii
dalej niż 400 m, poddaje się bez próbki. Marsze czytają samą wysokość bazy
(`ground()` w `WorldSampler`, ta sama, z której składa się `baseFields`, bez
klimatu i bez pasma gór tam, gdzie jego maska jest zerem; wynik ten sam co do
bitu). W probe były trzy kroki Newtona z gradientem z próbek ±12 m; sieczna
z nachylenia siatki znajduje linię tak samo często za mniej niż połowę próbek
(§9).

**Odległość węzła to nie długość jego własnego marszu**, tylko odległość od
węzła do najbliższego punktu linii, który znalazł którykolwiek zbieżny marsz
z jego sąsiedztwa 3×3, ze znakiem wysokości węzła (+ na lądzie). Na
postrzępionym brzegu dwa sąsiednie marsze lądują na różnych odcinkach linii
(odległości różniły się o ok. 3× między węzłami 64 m od siebie), i własny
marsz sam zostawiał pojedyncze dołki po 13 m. Sąsiedztwo 5×5 kosztowało
25 odczytów marszu na węzeł i też nie usuwało wszystkich wad; resztę usunął
człon klifu z §5.5.

Węzeł, w którego sąsiedztwie żaden marsz nie znalazł linii albo którego
najbliższa linia leży dalej niż `REACH` (najszerszy pas + `jag` + przekątna
komórki, ok. 303 m), **nie mówi nic**: odległość NaN, człon klifu 0.
Wymyślona odległość (w pierwszej wersji 1e4) mieszała się z prawdziwą
sąsiada i stawiała koniec podcięcia na linii siatki: prosty stopień 28 m na
2 m.

Węzeł trzyma dwie liczby: odległość i człon klifu (§5.5). Dla punktu:
interpolacja dwuliniowa czterech węzłów; człon klifu po wszystkich czterech
(nieznaleziony mówi 0, więc to on wygasza podcięcie w stronę węzła bez
linii), odległość tylko po narożnikach, które ją mają, z wagami
znormalizowanymi z powrotem do jedności.

Wartość węzła to czysta funkcja jego indeksów, więc wynik punktu jest czystą
funkcją punktu, niezależnie od kolejności wypełniania i od cache. Na tym stoi
`SampledGround` (odpowiada co do bitu jak okno) i dalekie okno. Cache: trzy
tablice haszowane po indeksach (wysokości węzłów, marsze, węzły), po 4096
miejsc, wypierane bez konsekwencji dla wyniku; test tego pilnuje (§10).
Dwa zapytania mogą trafić w to samo miejsce, więc wartość czyta się z miejsca
od razu, przed następnym zapytaniem: w pierwszej wersji cztery narożniki
czytane po czterech zapytaniach nadpisywały się i zostawiały dołki tam, gdzie
dwa z nich miały jedno miejsce.

### 5.3 Czy to morze

W marszu, który znalazł linię: wysokość bazy w punkcie `probe = 300 m` dalej
w dół stoku od znalezionej linii wody, w kierunku marszu. `sea =
sstep(deep[0], deep[1], -h)`, `deep = [3, 10]`. Staw jest płytki (mediana
maks. głębokości zbiornika do 0,1 km² to 7 m), morze za pasem przybrzeżnym
jest głębsze. `sea` nie jest interpolowane osobno: należy do marszu, który je
zmierzył, i wchodzi do jego członu klifu (§5.5). Marsz, który linii nie
znalazł, morza nie sprawdza wcale.

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

Ściana ma wysokość lądu na froncie. Liczy ją marsz: od znalezionej linii
wody idzie `W` (szerokość pasa w tym punkcie) w górę stoku, w kierunku
marszu, i czyta tam bazę. Jedna próbka więcej na zbieżny marsz. Dzięki temu
wysokość czoła znają też punkty morza przed klifem (§5.6), a szacunek nie
zaniża ściany na stoku wklęsłym, jak szacunek liniowy z punktu w probe 2.

`worth = sstep(minFace) · (1 - sstep(maxFace))`, `minFace = [18, 34] m`,
`maxFace = [140, 190] m`: poniżej plaża zostaje plażą (niższa ściana przy
`face = 32 m` to rampa, nie klif), powyżej nie tniemy gór.

Mielizny z probe biorą się z częściowego `worth · sea`: podcięcie w połowie
zostawia płaski ląd tuż pod wodą. `worth · sea` przechodzi więc przez
wyostrzenie (`sharp = sstep(0.35, 0.65, ·)`), a maska `m` nie, bo ona ma
zanikać łagodnie.

**Człon klifu węzła** to `sharp(worth · sea)` każdego zbieżnego marszu z jego
sąsiedztwa 3×3, uśredniony z wagą `exp(-d / 64 m)`, gdzie `d` to odległość od
węzła do linii tego marszu; w punkcie, po interpolacji, wyostrzany jeszcze
raz. Wyostrzany w marszu, a nie dopiero po zmieszaniu: mieszanka `sea` i
`front` leżała na całych stokach w środku wyostrzenia, i każde jej małe
nachylenie było stromym nachyleniem podcięcia (fosa za plażą, dołek przy
ścianie). Mieszany ze wszystkich marszów, a nie wzięty z najbliższego: dwa
marsze 42 m od siebie u nasady zatoki czytały morze jako 0 i 1, najbliższy
zmieniał się z węzła na węzeł, i wychodziły dołki wśród połowicznie
podciętych komórek i wysepki nietkniętego lądu. Test liczy jedne i drugie
(§10).

### 5.6 Dno

Klif stoi w głębokiej wodzie. Dno to `target = min(b, -floor ·
sstep(-160, -40, d))`, `floor = 7 m`: −7 m pod ścianą, w całym pasie i
jeszcze 40 m w morze, a potem wraca do szelfu do 160 m od dawnej linii
wody. Obejmuje to także punkty morza, więc `SEA_CLIFF.low = -40 m` (dno
szelfu to ok. −46 m). Bez tego dawny szelf zostawał przed klifem jasnym
pasem mielizny. Wynik: `k = m · cut · sharp(cliff)`, gdzie `cliff` to
interpolowany człon klifu (§5.5), zmiana `k · (target - b)`. Woda już na
głębokości dna lub głębiej (`b <= -floor`) nie zmienia się nigdy, więc
warstwa odpowiada 0 zanim zapyta siatkę.

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
nie ruszać gór (`slope` to tu większe z nachyleń komórki i normalnej
światła). Każdy szum ściany siedzi w gałęzi `If(wall > 0.01)`, więc
reszta terenu na GPU nie płaci za nic (SwiftShader płaci, §9).

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
  `If` jest w GLSL niezdefiniowana. Gałąź rzeźby ma własny warunek
  `wall > 0.01 i odległość < 1200 m`: dalej wygaszenie i tak mnoży ją przez
  zero, a pytała o dwanaście szumów. Spękania rzeźby zostają w 3D: szum samego
  punktu nie ma ramienia dźwigni (niżej), a na pochylonej ścianie wije się
  tylko jako rowek w świetle, pod prostymi spękaniami koloru.

**Kolor, nie jeden:**

- **Piasek nie oblepia ściany:** mieszanie piasku bierze
  `max(smoothstep(1.5, 7.5, h), smoothstep(0.3, 0.5, slope))`.
- **Warstwy:** szum 3D `(x·0,01, h·0,16, z·0,01)`, szybki w pionie i wolny
  wzdłuż ściany; przesuwa barwę między ciepłą a chłodną odmianą skały biomu
  i jasność o ±10%.
- **Ławice:** ostre poziome pasy co 4,5 m (`fract(h / 4,5)` z wolnym
  zafalowaniem), ±8% jasności.
- **Spękania i zacieki na dwóch pionowych płaszczyznach**, `(x, h)` i
  `(z, h)`, ważonych tym, w którą stronę patrzy ściana (`|n.z|` i `|n.x|`
  normalnej światła). Nie w 3D po x, z: pochylona ściana przesuwa się w
  poziomie, gdy rośnie, i spękania wiją się jak pismo. I nie we współrzędnej
  wzdłuż ściany (`run`, rzut `worldXZ` na kierunek poziomy ściany), jak
  planowano: to iloczyn skalarny pozycji w świecie z kierunkiem, więc obrót
  interpolowanej normalnej o kilka stopni przesuwa go o odległość od początku
  świata razy ten kąt, setki metrów 4,6 km od (0, 0), i spękania na krzywej
  ścianie gięły się w papkę. Dwie płaszczyzny nie mają ramienia dźwigni i
  kosztują dwa szumy więcej. Spękania to cienkie ciemne linie prawie
  pionowe, zacieki to szersze pionowe smugi.
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

**Zmierzone** (Node, seed 42, pełne okno 313 600 tekseli, minimum z trzech
rund, `MEASURE=1 npx vitest run tests/unit/seaCliffsCost.test.ts`): klif
(3584, −2992) **+5,3%**, klif 2 (2720, 2240) **+6,0%**, początek świata
**+4,7%**; w innych przebiegach +5,2..6,7%. Metoda różni się od planowanej:
obie strony, z klifami i bez, idą **na przemian wiersz po wierszu**, a nie
całe wypełnienia po kolei. Ta maszyna zrzuca zegar o ok. jedną trzecią po
dwóch, trzech sekundach przebiegu, więc całe wypełnienia na zmianę mierzyły,
która strona trafiła za spadek (+4..+12% dla tego samego kodu); wiersze na
przemian idą pod jednym zegarem, a ten sam przeplot bez klifów po obu
stronach czyta się w granicach 1,5% od zera. Zapas do budżetu to więc ok.
1,5–2,5 punktu.

Po rundach dołków i wysepek (3×3 marszów na węzeł, każdy z własnym odczytem
wybrzeża) warstwa kosztowała +33..36%. Z dźwigni z listy weszła pierwsza
(i do niej: woda głębsza niż dno odpada przed siatką); dwa kroki Newtona
oblały test dołków i wysepek, siatki 96 m nie trzeba było, cache 8192
oszczędzał 1% marszów i nie wszedł. Resztę zrobiły dźwignie, których lista
nie miała, w kolejności: marsz bez linii nie czyta wybrzeża; marsze czytają
samą wysokość, bez klimatu i bez pasma gór pod zerową maską; jeden krok
Newtona z nachylenia siatki i potem sieczne (5,6 próbki na marsz zamiast 15);
marsz, któremu linia wychodzi dalej niż 400 m, poddaje się; narożniki
komórki pamiętane, póki wiersz ją przecina, i człon klifu poniżej
wyostrzenia odpowiada przed maską. Tabela krok po kroku jest w
`docs/perf-notes.md`. Czwarta i piąta ruszają teren (marsze lądują w innych
punktach tej samej linii, 1,2–1,7% tekseli okna, udział wybrzeża 13,0 →
13,3%), reszta nie zmienia niczego co do bitu.

Gałąź ściany w shaderze: na GPU (WebGPU, znaczniki czasu, zainstalowany
Chrome) bez mierzalnej różnicy, także na vantage `cliff` (2,16 ms po, 2,17–2,18
przed w trzech z czterech przebiegów). Na SwiftShader (rasteryzator CI)
wszystkie vantage z ziemią podrożały o 40–110%, także te bez klifu na
ekranie: programowy rasteryzator płaci za ciało gałęzi, której żaden
fragment nie bierze.

## 10. Testy

- `tests/unit/seaCliffs.test.ts` (Node, sztuczna baza: rampa do morza, staw,
  cypel):
  - ściana od 80% do 20% swojej wysokości mieści się w 2 komórkach;
  - za frontem wysokość jest nietknięta co do bitu;
  - morze pod ścianą pogłębione do `-floor`, a dalej niż 160 m od dawnej
    linii wody bez zmian; płytki staw bez klifu; niski brzeg (czoło poniżej
    `minFace`) i góra (powyżej `maxFace`) bez zmian;
  - `share = 0` i maska zero dają 0;
  - ten sam wynik przy dowolnej kolejności zapytań i po wyparciu cache;
  - dwa narożniki w jednym miejscu cache nie mieszają się (test regresji
    §5.2);
  - podcięcie wygasa w stronę węzła, który linii nie znalazł, bez stopnia
    (sztuczny płaskowyż: było 36 m na komórkę).
- **Seed 42** (prawdziwy sampler z biblioteką, `seaCliffsWorld.test.ts`):
  okno 192×192 komórek wokół każdego z dwóch miejsc z §11, każde z ponad
  100 podciętymi komórkami (wysokość ponad 2 m pod bazą). Test liczy wady,
  które widać, a nie każde przejście przez próg: gładkie podcięcie
  przechodzące przez próg 2 m w jednej komórce to nie dołek, a mokre
  pasemko poniżej metra na brzegu częściowego podcięcia to postrzępiony
  brzeg, nie ląd w morzu. W planie było „podcięcie zmienia się najwyżej raz
  na 400 m” i „żadnej wysepki `h > 0` mniejszej niż 3×3”; oba łapały takie
  przejścia.
  - **bez dołków:** żadna komórka nie leży ponad 3 m niżej niż każda z
    czterech sąsiednich;
  - **bez wysepek:** żaden spójny kawałek lądu (`h > 0`) mniejszy niż 9
    komórek, stykający się z podciętą komórką i nie dotykający brzegu okna
    (ląd uciekający za okno może być stałym lądem, który okno ucięło), nie
    wystaje najwyższym punktem ponad 1 m nad wodę;
  - udział podciętego wybrzeża 10–20% (cel „gdzieniegdzie”; `cover` go
    ustawia): próbki co 48 m w kwadracie 40 km, wybrzeże to baza 0,5–3 m,
    podcięte to ponad 3 m pod bazą; zmierzone 13,3%. Testu „ściany między
    `minFace` a `maxFace`” nie ma: pilnuje tego `worth` i test sztucznej bazy.
- **Koszt** (`seaCliffsCost.test.ts`): +8% najwyżej, w trzech miejscach;
  działa tylko z `MEASURE`, bo wspólny runner CI mierzy własną pogodę (§9).
  W CI nie sprawdza więc niczego, a regresję kosztu widać dopiero, gdy ktoś
  zmierzy.
- **Lot** (`flightController.test.ts`, `FlightController` nad sztuczną
  ścianą 60 m i 160 m, 30 m nad wodą, autopilot i pilot; pilotowi lot
  przekazany naprawdę, `fly(0, 1)` i `fly(0, 0)`, bo `fly(0, 0)` przy
  włączonym autopilocie nic nie robi): prześwit nigdy poniżej
  `MIN_CLEARANCE` w obu trybach, a autopilot nie wznosi się szybciej niż
  `CLIMB`. **Pilot nad ścianą 160 m się wznosi szybciej** i to jest
  przypięte jako `it.fails`: sonda przed lotem wznosi się za późno i klamra
  prześwitu podrzuca postać o 5,6 m na krok (112 m/s) przez dwa kroki. To
  wyjaśnia 0,60 m na krok pilota z probe 2 i dotyczy każdej ściany, nie
  tylko klifu; naprawa lotu to osobne zadanie, a test zrobi się czerwony,
  gdy lot zostanie naprawiony (wtedy zwykłe `it`).
- **Drogi** (`routeGround.test.ts`): wysokość workera (`RouteGround.ts`)
  zawiera klify i zanika wokół końców przez promień osady i jej feather.
- Zmiany świadome: snapshoty `ringGolden` zaktualizowane; punkt startu w
  smoke teście bez zmian; złote wartości `WorldSampler.sample` bez zmian.
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

- `front` w marszu czyta bazę W w górę stoku od linii wody, w kierunku
  nachylenia siatki w węźle, z którego marsz wyszedł; na krętym brzegu ten kierunek może
  nie trafić w ląd za frontem. Widać to na zdjęciach, nie w teście.
- Osada z `shoreBonus` przy brzegu w masce: zatoczka zamiast klifu. Jeśli
  wioska w zatoczce będzie wyglądać źle, alternatywą jest odsuwanie osad od
  maski.
- Start lotu (0, 0): klif może stanąć 900 m od startu (probe 2). Scena
  otwarcia leci pod pokładem chmur; do obejrzenia, czy klif jej nie psuje.

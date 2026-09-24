# Osady w kraju i drogi między nimi: projekt

Data: 2026-09-24. Status: projekt zatwierdzony w rozmowie, do przeglądu w pliku.
Uzupełnia sekcję 8 `2026-09-14-dreamfall-design.md` (generator osad) i zmienia
jej jedną zasadę: osada przestaje wypierać kraj, na którym stoi.

## 1. Cel

Trzy rzeczy zgłoszone przez właściciela po obejrzeniu wiosek i miasteczek:

1. Pod osadą leży osobne podłoże (glina i ochra wioski, paleGreen i kamień
   miasteczka), które nie wygląda dobrze. Osada ma stać na gruncie kraju,
   w dowolnym biomie.
2. Drzewa i trawa mają rosnąć między domami i drogami.
3. Osady mają być połączone drogami, widocznymi z wysokości, tak żeby lecąc
   wzdłuż drogi trafić na zabudowania.

Do tego więcej wiosek.

## 2. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Częstość osad | Więcej wiosek (szansa 0,5 → 0,75); miasteczka bez zmian. |
| Podłoże w osadzie | Czysty grunt kraju. Żadnej własnej farby osady, żadnych wydeptanych plam. |
| Drzewa w osadzie | Gatunki kraju w ok. 40% jego gęstości („polana"). |
| Trawa w osadzie | Trawa kraju (gęstość i odcień), ale nie na drogach i nie w obrysach budynków. |
| Drogi między osadami | Tak, do nawigacji: każda droga kończy się osadą z obu stron. Tylko na wspólnym lądzie. |
| Krętość dróg | Zależnie od terenu: łagodne łuki na płaskim, serpentyny na stromym. |
| Organizacja pracy | Jedna specyfikacja na oba tematy; implementacja najpierw etap 1 (osady w kraju), potem etap 2 (drogi). |
| Podejście | Osada zostaje wpisem w rejestrze (obecność, plateau, plan), ale dziedziczy kraj: rozszerzenie istniejącego `ambience.inherit` na cały biom. Odrzucone: osobny kanał osadnictwa w oknie (zmiana formatu okna za ten sam efekt) i rozwiązanie w samej bibliotece (hook nie widzi innych slotów). |

## 3. Stan wyjściowy (pomiary z 2026-09-24)

Pomiar na prawdziwym samplerze, seedy 42, 7 i 1234, kwadrat 240 × 240 km.

| | siatka | szansa | średni odstęp | lot przy 50 m/s |
| --- | --- | --- | --- | --- |
| Wioska | 6 km | 0,5 | 9,2–9,8 km (1 na 86–96 km² lądu) | ok. 3 min |
| Miasteczko | 20 km | 0,6 | 28–31 km (1 na 780–990 km² lądu) | ok. 10 min |

- Połowa komórek to morze. Z komórek lądowych ok. połowę odrzuca losowanie,
  potem stok (`maxSlope`); `minTemp` i `land` razem odrzucają kilka procent.
- Osady już stają we wszystkich biomach, mniej więcej w proporcji do ich
  powierzchni. `minTemp` odcina część komórek frostpines i moor.
- Rezerwacja działki to koło `depth * 0.7` = 16,8 m, działki stoją co 24 m,
  więc cały pas ulicy (ok. ±31 m od osi) jest zamknięty dla drzew. Przy tych
  rezerwacjach żadne drzewo nie stanie między domami ani przed domem,
  niezależnie od gęstości.
- Trawa nie wie o osadach: kępki stoją na drogach i w budynkach.
- Rekwizyty (`place()` rekwizytu) nie pytają o zajętość gruntu.
- Drogi: 41 osad w promieniu 45 km od (0, 0) na seedzie 42, każda połączona
  z dwiema najbliższymi w 14 km, daje 44 pary. A* po siatce 48 m (morze poniżej
  3 m jako ściana, spadek ≤ 25%) łączy 15 z nich w korytarzu bbox + 2,5 km
  (średnio 1,27 × linia prosta), 12 dalszych dopiero z objazdem 1,6–3,7 ×
  w korytarzu 8 km, a 17 nie łączy się wcale (inne wyspy). Żadna para nie
  odpadła przez stromiznę. Jedna trasa: średnio 14 ms i ok. 9 400 próbek
  samplera, najgorsza 45 ms, z szerokim objazdem ponad 130 ms.

## 4. Etap 1: osada stoi w kraju

### 4.1 Kontrakt

- Biom dostaje pole `inherit?: { trees: number }`. Jego obecność znaczy
  „stoję w kraju": grunt, śnieg, trawa, drzewa, rekwizyty, dźwięk i mgła
  należą do biomów kraju obok. `trees` (0..1) to udział gęstości drzew
  i rekwizytów kraju, który stoi na gruncie tego biomu.
- `ambience.inherit` przechodzi do tej flagi: AmbienceModel i Haze czytają
  `inherit` biomu (World mapuje je tak jak dziś). `ambience.layers` (dzwony)
  zostają i są dodawane na wierzch, jak teraz.
- Walidator: biom z `inherit` nie może mieć `ground` ani `populate`;
  `inherit.trees` musi być skończone i w 0..1. Biom bez `inherit` musi mieć
  `ground` jak dotąd.

### 4.2 Udział kraju

Dla jednego teksla: `settled` to suma wag slotów z `inherit`, `country` to
suma pozostałych. Waga biomu kraju przeskalowana to `w / country`. Jeśli
`country == 0` (trzy sloty zajęte przez osady albo osada bez sąsiada w oknie),
teksel dostaje pierwszy biom rejestru, zgodnie z istniejącą regułą „nikt
nie zgłosił". Wagi w oknie są Float32, więc przeskalowanie jest dokładne.
Normalizacja, wybór trzech najsilniejszych i hooki wysokości się nie
zmieniają: plateau osady nadal działa przez jej wagę.

### 4.3 Grunt (`terrain/TerrainMesh.ts`)

- Maska biomu kraju w shaderze to jego udział przeskalowany jak w 4.2.
  Próg gałęzi (`BRANCH_FLOOR`, 0,01) jest sprawdzany na masce już
  przeskalowanej. Biomy z `inherit` nie mają gałęzi.
- `snowShare` liczy się tylko z biomów kraju.
- Koszt: bez zmian albo mniej, bo gałęzie osad znikają.

### 4.4 Drzewa i rekwizyty (`scenery/Ring.ts`)

- `populate` biomu kraju dostaje udział komórki
  `share = (w / country) × (1 − settled × (1 − trees))`. Na krawędzi pióra
  osady przechodzi to płynnie w pełny las kraju.
- Rekwizyty kraju (np. głazy) podlegają temu samemu mnożnikowi przez
  `cell.mix`.
- Silnik odrzuca każde postawienie rekwizytu, które trafia w zajęty grunt
  (`Claims.forTrees`). Rekwizyty zyskują tę ochronę także poza osadami.

### 4.5 Zajęty grunt (`scenery/Claims.ts`, nowy)

Wydzielenie siatki roszczeń z Ring (64 m, jak przeszkody) do własnego modułu,
czystego CPU z testem w Node. Dwa pytania:

- `forTrees(x, z)`: drogi planu (połowa szerokości), budynek (promień
  z wypieczonego kształtu, `metrics.structure().radius`, + 3 m), jawne
  rezerwacje planu (plac miasteczka), w etapie 2 także drogi między osadami
  z przesieką (5.5).
- `forGrass(x, z)`: drogi (połowa szerokości + 0,5 m) i budynek jako obrócony
  prostokąt `footprint` + 1 m.

Plan przestaje rezerwować działki (`kit.reserve(x, z, depth * 0.7)` znika
z `plan.js` i `plan-town.js`); budynek zajmuje grunt przez swój wypieczony
kształt, tak jak przeszkoda. Rezerwacja placu i punktu orientacyjnego
zostaje. Komentarz `hedges.offset` w `village.js` dostaje nowe uzasadnienie.
Jeśli plan używa rezerwacji działek do własnych sprawdzeń kolizji, zostają
one wewnątrz planu i nie trafiają do `reservations`.

Indeks buduje Scenery, gdy przybywa gotowy plan albo gdy Ring się
przebudowuje. Czytają go Ring i Grass.

### 4.6 Trawa (`scenery/Grass.ts`)

- Gęstość i odcień kafla to średnia biomów kraju przeskalowanych jak w 4.2.
  Osada nie ma własnej trawy.
- Kępka, która trafia w `Claims.forGrass`, nie staje. Kafel losuje wszystkie
  próby zawsze, więc zestaw kępek pozostałych jest nadal stały.
- Kafel jest czystą funkcją swoich współrzędnych i gotowych planów
  w zasięgu. Gdy w zasięgu trawy (`REACH` + promień osady) pojawia się nowy
  plan, okno wyrzuca kafle nachodzące na prostokąt ograniczający plan i pisze
  je od nowa w tym samym trybie co przyjazdy. To zdarza się raz na osadę.
  Pełne przepisanie nadal robi tylko skok `Origin`.

### 4.7 Osady (`library/settlements/`)

- `settlement.js`: znikają `paint`, `PAINT`, `ground` (warstwy), `populate`
  i `params`. Wpis ma `inherit: { trees: params.clearing }`, obecność,
  plateau, `sites` i `ambience.layers`.
- `village.js` i `town.js`: znikają `paint`, `scenery` (gatunki, gęstość,
  `grassGold`/`grassCool`, cairns) i `ground.minTemp`. Dochodzi
  `clearing: 0.4`.
- Wioska: `odds` 0,5 → 0,75. Losowanie `carry` jest monotoniczne, więc każda
  dzisiejsza wioska zostaje, a dochodzą nowe. Oczekiwany średni odstęp:
  ok. 7,7 km.
- `minTemp` znika z hooka `lattice` wywołanego przez osady i z `fits`. `land`
  (nie na plaży) i `maxSlope` (nie na urwisku) zostają. Parametr `minTemp`
  hooka `lattice` zostaje w bibliotece standardowej dla innych użytkowników.

### 4.8 Testy etapu 1

- Kontrakt: walidator odrzuca `inherit` razem z `ground` lub `populate`
  i `inherit.trees` spoza 0..1.
- Grunt w Node (warstwy z liczbami zamiast węzłów): fragment w środku wioski
  dostaje albedo kraju; maska przeskalowana; `country == 0` daje pierwszy
  biom rejestru.
- Ring na prawdziwym pierścieniu seeda 42:
  - drzewa w wiosce stojącej w lesie to gatunki tego lasu;
  - gęstość w środku to 0,3–0,5 gęstości na zewnątrz;
  - żadne drzewo ani rekwizyt nie stoi na drodze ani w budynku;
  - w pasie ±31 m od osi ulicy stoją drzewa (dziś zero).
- Trawa:
  - odcień i gęstość w osadzie są krajowe;
  - żadna kępka nie stoi na drodze ani w obrysie;
  - kafel przepisany po nadejściu planu jest identyczny z kaflem zapisanym
    przy gotowym planie.
- Częstość: średni odstęp wiosek na seedzie 42 między 7 a 8,5 km; każda
  wioska z obecnych parametrów nadal stoi.
- AmbienceModel i Haze: dotychczasowe testy `inherit` przechodzą po przeniesieniu
  flagi.
- Przeglądarka: jedno ujęcie wioski z góry, porównanie przed i po; `npm run parity`.

## 5. Etap 2: drogi między osadami

### 5.1 Kto z kim

Graf sąsiedztwa względnego na wszystkich osadach (wioski i miasteczka razem):
A i B łączy krawędź, gdy `d(A, B) ≤ 14 km` i nie istnieje osada C,
dla której `max(d(A, C), d(B, C)) < d(A, B)`. Taki graf:

- nie ma zbędnych trójkątów;
- zawiera najkrótsze połączenia między skupiskami;
- rozstrzyga się lokalnie: C leży w odległości `d(A, B)` od obu końców,
  więc wystarczy obsadzić komórki siatki w zasięgu 28 km od punktu zapytania
  (ok. 6 próbek na komórkę).

Krawędź, dla której trasa nie powstanie (5.2), nie istnieje. Osada na wyspie
bez sąsiada zostaje bez drogi.

### 5.2 Trasa

Czysta funkcja pary: liczona zawsze od osady o mniejszym id, więc wychodzi
ta sama bez względu na kierunek podejścia lotu. Wejście to wyłącznie seed
i dwa środki osad.

- A* po siatce 48 m, na wysokości bazowej samplera, w korytarzu bbox pary
  + 3 km.
- Ląd poniżej 3 m jest ścianą. Limit spadku 12%, żeby zbocza wymuszały
  serpentyny. Jeśli pomiar na trzech seedach pokaże, że 12% odrzuca więcej niż
  10% par łączących się przy 25%, limit rośnie do najniższej wartości, która
  mieści się w tym progu.
- Koszt kroku: `bieg × (1 + 40 × spadek² + a × szum)`.
- Trasa dłuższa niż 2,5 × linia prosta jest odrzucana (objazd całego
  półwyspu).

### 5.3 Krętość zależna od terenu

Rzeźba `R` to spadek wysokości bazowej mierzony w skali 250 m wzdłuż trasy.

- Płasko (`R` małe): szum kosztu o skali 400–800 m z wagą `a` najwyższą. Trasa
  omija wyimaginowane pola i mokradła i idzie długimi łukami. Meander:
  boczne przesunięcie z szumu, 6–12 m przy długości fali 200–500 m.
- Pagórki: wagę `a` przejmuje koszt spadku. Trasa idzie dolinami i po
  warstwicach, meander maleje.
- Stromo: limit spadku wymusza zygzak w górę zbocza. Serpentyny mają
  minimalny promień nawrotu 20 m, meander jest wyłączony.
- Wszędzie indziej minimalny promień skrętu to 40 m: ciaśniejszy zakręt jest
  rozciągany w łuk.
- Wygładzanie bez prostowania: schodki siatki usuwają dwa przejścia Chaikina,
  a nie skrót po linii widoczności, który z płaskich odcinków robiłby
  linijki. Na koniec trasa jest próbkowana co 24 m.
- Wszystkie szumy są solone seedem i id pary: droga jest kręta, ale zawsze
  ta sama.

Wagi i progi (`a`, granice `R`, amplitudy) dostraja plan pomiarem krętości
(długość trasy / linia prosta) w trzech klasach terenu na trzech seedach.
Cel: płasko 1,1–1,25, pagórki 1,2–1,4, góry do 1,8.

### 5.4 Gdzie się liczy

- Worker według wzoru `sky/galaxy.worker.ts`, z `createWorldSampler(seed)` bez
  biomów. Wysokość bazowa nie zależy od rejestru, więc worker nie ładuje
  biblioteki ani `three/webgpu`. Sama funkcja trasy jest czystym modułem
  z testem w Node; worker to tylko jej opakowanie.
- Wątek główny (`scenery/Roads.ts`, nowy) obsadza osady w zasięgu pierścienia
  + 14 km, wyznacza krawędzie (5.1) i zleca pary od najbliższej lotowi.
  Gotowe trasy trzyma w cache po id pary i zapomina je tak jak plany
  (`KEEP_PAD`). Przy 62 m/s i ok. 50 ms na trasę kolejka jest daleko przed
  pierścieniem.

### 5.5 Droga widoczna z góry

- **Kawałki.** Trasa jest dzielona na kawałki po ok. 1 km. Kawałek w pierścieniu
  dostaje własną wstęgę z RoadKit (siatka po jednej na kawałek, w grupie
  `pools.roads`), a po wyjściu z pierścienia jest zwalniany. Kawałek zawsze
  leży w oknie wysokości, więc wstęga kładzie się na prawdziwym terenie
  razem z plateau.
- **Wejście do osady.** Odcinek poza promieniem osady jest rysowany zawsze.
  Odcinek wewnątrz promienia pojawia się dopiero razem z planem i kończy tam,
  gdzie pierwszy raz dotyka drogi planu.
- **Szerokość.** 5 m. W shaderze wierzchołka dalekie odcinki poszerzają się
  z odległością tak, żeby nie spaść poniżej ok. 1,5 piksela. Dochodzi jeden
  atrybut `side`, a limit ośmiu buforów wierzchołków jest daleko.
- **Kolor.** Każdy biom kraju podaje `params.road`, kolor kontrastujący z jego
  gruntem. Kolor jest mieszany po wagach wierzchołka; domyślnie `clay`.
- **Zanik.** Na krawędzi pierścienia (`RING_FADE`) droga wygasza się razem
  z drzewami.
- **Przesieka.** `Claims.forTrees` trzyma drzewa od drogi na połowę szerokości
  + 5 m (promień korony), co daje ok. 15 m przesieki przez las.
  `Claims.forGrass` trzyma trawę tylko z dala od samej wstęgi.
- **Statystyki.** `WorldDebug` i panel deweloperski pokazują trasy zbudowane,
  w kolejce i odrzucone. Przełącznik warstwy `roads` obejmuje też te drogi.

### 5.6 Testy etapu 2

- Graf:
  - wychodzi ten sam dla różnych punktów zapytania;
  - jest symetryczny;
  - nie ma krawędzi dłuższej niż 14 km;
  - każda krawędź kończy się dwiema osadami.
- Trasa:
  - wychodzi identyczna z obu końców;
  - nigdy nie schodzi poniżej 3 m;
  - spadek na trasie po wygładzeniu mieści się w limicie z tolerancją
    na Chaikina;
  - promienie skrętu i nawrotu są dotrzymane;
  - krętość mieści się w celach z 5.3.
- Kawałki i poszerzanie: RoadKit w Node, limit ośmiu buforów liczony jak
  w `structureKit.test.ts`.
- Claims: drzewa trzymają się od drogi na przesiekę.
- Przeglądarka: z wysokości 1 200 m nad seedem 42 droga między osadami jest
  w scenie, a `WorldDebug` pokazuje zbudowane trasy.

## 6. Dokumentacja

- AGENTS.md: wpis „A settlement sows the ground it claims" zastępuje reguła
  dziedziczenia kraju (4.2–4.4). Dochodzi `Claims` jako jedno źródło zajętego
  gruntu dla drzew, rekwizytów i trawy, a w etapie 2 wpis o drogach (graf,
  czysta funkcja pary, worker, kawałki).
- Komentarze w `settlement.js`, `village.js`, `town.js`, `presence.js`
  (`minTemp`) opisują nowy stan.
- Sekcja 8 specyfikacji głównej dostaje odnośnik do tego dokumentu.

## 7. Poza zakresem

Mosty i promy, autopilot prowadzony drogą, drogi w obrębie wyspy bez drugiej
osady, zmiana wysokości terenu pod drogą (wcięcia, nasypy), własne kolory
domów zależne od biomu.

## 8. Ryzyka

- **Las przykryje osadę.** Przy `clearing` 0,4 wioska w dżungli (1,2) ma
  gęstość 0,48, wyższą niż dzisiejsze 0,3. Test gęstości z 4.8 to wykryje,
  a `clearing` to jedna liczba.
- **Przepisywanie kafli trawy.** Kiedy plan przybywa w zasięgu trawy, dochodzi
  koszt przepisania kilku–kilkunastu kafli. Mierzone tak jak dziś przebudowy
  okna (`docs/perf-notes.md`); próg: żadna przebudowa ponad 5 ms.
- **Droga niewidoczna.** Poszerzanie w shaderze i kolor zależny od kraju
  trzeba ocenić na ujęciach z góry w kilku biomach przed zamknięciem
  etapu 2.
- **Serpentyny na siatce 48 m** mogą wyjść kanciaste mimo Chaikina. Jeśli tak,
  trasa w stromym terenie przechodzi na siatkę 24 m tylko w tym odcinku.

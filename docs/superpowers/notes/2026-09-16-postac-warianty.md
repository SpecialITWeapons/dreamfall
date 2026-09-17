# Postać: jak ją zamodelować i jak poprawić jej ruch (2026-09-16)

> **Zrobione (2026-09-17).** Wariant B — jedna ciągła skóra na kościach —
> jest w repozytorium: `src/engine/avatar/Skin.ts` (czysta geometria, testy w
> Node) i przepisany `ProceduralHuman.ts`. Wyszło **2 rysunki zamiast 20,
> 1 120 trójkątów zamiast 3 528, 16 kości i tyle samo mikrosekund na klatkę**
> — pomiar w `docs/perf-notes.md`, plan w
> `docs/superpowers/plans/2026-09-17-postac-skora-na-kosciach.md`. Dwie rzeczy
> z tej notatki okazały się nieprawdą po zmierzeniu: „3,5 µs na `update()`” to
> była wartość **sprzed** sprężyn (dziś te same bryły kosztują 8,6 µs), a
> „jeden rysunek” to dwa, bo głowa musi być osobną powierzchnią, żeby FPP miał
> co chować. Trzecia rzecz z §5 — zestaw póz — czeka.

Notatka badawcza, nie plan. Powstała na pytanie właściciela: *„szukam
rozwiązania, jak tę postać zrobić, aby wyglądała najwierniej jak człowiek, jak
to możliwe w tym silniku. Nie wiem, jakie są jeszcze sposoby, aby wymodelować
tę postać inaczej i poprawić fizykę zachowania”.*

Odpowiada na dwa osobne pytania — **jaki kształt** i **jaki ruch** — i kończy
się rekomendacją z kolejnością. Nic w repozytorium nie zostało zmienione poza
tym plikiem. Wszystkie liczby poniżej są albo z kodu, albo zmierzone; przy
każdej zmierzonej jest napisane, czym.

---

## 0. Streszczenie dla niecierpliwego

1. **Widok pierwszoosobowy to defekt, nie kwestia gustu.** Zmierzone: żaden z
   czterech widocznych w FPP kawałków ręki nie ma środka wewnątrz kadru, gdy
   patrzysz przed siebie (61°, 90°, 123° i 145° od osi patrzenia przy kadrze
   sięgającym 54°). Widać je dopiero, gdy rozejrzysz się w bok — a wtedy nie
   mają do czego być doczepione, bo tułów jest ukryty. Naprawa w §2.
2. **Sufit obecnego podejścia został osiągnięty.** Cztery commity naprawcze
   ruszały *pozy* (kąty stawów, stopa, kask, pozycja barku, track, bezwład).
   Żaden nie ruszył *powierzchni*: to nadal dwadzieścia osobnych brył, które się
   przenikają na twardych granicach koloru. Zbiór wypukłych bąbli nie czyta się
   jako ciało, bo oko czyta ciało po ciągłym konturze i po tym, jak skóra
   przechodzi przez staw.
3. **Rekomendacja:** jedna ciągła siatka na kościach (`SkinnedMesh`), nadal
   generowana proceduralnie z tych samych liczb co dzisiejsze zawiasy. To
   jedyny wariant, który likwiduje szwy u źródła, a nie zakrywa je czapeczką. W
   tym silniku jest tańszy, niż brzmi: wychodzi **mniej** trójkątów niż dziś i
   **jeden** rysunek zamiast dwudziestu, a materiał świata działa bez zmian.
4. **Fizyka jest praktycznie darmowa.** Zmierzone: całe `avatar.update()`
   kosztuje **3,5 µs** na klatkę. Przy klatce 16,7 ms nic z listy z §5 nie jest
   ograniczone kosztem — tylko pracą projektową. Dwa pola kontraktu (`vy`,
   `speed`) są podawane postaci co klatkę i **ignorowane**.

---

## 1. Co jest dzisiaj i dlaczego tak wygląda

### 1.1 Inwentarz

Plik `src/engine/avatar/ProceduralHuman.ts`, 386 linii. Postać to `Group`, w
niej `body`, a w nim dwadzieścia osobnych siatek (`Mesh`) powieszonych na
pustych obiektach-zawiasach (`Group`) tworzonych lokalną funkcją `hinge()`.

Zmierzone (Vitest w tym kontenerze, przechodząc geometrie):

| liczba | wartość |
| --- | --- |
| siatek (`Mesh`) | **20** |
| trójkątów | **3528** z budżetu **4000** |
| wierzchołków | 2334 |
| geometrii na rendererze | 20 z **51**, które silnik raportuje w locie (`perf-notes.md`, M3b) |
| materiałów | 1, wspólny (`litMaterial(vertexColor().rgb)`) |
| rysunków (draw calls) | 20 — nic ich nie łączy |
| koszt `update()` | **3,5 µs** (mediana z 5 rund po 20 000 wywołań) |
| koszt `updateMatrixWorld(true)` | 1,7 µs |
| koszt zbudowania postaci | 0,7–1,8 ms, raz, za zasłoną |

Trójkąty po częściach (na jedną sztukę): tułów 288, miednica 288, głowa 168,
kask 288, daszek 168, gogle 168, kula barku 168, ramię 144, przedramię 144,
dłoń 168, udo 144, łydka 144, but 168.

Warto to zapamiętać: **2334 wierzchołki idą na dwadzieścia zamkniętych brył**.
Każda kula i każda kapsuła płaci za własną, zamkniętą powierzchnię — także za
te jej połacie, które są schowane w środku sąsiada.

### 1.2 Jak duża jest na ekranie

Kamera trzecioosobowa: `fov` 55°, domyślny dystans **7 m**, minimalny **3 m**
(`Steering.ts`, `ORBIT`). Postać ma zmierzone **1,89 m** od dłoni (z = 0,72) do
buta (z = −1,17). Na 7 m pionowa połowa kadru to 3,64 m, czyli postać zajmuje
jakieś ćwierć wysokości ekranu; na 3 m **nie mieści się w kadrze**. Komentarz w
`Steering.ts` mówi to wprost: bliski koniec zoomu istnieje po to, żeby się jej
przyglądać. To nie jest figurka w oddali — szwy widać.

### 1.3 Dlaczego wygląda źle — konkretnie, z liczbami

**a) Bark to kula wbita w klatkę piersiową.** Staw barkowy siedzi w
(±0,20, 0,03, 0,26), a powierzchnia elipsoidy tułowia w tym kierunku jest
**4,7 cm** bliżej środka (zmierzone). Kula deltoidu ma promień 7,5 cm, więc
zakrywa dziurę — ale zakrywa ją tak, że **2,8 cm** kuli tkwi w klatce. Nie ma
tam szpary; jest twarde przecięcie dwóch gładkich powierzchni, na dodatek na
granicy dwóch kolorów wierzchołkowych. Oko czyta to jako dwie rzeczy sklejone,
nie jako jeden bark.

**b) Nie ma szyi i głowa wystaje do przodu, nie do góry.** Środek głowy jest w
(0, 0,01, 0,475), środek tułowia w (0, 0, 0,05). Czyli głowa jest **dokładnie
na wysokości klatki piersiowej**, wysunięta 11,5 cm przed jej czubek. Tylny
biegun kuli głowy wypada 1,1 cm **poza** elipsoidą tułowia (zmierzone) — szparę
zasłania kask, którego tylny biegun wchodzi do środka klatki. Efekt sylwetkowy:
łabędź. Człowiek w wolnym spadaniu na brzuchu ma **wygiętą do góry szyję** i
patrzy na horyzont; tu głowa leży poziomo na wprost mostka.

**c) Kończyny nie mają zbieżności.** `CapsuleGeometry` ma jeden promień, więc
ramię jest walcem 5,5 cm na całej długości, udo walcem 7,5 cm. Prawdziwa
kończyna jest grubsza przy tułowiu i cieńsza przy stawie. Bez tego kontur to
kiełbaski, i to jest ta cecha, po której oko od razu rozpoznaje „to nie ciało”.

**d) Dłoń i but to spłaszczone elipsoidy o przypadkowym obrocie.** `hinge()`
buduje orientację przez `setFromUnitVectors(UP, dir)` — czyli najkrótszy obrót
z osi +y na kierunek kończyny. Taki obrót **nie ustala skrętu wokół osi
kończyny**; nikt go nie wybrał. Zmierzone analitycznie (bez łopotu): oś
„grubości” dłoni wypada na (0,35, −0,87, 0,34), a buta na (0,03, 0,91, 0,42).
Wyszło z grubsza sensownie — wnętrze dłoni patrzy w dół, podeszwa do góry — i
wyszło **symetrycznie**, ale wyszło przypadkiem. Każda zmiana kierunku kończyny
przekręci dłoń i but w nieprzewidywalny sposób.

**e) Postać nie odbiera cienia.** `ProceduralHuman.ts:185` ustawia
`castShadow = true`; `receiveShadow` nie pada w tym pliku ani razu (teren,
trawa, propsy i wstęgi dróg mają). Ręka nigdy nie przyciemnia klatki, pacha
nigdy nie jest ciemniejsza od barku. Postać jest jedną płaską, równo oświetloną
masą.

I uczciwie: **włączenie `receiveShadow` samo tego nie naprawi.** Mapa cieni to
2048 pikseli na 720 m (`Lights.ts`: `SHADOW_MAP`, `SHADOW_HALF`), czyli
**0,35 m na teksel**, przy `normalBias` **0,5 m**. Ramię ma promień 4,5 cm.
Cień własny postaci jest poniżej rozdzielczości mapy zrobionej dla terenu i
drzew. Zacienienie kontaktowe na postaci musi przyjść z czegoś innego (tania
okluzja w materiale albo przyciemnienie wpieczone w kolory wierzchołków przy
stawach) — patrz §4.

**f) Trzy z siedmiu kolorów stroju są poza kopertą koloru świata.** Koperta ze
spec §5.5 i `library/contract.ts`: nasycenie ≤ 0,62, jasność 0,18..0,93.
Zmierzone dla stroju `dusk`: gogle L = **0,122**, buty i rękawice L = **0,151**.
Stroje nie są wpisami biblioteki, więc `validateColor` ich nie ogląda. To
drobiazg, ale działa dokładnie tak, jak działa każdy element poza kopertą:
postać nie wygląda, jakby należała do tego świata.

**g) Łopot to metronom.** `flutter = 0.05 + 0.09 * gust` radianów, czyli od
**2,9° do 8,0°**, jako czysty sinus o jednej częstotliwości na staw, wokół
jednej osi. `windPhase` rośnie 4,5–8 rad/s, czyli 0,7–1,3 Hz. Ludzkie oko bardzo
dobrze wyłapuje pojedynczą sinusoidę i czyta ją jako mechanizm.

---

## 2. Widok pierwszoosobowy — diagnoza i konkretna naprawa

To jedyny punkt tej notatki, w którym oczekiwana jest jedna odpowiedź, bo to
usterka, a nie sprawa gustu.

### 2.1 Co zrobił commit `d8ac3bc`

Przed nim FPP pokazywał przedramię i rękawicę. Commit dołożył kulę barku i
ramię, z uzasadnieniem, że „przedramię samo wisi w powietrzu i nic go nie łączy
z patrzącym”. Uzasadnienie było trafne, lekarstwo nie: zamiast dwóch wiszących
przedramion są teraz dwa wiszące całe ramiona. Właściciel opisał to dokładnie
tak samo.

### 2.2 Co naprawdę widzi oko — zmierzone

Oko jest w (0, −0,03, 0,56) w układzie postaci. FPP ma `fov` 75° i `near` 0,1 m
(`ChaseCamera.ts`, `FPP`). Rozglądanie sięga **±110° w poziomie** i ±60° w
pionie (`Steering.ts`, `LOOK`).

Dla każdej siatki przeszedłem wszystkie wierzchołki i policzyłem odległość od
oka oraz kąt od osi patrzenia (patrząc prosto przed siebie):

| część | widoczna w FPP | najbliższy wierzchołek | kąt najbliższego rogu | **kąt środka** |
| --- | --- | --- | --- | --- |
| dłoń | tak | 0,292 m | 47,4° | **61,4°** |
| przedramię | tak | 0,293 m | 61,9° | **89,8°** |
| ramię | tak | 0,313 m | 97,6° | **122,6°** |
| kula barku | tak | 0,291 m | 133,4° | **145,1°** |
| tułów | nie | **0,202 m** | 152,4° | 176,5° |
| miednica | nie | 0,700 m | 168,1° | 178,6° |
| udo | nie | 0,911 m | 167,7° | 172,4° |
| łydka | nie | 1,345 m | 163,2° | 168,9° |
| but | nie | 1,628 m | 163,0° | 164,7° |
| głowa | nie | **0,012 m** | — | — |
| gogle | nie | **0,025 m** | — | — |
| kask | nie | **0,039 m** | — | — |
| daszek | nie | **0,089 m** | — | — |

Kadr przy `fov` 75° w pionie sięga 37,5° w górę i w dół, a w bok:
**50,8°** przy proporcji 16:10 i **53,8°** przy 16:9.

Z tego wynikają trzy rzeczy, wszystkie sprzeczne z tym, co się myśli o tym
widoku:

1. **Nic nie jest przycinane przez `near`.** Najbliższy widoczny wierzchołek
   ręki jest 0,29 m od oka, przy `near` 0,1 m. Ręce nie są „przecięte”.
2. **Patrząc przed siebie, nie widać ich prawie wcale.** Środek rękawicy jest
   61° od osi, a kadr kończy się na 54°. W kadr wchodzi tylko wewnętrzny skrawek
   rękawicy, w samym rogu. Reszta ręki jest poza kadrem — ramię 123°, bark 145°,
   czyli **za plecami patrzącego**.
3. **Widać je dopiero po rozejrzeniu się.** Rozglądanie sięga 110°, więc pilot
   może spojrzeć dokładnie na własny bark — i widzi kulę oraz walec zawieszone w
   niczym, bo tułów jest ukryty. To jest zgłoszona usterka, co do jednego stopnia.

### 2.3 Czego potrzebuje widok własnych rąk, żeby czytał się jako *twój*

Trzech rzeczy. Wszystkie są mierzalne i wszystkie dziś zawodzą:

**(i) Korzeń, który widać.** Ręka musi dochodzić do czegoś, co jest
bezspornie własnym ciałem. Zmierzone: najbliższy wierzchołek tułowia jest
**0,202 m** od oka, przy `near` 0,1 m — czyli klatkę piersiową **można po
prostu pokazać**. To samo dotyczy miednicy (0,70 m), ud (0,91 m), łydek
(1,35 m) i butów (1,63 m). Jedyne cztery siatki, których pokazać nie wolno, to
te, w których siedzi kamera: głowa (0,012 m), gogle (0,025), kask (0,039) i
daszek (0,089) — wszystkie bliżej niż `near`.

**(ii) Ręce w kadrze.** Dziś środki rękawic są 7° poza kadrem przy 16:9 i 11°
poza przy 16:10. Prawdziwa pozycja pudełkowa stawia dłonie na dolnej krawędzi
pola widzenia. Trzeba je przysunąć do przodu i do środka — albo pozą, albo
niewielkim przesunięciem stosowanym tylko w FPP.

**(iii) Oko tam, gdzie ma oko pilot.** To jest przyczyna źródłowa. Dziś oko jest
na czubku głowy, która wystaje poziomo z klatki: **0,30 m przed** barkiem i
**0,06 m pod** nim. U człowieka oko jest **nad** linią barków, a spadochroniarz
na brzuchu ma dodatkowo wygiętą do góry szyję. Ponieważ barki są za okiem,
ręce wchodzą w kadr *od tyłu* — i żadne żonglowanie widocznością siatek tego nie
naprawi.

### 2.4 Rekomendacja

1. **Ukryć w FPP wyłącznie grupę głowy** — `head`, `helmet`, `visor`,
   `goggles`. Pokazywać całą resztę. Pojęcie `fppHands` przestaje mieć sens:
   opcja nazywa się teraz „ukryj głowę”, a nie „pokaż ręce”. (Sprawdzone:
   `fppHands` nie jest nigdzie ustawiane w silniku — `World.ts:158` przekazuje
   tylko strój i wzór — więc jedynym użytkownikiem `fppHands: false` jest test.)
2. **Dodać staw szyi i wygiąć głowę do góry**, a oko przenieść na zawias głowy.
   Kontrakt już na to pozwala: `ChaseCamera` czyta `avatar.eye` **co klatkę**
   (`World.ts:236` → `bodyToWorld(eye, …)`), więc `eye` może być tym samym
   `Vector3` przepisywanym w `update()`. Interfejs `Avatar` nie musi się zmienić
   ani o literę.
3. **Przysunąć dłonie tak, żeby rękawice siedziały w dolnych rogach kadru.**
   Kryterium jest liczbowe i nadaje się na asercję testu: kąt środka rękawicy od
   osi patrzenia < 45°, czyli z zapasem wewnątrz najwęższego sensownego kadru.
4. **Uwaga na skutek uboczny, który się wtedy ujawni:** kamera FPP bierze tylko
   40 % przechyłu (`FPP.bankShare = 0.4`) i dokłada 2 cm bujania
   (`FPP.bob = 0.02`), podczas gdy ciało bierze 100 % przechyłu. Dopóki ciała nie
   widać, nikt tego nie zauważy. Gdy klatka piersiowa będzie na ekranie
   0,2 m od oka, jej obrót względem kamery stanie się widoczny. Albo `bankShare`
   idzie do 1, albo bujanie musi ruszać całą postacią, a nie samą kamerą.

Krok 1 to kilka linii i jest do zrobienia natychmiast. Kroki 2–4 wchodzą razem z
pracą nad sylwetką i mają sens dopiero z nią.

---

## 3. Ograniczenia, w których musi zmieścić się każda odpowiedź

Sprawdzone w źródle, nie założone.

| ograniczenie | wartość | gdzie |
| --- | --- | --- |
| trójkąty postaci | **4000**, dziś 3528 | spec §5.5; `HUMAN_TRIANGLE_BUDGET`; test tego pilnuje |
| jeden materiał oświetlenia dla całego świata | `createLitMaterial`, model pasmowy bez odblasku | `SoftLighting.ts`; spec §2 („oświetlenie zostaje w silniku”) |
| ciało bez tekstur | kolor idzie z `vertexColor()`, postać nie ma dziś ani jednej mapy | `ProceduralHuman.ts:160` |
| koperta koloru | S ≤ 0,62, L 0,18..0,93 | spec §5.5, `contract.ts` |
| budżet pikseli / DPR | 2 000 000, DPR ≤ 1,5 | AGENTS.md |
| koszt klatki dziś (prawdziwy GPU) | mediana **3,15 ms** z 16,7 ms | `perf-notes.md`, M3a |
| co `Avatar` musi wystawiać | `object`, `update(pose, dt)`, `eye`, `bounds{below, radius}`, `setOutfit`, `dispose` | `Avatar.ts`; spec §9 |
| postawienie przed pierwszą klatką | `dt <= 0` znaczy „bądź tam natychmiast” | `ProceduralHuman.ts:319`; AGENTS.md |
| testy | CPU w Vitest zawsze, GPU w Playwright | AGENTS.md, spec §13 |
| zasłona | schodzi po `waitForGpu()` po pierwszej klatce; start to dziś ~2,1 s na prawdziwym GPU, z czego 1,8 s to kompilacja shaderów | AGENTS.md, `perf-notes.md` |
| `uncapturederror` | zawsze śmiertelny; shader, który tylko ostrzega, nie wchodzi | AGENTS.md |
| zależności | **jedna**: `three` przypięte do 0.185.1; w repozytorium **nie ma ani jednego pliku binarnego** (ani png, ani glb, ani svg) | `package.json`, przeszukanie repo |

Co jeszcze wyszło przy sprawdzaniu, a warto wiedzieć:

- **`bounds.radius` nie jest przez nic czytane.** W całym silniku konsumowane
  jest tylko `bounds.below` (`World.ts:120` i `:125`). `radius` istnieje w
  kontrakcie i w spec, i nic go nie pyta. Nowy model ciała musi go dostarczyć,
  ale nic go nie kosztuje.
- **Zadeklarowane `bounds` są niezgodne z rzeczywistą bryłą.** Zmierzony zasięg
  w poziomie to **1,31 m** w pudełku i **1,41 m** w nurkowaniu, a
  `HUMAN_BOUNDS.radius` mówi **1,1**. Zwis pod środkiem to zmierzone 0,13 m przy
  deklarowanych 0,3 (tu zapas jest bezpieczny, bo w dobrą stronę). AGENTS.md ma
  dla scenerii regułę, że przeszkoda nigdy nie może zaniżyć zajętego miejsca —
  postać robi dokładnie to, czego tam zakazano. Dziś nieszkodliwe, bo nikt nie
  pyta.
- **Wzorców pikselowych jeszcze nie ma** (`tests/references/` nie istnieje;
  narzędzia wchodzą w M5). To jest okno: przebudowa postaci **teraz** nie unieważnia
  żadnego wzorca. Po M5 ta sama zmiana będzie kosztować rundę porównań.

### Co przypina test (`tests/unit/proceduralHuman.test.ts`)

Warto to mieć przed oczami, bo to jest to, czego nie da się zmienić po cichu:
dokładnie **20 siatek**, trójkątów >1500 i ≤4000, `castShadow` na wszystkich,
zgięcie łokcia 60–110°, kolana 55–100°, złamanie buta od łydki >20°, dłonie
ponad 0,2 m w bok i przed okiem, kostka wyżej niż biodro o 0,25 m, kolano za
biodrem o 0,3 m, szpara barku < promień ramienia, kolejność obrotów `YXZ`,
bezwład stawów (bark rusza się przed łokciem, ale po sekundach dochodzi do tej
samej pozy), oraz **dokładnie osiem widocznych siatek w FPP o nazwach
`deltoid`, `upperArm`, `forearm`, `hand`**. Ten ostatni test trzeba będzie
świadomie przepisać razem z §2.

---

## 4. Warianty modelowania

Dla każdego: czym jest, jak wygląda, ile kosztuje zbudowanie, ile kosztuje na
klatkę, co psuje.

### Wariant A — zostać przy bryłach i naprawić stawy

**Czym jest.** Bez zmiany architektury. Kapsuły i elipsoidy zostają osobnymi
siatkami na zawiasach; poprawia się to, co daje kontur:

- zbieżność kończyn: zamiast `CapsuleGeometry` (jeden promień) — stożek ścięty z
  kulami na końcach albo własna „obrotówka” (`LatheGeometry`), grubsza przy
  tułowiu;
- szyja jako osobny staw, głowa wygięta do góry;
- kręgosłup: klatka i miednica na jednym zawiasie pośrodku, żeby łuk pleców
  („arch”) był łukiem, a nie zawiasem biodrowym;
- dłoń i but z ustalonym skrętem (patrz §1.3 d): kierunek kończyny **plus**
  wektor odniesienia, a nie sam najkrótszy obrót;
- hojne przenikanie zamiast stykania się: każda bryła wchodzi w sąsiada głęboko,
  a na styku ten sam kolor po obu stronach, żeby granica koloru nie leżała
  dokładnie na krawędzi przecięcia.

**Jak wygląda.** Lepiej. Nadal jak zestaw brył — bo nadal jest zestawem brył.
Kontur się poprawia (zbieżność, szyja), ale każdy staw dalej jest miejscem,
gdzie jedna zamknięta powierzchnia wychodzi z drugiej. W ruchu, przy dużych
wymachach, dalej będzie widać, że „czapka” barku kręci się niezależnie od
klatki.

**Koszt budowy.** Najmniejszy z wszystkich: pół dnia do dnia. Nie rusza testów
poza liczbą siatek i kątami.

**Koszt na klatkę.** Zero zmiany. Może o kilka siatek więcej (szyja,
kręgosłup) — czyli 22–24 rysunki zamiast 20, przy klatce, która dziś kosztuje
3,15 ms.

**Co psuje.** Nic. To jedyny wariant bez ryzyka.

**Uczciwa ocena.** To jest czwarta runda tego samego. Cztery poprzednie commity naprawcze
(`321fc81`, `e44d828`, `411b393`, `d8ac3bc`) robiły dokładnie to i właściciel
po każdej rundzie mówił „nadal źle”. Wariant A jest wartościowy **jako przygotowanie**
do wariantu B — bo szkielet, proporcje i pozy przenoszą się jeden do jednego —
ale sam z siebie nie zamknie sprawy.

### Wariant B — jedna ciągła siatka na kościach (`SkinnedMesh`) — **rekomendowany**

**Czym jest.** Zamiast dwudziestu brył jest **jedna powłoka** — jak skóra
kombinezonu — i osobno **szkielet**: drzewo kości (`Bone`), czyli dokładnie to
samo drzewo, które dzisiaj tworzy `hinge()`. Każdy wierzchołek powłoki ma
przypisane, w jakim stopniu należy do której kości („wagi”): wierzchołek w
połowie ramienia należy w 100 % do kości ramienia, wierzchołek tuż przy łokciu
pół na pół do ramienia i przedramienia. Gdy kość się obraca, GPU przelicza
wierzchołki. W łokciu skóra **zgina się**, zamiast rozjeżdżać się na dwie bryły.

Kluczowe: **powłoka nadal jest generowana proceduralnie**, z tych samych liczb,
którymi dziś opisane są kierunki i długości kończyn. To nie jest „wczytany
model”; to jest ten sam generator, który zamiast składać bryły, nawleka pierścienie
wierzchołków wzdłuż łańcucha kości i zszywa je w rurę.

**Jak wygląda.** Ciało z ciągłym konturem: bark przechodzi w ramię, szyja w
kark, pacha jest pachą. Znikają wszystkie szwy z §1.3 a i b naraz, bo nie ma
czego zszywać — jest jedna powierzchnia. Dochodzą rzeczy, których dziś nie da
się zrobić w ogóle: przewężenie w talii, łopatki, wygięty łuk pleców, kołnierz
kombinezonu.

**Koszt budowy.** Największa pozycja tej notatki, i jedyna warta tego czasu:
1–2 dni na pierwszą wersję plus strojenie. Praca dzieli się na trzy kawałki:
generator pierścieni wzdłuż łańcucha (rura z zadaną liczbą pierścieni i boków),
funkcja wag (odległość wzdłuż łańcucha, wygładzona wokół stawu — kilkanaście
linii) i profil ciała (promień jako funkcja położenia wzdłuż tułowia i kończyny —
czyli dane, nie kod).

**Koszt na klatkę.** *Niższy niż dziś.* Trzy rzeczy, wszystkie sprawdzone:

- **Mniej trójkątów.** Dziś 3528 trójkątów i 2334 wierzchołki idą na dwadzieścia
  **zamkniętych** brył. Rura ma `(pierścienie−1) × boki × 2` trójkątów;
  szacunek arytmetyczny dla rozsądnego podziału (tułów 8×12, każda ręka 6×8,
  każda noga 7×8, głowa 12×8, kask 16×10, dłonie i buty jako niskie bryły) to
  około **1200–1600 trójkątów** plus zaślepki — czyli mniej niż połowa dzisiejszych,
  przy nieporównanie lepszym konturze. To szacunek ze wzoru, nie pomiar.
- **Jeden rysunek zamiast dwudziestu**, i 32 geometrie na rendererze zamiast 51.
- **Żadnego nowego materiału.** Sprawdzone w kodzie przypiętej wersji: materiał
  węzłowy sam wykrywa `isSkinnedMesh` i dokłada węzeł `skinning`
  (`three.webgpu.js:21545`; `three/tsl` eksportuje `skinning`). Czyli
  `litMaterial(vertexColor().rgb)` zostaje bez jednej zmiany, a skoro to nadal
  ten sam materiał, kompilacja za zasłoną nie rośnie o nowy program.

**Co psuje.**

- Test jednostkowy trzeba przepisać. Ale mniej, niż się wydaje: kości to też
  `Object3D` z nazwami, więc `getObjectByName('shoulderL')` i wszystkie asercje
  o kątach i pozycjach stawów działają dalej. Zmieniają się asercje o liczbie
  siatek i o widoczności w FPP — a ta druga i tak się zmienia przez §2.
- `setOutfit` musi działać inaczej: dziś przemalowuje kolory wierzchołków
  **na siatkę**. Przy jednej siatce swatch staje się **zakresem wierzchołków**
  (generator wie, który pierścień jest rękawicą, a który kombinezonem).
  Mechanizm zostaje ten sam — przepisanie atrybutu koloru, bez nowego bufora,
  dokładnie jak dzisiejsza funkcja `paint`.
- Widoczność części w FPP przestaje być „ukryj siatkę”. Z jedną siatką głowę
  chowa się albo drugim `SkinnedMesh`-em na tym samym szkielecie (głowa osobno —
  wtedy 2 rysunki), albo zerowaniem skali kości głowy. Pierwsze jest czytelniejsze.
- `SkinnedMesh` ma własną pułapkę z obcinaniem widokiem (sfera otaczająca liczy
  się z pozy spoczynkowej). Na jednym obiekcie `frustumCulled = false` kosztuje
  zero i zamyka temat.

**Zgodność z regułami.** Pełna, i to jest wariant, który spec **wprost
przewiduje**: §2 („interfejs `Avatar`, który pozwala później podstawić model
szkieletowy”) i §17 („interfejs `Avatar` pozwala na model szkieletowy bez zmian
w silniku”). Tu nie trzeba niczego negocjować.

### Wariant C — jedna siatka deformowana w vertex shaderze (TSL)

**Czym jest.** Powłoka jak w B, ale zamiast szkieletu i wag liczonych przez
silnik, wierzchołki przesuwa **własny kod w shaderze wierzchołków** (w tym
silniku: węzły TSL podpięte pod `positionNode`). Kości wchodzą jako uniformy;
całe wyginanie dzieje się na GPU.

**Jak wygląda.** Dokładnie tak jak B. Różnica jest wyłącznie w tym, kto liczy.

**Koszt budowy.** Wyższy niż B przy identycznym efekcie, bo cała logika
przenosi się do języka, w którym trudniej się debuguje — i, co ważniejsze,
**wypada z Node**. AGENTS.md wymaga, żeby wszystko, co liczy CPU, miało test w
Vitest, a GPU jest sprawdzane w Playwright. Dzisiejsze testy postaci czytają
pozycje stawów w Node. Po przeniesieniu wyginania do shadera **nie da się
sprawdzić w Node, gdzie jest dłoń** — bo tego nie wie już nikt poza GPU.

**Koszt na klatkę.** Teoretycznie najniższy, praktycznie nieodróżnialny. Cała
dzisiejsza animacja CPU to zmierzone **3,5 µs**. Nie ma czego oszczędzać.

**Co psuje.** Widoczność w testach (powyżej), a przy okazji przesuwa postać na
tę stronę, gdzie każdy błąd jest `uncapturederror` — a ten jest z założenia
śmiertelny (AGENTS.md).

**Uczciwa ocena: to jest ten sam efekt za wyższą cenę i z gorszą
sprawdzalnością.** Jedyny powód, dla którego warto by to rozważać, to tysiące
postaci naraz — a tu jest jedna. **Odradzam.**

### Wariant D — gotowy model glTF z riggiem

**Czym jest.** Ktoś rzeźbi i „ubiera w kości” człowieka w programie do
modelowania, eksportuje do `.glb`, a aplikacja wczytuje plik.

**Jak wygląda.** Potencjalnie najlepiej ze wszystkich — bo modelem zajmuje się
człowiek, który to umie.

**Czy reguły na to pozwalają — sprawdzone.** Nie ma reguły, która tego zakazuje
wprost. Spec dopuszcza „model szkieletowy”, nie precyzując, skąd ma pochodzić.
Ale koliduje z czterema rzeczami zapisanymi w spec i AGENTS.md, i to nie są
drobiazgi:

1. **Stroje.** Spec §9 przewiduje katalog stroje × wzory, przypisanie regułą i
   „szafę” za przyciskiem, a `setOutfit(outfit, pattern)` jest w kontrakcie.
   Dzisiejszy mechanizm to przemalowanie kolorów wierzchołków po siedmiu
   swatchach. Model z zewnątrz ma własne materiały i własne tekstury; żeby
   przyjął stroje, trzeba by go przy wczytaniu rozebrać na te same siedem
   swatchów. Jest to wykonalne i jest to praca, której nie widać.
2. **Jedno oświetlenie.** Spec §2 i AGENTS.md: każda oświetlona powierzchnia
   świata idzie przez `createLitMaterial`; biom może odcieniować, nie podmienić.
   Materiały z pliku trzeba by wyrzucić i podstawić materiał świata — czyli
   stracić to, za co się płaciło (mapy PBR), albo dołożyć tekstury do ciała,
   którego dziś w ogóle nie ma teksturowanego.
3. **Zasłona i start.** Zasada §3.5: zasłona schodzi po pierwszej klatce.
   Dochodzi pobranie pliku przez sieć **przed** tym momentem, do startu, który
   dziś trwa ~2,1 s na prawdziwym GPU.
4. **Tożsamość projektu i testy.** W repozytorium **nie ma ani jednego pliku
   binarnego**, a jedyna zależność runtime to `three`. Doszedłby `GLTFLoader` z
   dodatków, licencja modelu, i pytanie, jak testować w Node coś, czego kształtu
   nie generuje kod. Spec §1 opisuje świat generowany z ziarna; postać jest
   jedyną rzeczą w kadrze, która nie jest.

**Koszt budowy.** Model: kupiony albo zlecony (poza repozytorium). Integracja:
dzień–dwa na loader, rozbiór na swatchy, mapowanie animacji na `FlightPose` i
etap zasłony. Plus utrzymanie przy każdej aktualizacji `three`.

**Koszt na klatkę.** Zależy od modelu. Typowy rigowany człowiek z asset store to
dziesiątki tysięcy trójkątów — czyli **kilkukrotne przekroczenie budżetu 4000**,
chyba że osobno się go uprości.

**Uczciwa ocena.** Nie zakazane, ale to wariant, który kosztuje najwięcej reguł
za najmniej pewności. Nie polecam **teraz**. Sensowny tylko jako świadoma
decyzja właściciela typu „rezygnuję z proceduralnej postaci na rzecz wyglądu”, i
wtedy trzeba to dopisać do spec §2 i §9, a nie przemycić.

### Wariant E — powłoka wytopiona z brył (SDF / marching cubes), potem oskórowana

**Czym jest.** Wariant B bez pisania generatora powłoki. Bierze się **dokładnie
te same bryły co dziś**, traktuje jako jedną gładką sumę (technika zwana
metaballs: każda bryła to pole, pola się dodają, powierzchnia to miejsce, gdzie
suma przekracza próg) i **raz przy starcie** wytapia z tego jedną siatkę.
Potem przypina się ją do tych samych kości co w B.

**Jak wygląda.** Bardzo dobrze na stawach — bo tam, gdzie dwie bryły się
przenikają, suma robi **gładkie przejście** zamiast twardej krawędzi. Dokładnie
to, czego brakuje na barku i szyi. Gorzej na krawędziach, które mają być ostre:
daszek kasku i podeszwa buta rozpłyną się razem z resztą.

**Koszt budowy.** Sam algorytm to znana rzecz, ale nie ma go w `three` — trzeba
napisać. Dzień.

**Koszt na klatkę.** Zero (wytapianie jest raz, za zasłoną), ale **koszt startu
rośnie** i, co ważniejsze, **liczba trójkątów jest trudna do kontroli**: siatka
z takiego wytapiania przy siatce 64³ to zwykle 5–10 tys. trójkątów, czyli
powyżej budżetu 4000, a w `three` nie ma upraszczania siatek.

**Uczciwa ocena.** Ładny pomysł z realnym problemem budżetowym. Warto trzymać w
zanadrzu jako sposób na zrobienie *pierwszej* powłoki dla wariantu B (wytopić,
obejrzeć, przepisać ręcznie na pierścienie), a nie jako rozwiązanie docelowe.

### Zestawienie

| | A: bryły poprawione | **B: skinning** | C: TSL | D: glTF | E: wytapianie |
| --- | --- | --- | --- | --- | --- |
| likwiduje szwy | nie | **tak** | tak | tak | tak |
| trójkąty | ~3500 | **~1200–1600** (szacunek) | jw. | 10k+ | 5–10k, poza budżetem |
| rysunki | 20–24 | **1–2** | 1 | 1+ | 1 |
| nowy materiał / kompilacja | nie | **nie** | tak | tak | nie |
| testowalne w Node | tak | **tak** | **nie** | słabo | tak |
| zgodne ze spec | tak | **wprost przewidziane** | tak | koliduje z 4 miejscami | tak |
| czas | 0,5–1 dnia | **1–2 dni** | 2–3 dni | 2 dni + model | 1 dzień |

---

## 5. Warianty zachowania i „fizyki”

To jest osobne pytanie od kształtu i warto je trzymać osobno: **najwierniejszy
kształt poruszany metronomem dalej będzie wyglądał jak lalka, a bardzo dobry
ruch ratuje nawet przeciętny kształt.** Animatorzy mówią, że ruch czyta się z
większej odległości niż kształt, i tu jest to prawda dosłownie: przy dystansie
kamery 7 m widać ruch całej sylwetki, a szwy dopiero po najechaniu.

Punkt wyjścia, z kodu: każdy staw goni cel przez filtr pierwszego rzędu ze stałą
czasową 0,10 s (bark, biodro), 0,17 s (łokieć, kolano) i 0,24 s (kostka).
Do tego jeden sinus łopotu na staw. I dwa fakty, które to ustawiają:

- **`pose.vy` i `pose.speed` nie są w `update()` czytane ani razu.** Kontrakt
  podaje je co klatkę (`Avatar.ts`), postać ich nie używa. Jedyne, co wie o
  powietrzu, to `pitch`, `bank`, `gust` i `windPhase`.
- **`windPhase` nie zależy od prędkości lotu.** `FlightController.ts:408`:
  `windPhase += dt * (4.5 + 3.5*gust + |vy|*0.1)`. Prędkość powietrzna waha się
  od 30 do 62 m/s i **nie wchodzi tu w ogóle** — a dźwięk jej używa
  (`World.ts`: `rush = speed / SPEED`, `AmbienceModel.windParams`). Czyli przy
  nurkowaniu **szum się wzmaga, a kombinezon łopocze tak samo**. Oko i ucho
  mówią co innego.

### 5.1 Sprężyna z tłumieniem zamiast filtru pierwszego rzędu — **widać, tanie**

**Czym jest.** Dzisiejszy filtr (`x += (cel − x) * k`) potrafi tylko jedno:
dojść do celu, zwalniając. Nigdy go nie przekroczy. Sprężyna z tłumieniem ma
dwa stany zamiast jednego (położenie **i prędkość**), więc kończyna **wybiega za
cel i wraca** — dokładnie to, co robi ręka w powietrzu, kiedy szarpniesz
barkiem. Przy tłumieniu krytycznym zachowuje się jak dziś, więc to jest
nadzbiór, nie zamiana.

**Co daje.** Wszystkie szarpnięcia — podmuch, wejście w nurkowanie, przechył —
przestają być „przesunięciem”, a stają się „ruchem, który ma masę”.

**Koszt.** Dwie liczby więcej na staw i pięć linii arytmetyki. Przy zmierzonych
3,5 µs na całe `update()` nie ma o czym mówić. Pół dnia z testami.

**Uwaga o regule.** `dt <= 0` musi dalej znaczyć „bądź tam natychmiast”
(AGENTS.md, świat stawia postać przed pierwszą klatką) — czyli przy `dt <= 0`
sprężyna skacze do celu i zeruje prędkość. To jedna linia, ale łatwo o niej
zapomnieć i wtedy postać wjeżdża w pierwszą klatkę w trakcie dochodzenia.

### 5.2 Prędkość powietrzna wchodzi do postaci — **widać, najtańsze ze wszystkich**

**Czym jest.** Trzy odczyty pól, które już przychodzą:
- częstotliwość i amplituda łopotu rosną z `speed` (albo dokładniej: z
  ciśnieniem dynamicznym, czyli z kwadratem prędkości — to ta sama liczba, którą
  dźwięk nazywa `rush`);
- kończyny są **spychane do tyłu** tym mocniej, im szybciej leci — opór powietrza
  jest realny i to jest ta cecha, po której widać, że ktoś leci, a nie pozuje;
- `vy` dokłada do łuku pleców: mocne nurkowanie to mocniejszy łuk.

**Co daje.** Nurkowanie i wznoszenie przestają różnić się samą pozą ramion.
Dodatkowo naprawia rozjazd oka i ucha opisany wyżej.

**Koszt.** Godziny. Zero ryzyka.

### 5.3 Zestaw póz mieszanych prędkością i położeniem, zamiast jednej pozy „track” — **widać, średnio drogie**

**Czym jest.** Dziś są dwie pozy: pudełko i `trackDir` (ręce wzdłuż ciała), a
nurkowanie przechodzi między nimi jednym parametrem. Spadochroniarz ma ich
więcej i różnią się czytelnie: pudełko (wolno, stabilnie), track (szybko, na
wprost), delta (pośrednia), zakręt (jedna ręka niżej, przeciwna noga
wyprostowana), hamowanie (ręce szeroko i do przodu, kolana bardziej zgięte).
Zamiast jednej osi `pitch` wybiera się pozę z dwóch–trzech osi: prędkość
powietrzna, kąt lotu, tempo skrętu.

**Co daje.** To jest wariant, który najmocniej podnosi „wierność człowieka”,
bo prawdziwy spadochroniarz **zmienia kształt, żeby lecieć inaczej**, a nie
leci inaczej, kończąc w innym kształcie. Dziś jest odwrotnie: autopilot
decyduje o kącie, a kształt jest jego skutkiem.

**Koszt.** Pozy to dane (po jednym kierunku na kończynę, tak jak dzisiejsze
`upperDir`/`foreDir`), więc pisania jest mało; strojenia dużo. Pół dnia do dnia.
Ma sens **po** wariancie B, bo poza bez ciągłej skóry dalej będzie wyglądać jak
przestawienie brył.

### 5.4 Kombinezon i tkanina — **prawie niewidoczne, drogie**

**Czym jest.** Symulacja tkaniny: siatka punktów połączonych sprężynami, z
oporem powietrza, licząca się co klatkę. Albo lżej: kilka „płatów” pod pachami i
między nogami, które napinają się z prędkością.

**Co daje w tym świecie.** Bardzo mało. Powód jest prozaiczny i liczbowy:
postać jest oglądana z 7 m przy `fov` 55°, na ekranie ma jakieś ćwierć
wysokości kadru, a materiał świata jest **pasmowy, bez odblasku** (`SoftLighting`) —
czyli fałda daje jeden stopień jaśniej, nie błysk. Falowanie tkaniny na tej
skali i przy tym oświetleniu jest poniżej progu widzenia.

**Koszt.** Najwyższy z całej listy: symulacja, jej stabilność przy 30–62 m/s,
test w Node, i nowa geometria co klatkę — a to ostatnie łamie zasadę §3.4
(„stałe alokacje, geometria świata nigdy nie rośnie”) w duchu, jeśli nie w
literze.

**Werdykt: to jest niewidoczny wysiłek.** Nie robić. Jedyny kawałek tego pomysłu
wart wzięcia to §5.2 — niech łopot **wie o prędkości**; to daje 90 % odczucia za
1 % pracy.

### 5.5 Głowa, która patrzy — **widać, tanie, i naprawia też FPP**

**Czym jest.** Staw szyi, a na nim: wygięcie do góry w wolnym spadaniu (§1.3 b),
patrzenie w stronę skrętu, opuszczanie wzroku przy niskim przelocie. Głowa
prowadzi ruch — u człowieka głowa skręca **przed** ciałem.

**Co daje.** Nieproporcjonalnie dużo: patrząca głowa to najsilniejszy sygnał
„to jest ktoś, a nie manekin”, jaki można dodać za tę cenę. A przy okazji jest
to krok (2) z rekomendacji dla FPP, więc płaci się raz.

**Koszt.** Jeden zawias plus arytmetyka. Godziny.

### 5.6 Skręt całym ciałem, nie samą ręką — **widać, tanie**

**Czym jest.** Dziś skręt to `drop`: wewnętrzna ręka schodzi niżej o pół
radiana razy przechył, i tyle. Spadochroniarz skręca asymetrią całego ciała:
jedno ramię niżej i do tyłu, przeciwna noga bardziej wyprostowana, biodra
skręcone.

**Co daje.** Skręt przestaje być obrotem całej bryły z opuszczoną ręką.

**Koszt.** Kilka linii w istniejącej pętli po stawach, przy istniejącym polu
`bank`. Godziny.

### Które z tych widać

| | widać z 7 m | koszt | kolejność |
| --- | --- | --- | --- |
| 5.2 prędkość wchodzi do postaci | **tak, natychmiast** | godziny | **najpierw** |
| 5.5 patrząca głowa | **tak** | godziny | z pracą nad sylwetką |
| 5.1 sprężyna z tłumieniem | **tak, w każdym szarpnięciu** | pół dnia | wcześnie |
| 5.6 skręt całym ciałem | tak | godziny | wcześnie |
| 5.3 zestaw póz | **tak, najmocniej** | dzień | po skinningu |
| 5.4 tkanina | nie | dni | nie robić |

---

## 6. Rekomendacja i kolejność

Właściciel pyta, bo nie wie — więc: **oto co bym zrobił, w tej kolejności.**

**Krok 1 (godzina). Napraw FPP.** Ukryj w pierwszej osobie wyłącznie cztery
siatki głowy, pokaż resztę ciała. To jest defekt, jest zgłoszony, i jest
policzony co do stopnia w §2. Test FPP zmienia się świadomie z „osiem widocznych
siatek o tych nazwach” na „żadna widoczna siatka nie jest bliżej oka niż `near`”
— co, w przeciwieństwie do listy nazw, jest **własnością, a nie inwentarzem**, i
przeżyje każdy z wariantów z §4.

**Krok 2 (pół dnia). Wpuść powietrze do postaci.** §5.2 plus §5.1: `speed` i
`vy` sterują łopotem i spychaniem kończyn do tyłu, a filtr pierwszego rzędu
zamienia się w sprężynę z tłumieniem. To jest najlepszy stosunek widocznej
zmiany do godziny w całej notatce i **nie zależy od żadnej decyzji o kształcie** —
robi się raz i działa w każdym wariancie z §4.

**Krok 3 (pół dnia do dnia). Popraw szkielet i proporcje, jeszcze na bryłach.**
Wariant A, ale świadomie jako przygotowanie: szyja i wygięta do góry głowa (§5.5),
łuk pleców na osobnym stawie, zbieżność kończyn, ustalony skręt dłoni i buta,
`bounds` zgodne ze zmierzoną bryłą (1,41 m, nie 1,1), trzy kolory wracające do
koperty. **Te liczby przenoszą się jeden do jednego na kości w kroku 4**, więc
nic z tej pracy nie idzie do kosza. Po tym kroku warto pokazać właścicielowi —
jest szansa, że szyja i zbieżność załatwią więcej, niż się spodziewam, i wtedy
krok 4 można odłożyć.

**Krok 4 (1–2 dni). Jedna ciągła siatka na kościach — wariant B.** To jest
odpowiedź na pytanie „jak zrobić, żeby wyglądała jak człowiek”. Dotychczasowe
rundy nie mogły tego dosięgnąć, bo poprawiały pozy, a problemem jest
powierzchnia. Spec to wprost przewiduje, materiał świata działa bez zmian,
trójkątów wychodzi mniej niż dziś, rysunek jest jeden zamiast dwudziestu, a
wzorców pikselowych jeszcze nie ma, więc to jest **najtańszy moment, jaki ten
projekt będzie miał**.

**Krok 5 (dzień). Zestaw póz — §5.3.** Dopiero teraz, bo poza jest widoczna
tylko przez ciało, które potrafi ją pokazać.

**Czego nie robić:**

- **Wariant C (TSL).** Ten sam efekt co B, wyższy koszt, i wypada z testów w Node.
- **Wariant D (glTF).** Koliduje ze strojami (§9), z jednym materiałem świata
  (§2), z budżetem startu (§3.5) i z zerową liczbą plików binarnych w repo.
  Jeśli właściciel go chce, to jest decyzja projektowa do dopisania do spec, a
  nie ulepszenie do przemycenia.
- **Symulacja tkaniny (§5.4).** Niewidoczna z 7 m przy pasmowym oświetleniu.
- **Podnoszenie budżetu 4000 trójkątów.** Zmierzone 3528 to nie jest ograniczenie,
  które boli — wariant B zejdzie poniżej połowy tej liczby. Problemem nigdy nie
  była liczba trójkątów, tylko to, na co poszły.
- **Samo `receiveShadow = true`.** Przy tekselu cienia 0,35 m i `normalBias` 0,5 m
  nie zrobi nic dla kończyny o promieniu 4,5 cm. Zacienienie stawów musi przyjść
  z ciemniejszych kolorów wierzchołków wpieczonych przy pachach i pachwinach
  (a przy jednej siatce z wariantu B jest to trywialne, bo generator wie, gdzie
  jest staw).

---

## 7. Znalezione usterki (nie kwestie gustu)

Osobno, bo to rzeczy do naprawienia niezależnie od tego, który wariant wygra:

1. **FPP pokazuje części, których środki są poza kadrem** (61°–145° przy kadrze
   54°), i ukrywa tułów, który jest bezpiecznie poza `near` (0,202 m przy 0,1).
   §2.
2. **`pose.vy` i `pose.speed` są podawane co klatkę i nieczytane.**
   `ProceduralHuman.ts` nie odwołuje się do nich ani razu.
3. **`windPhase` ignoruje prędkość powietrzną, a dźwięk jej używa.** Nurkowanie
   jest głośniejsze, ale nie bardziej łopoczące.
4. **`HUMAN_BOUNDS.radius` = 1,1 m przy zmierzonym zasięgu 1,31 m (pudełko) i
   1,41 m (nurkowanie).** Dziś nieszkodliwe, bo `radius` nie jest przez nic
   czytane — konsumowane jest tylko `bounds.below`. Ale to dokładnie ten rodzaj
   zaniżenia, którego AGENTS.md zakazuje przeszkodom scenerii.
5. **Trzy z siedmiu kolorów stroju są poniżej minimalnej jasności koperty**
   (gogle 0,122; buty i rękawice 0,151 przy minimum 0,18). Stroje nie przechodzą
   przez `validateColor`, bo nie są wpisami biblioteki.
6. **Postać nigdzie nie ustawia `receiveShadow`**, w przeciwieństwie do terenu,
   trawy, propsów i dróg. Samo włączenie nie wystarczy (patrz wyżej), ale brak
   jest niezamierzony.
7. **Skręt dłoni i buta wokół osi kończyny jest nieustalony.**
   `setFromUnitVectors` wybiera go za autora. Wyszło symetrycznie i z grubsza
   sensownie, ale nikt tego nie wybrał, więc każda zmiana kierunku kończyny to
   przekręci.
8. **Zbiór nazwany `hands` zawiera cały ciąg bark–ramię–przedramię–dłoń.**
   Kosmetyka, ale nazwa kłamie i była częścią nieporozumienia z `d8ac3bc`.

---

## 8. Czego nie jestem pewien

Uczciwie, z eksperymentem przy każdym.

**a) Czy szkielet rzuca cień poprawnie w tym rendererze.** Materiał węzłowy
dokłada `skinning` przy `isSkinnedMesh` (sprawdzone w kodzie), ale **nie
sprawdziłem, czy przebieg mapy cieni używa tej samej ścieżki**, czy cień
rysowany jest z pozy spoczynkowej. *Eksperyment:* najmniejszy możliwy
`SkinnedMesh` — dwie kości, osiem wierzchołków — postawiony nad terenem w teście
Playwright, kość obrócona o 90°, zrzut i porównanie kształtu cienia. Pół
godziny, rozstrzyga definitywnie, i **to jest eksperyment, który zrobiłbym
pierwszy**, bo jest jedynym twardym ryzykiem technicznym wariantu B.

**b) Ile z „wygląda fatalnie” to szwy, a ile proporcje.** Moja teza — że sufit
brył został osiągnięty i trzeba ciągłej skóry — jest przekonaniem, nie pomiarem.
Możliwe, że szyja plus zbieżność kończyn (krok 3, pół dnia) wystarczą.
*Eksperyment:* zrobić krok 3 i pokazać, **zanim** zacznie się krok 4. Kosztuje
pół dnia i może oszczędzić dwa.

**c) Ile trójkątów naprawdę wyjdzie na powłokę.** Mój szacunek 1200–1600 to
arytmetyka z liczby pierścieni, nie pomiar. Za mało pierścieni przy łokciu i
staw się „ściśnie”; za dużo i budżet rośnie. *Eksperyment:* wygenerować samą
rurę ręki przy 4, 6 i 8 pierścieniach, zgiąć o 90° i obejrzeć przekrój. Godzina
w Node, bez renderera.

**d) Czy przy widocznym ciele w FPP rozjazd kamery z ciałem będzie przeszkadzał**
(kamera bierze 40 % przechyłu, ciało 100 %, plus 2 cm bujania kamery). Nie da
się tego przewidzieć zza biurka. *Eksperyment:* krok 1 z §6 to kilka linii —
zrobić, polecieć, zdecydować. Jeśli przeszkadza, `bankShare` idzie do 1 i
bujanie przenosi się na postać.

**e) Czy cokolwiek z tego w ogóle kosztuje.** Mediana klatki na prawdziwym GPU
to 3,15 ms z 16,7, a cała animacja CPU to 3,5 µs. Wszystko powyżej wygląda na
darmowe, ale **ani jedna liczba w tej notatce nie została zmierzona na
prawdziwym GPU właściciela** — tylko w kontenerze i w Node. *Eksperyment:*
`__world.gpuMs` przed i po, w tym samym miejscu świata. To jest liczba, którą
`perf-notes.md` każe obserwować, i jedyna, która ma prawo zawetować którykolwiek
z tych wariantów.

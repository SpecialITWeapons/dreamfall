# Postać: skóra na kościach (wariant B) i powietrze w ruchu

Właściciel wybrał **wariant B** z `docs/superpowers/notes/2026-09-16-postac-warianty.md`
i zapytał, czy w tym wariancie da się poprawić fizykę. Da się, i to lepiej niż
dzisiaj: fizyka z §5 notatki operuje na **drzewie stawów**, a wariant B tego
drzewa nie rusza — kości to dokładnie to samo drzewo, które dziś buduje
`hinge()`. Jedna rzecz działa dopiero po B (§5.3, zestaw póz), bo poza na
sztywnych bryłach czyta się jak przestawianie klocków.

Kolejność jest z §6 notatki, z jedną zmianą: krok 3 (poprawki na bryłach)
wypada, bo właściciel wybrał B od razu, a te liczby i tak przenoszą się na
kości — zrobimy je **przy** kościach, nie przed nimi.

## Global Constraints

- Kod i komentarze po angielsku; ten plan po polsku.
- `Avatar` (interfejs) się nie zmienia. Silnik nie ma prawa zauważyć.
- Materiał świata bez zmian: `litMaterial(vertexColor().rgb)` sam wykrywa
  `isSkinnedMesh` i dokłada węzeł `skinning`. Żadnego nowego programu.
- Budżet 4000 trójkątów zostaje; wariant B ma zejść **poniżej połowy**.
- `dt <= 0` dalej znaczy „bądź tam natychmiast" (AGENTS.md).
- `npm run check` do pliku, z odczytem kodu wyjścia.
- Każdy pomiar zmierzony, nie oszacowany.

## Zadania

---

### Task 1: FPP pokazuje to, co widać, i nic więcej

**Files:** `src/engine/avatar/ProceduralHuman.ts`, `tests/unit/proceduralHuman.test.ts`

Zgłoszone przez właściciela i widoczne na każdym bliskim zdjęciu: w pierwszej
osobie w górnych rogach kadru wiszą dwa czarne kształty. To są ramiona, których
**środki leżą poza kadrem** (61°–145° przy kadrze 54°), a tułów — bezpiecznie za
`near` — jest schowany.

- [x] **Step 1: Test, który nie przechodzi** — asercja przestaje być inwentarzem
      nazw („osiem siatek o tych nazwach") i staje się **własnością**: żadna
      widoczna w FPP siatka nie ma środka bliżej oka niż `near`, i żadna nie
      leży poza kadrem. To przeżyje wariant B, lista nazw nie.
- [x] **Step 2:** Chować wyłącznie głowę (cztery siatki: `head`, `helmet`,
      `visor`, `goggles`). Reszta ciała zostaje.
- [x] **Step 3: Zdjęcie z FPP**, commit.

---

### Task 2: Powietrze wchodzi w postać, a stawy dostają masę

**Files:** `src/engine/avatar/ProceduralHuman.ts`, `src/engine/flight/FlightController.ts`,
`tests/unit/proceduralHuman.test.ts`

§5.2 i §5.1 notatki. Niezależne od kształtu — działają w każdym wariancie.

Dwa fakty z kodu, które to ustawiają: **`pose.vy` i `pose.speed` nie są w
`update()` czytane ani razu**, a `windPhase` nie zależy od prędkości lotu, więc
przy nurkowaniu szum się wzmaga, a kombinezon łopocze tak samo. Oko i ucho mówią
co innego.

- [x] **Step 1: Test, który nie przechodzi** — przy tej samej fazie wiatru i
      tym samym podmuchu postać lecąca szybciej ma inne kąty stawów niż wolna;
      kończyny są spychane do tyłu tym mocniej, im szybciej leci.
- [x] **Step 2:** `speed` i `vy` wchodzą do łopotu (przez ciśnienie dynamiczne,
      tę samą liczbę, którą dźwięk nazywa `rush`) i do spychania kończyn.
- [x] **Step 3:** Filtr pierwszego rzędu → **sprężyna z tłumieniem**: dwa stany
      zamiast jednego, więc kończyna wybiega za cel i wraca. Przy tłumieniu
      krytycznym zachowuje się jak dziś, więc to nadzbiór. `dt <= 0` skacze do
      celu **i zeruje prędkość** — o tym najłatwiej zapomnieć.
- [x] **Step 4: Testy i commit.**

---

### Task 3: Jedna skóra na kościach

**Files:** `src/engine/avatar/ProceduralHuman.ts` (przepisany), `tests/unit/`

Serce etapu. Zamiast dwudziestu zamkniętych brył — jedna powłoka i szkielet
`Bone`, czyli to samo drzewo, które dziś tworzy `hinge()`.

Trzy kawałki, w tej kolejności:

1. **Generator rury wzdłuż łańcucha kości**: pierścienie wierzchołków o zadanym
   promieniu, zszyte w powierzchnię. Czysta geometria, testuje się w Node.
2. **Wagi**: odległość wzdłuż łańcucha, wygładzona wokół stawu. Kilkanaście linii.
3. **Profil ciała**: promień jako funkcja położenia wzdłuż tułowia i kończyny —
   **dane, nie kod**, i to jest miejsce, w którym wracają rzeczy niemożliwe dziś:
   przewężenie w talii, łopatki, kołnierz.

Rzeczy do rozstrzygnięcia w trakcie i zapisania:

- **Stroje.** Dziś swatch to siatka; przy jednej siatce staje się **zakresem
  wierzchołków**. Mechanizm ten sam — przepisanie atrybutu koloru, bez nowego
  bufora.
- **FPP.** Z jedną siatką „ukryj siatkę" przestaje działać. Głowa idzie na
  **drugi `SkinnedMesh` na tym samym szkielecie** (dwa rysunki zamiast jednego,
  ale czytelne) — nie zerowanie skali kości.
- **`frustumCulled = false`** na siatkach: sfera otaczająca `SkinnedMesh`-a liczy
  się z pozy spoczynkowej i przy tej pozie potrafi obciąć postać. Kosztuje zero.
- **Zacienienie stawów** z ciemniejszych kolorów wierzchołków przy pachach i
  pachwinach — przy jednej siatce trywialne, bo generator wie, gdzie jest staw.

- [x] **Step 1: Test, który nie przechodzi** — powłoka jest jedną powierzchnią
      bez dziur (każda krawędź należy do dwóch trójkątów albo do zaślepki),
      wagi każdego wierzchołka sumują się do jedynki, kości mają te same nazwy
      i te same kąty co dzisiejsze stawy.
- [x] **Step 2: Implementacja.**
- [x] **Step 3: POMIAR** — trójkąty, wierzchołki, rysunki i geometrie na
      rendererze, przeciw dzisiejszym 3528 / 2334 / 20 / 51. Zapisać
      w `perf-notes.md` niezależnie od wyniku.
- [x] **Step 4: Zdjęcia** z TPP i FPP, i commit.

---

### Task 4: Zestaw póz

**Files:** `src/engine/avatar/ProceduralHuman.ts`, `tests/unit/`

§5.3. Dopiero teraz, bo poza jest widoczna tylko przez ciało, które potrafi ją
pokazać. Pudełko, track, delta, zakręt, hamowanie — wybierane z dwóch–trzech
osi (prędkość powietrzna, kąt lotu, tempo skrętu) zamiast z jednej.

- [x] **Step 1: Test** — trzy różne stany lotu dają trzy różne kształty, i
      każdy z nich jest powtarzalny.
- [x] **Step 2: Implementacja, zdjęcia, commit.**

---

### Task 5: Dokumentacja

- [x] `AGENTS.md`: wpis o postaci przestaje mówić „bryły", zaczyna mówić „skóra
      na kościach"; co znaczy `dt <= 0` zostaje.
- [x] Specyfikacja: datowana poprawka, §2 i §17 wprost to przewidywały.
- [x] `perf-notes.md`: pomiar z Tasku 3.
- [x] Notatka `2026-09-16-postac-warianty.md` dostaje nagłówek „zrobione, co
      wyszło" — tak jak notatka o drzewach i trawie.

## Czego ten plan świadomie nie bierze

- **Wariantu C, D i E** — powody w §6 notatki, wszystkie nadal aktualne.
- **Symulacji tkaniny** — niewidoczna z 7 m przy pasmowym oświetleniu.
- **Podnoszenia budżetu trójkątów** — wariant B ma zejść poniżej połowy.

## Samoprzegląd planu

Czego się boję, w kolejności:

1. **Że skóra będzie wyglądać jak kiełbasa.** Rura o stałym promieniu jest
   gorsza niż dwie bryły. Cała jakość siedzi w profilu (kawałek 3) i w tym, czy
   pierścienie są dość gęste przy stawach. To jest miejsce na strojenie, nie na
   arytmetykę — i dlatego zdjęcie jest krokiem, nie dodatkiem.
2. **Że `skinning` w materiale węzłowym zachowa się inaczej, niż mówi kod.**
   Sprawdzone w źródle przypiętej wersji, ale nie uruchomione. Pierwszy test
   przeglądarkowy po Tasku 3 to rozstrzyga.
3. **Że sprężyna rozhuśta stawy przy dużym `dt`.** Klatka 50 ms przy stałej
   czasowej 0,10 s to jest dokładnie ten zakres, w którym jawny Euler potrafi
   wybuchnąć. Całkowanie półjawne (najpierw prędkość, potem położenie) to
   zamyka, ale trzeba to napisać świadomie i przypiąć testem przy `dt = 0,2`.

## Jak wyszło (2026-09-17)

Trzy strachy z samoprzeglądu, po kolei, i co z nich zostało.

1. **Kiełbasa — trafiony, i dlatego zdjęcie było krokiem.** Pierwsza wersja
   profili miała tors najszerszy w połowie (0,185 m na `t = 0,5`, czyli na
   środku pleców) i węższy w barkach. Na zdjęciu to jest brzuch, od którego
   barki opadają. Drugie podejście: klatka 0,178 na `t = 0,74`, talia 0,138,
   barki 0,163 — i sylwetka nagle jest sylwetką. Ręce w pierwszej wersji były
   patykami (0,05 m półszerokości przy torsie 0,36 m szerokim); po zgrubieniu
   o jakieś 10% czytają się jak ręce. Żadnej z tych dwóch rzeczy nie dało się
   zobaczyć w Node.
2. **`skinning` w materiale węzłowym — bez niespodzianki.** Działa dokładnie
   tak, jak mówi źródło 0.185.1: `setupPosition` dokłada `skinning(object)`,
   gdy `object.isSkinnedMesh`, i materiał świata nie wymagał ani jednej linii.
3. **Sprężyna przy dużym `dt` — zamknięta podkrokiem**, tak jak planowano, i
   przypięta testem.

**Czwarta rzecz, której się nie bałem, a powinienem.** Pasmo gogli było
zapisane jako 0,58–0,80 długości głowy. Głowa o trzech pierścieniach na
segment próbkuje w 0; 0,107; 0,321; 0,428; 0,571; 0,857 i 1 — **w to pasmo nie
trafia nic**. Postać latała w gładkim kremowym jajku i żaden z jedenastu testów
tego nie widział, bo wszystkie pytały o wagi, rozmaitość i granice, a żaden nie
zapytał, jakiego koloru cokolwiek jest. Naprawa to cztery pierścienie i stopy
przepisane pod pierścienie, a nie pod wyobrażenie głowy; przy okazji doszedł
dwunasty test, który pyta wyłącznie o kolory i który tę usterkę łapie.

To jest ta sama lekcja, którą ten katalog zapisuje po raz piąty: **liczba,
która wygląda na narzędzie do problemu, zwykle nim nie jest, dopóki się nie
zmierzy.** Tu doszła jej bliźniaczka — *asercja, która wygląda na komplet,
zwykle nim nie jest, dopóki się nie spojrzy.*


## Jak wyszedł zestaw póz (2026-09-17)

Pięć kształtów: pudełko, delta, track, wznoszenie i zakręt nakładany na każdy z
nich. Poza to pięć kierunków na stronę i nic więcej, więc pisania było tyle, ile
notatka obiecywała; cała robota poszła w wybór i w strojenie.

**Dwie usterki, obie znalezione pomiarem, nie okiem.**

1. **Próg `dive` ustawiony poza światem.** Napisałem 0,5 rad, bo tyle ma
   nurkowanie spadochroniarza. Najstromsze trwałe nurkowanie tego kontrolera to
   **0,42** — zmierzone przez przelecenie każdego rogu obwiedni przez pół minuty
   z czterema kilometrami powietrza pod spodem. Track istniał, miał pozę, miał
   testy i **był nieosiągalny lotem**. Jest 0,40, a nowy test pyta o to sam
   kontroler, więc próg pisany ze zdjęcia zamiast z obwiedni teraz pada.
2. **Delta, której nie dało się utrzymać.** Pierwsza wersja robiła track
   iloczynem dwóch osi, a deltę ich niezgodą — na papierze bez zarzutu: nos w
   dół **i** szybko to track, jedno bez drugiego to delta. W powietrzu
   nurkowanie kupuje prędkość, więc obie osie zgadzają się w ciągu sekundy i
   delta była kształtem, przez który postać przemykała. Widać to dopiero na
   zdjęciu: „delta" wyglądała jak track. Mieszanie pudełka, delty i tracku wzdłuż
   jednej drogi — średniej obu osi — daje przelot w pudełku, łagodne opadanie
   (`vy -6`, to czym autopilot lata cały czas) w 85% delcie, i cały track dopiero
   w najstromszym nurkowaniu.

**Koszt:** 9,0 → 14,4 µs na klatkę za pozę, 11,4 → 17,0 µs za całość. Sześć
gniazd na staw to sześćdziesiąt sprężyn i do sześćdziesięciu slerpów tam, gdzie
były dwa. Próg `POSE.floor` — poniżej którego gniazdo nie jest warte slerpa —
oszczędza 3,2 µs z tych 5,6, czyli **jedną trzecią kosztu funkcji za jedno
porównanie**. Geometria bez zmian: 1 120 trójkątów, 2 rysunki, 16 kości.

**Czy to w ogóle widać bez dotykania klawiatury.** Dziesięć minut autopilota na
ziarnie 42: pudełko prowadzi 63% czasu, wznoszenie 19%, track 14%, zakręt 2,6%
(ale jest *noszony* przez 24% czasu — autopilot nigdy nie przechyla się mocno,
więc zakręt jest prawie zawsze nakładką, nie kształtem, co jest dokładnie tym, do
czego jest `POSE.lean`). Delta prowadzi 1,4% i to jest uczciwa liczba, nie
wada: opadania autopilota są prawie dwustanowe, więc `drive` przechodzi przez
środek drogi zamiast na nim siedzieć, a delta jest tym, co postać nosi przez tę
sekundę czy dwie. Pod ręką, gdzie celowanie wskaźnikiem jest ciągłe, `vy -7`
trzyma ją na 0,85 — i to jest pozycja, nie przejście.

**Trzecia usterka, zgłoszona przez właściciela ze zdjęcia.** Wznoszenie
zrobiłem jako *flare* spadochroniarza — ręce do przodu i w górę, kolana mocno
złożone. Tak hamuje prawdziwy skoczek i tutaj to było źle: z boku czyta się jak
postać podnoszona za nadgarstki. Ręce idą teraz **do tyłu**, mniej więcej tak
daleko jak w tracku, a te dwa kształty rozróżniają nogi — wznoszenie składa
kolana najmocniej z czterech (1,41 rad przeciw 1,04 pudełka), track nie składa
ich wcale (0,03). Nos w górę i wolno zostały jednym stanem, nie dwoma: w tym
świecie za wznoszenie płaci się prędkością, więc `pitch +0,56` i `speed 30`
przychodzą razem i nie ma trzeciej rzeczy, którą druga poza mogłaby znaczyć.

**Czego przy okazji pozbyło się `update`:** `drop` (opadanie wewnętrznej ręki w
zakręcie) i `back` (odchylanie ramion kątem wznoszenia) były osobnymi
mechanizmami doklejonymi do jednej pozy. Zakręt i wznoszenie są teraz pozami, więc
oba zniknęły — jeden mechanizm zamiast trzech, i o jeden powód mniej, żeby dwa
z nich kiedyś policzyły to samo dwa razy.

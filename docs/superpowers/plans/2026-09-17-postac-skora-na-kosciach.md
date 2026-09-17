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

- [ ] **Step 1: Test, który nie przechodzi** — asercja przestaje być inwentarzem
      nazw („osiem siatek o tych nazwach") i staje się **własnością**: żadna
      widoczna w FPP siatka nie ma środka bliżej oka niż `near`, i żadna nie
      leży poza kadrem. To przeżyje wariant B, lista nazw nie.
- [ ] **Step 2:** Chować wyłącznie głowę (cztery siatki: `head`, `helmet`,
      `visor`, `goggles`). Reszta ciała zostaje.
- [ ] **Step 3: Zdjęcie z FPP**, commit.

---

### Task 2: Powietrze wchodzi w postać, a stawy dostają masę

**Files:** `src/engine/avatar/ProceduralHuman.ts`, `src/engine/flight/FlightController.ts`,
`tests/unit/proceduralHuman.test.ts`

§5.2 i §5.1 notatki. Niezależne od kształtu — działają w każdym wariancie.

Dwa fakty z kodu, które to ustawiają: **`pose.vy` i `pose.speed` nie są w
`update()` czytane ani razu**, a `windPhase` nie zależy od prędkości lotu, więc
przy nurkowaniu szum się wzmaga, a kombinezon łopocze tak samo. Oko i ucho mówią
co innego.

- [ ] **Step 1: Test, który nie przechodzi** — przy tej samej fazie wiatru i
      tym samym podmuchu postać lecąca szybciej ma inne kąty stawów niż wolna;
      kończyny są spychane do tyłu tym mocniej, im szybciej leci.
- [ ] **Step 2:** `speed` i `vy` wchodzą do łopotu (przez ciśnienie dynamiczne,
      tę samą liczbę, którą dźwięk nazywa `rush`) i do spychania kończyn.
- [ ] **Step 3:** Filtr pierwszego rzędu → **sprężyna z tłumieniem**: dwa stany
      zamiast jednego, więc kończyna wybiega za cel i wraca. Przy tłumieniu
      krytycznym zachowuje się jak dziś, więc to nadzbiór. `dt <= 0` skacze do
      celu **i zeruje prędkość** — o tym najłatwiej zapomnieć.
- [ ] **Step 4: Testy i commit.**

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

- [ ] **Step 1: Test, który nie przechodzi** — powłoka jest jedną powierzchnią
      bez dziur (każda krawędź należy do dwóch trójkątów albo do zaślepki),
      wagi każdego wierzchołka sumują się do jedynki, kości mają te same nazwy
      i te same kąty co dzisiejsze stawy.
- [ ] **Step 2: Implementacja.**
- [ ] **Step 3: POMIAR** — trójkąty, wierzchołki, rysunki i geometrie na
      rendererze, przeciw dzisiejszym 3528 / 2334 / 20 / 51. Zapisać
      w `perf-notes.md` niezależnie od wyniku.
- [ ] **Step 4: Zdjęcia** z TPP i FPP, i commit.

---

### Task 4: Zestaw póz

**Files:** `src/engine/avatar/ProceduralHuman.ts`, `tests/unit/`

§5.3. Dopiero teraz, bo poza jest widoczna tylko przez ciało, które potrafi ją
pokazać. Pudełko, track, delta, zakręt, hamowanie — wybierane z dwóch–trzech
osi (prędkość powietrzna, kąt lotu, tempo skrętu) zamiast z jednej.

- [ ] **Step 1: Test** — trzy różne stany lotu dają trzy różne kształty, i
      każdy z nich jest powtarzalny.
- [ ] **Step 2: Implementacja, zdjęcia, commit.**

---

### Task 5: Dokumentacja

- [ ] `AGENTS.md`: wpis o postaci przestaje mówić „bryły", zaczyna mówić „skóra
      na kościach"; co znaczy `dt <= 0` zostaje.
- [ ] Specyfikacja: datowana poprawka, §2 i §17 wprost to przewidywały.
- [ ] `perf-notes.md`: pomiar z Tasku 3.
- [ ] Notatka `2026-09-16-postac-warianty.md` dostaje nagłówek „zrobione, co
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

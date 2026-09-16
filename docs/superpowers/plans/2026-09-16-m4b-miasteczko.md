# M4b: miasteczko, wstęgi i to, co stoi przy drodze

Druga połowa M4. M4a dała stanowiska, plan jako dane, kolejkę, `RoadKit`,
`StructureKit` i wieś. To domyka etap: miasteczko, `kit.line`, propsy wzdłuż
dróg, paleta osady.

Stan wyjściowy: `main` po scaleniu M4a (`910bee1`) plus gałąź z wygaszaniem
drzew i pękami trawy (PR #10). Liczby niżej są zmierzone na tym drzewie, nie
przepisane ze specyfikacji.

## Co mówi specyfikacja, a co pokazał pomiar

Specyfikacja (§8) chce miasteczka: krata 20 km, odds 0,6, promień 400..900 m,
siatka z jitterem, obwodnica, plac z dominantą, **500..2000 budynków**,
plateau pełne (1,0), kondygnacje 1..4 malejące od centrum, przedmieścia
rzednące.

Zmierzone na generatorze wsi, rozciągniętym do promienia miasteczka:

| promień | parcele | drogi | koszt planu |
| --- | --- | --- | --- |
| 250 m (wieś) | 47 | 7 | 0,72–1,34 ms |
| 400 m | 78 | 9 | 0,65 ms |
| 600 m | 114 | 12 | 0,83 ms |
| 900 m | 147 | 12 | 0,72 ms |

Dwa wnioski, oba istotne dla planu:

1. **Generator wsi nie skaluje się do miasteczka i nie powinien.** Przy 900 m
   daje 147 parcel, a nie 500–2000, bo jego układ to jedna ulica wzdłuż
   warstwicy z bocznymi ścieżkami — to wypełnia wstęgę, nie dysk. Miasteczko
   potrzebuje własnego generatora (siatka, obwodnica, plac), a nie większych
   parametrów.
2. **Koszt jest liniowy w parcelach, około 5–8 µs na parcelę** (28 µs przy
   pierwszym wywołaniu to rozgrzewka JIT-a). Przy 2000 parcelach to **10–16 ms
   za same parcele**, plus drogi siatki, których w dysku 900 m jest dużo więcej
   niż siedem odcinków wsi.

## Problem, który ten etap musi rozstrzygnąć

`Sites.work(budgetMs)` woła `build(site)` **atomowo**: hak planu biegnie w
całości albo wcale. Budżet klatki to 4 ms. Plan miasteczka najpewniej kosztuje
kilkanaście do trzydziestu milisekund, czyli **jedną zgubioną klatkę** przy
60 Hz.

Cztery wyjścia, w kolejności rosnącego kosztu wykonania:

- **(a) Przyjąć zacięcie.** Krata ma 20 km, a lot robi 40–62 m/s: między
  komórkami kraty mija **5 do 8 minut**, i tylko 0,6 z nich niesie miasteczko.
  Jedna zgubiona klatka raz na kilkanaście minut jest tańsza niż każda
  maszyneria, która by ją usunęła.
- **(b) Podzielić miasteczko na kwartały** — kilka planów zamiast jednego,
  budowanych w kolejnych klatkach. Zmienia model („jedno stanowisko, jeden
  plan") i psuje regułę „plan stawia się w całości albo wcale".
- **(c) Uczynić `build` wznawialnym** — generator albo hak z budżetem. Brzydka
  zmiana kontraktu dla autora biblioteki, który chce napisać pętlę.
- **(d) Wątek roboczy.** Osobny etap, nie ten.

**Plan wybiera (a) warunkowo: mierzymy, a maszynerię budujemy dopiero, gdy
pomiar jej zażąda.** Próg: jeśli plan miasteczka przekroczy **1,5 klatki
(25 ms)** na tym kontenerze, wraca (b). Nie budujemy niczego przed pomiarem —
to jest ta sama zasada, która w M4a znalazła pięć błędów.

## Global Constraints

- Kod i komentarze po angielsku; ten plan i specyfikacja po polsku.
- Nic nowego w `library/standard/` nie importuje TSL.
- Plan osady zostaje **czystą funkcją** stanowiska, parametrów i tego, co kit
  odpowie o gruncie. Testuje się w Node, bez okna terenu.
- `npm run check` **do pliku, z odczytem kodu wyjścia** — nie przez `grep`,
  bo potok zwraca kod `grep`-a i zjada porażkę. Ta sesja dała się na tym
  złapać dwa razy.
- Każdy pomiar w planie i w `perf-notes.md` jest zmierzony, nie oszacowany.

## Zadania

---

### Task 1: `BUDGET.siteReach` przestało być prawdą

**Files:** `library/contract.ts`, `tests/unit/contract.test.ts`

Walidator M4a liczy, ile osad zmieści się przed lotem: `across = floor(2 *
BUDGET.siteReach / cell) + 1`, i odrzuca kratę, gdy `across² > siteInstances`.
`siteReach` wpisano jako 1900, bo tyle wynosił wtedy `TREE_RADIUS`. **Pierścień
sięga dziś 2600 m**, więc strażnik liczy o 1,87 raza za małą powierzchnię.

Żadna krata w rejestrze nie jest tym dotknięta (wieś 6 km, miasteczko 20 km
przechodzą z zapasem), więc to nie jest błąd, który dziś coś psuje — jest to
strażnik, który kłamie, a M4b właśnie dokłada do rejestru drugą kratę.

- [x] **Step 1: Test, który nie przechodzi** — krata, która mieści się w 1900,
      a nie mieści w 2600, musi zostać odrzucona.
- [x] **Step 2:** Zsynchronizować liczbę z `TREE_RADIUS` tak, żeby nie mogła
      się znów rozjechać. `contract.ts` nie może importować z `src/`, więc albo
      liczba zostaje w kontrakcie z testem, który porównuje ją z `TREE_RADIUS`
      i pada przy rozjeździe, albo `Ring` przejmuje walidację zasięgu. **Wybrać
      jedno i uzasadnić w komentarzu**, bo to jest dokładnie ta klasa błędu,
      którą M4a naprawiało przy loterii: jedna prawda w dwóch miejscach.

---

### Task 2: `kit.line` — wstęga, która nie jest drogą

**Files:** `src/engine/scenery/RoadKit.ts` (albo nowy `LineKit.ts`),
`library/contract.ts`, `src/engine/scenery/Sites.ts`, `tests/unit/`

Płot, murek, żywopłot. W kontrakcie od M4a i **rzuca wyjątkiem** — to jest
najtańszy możliwy start etapu, bo sygnatura jest już uzgodniona.

Różnica wobec drogi: droga leży na ziemi (wstęga o szerokości, normalna z
gruntu), linia **stoi** na ziemi (pionowa wstęga o wysokości, obie strony
widoczne, podąża za terenem dołem). Rozstrzygnąć, czy to dzieli kod z
`buildRoads` (próbkowanie łamanej, mitra na zakręcie) — najpewniej tak, i
wtedy wspólna część idzie do jednej funkcji, a nie kopiuje się.

- [x] **Step 1: Test, który nie przechodzi** (czysta geometria, więc Node):
      odcinek 100 m o wysokości 1,2 m ma tyle wierzchołków, ile mówi
      próbkowanie; dół każdego wierzchołka siedzi na tym, co zwraca atrapa
      `heightAt`, a góra o `height` wyżej; zakręt 90° nie zwęża wstęgi;
      przekroczenie budżetu rzuca z nazwą stanowiska.
- [x] **Step 2: Implementacja i commit.**

---

### Task 3: Propsy i linie w planie, i to, co je stawia

**Files:** `src/engine/scenery/Ring.ts`, `src/engine/scenery/Pools.ts`,
`src/engine/scenery/Sites.ts`, `tests/unit/ring.test.ts`

`SiteKit.prop` już zbiera propsy do planu (parcela bez kondygnacji), a
pierścień je stawia — to działa od M4a. Czego nie ma: **linii**. Plan niesie
`RoadSpec[]`, `LotSpec[]`, `Reservation[]`; dochodzi `LineSpec[]`.

Linie, jak drogi, są jedną siatką na stanowisko, nie instancjami. Pule trzymają
dziś jedną wstęgę na plan (`ScenerySink.site`); linie dołączają do tej samej
ścieżki — jedna siatka więcej w tej samej grupie, zwalniana z planem.

- [ ] **Step 1: Test, który nie przechodzi** — plan z linią jest oferowany
      w całości; linia znika, gdy pierścień zostawia plan; rezerwacje planu
      dalej trzymają las z daleka.
- [ ] **Step 2: Implementacja i commit.**

---

### Task 4: Dominanta i paleta osady

**Files:** `library/structures/`, `library/contract.ts`, `library/settlements/`

Specyfikacja chce dominanty (rodzaj i wysokość do 60 m) i palety osady jako
parametru.

Uwaga do wysokości: 60 m to nie jest liczba kondygnacji — `BUDGET.floorSpan`
ogranicza do czterech **różnych liczb kondygnacji** na przepis, bo każda ma
własne pieczenie i własną pulę. Wieża robi się przepisem o `floors: [1, 1]`
i wysokim `floorHeight`, nie przepisem o czterdziestu piętrach.

Paleta osady: dziś parcela nie dostaje odcienia (`LotSpec.tint` istnieje,
`plan.js` go nie ustawia). Paleta osady to zestaw swatchów, z którego plan
losuje odcień parceli — i to jest miejsce, gdzie miasteczko może wyglądać
inaczej niż wieś przy tych samych trzech przepisach budynków.

- [ ] **Step 1: Test, który nie przechodzi** — walidator przyjmuje wieżę
      i odrzuca przepis spoza koperty kolorów; dwa stanowiska z różnymi
      paletami dają różne odcienie przy tych samych przepisach.
- [ ] **Step 2: Implementacja i commit.**

---

### Task 5: Generator miasteczka

**Files:** `library/settlements/town.js`, `library/settlements/plan-town.js`,
`library/settlements/settlement.js`, `library/index.js`, `tests/unit/`

Serce etapu. Własny generator, nie parametry wsi.

Układ ze specyfikacji: **siatka z jitterem**, **obwodnica**, **plac
z dominantą**, kondygnacje 1..4 **malejące od centrum**, **przedmieścia
rzednące**. Krata 20 km, odds 0,6, promień 400..900 m, plateau pełne (1,0).

Rzeczy, które trzeba rozstrzygnąć w trakcie i zapisać:

- Siatka na dysku, nie na kwadracie: ulice urwane obwodnicą, nie wystające.
- Nachylenie: wieś odmawia ścieżki powyżej `maxSlope`. Miasteczko z pełnym
  plateau ma grunt płaski w środku, ale przedmieścia wychodzą poza pióro
  płaskowyżu — tam ta sama reguła musi działać, inaczej ulica wejdzie na
  zbocze.
- Kolejność losowań ze strumienia stanowiska jest powtarzalnością
  miasteczka; zmiana kolejności to inne miasteczko z tego samego ziarna.

- [ ] **Step 1: Test, który nie przechodzi** — plan tej samej komórki dwa razy
      jest identyczny; liczba budynków mieści się w 500..2000; żadne dwie
      parcele nie zachodzą na siebie; parcela trzyma odstęp od osi każdej
      drogi, przy której stoi; rezerwacje pokrywają parcele, plac i obwodnicę;
      kondygnacje maleją od centrum (średnia w środku wyższa niż na obrzeżu);
      promień 400 m ma mniej budynków niż 900 m; wszystkie identyfikatory
      budynków są w rejestrze.
- [ ] **Step 2: Implementacja.**
- [ ] **Step 3: POMIAR** — koszt planu miasteczka przy 400, 650 i 900 m,
      mediana z pięciu, oraz liczba parcel, dróg i rezerwacji. **To jest ten
      pomiar, który rozstrzyga o (a) albo (b)** z sekcji wyżej. Zapisać
      w `perf-notes.md` niezależnie od wyniku. Commit.

---

### Task 6: Miasteczko w świecie i sufity, które ono podnosi

**Files:** `src/engine/scenery/Pools.ts`, `src/engine/scenery/Ring.ts`,
`library/contract.ts`, `tests/unit/`

Dwa tysiące budynków przechodzi przez pule, których pojemność to dziś
`BUDGET.propInstances = 2000` **na rodzaj i liczbę kondygnacji**. Przy trzech
rodzajach i czterech liczbach kondygnacji to dwanaście pul po 2000 — miejsca
dość, ale **rozkład nie jest równy**: jeśli 1200 z 2000 budynków to
jednopiętrowe chaty, ta jedna pula jest przy suficie.

Pierścień stawia plan w całości, więc pula, która odmówi, zjada dom **bez
słowa** (`raise` robi `continue`) — dokładnie ta klasa cichej wady, którą M4a
naprawiało przy piętrach.

- [ ] **Step 1: POMIAR przed zmianą** — rozkład budynków miasteczka po
      rodzajach i kondygnacjach, i najgorsza pula.
- [ ] **Step 2:** Podnieść, co pomiar każe podnieść, i **uczynić odmowę puli
      głośną** albo policzalną: `SceneryStats` niech niesie, ile budynków
      odmówiono w ostatniej przebudowie, żeby test przeglądarkowy mógł żądać
      zera. Cicha strata jest gorsza niż brzydka liczba.
- [ ] **Step 3: Testy i commit.**

---

### Task 7: Dwie kraty naraz

**Files:** `src/engine/scenery/Sites.ts`, `library/settlements/`,
`tests/unit/sites.test.ts`

Po tym etapie rejestr niesie **dwa** biomy osad: wieś na kracie 6 km i
miasteczko na 20 km. Nic dziś nie zabrania, żeby wieś usiadła wewnątrz
miasteczka — a wtedy dwa plany rezerwują ten sam grunt, dwa płaskowyże ciągną
ten sam teren, i dwie ulice przechodzą przez siebie.

To jest **ryzyko projektowe, nie błąd do naprawienia w locie**. Rozstrzygnąć
świadomie i zapisać:

- albo miasteczko wygasza obecność wsi (hak obecności wsi mnoży się przez
  dopełnienie obecności miasteczka — ale wtedy wieś czyta dwie kraty),
- albo `Sites` odrzuca stanowisko, które leży w promieniu innego, większego
  (reguła silnika, nie biblioteki),
- albo przyjmujemy, że się zdarza, i mierzymy, jak często.

- [ ] **Step 1: POMIAR** — na ilu komórkach ziarna 42 w promieniu 100 km wieś
      i miasteczko zachodzą na siebie. **Dopiero ta liczba mówi, czy warto
      cokolwiek robić.**
- [ ] **Step 2:** Rozstrzygnięcie, implementacja jeśli pomiar jej żąda, test,
      commit.

---

### Task 8: Testy przeglądarkowe

**Files:** `tests/e2e/smoke.spec.ts`

Wszystkie na pauzie, z twardo wpisanym miejscem ziarna 42 — i **miejsce trzeba
najpierw znaleźć pomiarem w Node**, jak przy wsi. Krata 20 km, więc
miasteczko może być daleko od startu.

- [ ] **Step 1: Testy:**
  1. **Miasteczko stoi**: `scenery.buildings` przekracza 500, a przeszkody
     rosną o tyle samo.
  2. **Żaden dom nie zginął**: licznik odmówionych z Taska 6 jest zerem.
  3. **Ziemia pod nim jest płaska**, a poza pióropuszem już nie — kontrast, jak
     przy wsi, bo plateau miasteczka jest pełne (1,0), więc różnica ma być
     **większa** niż przy wsi.
  4. **Lot go nie przecina** — dominanta do 60 m jest wyższa niż cokolwiek, co
     lot dotąd omijał, więc to jest test na `MIN_CLEARANCE` nad wieżą, nie nad
     dachem.
  5. **Kolejka nie zacina klatki ponad to, co pomiar z Taska 5 przewidział** —
     asercja z liczbą, nie z nadzieją.
  6. **Brak błędów konsoli** — materiały linii i dominanty się skompilowały.
- [ ] **Step 2:** Uruchomienie (`--config pw.local.config.ts` w tym
      kontenerze) **i commit**.

---

### Task 9: Dokumentacja

**Files:** `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/perf-notes.md`,
specyfikacja

- [ ] **Step 1: `AGENTS.md`** — sekcja „Settlements" zyskuje najwyżej dwa
      zdania: co robi druga krata i co kosztuje plan miasteczka. Nie więcej.
- [ ] **Step 2: `CONTRIBUTING.md`** — „Adding a settlement" zyskuje miasteczko
      jako drugi przykład i mówi, kiedy pisze się nowy generator, a kiedy
      wystarczą parametry. Pomiar z tego planu jest odpowiedzią: **gdy układ
      jest inny, parametry nie wystarczą.**
- [ ] **Step 3: specyfikacja** — poprawki z datą, jak w M4a: co z §8 wykonanie
      wymusiło inaczej, i dlaczego.
- [ ] **Step 4: `perf-notes.md`** — koszt planu miasteczka, koszt jego dróg
      i linii, wpływ na przebudowę pierścienia, i rozstrzygnięcie (a)/(b)
      z liczbą, która je uzasadnia.
- [ ] **Step 5: `README.md`** — linijka statusu M4b.

---

## Czego ten plan świadomie nie bierze

- **Sadów i pól uprawnych** — specyfikacja stawia je w M6 razem z jeziorami.
- **Mostów** — M6, razem z przeszkodami niosącymi `bottom`.
- **Wnętrz** — poza zakresem całego projektu.
- **Okna przyrostowego trawy** — osobna sprawa, zapisana w `perf-notes.md`,
  i blokuje zasięg trawy, którego właściciel kazał nie ruszać.

## Samoprzegląd planu

Czego się boję w tym planie, w kolejności:

1. **Koszt planu miasteczka.** Jedyna liczba, której nie znam, i jedyna, która
   może zawrócić Task 5 do (b). Dlatego pomiar jest osobnym krokiem z progiem
   wpisanym wprost, a nie „sprawdzimy na końcu".
2. **Cicha odmowa puli.** Dwa tysiące budynków przez pule po 2000 na rodzaj —
   to jest ustawione na powtórzenie błędu z pięter M4a, tylko z innej strony.
   Task 6 jest po to, żeby strata była policzalna, zanim stanie się niewidzialna.
3. **Dwie kraty.** Najbardziej „to się pewnie nie zdarza" ze wszystkiego tutaj,
   a M4a nauczyło, że „pewnie" jest w tej bazie kodu warte pomiaru: dwie
   niezależne loterie o tej samej komórce zgadzały się w połowie przypadków.
4. **`kit.line` dzielony z drogami.** Kuszące jest skopiowanie próbkowania
   łamanej. Jeśli skopiuję, następna poprawka mitry naprawi jedno z dwóch
   miejsc — i będzie to widać dopiero na płocie.

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

- [x] **Step 1: Test, który nie przechodzi** — plan z linią jest oferowany
      w całości; linia znika, gdy pierścień zostawia plan; rezerwacje planu
      dalej trzymają las z daleka.
- [x] **Step 2: Implementacja i commit.**

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

- [x] **Step 1: Test, który nie przechodzi** — walidator przyjmuje wieżę
      i odrzuca przepis spoza koperty kolorów; dwa stanowiska z różnymi
      paletami dają różne odcienie przy tych samych przepisach.
- [x] **Step 2: Implementacja i commit.**

---

> **Zrobione.** Wieża: `floors: [3, 4]`, `floorHeight` 10,8 m — kondygnacja jest
> tu **kondygnacją trzonu**, nie piętrem, więc 46 m nad wsią i 57 m nad
> miasteczkiem z dwóch pieczeń zamiast czterdziestu. 274/338 trójkątów, czyli
> 5 % budżetu i **mniej niż młyn**. Paleta: odcienie mnożą kolory instancji,
> więc miasteczko różni się od wsi bez ani jednego nowego pieczenia.
>
> **Sufit wysokości to nie 60 m, tylko 70** — `FlightController` zaczyna niski
> przelot tylko dopóki `terrainAhead < here + 70`, a `terrainAhead` czyta
> przeszkody. Dominanta wyższa niż 70 m **odpychałaby lot od jedynego miejsca
> wartego niskiego przelotu**. To nie jest w specyfikacji ani w `AGENTS.md`;
> zweryfikowane w źródle.
>
> **Pułapka przy wpinaniu:** `plan.js` wybiera kondygnacje jako
> `mill ? 3 : random < 0.3 ? 2 : 1`. Osada, która nazwie `tower` w wagach
> budynków bez własnego przypadku, poprosi o 1 albo 2 — poza `[3, 4]` — i
> **rzuci w kolejce** (reguła z M4a). Generator miasteczka musi prosić o 3 lub 4.

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

**Rozstrzygnięte w trakcie (2026-09-16):**

1. **`settlement()` przyjmuje parametry i plan.** Miał zaszyte słowo „village"
   w id, nazwie i wywołaniu planu. Parametry niosą teraz własne `id`, `name`,
   `landmark` i `paint`. Wieś przechodzi przez to bez zmiany.
2. **Chata dostaje trzecią kondygnację.** Centrum miasteczka ma być wyższe niż
   obrzeże, a jedyne inne wypieki na 3 kondygnacje to młyn i wieża — centrum
   miasteczka z samych wiatraków to nie jest centrum miasteczka. Koszt: jeden
   wypiek i jedna pula więcej (Task 6 i tak je mierzy).
3. **`maxCut` zamiast ostrzejszego `maxSlope`** — i to jest pomiar, nie gust.
   Plan zakładał, że miasteczko potrzebuje znacznie ostrzejszego `maxSlope`.
   Zmierzone: zaostrzenie z 0,45 do 0,06 przesuwa medianę ucieczki gruntu od
   środka w promieniu 900 m ze 167 m na 146 m — czyli o nic — odrzucając przy
   tym dwa stanowiska na trzy (41 km między miasteczkami robi się 78 km).
   Na setkach metrów to jest rzeźba terenu, nie pochodna w jednym punkcie.
   Hak `lattice` dostał więc `maxCut` (w metrach) osobno od `maxSlope`.
   Tabele: `docs/superpowers/notes/2026-09-16-m4b-ciecie-miasteczka.md`.
4. **Liczba budynków wychodzi z konstrukcji, nie z sufitu.** Generator
   przechodzi wszystkie parcele, jakie oferuje siatka, sumuje `1 - out²`
   i dobiera udział tak, żeby liczba wypadła w `lots.count`. Sufit obciąłby
   miasteczko przestrzennie — dokładnie ta wada, którą ma sufit drzew
   w pierścieniu.
5. **`storeys`: zakres kondygnacji, o jaki osada wolno prosi każdy rodzaj.**
   Plan jest czystą funkcją i nie pyta kitu, co jest upieczone, a prośba
   o kondygnację bez wypieku **rzuca w kolejce**. Zakres jest więc zapisany
   w parametrach, a test trzyma go przy zakresach z przepisów.

- [x] **Step 1: Test, który nie przechodzi** — `tests/unit/townPlan.test.ts`,
      12 przypadków: cała lista wyżej, plus trzy rzeczy, których lista nie
      wymieniała — tinty tylko z palety, nachylenie tnie ulicę na odcinki
      zamiast ją kończyć, i **każda para (rodzaj, kondygnacje) leży w zakresie
      z samego przepisu**, a nie w `storeys`. To ostatnie jest jedyną rzeczą,
      która trzyma `storeys` przy wypiekach: kontrakt o tej liście nie wie.
- [x] **Step 2: Implementacja.** `library/settlements/plan-town.js`.
- [x] **Step 3: POMIAR — rozstrzygnięty na (a), miasteczko budowane w całości.**
      Na prawdziwym gruncie ziarna 42, mediana z pięciu: **4,3 ms** przy 400 m
      (537 budynków), **10,3 ms** przy 650 (1228), **18,8 ms** przy 900 (1902).
      Prawdziwe miasteczko 9,2 km od środka świata: promień 804 m, 1635
      budynków, 18,9 ms przez kolejkę.

      Za pierwszym razem wyszło **24,6 ms** przy 900 m — w progu o dwa procent,
      czyli na innej maszynie decyzja byłaby inna. Cała różnica siedziała
      w kluczach: plan pyta swoje dwie kraty haszujące około piętnastu tysięcy
      razy, a każde pytanie budowało dziewięć kluczy `` `${cx},${cz}` ``.
      Spakowanie dwóch indeksów w jedną liczbę: 24,6 → 18,8 ms, przy identycznym
      miasteczku na wyjściu. `docs/perf-notes.md`, sekcja „M4b: what a town
      costs to plan".

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

- [x] **Step 1: POMIAR przed zmianą** — 24 miasteczka po całym zakresie
      promienia, najgorsze, co pojedyncze miasteczko włożyło do każdej puli:
      `cottage:2` 655, `cottage:1` 607, `cottage:3` 277, `barn:2` 197,
      `barn:1` 116, `mill:3` 36, wieża 1. Największe z nich miało 1871
      budynków. **Najgorsza pula jest w jednej trzeciej.**
- [x] **Step 2: nie ma czego podnosić** — i to jest wynik pomiaru, nie
      zaniechanie: wagi rozkładają miasteczko na trzy rodzaje i cztery liczby
      kondygnacji, a krata 20 km przy zasięgu pierścienia 2,6 km stawia przed
      lotem najwyżej jedno miasteczko naraz. Druga połowa zadania stoi mimo to:
      `SceneryStats` niesie `buildingsRefused` z ostatniej przebudowy i liczy
      **oba** sposoby, na jakie parcela może nie stanąć — pula przy suficie
      i kształt, którego nikt nie upiekł. Do tej pory oba były cichym
      `continue` w pierścieniu.
- [x] **Step 3: Testy i commit.** Cztery przypadki w `ring.test.ts`; złamanie
      licznika czerwieni trzy z nich.

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

- [x] **Step 1: POMIAR** — zrobiony, `docs/superpowers/notes/2026-09-16-m4b-dwie-kraty.md`.
      Obszar: 2,24 mln posadzonych komórek, 73,9 mln km². **Środek wsi wpada
      w promień miasteczka na 1,51 % miasteczek**, czyli raz na 82–127 godzin
      lotu. Dwa miasteczka ani dwie wsie nie zachodzą nigdy — ryzyko jest
      wyłącznie międzykratowe.
- [x] **Step 2: rozstrzygnięte — trzecie wyjście, przyjmujemy i zapisujemy.**
      Uzasadnienie w notatce: odrzucanie stanowiska w `Sites` **pogorszyłoby**
      sprawę, bo grunt psuje obecność, a nie plan — zostałby płaski placek gliny
      bez domów, czyli dokładnie ta wada, którą M4a usunęło. Wygaszanie obecności
      wsi przez miasteczko jest jedyną rzeczą, która naprawia grunt, nic nie
      kosztuje na texel, i jego ceną są te same liczby w dwóch plikach — kształt
      na kiedyś, nie na teraz.

      **Pomiar znalazł przy okazji coś kosztowniejszego niż samo zadanie:** druga
      krata podwajała wypełnienie okna (783 → 1810 ms), bo pamięć środka kraty
      w `Fields.ts` miała jedno miejsce, a dwie kraty ją tłukły. Naprawione
      osobnym commitem, cztery miejsca, 828 ms.

---

### Task 7b: `maxSlope` nie odrzuca niczego

**Files:** `library/contract.ts`, `library/standard/presence.js`,
`src/engine/terrain/Fields.ts`, `library/settlements/`, `tests/unit/`

Znalezione przy pomiarze Taska 7 i sprawdzone analitycznie. Hak `lattice`
kończy się tak:

```js
const room = maxSlope * Math.max(hit.d, radius);
return near * (1 - sstep(room, room * 2, Math.abs(f.baseHeight - hit.h)));
```

Siedzisko jest sprawdzane **w środku kraty**, gdzie `hit.d = 0`, a `f.baseHeight`
i `hit.h` to ta sama liczba — ten sam punkt. Różnica jest zerem, `sstep` zwraca
zero, a człon wychodzi 1. **`maxSlope` nie ma jak odrzucić siedziska**; fade'uje
tylko brzegi osady na nierównym gruncie. Specyfikacja §8 żąda „nachylenia < 0,25
**w centrum**" i tego wymogu nie ma w kodzie.

Przy wsi z plateau 0,3 to jest łagodne. **Przy miasteczku z plateau 1,0
i promieniem do 900 m to jest 900-metrowy płaski dysk wcięty w zbocze** — i to
jest powód, dla którego to zadanie stoi przed Taskiem 5, a nie po nim.

- [x] **Step 1: Test, który nie przechodzi** — stanowisko na stromym zboczu
      ziarna 42 (znaleźć pomiarem, nie zgadnąć) jest dziś posadzone, a nie
      powinno być.
- [x] **Step 2:** Rozstrzygnąć, skąd bierze się nachylenie w środku. `Fields`
      nie ma pola nachylenia, a siedzisko czyta sampler, nie okno wysokości.
      Najprościej: `LatticeHit` niesie nachylenie środka, próbkowane z samplera
      razem z `h` i `t` — pamięć ma teraz cztery miejsca, więc to kilka próbek
      na komórkę kraty, nie na texel. **Zmierzyć koszt wypełnienia okna przed
      i po**, bo to jest dokładnie to miejsce, które przed chwilą podwoiło fill.
- [x] **Step 3: Testy i commit.**

---

### Task 8a: Pustka wokół domów

**Files:** `library/settlements/`, `tests/unit/`

Zgłoszone przez właściciela po obejrzeniu zdjęć: **„obszar gdzie są domy jest
pusty dookoła i to wygląda dość dziwnie, chyba że później dodamy drzewa i jakieś
krzaki"**.

Przyczyna sprawdzona w kodzie: biom wsi **nie ma haka `populate` w ogóle**. Jego
obecność maluje wydeptaną glinę i spłaszcza grunt na `radius + feather`, czyli
250 + 170 = **420 m**, a parcele zajmują środkowe ~200 m. Reszta to malowana
ziemia, na której z definicji nic nie rośnie — bo wieś nic nie sadzi, a biomy
klimatyczne mają tam bliską zeru wagę.

To jest w zakresie M4b: specyfikacja §8 wymienia wśród dodatków „propsy wzdłuż
dróg (latarnie, drzewa), płoty i sady dla wsi".

- [x] **Step 1: Test, który nie przechodzi** — „nic na rezerwacjach ani na
      drogach" **już było** (`ring.test.ts`, „keeps the scatter off a plan").
      Brakująca połowa siedziała w `contract.test.ts`, który twierdził wprost,
      że osada nic nie sieje, „co utrzymuje jej grunt wsią, a nie lasem".
      To było to zdanie, które oko właściciela obaliło; teraz mówi odwrotnie.
- [x] **Step 2:** Zrobione — i **prościej, niż plan zgadywał**. Przerzedzanie ku
      środkowi okazało się niepotrzebne: rezerwacje parcel już odmawiają drzewa
      tam, gdzie stoją domy, więc jedna gęstość na całym dysku wychodzi rzadko
      w zabudowie i pełno na obrzeżu sama z siebie. Deskryptor `scatter`
      wystarczył, a to znaczy, że osada dostała też **trawę** — i to jest
      większa połowa naprawy, bo okno trawy składa gęstość każdego biomu jego
      wagą, więc wieś bez gęstości była łysa bardziej niż łąka wokół niej.
      Sady: `kit.line` z rodzajem `hedge`, pierwszy użytkownik Taska 3
      w bibliotece. Żywopłot nie zajmuje gruntu (tak mówi kontrakt), więc
      w środku rośnie własny scatter wsi — i dlatego obrysowany kwadrat drzew
      czyta się jako zasadzony. Pięć prób, zmierzone 3,8 sadu na wieś.
      Rysowane na samym końcu: test trzyma, że żywopłoty nie ruszyły ani
      jednego domu.
- [ ] **Step 3: Zdjęcie przed i po**, tą samą drogą co przy nachyleniu, i commit.

---

### Task 8: Testy przeglądarkowe

**Files:** `tests/e2e/smoke.spec.ts`

Wszystkie na pauzie, z twardo wpisanym miejscem ziarna 42 — i **miejsce trzeba
najpierw znaleźć pomiarem w Node**, jak przy wsi. Krata 20 km, więc
miasteczko może być daleko od startu.

Miejsce znalezione pomiarem: **(-5289, -7577)**, 9,2 km od startu — najbliższe
miasteczko ziarna 42, promień 804 m, 1635 budynków, i **żadnej wsi w promieniu
1,4 km**. Rozpiętość gruntu w jego wnętrzu: **0,00 m**. Siedemset metrów od
środka nadal 0,00; dopiero na 1000–1200 m (za promieniem 900, w piórze) grunt
rusza o 12 do 48 m. To jest ten kontrast, o który prosił plan, i jest ostrzejszy
niż przy wsi: wieś trzyma 12 m, miasteczko pół metra.

- [x] **Step 1: Testy:** pięć, `tests/e2e/smoke.spec.ts`.
  1. **Miasteczko stoi**: `scenery.buildings` przekracza 500, a przeszkody
     rosną o tyle samo.
  2. **Żaden dom nie zginął**: licznik odmówionych z Taska 6 jest zerem.
  3. **Ziemia pod nim jest płaska**, a poza pióropuszem już nie — kontrast, jak
     przy wsi, bo plateau miasteczka jest pełne (1,0), więc różnica ma być
     **większa** niż przy wsi. **Uwaga z pomiaru Taska 7:** miejsce trzeba
     wybrać jako miasteczko bez wsi w promieniu 1150 m (nie 900), bo wieś
     w środku miasteczka rozcieńcza plateau do 0,35 naturalnej rzeźby i podnosi
     rozpiętość z 0,01 m do 32,8 m. I nawet wtedy tylko 150 z 200 miasteczek
     jest martwo płaskich — asercja „rozpiętość < 0,5 m" na losowym miasteczku
     migotałaby w jednym przypadku na cztery. Po Tasku 7b ta liczba się zmieni;
     zmierzyć ponownie.
  4. **Lot go nie przecina** — dominanta do 60 m jest wyższa niż cokolwiek, co
     lot dotąd omijał, więc to jest test na `MIN_CLEARANCE` nad wieżą, nie nad
     dachem.
  5. **Kolejka nie zacina klatki ponad to, co pomiar z Taska 5 przewidział** —
     asercja z liczbą, nie z nadzieją.
  6. **Brak błędów konsoli** — materiały linii i dominanty się skompilowały.
- [x] **Step 2:** Uruchomione, `--config pw.local.config.ts`. Jedna asercja
      poszła do kosza w trakcie: „lot przeszedł nad wieżą" nie jest prawdą,
      którą można wymusić — autopilot steruje i nie obiecuje przelecieć nad
      konkretnym dachem. Dominanta dostała więc pytanie deterministyczne:
      postawić postać **wewnątrz** wieży metr pod prześwitem, który dałby sam
      grunt, zrobić jeden krok i zobaczyć, że koperta podniosła ją nad szczyt,
      a nie nad pole, na którym wieża stoi.

---

### Task 9: Dokumentacja

**Files:** `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `docs/perf-notes.md`,
specyfikacja

- [x] **Step 1: `AGENTS.md`** — sekcja „Settlements" zyskuje najwyżej dwa
      zdania: co robi druga krata i co kosztuje plan miasteczka. Nie więcej.
- [x] **Step 2: `CONTRIBUTING.md`** — „Adding a settlement" zyskuje miasteczko
      jako drugi przykład i mówi, kiedy pisze się nowy generator, a kiedy
      wystarczą parametry. Pomiar z tego planu jest odpowiedzią: **gdy układ
      jest inny, parametry nie wystarczą.**
- [x] **Step 3: specyfikacja** — poprawki z datą, jak w M4a: co z §8 wykonanie
      wymusiło inaczej, i dlaczego.
- [x] **Step 4: `perf-notes.md`** — koszt planu miasteczka, koszt jego dróg
      i linii, wpływ na przebudowę pierścienia, i rozstrzygnięcie (a)/(b)
      z liczbą, która je uzasadnia.
- [x] **Step 5: `README.md`** — linijka statusu M4b.

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

## Jak wyszło (2026-09-16, po wykonaniu)

Cztery strachy z samoprzeglądu, po kolei:

1. **Koszt planu miasteczka** — zmierzony i mieści się: 18,8 ms przy 900 m,
   próg 25. Ale pierwszy pomiar dał 24,6, czyli mieścił się o dwa procent, i to
   nie jest decyzja. Klucze hasza jako liczby zamiast stringów zrobiły
   z 24,6 → 18,8 przy identycznym miasteczku. Bez tego Task 5 byłby wrócił do
   (b) na pierwszej innej maszynie.
2. **Cicha odmowa puli** — nie zdarza się (najgorsza pula w jednej trzeciej),
   ale jest teraz policzalna i test przeglądarkowy żąda zera.
3. **Dwie kraty** — zmierzone w Tasku 7, zero kolizji na 65 536 masek ziarna.
4. **`kit.line` dzielony z drogami** — `walkPolyline` jest jeden, sprawdzone
   złamaniem `MITER_LIMIT`: czerwienią się oba zestawy testów.

Czego samoprzegląd **nie** przewidział, a okazało się ważniejsze od trzech
z powyższych:

- **`maxSlope` nie jest narzędziem do cięcia gruntu.** Plan zakładał, że
  miasteczko dostanie ostrzejszy próg. Pomiar pokazał, że ostrzejszy próg nie
  zmienia cięcia (167 → 146 m mediany) i tylko przerzedza miasteczka dwukrotnie.
  Stąd `maxCut`, którego w planie nie było.
- **Rezerwacje parcel nie przerzedzają scatteru tak, jak wyglądają.** Pokrywają
  jakąś piątą część dysku, a `floor()` w scatterze zjada resztę: przy gęstości
  0,55 wieś miała 1,7 drzewa na hektar w środku i 1,7 na zewnątrz — ten sam las,
  z domami w środku. Dopiero 0,3 robi z tego polanę.
- **Test „lasu wokół wsi" mierzył wieś przeciwko jej własnemu obrzeżu.** Pasmo
  od 1,4 do 2,4 promienia leży wewnątrz obecności wsi (promień + pióro), więc
  „las na zewnątrz" był przerzedzony przez samą wieś. Stosunek czytał się jako
  0,74 dla czegoś, co naprawdę wynosi 0,40.

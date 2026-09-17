# Dwie kraty naraz: jak często wieś siada w miasteczku (2026-09-16)

M4b, Task 7, Step 1 — **pomiar, nie implementacja**. Nic w `src/` ani
`library/` się nie zmieniło; ten plik jest jedynym wynikiem kroku.

Pytanie planu: po M4b rejestr niesie dwie kraty osad (wieś 6 km, miasteczko
20 km) i nic nie zabrania, żeby wieś usiadła wewnątrz miasteczka. Plan
wymienia trzy wyjścia — miasteczko wygasza obecność wsi, `Sites` odrzuca
stanowisko w promieniu większego, albo przyjmujemy to i mierzymy, jak często.
Ta notatka mierzy i wskazuje jedno.

---

## 1. Reguła sadzania, odtworzona i sprawdzona

`Sites.seat` (`src/engine/scenery/Sites.ts`) dla komórki kraty `(gx, gz)`:

1. pyta `fields.at((gx + 0,5) · cell, (gz + 0,5) · cell).lattice(cell, salt)` —
   w **nominalnym** środku komórki, bo każdy jej punkt daje ten sam trafiony
   środek;
2. bierze z trafienia **zjitterowany** środek `(hit.cx, hit.cz)`, promień ze
   strumienia 2 i obrót ze strumienia 3;
3. czyta pola **w tym środku** i odrzuca komórkę, gdy
   `presence(here) <= 0 || !spec.fits(here)`.

Hak `lattice` (`library/standard/presence.js`) pytany dokładnie w środku
upraszcza się do trzech warunków, bo `hit.d = 0`: `near = 1`, człon
`maxSlope` = 1 (różnica wysokości względem samego siebie to zero), a
`shoreBonus` wieś ma zerowy. Zostaje:

> **Komórka niesie osadę wtedy i tylko wtedy, gdy jej własny strumień 1
> (`hit.u(1)`, liczony na indeksie komórki, nie na środku) wypadnie poniżej
> `odds`, a grunt w zjitterowanym środku ma `baseHeight >= land` i
> `temp >= minTemp`.** Promień, obrót i strumień planu to już tylko
> konsekwencje tej samej komórki.

**Jak to sprawdziłem:** napisałem ten warunek słowo w słowo (trzy porównania
na surowych liczbach z `hit`) i porównałem z tym, co zwraca prawdziwe
`createSites(...).near(0, 0, 400 000)` na ziarnie 42. Na **11 968 komórkach
wsi i 1 060 komórkach miasteczka** (dysk 370 km wokół startu):

- **0 niezgodności** między regułą wypowiedzianą po ludzku a silnikiem,
- **0 stanowisk** postawionych gdziekolwiek indziej niż w środku kraty
  (odległość siedziska od środka: dokładnie 0,00 m — to samo, co M4a wpisało
  do specyfikacji),
- **0 stanowisk**, w których hak obecności nie jest dodatni.

Cała reszta pomiarów jedzie na prawdziwym `createSites`, prawdziwym
`createWorldSampler(42)` i prawdziwych hakach z `library/standard/` — nigdzie
nie ma mojej kopii reguły poza tym jednym testem zgodności.

### Co przy okazji widać w hakach

- **`maxSlope` nie ma prawa odrzucić siedziska.** W środku komórki mierzona
  różnica wysokości to `|baseHeight − hit.h| = 0`, więc człon nachylenia jest
  równy 1 zawsze. `fits` wsi też czyta tylko wysokość i temperaturę. To
  znaczy, że **osada może usiąść na dowolnie stromym zboczu**, byle sam środek
  był nad linią lądu — hak przycina potem tylko *obecność wokół* środka.
  W próbie jest para, w której środek wsi leży **513 m wyżej** niż środek
  miasteczka oddalonego o 660 m. Nie nazywam tego błędem (tak to jest
  napisane), ale to jest powód, dla którego miasteczko z „pełnym plateau" nie
  zawsze ma płaski grunt — patrz §4.
- `seat` losuje promień i obrót **przed** sprawdzeniem obecności; to tylko
  praca na próżno na odrzuconej komórce, strumienie są per-komórka, więc nic
  się nie przesuwa.
- `forget` kasuje z mapy `found` wpisy ze stanowiskiem, ale **nigdy wpisów
  pustych** (`null`) — pamięć pustych komórek rośnie przez cały lot i nic jej
  nie zwalnia. Ile to jest po godzinach lotu, nie mierzyłem; przy kracie 6 km
  rośnie wolno, ale rośnie monotonicznie.

---

## 2. Miasteczko na stanowisku pomiarowym

Miasteczka nie ma, więc zbudowałem je w stendzie z liczb specyfikacji (§8) w
kształcie, jaki narzuca `library/settlements/settlement.js`: krata 20 km, odds
0,6, promień 400..900 m, plateau `strength: 1,0`, pióro 200 m (górna granica
pasma 100..200 ze specyfikacji), a **grunt te same trzy liczby, co wieś**
(`land: 10`, `minTemp: 0,2`, `maxSlope: 0,25`) — tabela §8 podaje wymóg lądu
i nachylenia raz, dla osad, a nie osobno dla każdej.

`validateLibrary` na rejestrze z dwiema osadami zwraca **pustą listę**:
promień 900 m siada dokładnie na `SITE_RADIUS = 900` (granica jest „większy
niż", więc przechodzi), a krata 20 km przechodzi strażnika zasięgu z Taska 1.

### Sól kraty: `0x7011`, i dlaczego nie cokolwiek

Sól wchodzi do hasha przez `salted(salt) = salt ^ imul(seed, 0x9e3779b1)`, a
z niej kraty biorą jitter (`salted(salt)`, `salted(salt + 31)`) i strumienie
`u(k) = salted(salt) + k · 977` dla k = 0..4. Sól miasteczka nie może wpaść
w żaden z tych sześciu numerów wsi — **w żadnym świecie**, bo ziarno jest maską
XOR i różnica soli zmienia się razem z nim. Przejechałem wszystkie 65 536
masek:

| kandydat | maski, w których dzieli strumień ze wsią |
| --- | --- |
| `0x7011` (wybrany) | **0** z 65 536 |
| `0x5117 + 977` = `0x54e8` | 128 |
| `0x5117 + 31` = `0x5136` | 65 536 |

I sprawdzenie od drugiej strony, na ziarnie 42, na 160 000 wspólnych indeksach
komórek: przy `0x7011` obie kraty ciągną jak dwie niezależne monety — obie na
raz 0,3020 wobec 0,3011 oczekiwanego z iloczynu (0,5022 · 0,5995) — a jitter
zgadza się na **0 z 3 600** indeksów. Gdyby miasteczko zostało przy soli wsi
`0x5117`: obie na raz 0,5022, czyli komórka o danym indeksie niosąca wieś
**zawsze** niesie i miasteczko (0,5 < 0,6 na tym samym losowaniu), a jitter
identyczny na **3 600 z 3 600** indeksów. Że indeksy obu krat to inne miejsca
w świecie, nie ratuje sprawy: to jest ta sama loteria i ten sam rozkład
środków wewnątrz komórki, przepisane w dwóch skalach — jeden świat, nie dwie
kraty.

---

## 3. Ile tego jest

### Dlaczego nie 100 km

Plan pyta o „promień 100 km wokół ziarna 42". Zmierzone dosłownie: **80
komórek miasteczka (28 miasteczek) i 872 komórki wsi (189 wsi), zero zajść
jakiegokolwiek rodzaju**, najbliższa wieś do miasteczka 3 262 m. Na tym
obszarze odpowiedź brzmi „nigdy", i jest to odpowiedź bez wartości — 80
komórek to za mało, żeby zobaczyć zdarzenie rzędu jednego na sto.

### Obszar, na którym liczby coś znaczą

**25 dysków o promieniu 970 km, środki co 2 500 km, razem 73 898 113 km²
ziarna 42; 2 236 776 posadzonych komórek kraty (2 052 576 wsi + 184 200
miasteczka), 25,4 s pracy.** Zdarzeń „wieś w miasteczku" wyszło 774, czyli
błąd względny około 3,6 % (1/√774) — to jest ten poziom, przy którym decyzja
nie zmienia się od szumu. Świat jest szumem bez globalnej struktury, więc
dyski daleko od startu są równie prawdziwe jak ten wokół niego.

| krata | komórki | niesie osadę | komórki, które przeszły próg gruntu |
| --- | --- | --- | --- |
| wieś, 6 km | 2 052 576 | 475 057 (23,14 %) | 46,3 % |
| miasteczko, 20 km | 184 200 | 51 263 (27,83 %) | 46,4 % |

Obie kraty widzą ten sam grunt (23,14/0,5 = 46,3 %, 27,83/0,6 = 46,4 %) — to
jest wewnętrzna kontrola spójności, bo mają te same trzy liczby na grunt.
Puste komórki wsi (dysk 370 km): 64,8 % z loterii, 34,4 % pod linią lądu,
0,7 % za zimne.

### Zajścia

| zdarzenie | wsi | % wsi | % miasteczek |
| --- | --- | --- | --- |
| środek wsi w **losowanym** promieniu miasteczka (`d < rT`) | 774 | 0,163 % | **1,51 %** |
| środek wsi w 900 m, które hak zawsze zajmuje | 1 335 | 0,281 % | 2,60 % |
| … w 900 + 200 m pióra | 1 939 | 0,408 % | 3,78 % |
| **losowane** promienie zachodzą (`d < rV + rT`) | 1 210 | 0,255 % | **2,36 %** |
| zajmowane dyski zachodzą (`d < 250 + 900`) | 2 083 | 0,438 % | 4,06 % |
| … z obydwoma piórami (`d < 420 + 1 100`) | 3 353 | 0,706 % | 6,54 % |

Rozróżnienie „w środku" a „zachodzą" jest istotne i wypada dokładnie tak, jak
zapowiadał plan: zachodzenie jest o połowę częstsze niż wejście do środka.
Warto też widzieć, że **hak zajmuje zawsze `radius[1]`**, nie wylosowany
promień — ziemia jest malowana i płaszczona na 900 m wokół każdego
miasteczka, choćby to miasteczko miało 400 m — więc wiersze „zajmowane dyski"
są tym, co naprawdę dotyczy terenu, a wiersze „losowane" tym, co dotyczy
planów.

Głębokość zajścia (774 par „w środku"): odległość od środka miasteczka
min 1,8 m, p25 322,9 m, **mediana 462,8 m**, p75 598,1 m, max 892,5 m; licząc
od krawędzi miasteczka do wewnątrz — p25 110,5 m, **mediana 230,9 m**, p75
370,2 m, max 843,8 m. Czyli to nie są muśnięcia krawędzi: typowa kolizja to
wieś mniej więcej w połowie promienia miasteczka. Szerokość wspólnego pasa dla
1 210 par zachodzących: p25 112,1 m, mediana 280,1 m, max 1 045,9 m.

Rzeczy, które **nie** zachodzą nigdy: dwa miasteczka (najbliższa para w
próbie 8 070 m przy sumie promieni 1 800 m) i dwie wsie (2 439 m przy 500 m).
Jitter ±0,3 komórki nie potrafi zbliżyć dwóch środków tej samej kraty.
Ryzyko jest wyłącznie międzykratowe.

---

## 4. Co się dzieje z ziemią, gdy obie kraty ją zajmą

To jest pytanie, na które plan kazał nie zgadywać. Zmierzone na samym
samplerze (bez planów, bez pierścienia — sam `sampleWindow`), w trzech
wariantach rejestru: „jak dziś" (sama wieś), „samo miasteczko" (wieś wyjęta),
„obie".

**Nie ma walki ani uskoku — jest rozcieńczenie.** Sampler nie pozwala jednemu
hakowi wygrać z drugim: liczy obecności, normalizuje trzy najsilniejsze i
**każdą zmianę wysokości waży udziałem jej biomu**, a każdy hak czyta wysokość
bazową, nie odpowiedź sąsiada. W środku wsi leżącej w miasteczku obie
obecności są równe 1 (biomy klimatyczne mają tam ~0,00), więc udziały
wychodzą **0,50 / 0,50 — na 773 z 774 par** (na jednej jedynej obecność
miasteczka jest zerowa, ścięta jego własnym `maxSlope`).

Wysokość jest wtedy jedną mieszanką i niczym więcej:

```
h = base + w_T · 1,0 · (h_T − base) + w_V · 0,3 · (h_V − base)
```

sprawdzone na 657 parach z dokładnością do **5,7 · 10⁻¹⁴ m**, czyli do szumu
zmiennoprzecinkowego. Przy udziałach 0,50/0,50 to jest

```
h = 0,35 · base + 0,50 · h_T + 0,15 · h_V
```

— **35 % naturalnej rzeźby zostaje na miejscu**, bo plateau wsi ma siłę
zaledwie 0,3 i nie dokłada tego, co zabiera miasteczku normalizacja.

Skutek na gruncie miasteczka, w promieniu 400 m od jego środka (774 par):

| | samo miasteczko | z wsią w środku |
| --- | --- | --- |
| odchylenie std wysokości | mediana 0,00 m | mediana **6,22 m** (p95 22,46) |
| rozpiętość min–max | mediana 0,01 m | mediana **32,83 m** (p95 95,50) |
| „martwo płaskie" (< 0,5 m) | 548 z 774 | **24 z 774** |

Wieś przesuwa grunt miasteczka o **medianę 24,35 m** (p75 38,45, p95 78,85,
max 252,08). W drugą stronę grunt samej wsi robi się *gładszy* (odchylenie std
z 13,57 m na 6,94 m), ale wokół cudzej wysokości — wieś dostaje ładny stok
zamiast swojego placu.

Kontrola, bo połowa tego efektu mogłaby być winą terenu, nie wsi: **200
miasteczek bez wsi w promieniu 1 150 m** — 150 z 200 martwo płaskich w
promieniu 400 m, mediana rozpiętości 0,00 m, p95 41,4 m, max 157,5 m. Czyli
miasteczko samo w sobie jest płaskie w ~75 % przypadków, a te pozostałe 25 %
to ścięcia jego własnego `maxSlope` na stromiźnie (§1). Z wsią w środku
płaskich zostaje 3 %.

### Jak to wygląda w świecie

Najbliższa startu para ziarna 42: **`village:-28,-22` przy (−166 089,
−129 468), promień 198 m, i `town:-9,-7` przy (−166 064, −129 040), promień
721 m — 429 m od siebie**, środki różnią się wysokością o 53 m. Zbudowałem
prawdziwy plan tej wsi prawdziwym `planVillage` przez `Sites.work` (jednym
wywołaniem z nielimitowanym budżetem, więc czas tego wywołania nie jest kosztem
planu i nie podaję go — koszt planu ma plan M4b): **5 dróg, 34 parcele,
34 rezerwacje, 725 m ulicy, 17,0 tys. m² zarezerwowanego gruntu — i wszystkie
34 parcele oraz wszystkie punkty dróg leżą wewnątrz dysku miasteczka**
(1 631 tys. m²).

Grunt tej właśnie pary, zmierzony: środek miasteczka 40,6 m, środek wsi
93,5 m. Samo miasteczko kładzie swoje 400 m **martwo płasko** (odchylenie
0,00 m, rozpiętość 0,0 m); z wsią w środku ten sam krąg ma odchylenie 8,83 m
i **38,5 m rozpiętości**, a wieś przesuwa jego grunt miejscami o **50,95 m**.
Sama wieś dostaje ziemię 26,4 m niżej, niż stałaby bez miasteczka (93,5 →
67,1 m).

Czyli obraz kolizji jest taki: 34 chałupy ze swoją ulicą stoją wewnątrz
miasteczka, 429 m od jego środka, na gruncie, który zamiast być płaski jak
stół ma 38 m rozpiętości na 800 m — a obie osady rezerwują ten sam teren, więc
las trzyma się z daleka od obu. Nic się nie psuje, nic nie znika, nic nie
miga: to wygląda jak dzielnica postawiona przez kogoś innego i o kilkadziesiąt
metrów za wysoko.

---

## 5. Jak często pilot to zobaczy

Pierścień sięga 2 600 m, więc kilometr lotu prześwietla 5,2 km². Z gęstości
zmierzonych wyżej (73 898 113 km²):

| | na km lotu | co ile kilometrów | przy 40..62 m/s |
| --- | --- | --- | --- |
| jakiekolwiek miasteczko | 3,61 · 10⁻³ | 277 km | co **1,2–1,9 h** |
| zachodzące promienie | 8,51 · 10⁻⁵ | 11 745 km | co **53–82 h** |
| wieś w środku miasteczka | 5,45 · 10⁻⁵ | 18 360 km | co **82–127 h** |

---

## 6. Czego nikt nie zamawiał: druga krata kosztuje 2,3 × wypełnienie okna

Przy okazji wyszła rzecz **większa niż samo ryzyko kolizji**, i jest ona
dokładnie o tytule tego Taska („dwie kraty naraz"). Pełne wypełnienie okna
wysokości (560 × 560 texeli), mediana z pięciu:

| rejestr | biomy | pełne wypełnienie |
| --- | --- | --- |
| jak dziś (jedna krata) | 11 | **784 ms** |
| dwunasty biom **bez** kraty | 12 | 792 ms |
| wieś 6 km + miasteczko 20 km | 12 | **1 823 ms** |
| miasteczko na komórce i soli wsi (jeden środek) | 12 | 809 ms |
| dwie kraty 6 km, różne sole | 12 | 1 810 ms |
| samo miasteczko (jedna krata) | 11 | 778 ms |

Dwunasty biom **bez** kraty kosztuje 8 ms, czyli mniej niż rozrzut między
pięcioma przebiegami — to jest ta sama obserwacja, co w `AGENTS.md`: koszt
wypełnienia robią pola bazowe, nie haki. (Punkt odniesienia 784 ms jest
zmierzony tutaj, na tym kontenerze; 530 ms z `AGENTS.md` jest z innej maszyny
i innego drzewa, więc porównuję tylko wiersze tej tabeli między sobą.)
**Druga krata kosztuje 1 038 ms, czyli 2,32 ×**, i nie ma to nic wspólnego
z rozmiarem komórki: dwie kraty 6 km o różnych solach kosztują tyle samo,
a miasteczko na *tej samej* komórce i soli co wieś jest znowu darmowe.

Przyczyna jest w `src/engine/terrain/Fields.ts`: pamięć wysokości środka
kraty (`centre`, `atX`, `atZ`) ma **jedno miejsce**. Przy jednej kracie trafia
prawie zawsze; przy dwóch haki na przemian pytają o dwa różne środki i każdy
texel płaci dwa dodatkowe `baseFields`. Komentarz w tym pliku sam to
przewiduje („without it a presence hook that asks for a lattice would double
the cost of a fill") — tylko że warunkiem nie jest brak pamięci, lecz **druga
krata**.

W locie (30 s prosto po skosie przy 62 m/s, okno aktualizowane co klatkę):
praca okna rośnie z 224 ms na 540 ms (7,5 → 18,0 ms na sekundę lotu), a
**najgorsza klatka z 3,74 ms na 8,25 ms** — przy 16,7 ms budżetu i 4 ms
kolejki planów to jest realny kawałek klatki. Pełne wypełnienie zdarza się
tylko przy starcie i przy skoku ponad 2,24 km, więc 1,8 s to koszt ładowania
za zasłoną, nie zacięcie w locie.

To nie jest zadanie tego kroku i niczego tu nie zmieniałem. Do rozważenia w
Tasku 5 albo 6: pamięć środka na kilka miejsc, kluczowana `(cell, salt, ix,
iz)`. Zmiana jest lokalna i nie dotyka żadnego haka.

---

## 7. Rozstrzygnięcie

**Rekomendacja: trzecie wyjście z planu — przyjmujemy, że się zdarza,
zapisujemy liczbę i nie budujemy nic.** (Numeruję wyjścia słowami, nie
literami, bo litery (a)–(d) są w tym planie zajęte przez rozstrzygnięcie
o budżecie planu miasteczka.)

Liczba, która to uzasadnia: **wieś ląduje w promieniu miasteczka raz na
18 360 km lotu, czyli raz na 82–127 godzin w powietrzu (1,51 % miasteczek),
a jakiekolwiek zachodzenie promieni raz na 53–82 godziny (2,36 %).** Miasteczko
samo w sobie mija się co 1,2–1,9 h. Żadna maszyneria dokładana do silnika albo
do kontraktu biblioteki nie zwraca się przy zdarzeniu tej rzadkości, a koszt
wizualny zdarzenia jest „dzielnica na stoku", nie awaria.

Dlaczego nie pozostałe dwa, skoro i tak trzeba było zmierzyć:

- **`Sites` odrzuca stanowisko wewnątrz większego — to pogarsza sprawę.**
  Grunt psuje **obecność**, nie plan: cały §4 zmierzono na samym samplerze,
  bez jednego domu. Odrzucenie siedziska w `Sites` zostawiłoby udziały
  0,50/0,50 i płaskość placu miasteczka dalej rozjechaną o 32,8 m mediany,
  a zabrałoby domy wsi (w mierzonym przykładzie 34) — zostałby **łysy placek
  wydeptanej gliny bez ani jednego domu**. To jest dokładnie ta wada, którą
  M4a usunęło („72 płaskie place wydeptanej gliny bez jednego domu"), tylko
  wprowadzona z powrotem świadomie.
- **Miasteczko wygasza obecność wsi — to jedyne, co naprawia grunt**, bo
  zdejmuje obecność u źródła, a że `seat` woła ten sam hak w tym samym
  punkcie, siedzisko znika razem z malowaniem i płaskowyżem, bez drugiej
  reguły. I **nie kosztuje nic na texel**: wieś czytająca dodatkowo kratę
  miasteczka to 1 834 ms wypełnienia wobec 1 853 ms bez tego (szum) — druga
  krata i tak już jest w rejestrze (§6). Jej cena jest wyłącznie projektowa:
  plik wsi musiałby znać komórkę, sól, odds i grunt miasteczka, czyli **te
  same liczby w dwóch miejscach** — ta sama klasa wady, którą naprawia Task 1
  tego planu. Przy 1,51 % nie warto; gdyby kiedyś warto było (np. gdy dojdzie
  trzecia osada albo gęstsza krata), to jest ten kształt, który należy wziąć.

### Co z tego wynika dla pozostałych zadań M4b

- **Task 8, test 3 („ziemia pod miasteczkiem płaska").** Miejsce trzeba wybrać
  pomiarem, jak mówi plan, ale kryterium jest ostrzejsze, niż się wydaje:
  miasteczko bez wsi w promieniu **1 150 m** (nie 900), i nawet wtedy tylko
  **150 z 200** miasteczek jest martwo płaskich w promieniu 400 m — reszcie
  ścina obecność jej własny `maxSlope` na stromiźnie. Asercja „rozpiętość
  < 0,5 m" na losowo wybranym miasteczku byłaby migotliwa w ~25 % miejsc, i to
  bez żadnej wsi w pobliżu.
- **Task 5.** Przedmieścia wychodzą poza pióro płaskowyżu tam, gdzie plateau
  i tak nie zadziałało w pełni — reguła nachylenia dla ulic miasteczka jest
  potrzebna nie tylko na obrzeżu, ale i w środku tych 25 % miasteczek.
- **Task 9.** Do `AGENTS.md` idą dwa zdania: druga krata (1,51 % miasteczek
  niesie wieś, przyjmujemy to) **i** to, że druga krata podwaja koszt
  wypełnienia okna, dopóki pamięć środka w `Fields.ts` ma jedno miejsce.

---

## 8. Czego nie zmierzyłem

- **Planu miasteczka.** Generatora nie ma (Task 5), więc zdanie „dwie ulice
  przechodzą przez siebie" opiera się na tym, że **cały** plan wsi (34 parcele,
  725 m ulicy) leży w dysku miasteczka — nie na dwóch zmierzonych układach.
  Ile parcel miasteczka trafi dokładnie w te 34, policzy dopiero Task 5.
- **Obrazu.** Wszystko jest z CPU (`sampleWindow`, `Sites`, `planVillage`);
  żadnego piksela, bo testów przeglądarkowych w tej sesji uruchamiać nie
  wolno. „Wygląda jak dzielnica na stoku" to wniosek z liczb wysokości, nie
  ze zrzutu.
- **Wrażliwości na parametry miasteczka.** `land`, `minTemp`, `maxSlope`
  i pióro 200 m to moje odczytanie §8; procent **na miasteczko** od nich nie
  zależy (liczy gęstość wsi wokół istniejącego miasteczka), ale procent **na
  wieś** skaluje się mniej więcej liniowo z odds i gęstością miasteczek.
- **Innych ziaren niż 42.** Cały pomiar jest na ziarnie 42. Sól `0x7011` jest
  sprawdzona dla wszystkich 65 536 masek ziarna, ale zajścia — nie.
- **Zachowania pierścienia i pul**, gdy oba plany są w nim naraz
  (`cell.occupied`, `Obstacles`, pule budynków). To jest pytanie na test
  przeglądarkowy, nie na Node.

---

Pomiary zrobione na drzewie z `322e3c3`, ziarno 42, ten kontener. Wszystkie
liczby w tym pliku są zmierzone; żadna nie jest oszacowana.

# Pomiar: czym naprawdę sterujemy cięciem pod miasteczkiem (2026-09-16)

Zapis pomiaru z Tasku 5 M4b. Plan zakładał, że miasteczko dostanie `maxSlope`
„znacznie ostrzejszy niż wsi", bo jego plateau o pełnej sile wycięłoby zbocze.
Pomiar pokazał, że to nieprawda, i że ostrzejsza liczba kupuje wyłącznie
rzadkość. Stąd `maxCut` — nowe, jedno opcjonalne pole haka `lattice`.

Ziarno 42, krata 20 km, salt `0x7011`. Kod pomiaru był jednorazowy (katalog
roboczy sesji), liczby niżej są tym, co wypisał.

## 1. Ile komórek w ogóle uniesie miasteczko

5184 różnych środków krat w kwadracie 1400 km.

```
nachylenie środka: min 0,000  q25 0,031  mediana 0,110  q75 0,228  q90 0,359  max 1,219
ląd >= 12 m:                    2466 / 5184  (47,6%)
  i temperatura >= 0,25:        2342 / 5184  (45,2%)
```

Z odds 0,6 na wierzchu:

| maxSlope | przechodzi ląd+temp+nachylenie | × odds 0,6 | km między miasteczkami |
| --- | --- | --- | --- |
| 0,06 | 177 (3,4%) | 105 (2,0%) | 141 |
| 0,08 | 297 (5,7%) | 172 (3,3%) | 110 |
| 0,10 | 436 (8,4%) | 251 (4,8%) | 91 |
| 0,12 | 596 (11,5%) | 341 (6,6%) | 78 |
| 0,15 | 808 (15,6%) | 471 (9,1%) | 66 |
| 0,20 | 1176 (22,7%) | 699 (13,5%) | 54 |
| 0,30 | 1713 (33,0%) | 1016 (19,6%) | 45 |
| 0,45 | 2099 (40,5%) | 1261 (24,3%) | 41 |

Dla skali: wieś (krata 6 km, odds 0,5, ląd 10, temp 0,2, nachylenie 0,45) niesie
stanowisko w 21,0% komórek, czyli **jedna co 13,1 km**. Przy 40–62 m/s to 3,5 do
5,4 minuty lotu. Miasteczko przy 0,45 to 41 km, czyli **11 do 17 minut** — i to
jest sufit narzucony przez samą kratę 20 km ze specyfikacji, nie przez nachylenie.

## 2. Co ostrzejsze nachylenie robi z cięciem — nic

Dla każdego stanowiska, które przechodzi ląd+temp+odds (1415 sztuk), zmierzone
`|baseHeight - h_środka|` w 32 kierunkach na promieniach 150…900 m.

| maxSlope | stanowisk | największe cięcie w 900 m (mediana / q90 / max) | cięcie na obrzeżu (mediana / q90) |
| --- | --- | --- | --- |
| 0,06 | 105 | 146 / 319 / 563 m | 140 / 304 m |
| 0,10 | 251 | 137 / 303 / 563 m | 133 / 283 m |
| 0,12 | 341 | 140 / 310 / 563 m | 135 / 291 m |
| 0,20 | 699 | 148 / 318 / 563 m | 140 / 295 m |
| 0,45 | 1261 | 167 / 335 / 608 m | 152 / 311 m |

**Mediana cięcia spada ze 167 m do 146 m, kiedy odrzucamy dwa stanowiska na
trzy.** To nie jest narzędzie do tego zadania. Powód jest prosty: `hit.s` mierzy
nachylenie przez `LATTICE_SLOPE_PROBE` = 125 m, a to, jak daleko grunt ucieknie
na 900 m, jest rzeźbą terenu, nie pochodną w jednym punkcie.

## 3. Cięcie rośnie z zasięgiem, i to podpierwiastkowo

Te same 895 stanowisk (po odrzuceniu `s > 0,45`), maksymalne odchylenie gruntu
na danym promieniu:

| zasięg | mediana | q75 | q90 | max |
| --- | --- | --- | --- | --- |
| 250 m | 65 | 90 | 118 | 301 m |
| 400 m | 93 | 130 | 184 | 460 m |
| 550 m | 114 | 168 | 238 | 524 m |
| 650 m | 127 | 188 | 260 | 531 m |
| 800 m | 140 | 209 | 302 | 600 m |
| 900 m | 148 | 231 | 310 | 608 m |

3,6× zasięgu daje 2,3× cięcia — teren ma rzeźbę mniej więcej jak `r^0,66`.
Wieś przeżywa swoje 65 m, bo jej plateau ma siłę 0,3 (zostaje ~20 m).

## 4. Co z tego wyszło

Hak `lattice` dostał **`maxCut`** — dopuszczalne odejście gruntu od środka
**w metrach**, w miejsce `maxSlope × max(d, radius)`. Dwa różne pytania, które
do tej pory odpowiadała jedna liczba:

- `maxSlope` odrzuca **komórkę**, której własny środek stoi na stromiźnie
  (mierzone przez 125 m). To jest to, do czego ją napisano w Tasku 7b.
- `maxCut` wygasza **osadę** tam, gdzie grunt uciekł od środka za daleko. Przy
  osadzie szerokiej na kilkaset metrów to jest zupełnie inna wielkość.

Wieś nie podaje `maxCut` i zachowuje dokładne stare zachowanie. Miasteczko
dostało `maxSlope: 0.45` (to samo, co wieś, wybrane przez właściciela ze zdjęć)
i `maxCut: 120` — mediana cięcia na obrzeżu to 148 m, więc przy 120 wygaszanie
naprawdę pracuje: miasteczko na falującym gruncie zachowuje tę część, która jest
płaska, i oddaje resztę. Plateau idzie za tym samo, bo silnik waży każdą zmianę
wysokości udziałem biomu.

## Czego tu nie ma

Nie mierzono, jak to wygląda. Liczby mówią, o ile grunt ucieka; czy 120 m to
ładny kompromis, rozstrzygnie zdjęcie — tak jak przy progu 0,45 dla wsi.

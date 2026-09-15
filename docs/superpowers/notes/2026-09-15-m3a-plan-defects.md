# Wady planu M3a znalezione przy wykonaniu

Jeden wpis na miejsce, gdzie tekst planu był wewnętrznie niespójny albo
prowadziłby do błędu, co z tym zrobiłem i co silniejszy recenzent ma
sprawdzić. Ten plik nie jest częścią normalnej pętli przeglądu zadań — to
lista do ręki dla przeglądu całej gałęzi na końcu M3a.

---

## Task 1 — kolory w `params` biomu

Plan (Task 1, Step 2, punkt 2) każe przepuszczać przez `colorProblem` „każdą
wartość w `params`, która jest stringiem z `SWATCH` **albo liczbą całkowitą w
zakresie koloru**”. Drugiej połowy tej reguły nie da się wykonać: **każda**
liczba całkowita z 0..16 777 215 jest w zakresie koloru, więc `scale: 1200`
(zwykła liczba metrów) byłaby czytana jako `#0004b0`, czyli bardzo ciemny
granat, i odrzucona za wyjście poza kopertę jasności. Reguła odrzucałaby
poprawne parametry i nie dałoby się jej naprawić progiem — nie ma progu, który
odróżnia gęstość od koloru.

**Zastosowana poprawka:** kolor w `params` zapisuje się jako **string** —
nazwa próbki (`'meadow'`) albo `'#rrggbb'`. Walidator sprawdza wyłącznie
wartości tekstowe; liczby przechodzą bez pytań. `colorProblem` przyjmuje teraz
także `'#rrggbb'`, a `swatchColor` je rozwiązuje. Liczbowe kolory zostają
legalne w kodzie (haki biomu z kodu, `validateBaked`), bo tam nikt ich nie
myli z parametrem.

**Do sprawdzenia przez przegląd:** czy dziesięć biomów z Taska 8 rzeczywiście
zapisuje `params` stringami (inaczej walidator przepuści literówkę w kolorze),
i czy `GroundCtx.color` w Tasku 7 radzi sobie z obiema postaciami.

**Skutek uboczny, świadomy:** `params` biomu ma teraz typ
`Record<string, string | number>`, a nie `Record<string, unknown>` — parametr
biomu z danych ma być zapisywalny do JSON (spec §5.1), więc zawężenie jest
zgodne z kontraktem, nie wbrew niemu.

---

## Task 2 — zasięg brzegu

Plan (Task 2, Interfaces) podawał `shore = 1 - smoothstep(0, 60, |baseHeight|)`.
Szelf w `sampleWorld` przycina dno morskie do około **−46 m**, więc przy zasięgu
60 m całe morze jest brzegiem (|h| = 45 → shore ≈ 0,16, a nie 0), a test „głęboka
woda nie jest brzegiem” nie miał jak przejść — bo głębokiej wody w tym świecie
nie ma.

**Zastosowana poprawka:** `SHORE_REACH = 25`. Pokrywa plażę (piasek rysuje się
od 1,5 do 7,5 m) i pas wydm za nią, a dno morskie zostaje poza zasięgiem.

**Do sprawdzenia przez przegląd:** czy 25 m wystarczy hakom osad z M4
(`shoreBonus`), gdy będą chciały stawiać wioski „przy brzegu”.

---

## Task 7 i 8 — kolejność

Zadania wykonane w kolejności 8 → 7 (biomy przed shaderem), nie 7 → 8. Powód:
shader bez rejestru nie ma czego malować, a dane biomów to czysty tekst bez
ryzyka. Żadnych zmian w treści zadań.

---

## Task 10 — test przeglądarkowy szukający biomów

Plan kazał znaleźć w locie dwa punkty o różnych biomach, skacząc co 20 km.
Każdy taki skok to **pełne wypełnienie okna** (313 600 texeli, ~0,5 s w Node i
wyraźnie więcej w przeglądarce programowej), więc sześćdziesiąt prób nie mieści
się w 90-sekundowym budżecie testu — pierwsza wersja padała na czasie.

**Zastosowana poprawka:** dwa punkty ziarna 42 wpisane na sztywno
(`steppe` na 24 000/5 500, `wildsong` na 162 000/62 500), z asercją na
identyfikatory, więc zmiana wag wysypie test z czytelnym komunikatem zamiast
cicho go osłabić. Do tego `test.slow()` i pauza pętli renderowania.

Druga rzecz, której plan nie przewidział: **dwa zrzuty tego samego miejsca nie
były identyczne**, bo między nimi lot leciał dalej (szum kursu, harmonogram
pokładu, niskie przeloty). Zrzut robi się teraz po **jednym** kroku 0,02 s od
ręcznie ustawionej pozy, a nie po sześćdziesięciu.

---

## Pomiar, którego plan nie zamawiał

Pełne wypełnienie okna z dziesięcioma biomami: **530 ms**, bez biblioteki:
**528 ms** (ten sam kontener, średnia z trzech). Dziesięć haków obecności na
texel ginie w koszcie pól bazowych. Ryzyko nr 3 z planu („koszt rośnie z
rejestrem”) dotyczy więc shadera, nie próbkowania — i na razie nie widać go też
w shaderze, bo przy trzech slotach wykonują się najwyżej trzy gałęzie z dziesięciu.

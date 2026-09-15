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

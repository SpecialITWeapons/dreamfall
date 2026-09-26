# Woda: jeziora i morza

Data: 2026-09-26. Status: kierunek zatwierdzony w rozmowie; właściciel prosi
o implementację od razu po specu. Zmienia wodę z sekcji M1 projektu
(`2026-09-14-dreamfall-design.md`): jedna tafla i jeden wygląd zostają, ale
wygląd zależy od tego, jaki to zbiornik.

## 1. Cel

Woda ma wyglądać inaczej zależnie od zbiornika:

- jeziora w głębi lądu: inny, ciemniejszy kolor i spokojny brzeg,
- duże akweny i morza: jaśniejszy odcień i więcej ruchu na brzegach.

## 2. Stan wyjściowy

`src/engine/water/Water.ts`: jedna tafla na `SEA_LEVEL = 0`, siatka 8,4 km
jadąca za kamerą, jeden shader. Jezioro nie jest bytem: to zagłębienie
terenu poniżej zera. Jedyne, co shader wie o miejscu, to głębokość pod
pikselem. Liczby wyglądu (kolory `waterShallow`/`waterDeep`, przybój,
zmarszczki, odbicie) są na sztywno; panel `?dev=1` ma dla wody tylko
przełącznik warstwy.

Sonda na seedach 42 i 7 (kwadrat 60 km, siatka 64 m): ok. 200–230
zbiorników, z czego ponad 200 poniżej 1 km² i płytkich (mediana maks.
głębokości: 1 m poniżej 0,01 km², 7 m do 0,1 km², 23 m do 1 km²); morza
schodzą do dna szelfu, ok. 48 m. Przy samym brzegu głębokość pod pikselem
jest ta sama w jeziorze i w morzu, więc do rozróżnienia trzeba się rozejrzeć.

## 3. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Jak rozróżnić | **Wariant A**: „otwartość” z próbek głębokości dookoła punktu. Odrzucone na teraz: woda per biom (B) i mapa zbiorników z workera (C). |
| Suwaki | Tak: `WATER_LOOK` w `?dev=1`, osobno dla jeziora i morza, z „print”. |
| Kolor jezior | Ciemna oliwkowa zieleń, przy brzegu w stronę brązu. Morze: jaśniejszy turkus, szersza jasna płycizna. |

## 4. Otwartość

Czysty moduł CPU `src/engine/water/WaterLook.ts` (bez `three`, test w Node)
trzyma wzór próbek i wszystkie liczby wyglądu.

- **Zasięg** (`reach`, 0..1): największa głębokość spośród punktu i 16 próbek
  na dwóch okręgach (8 na 250 m i 8 na 500 m), przycięta do 40 m i podzielona
  przez 40. Głębokość to `max(0, -h)`.
- **Otwartość** (`open`, 0..1): `smoothstep(openFrom, openTo, reach)`, progi
  są suwakami.
- Sonda na 400 m: brzeg jeziora mediana 0,41, brzeg morza mediana 0,95
  (10. percentyl 0,53). Laguna tuż przy morzu wyjdzie w połowie morska i tak
  ma być.

GPU liczy to samo **w vertex shaderze tafli** (wierzchołki co 64 m, pole
o skali setek metrów, interpolacja wystarcza): 17 odczytów najbliższego
teksela okna na wierzchołek, ok. 18 tys. wierzchołków. Stałe próbek pochodzą
z `WaterLook.ts`, więc wzór jest jeden.

Okno heightfieldu kończy się ok. 220 m za krawędzią tafli, a tekstura jest
toroidalna: próbka spoza okna czytałaby drugi koniec świata. Próbki są
przycinane do okna (`[cx - N/2, cx + N/2 - 1]`), środek okna trafia do
shadera uniformem. Na krawędzi przycięte próbki czytają brzeg okna; od 3,6 km
i tak zakrywa to mgła.

## 5. Dwa wyglądy

Każda liczba ma wartość jeziora i morza; shader miesza je przez `open`.

| Liczba | Co robi | Jezioro | Morze |
| --- | --- | --- | --- |
| kolory `shallow`, `deep` | płycizna i głębia | oliwkowo-brązowa, ciemnozielona | jaśniejszy turkus |
| `deepAt` | głębokość pełnego koloru głębi, m | 12 | 34 |
| `surf` | ile piany w przyboju | mało | wyraźnie |
| `surfSpeed` | tempo pulsu przyboju | wolno | szybciej |
| `surfReach` | głębokość, do której sięga przybój, m | płytko | głębiej |
| `breakers` | druga, zewnętrzna linia fal, porwana szumem | 0 | wyraźna |
| `ripple` | siła zmarszczek (normalnych) | spokojnie | mocniej |
| `gloss` | siła odbicia nieba | trochę więcej | 1 |

Plus progi `openFrom`, `openTo`. Kolory wody wychodzą z palety terenu
`DayClock` do `WATER_COLORS` w `WaterLook.ts` (surowe hexy) i przechodzą przez
ten sam grading co teren (`LOOK.terrain`). `waterShallow`/`waterDeep` znikają
z palety terenu: czytała je tylko woda.

Wartości startowe morza są blisko dzisiejszego wyglądu, żeby zmiana nie
przestawiła całego świata; jezioro to nowy wygląd.

## 6. Panel i `WorldDebug`

`WorldDebug.water`: `ranges`, `form`, `set(change)` jak przy `look`, plus
`colors`, `setColor(key, hex)` na surowych hexach (świat grading robi sam)
i `openAt(x, z)`: otwartość policzona na CPU pod lotem. Panel: sekcja
„water” z odczytem otwartości pod lotem, suwakami, polami koloru, „reset
water” i „print” (JSON liczb i kolorów do wklejenia w `WATER_LOOK`
i `WATER_COLORS`). Panel importuje tylko typy.

## 7. Poza zakresem

Fale ustawione do linii brzegu i prawdziwa wielkość zbiornika (wariant C),
woda per biom (B), podpięcie dryfu zmarszczek pod `uWind`.

## 8. Testy

- Vitest `waterLook.test.ts`: na seedach 42 i 7 brzegi jezior (< 1 km²,
  flood fill na siatce) mają przeważnie niską otwartość, brzegi mórz
  przeważnie wysoką; wartości startowe mieszczą się w zakresach; próbki
  leżą na dwóch okręgach.
- `devPanel.test.ts`: suwak wody pisze w `water.set`, pole koloru
  w `water.setColor`, „reset water” wraca do startu.
- Liczba buforów wierzchołków tafli się nie zmienia (nowe dane to uniformy).
- Przeglądarka: jezioro i brzeg morza na zrzutach, WebGL2 i WebGPU, bez
  błędów konsoli; `npm run check`.

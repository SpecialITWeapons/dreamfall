# Chmury: pokład na różnych wysokościach i nowy wygląd

Data: 2026-09-24. Status: kierunek zatwierdzony w rozmowie, do przeglądu w pliku.
Zmienia sekcję 6 `2026-09-14-dreamfall-design.md` (niebo) i odwołuje jedną
stałą z tabeli na jej końcu: `DECK_Y = 800`.

## 1. Cel

Dwie rzeczy zgłoszone przez właściciela po obejrzeniu nieba
(`docs/screenshots/clouds.png` i `clouds_high.png` to stan wyjściowy):

1. Chmury mają wyglądać lepiej. Z dołu kłęby przy horyzoncie są płaskie
   i nieoświetlone, z góry morze chmur to wzgórzowata płachta bez boków.
2. Pokład ma wisieć na różnych wysokościach w zależności od regionu, w pasie
   700–1200 m, zamiast jednej płaszczyzny 800 m nad całym światem.

## 2. Decyzje podjęte w rozmowie

| Pytanie | Decyzja |
| --- | --- |
| Technika | **C z elementami A**: bliskie chmury to miękkie gromady sprite'ów zwróconych do kamery, oświetlonych przez słońce (kłęby, wieże cumulusów); dalekie morze chmur zostaje powierzchnią, ale stylizowaną: gęstsza siatka, boki ławic, prawdziwe światło na zboczach. |
| Wysokość | **Wariant B**: podstawa ławic zależy od regionu, 700–1200 m; wierzchołki do ok. 1550 m; sufit lotu zostaje na 2000 m. |
| Jedno pole | Zostaje zasada z `CloudCover.ts`: jedno pole, czytane przez CPU i GPU z tych samych bajtów. Wysokość dochodzi do niego jako drugi kanał, a nie osobny szum. |

Odrzucone: prawdziwy volumetric raymarching (koszt na rasteryzatorze CI
i w budżecie 2 Mpx) oraz kilka pokładów jeden nad drugim (każda warstwa to
drugi komplet mgły, bieli i harmonogramu przejść).

## 3. Stan wyjściowy

- `DECK_Y = 800` (`terrain/WorldSampler.ts`) czytają: `CloudSea` (płachta na
  `DECK_Y − 55`), `Clouds` (64 kłęby na `DECK_Y ± 45`), `SkyDome` (spód
  pokładu jako przecięcie promienia z płaszczyzną `DECK_Y − 55`),
  `Atmosphere` (`rel = cameraY − DECK_Y` steruje `uAbove`, `uCloudBodies`,
  `uWhiteout`), `SkyUniforms.uDeck` (mgła wysokościowa w `Fog.ts`),
  `FlightController` (cel przejścia górą `DECK_Y + 190`, `cloudOrigin`),
  `Opening.startY = DECK_Y − 70`, `tools/vantages.ts` (`deck`) i testy
  (`worldSampler`, `opening`, `flightController`, e2e `smoke`).
- Pole pokrycia: 256² tekseli po 80 m, okres 20,48 km, czytane w
  `p − wind·t`; udział zachmurzenia 30–60% zależnie od regionu (~7 km).
- Teren sięga 851 m (seed 42, kwadrat 80 km), więc już dziś najwyższe wzgórza
  wchodzą w pokład.
- Kłęby: siedem zlanych sfer na instancję, kolor z `normalLocal.y`, bez słońca;
  z bliska kurczą się, żeby nic nie wyskakiwało. Stąd płaskie, szare plamy.

## 4. Pole wysokości pokładu

### 4.1 Co mówi

`CloudCover` dostaje drugi kanał: **podstawę pokładu** w metrach, zakodowaną
w bajcie na zakresie `DECK.base = [700, 1200]` (≈2 m na krok, niewidoczne).
Tekstura staje się `RGFormat`: R to pokrycie jak dziś, G to podstawa.

- Podstawa to region, nie ławica: wolny szum o 3 komórkach na okres
  (~7 km, jak udział zachmurzenia), wygładzony, żeby zmiana 500 m rozkładała
  się na kilka kilometrów. Test trzyma nachylenie: podstawa nie zmienia się
  szybciej niż o `DECK.maxGrade` = 0,25 (zmierzone: 0,17–0,20 na pięciu
  seedach, czyli do 200 m na km; regiony ok. 5 km, 4 komórki na okres).
- **Podstawa stoi w świecie, pokrycie płynie z wiatrem.** Kanał G jest czytany
  w `p`, a nie w `p − wind·t`: ławice przepływają nad krainą, której powietrze
  trzyma podstawę wyżej albo niżej (tak jak w prawdziwej pogodzie podstawa
  zależy od wilgotności przy ziemi). Dzięki temu wysokość nie zależy od czasu,
  a CPU pyta o nią jedną funkcją bez `t`.
- **Grubość** to funkcja pokrycia: `thickness = mix(DECK.thin, DECK.thick,
  bank)`, 120–350 m. Wierzchołek: `top = base + thickness`, maksymalnie
  1550 m, jak w decyzji. Wieże wyższe niż wierzchołek robią gromady
  (rozdz. 7), nie pole: lot i atmosfera czytają gładką powierzchnię.

### 4.2 API

Czyste CPU, w `sky/CloudCover.ts`:

- `cover.baseAt(x, z)` — podstawa w metrach, dwuliniowo, jak próbnik GPU.
- `deckAt(cover, x, z, t, wind)` → `{ base, top, bank }` — to, o co pyta
  reszta silnika. `bankAt` zostaje jako jego część.

Na GPU (`CloudShadow.ts` przemianowane albo rozszerzone o `DeckField.ts`):
`deckBaseAt(u, worldXZ)` i `deckTopAt(u, worldXZ)` na tych samych bajtach.
Jest test zgodności CPU/GPU w przeglądarce (odczyt tekstury w jednym punkcie),
jak dla pokrycia.

`DECK_Y` znika. Zostaje `DECK.base` jako jedyne miejsce, gdzie stoją liczby.

## 5. Konsumenci wysokości

| Moduł | Dziś | Po zmianie |
| --- | --- | --- |
| `Atmosphere` | `rel = cameraY − 800` | `deckAt` pod kamerą: `uAbove` względem **wierzchołka**, `uCloudBodies` względem podstawy, `uWhiteout` w paśmie `base − 20 .. top + 20` razy `bank`. Sygnatura `update` przyjmuje `{ base, top, bank }` zamiast samego `cloud`. |
| `Fog.ts` | `exponentialHeightFogFactor(…, uDeck − 30)` | ten sam czynnik, ale do wysokości `deckBaseAt(worldXZ) + DECK.thin − 30` w fragmencie, razy `uAbove` i `cloudBankAt` jak dziś. `uDeck` znika. Podstawa, a nie wierzchołek, bo zmienia się tylko między regionami: wierzchołek zmienia się z każdą ławicą i przy spojrzeniu z wysoka pod kątem dawał kurtynę smug nad ziemią. |
| `SkyDome` (spód) | przecięcie z płaszczyzną 745 m | przecięcie z płaszczyzną podstawy pod kamerą, potem **jedna poprawka**: odczyt podstawy w punkcie trafienia i ponowne przecięcie. Podstawa zmienia się wolno (4.1), więc jeden krok wystarcza; test w Node sprawdza błąd na siatce kierunków. |
| `CloudSea` | płachta na stałej `y` | wierzchołek siatki stoi na `deckTopAt` (rozdz. 6). |
| `Clouds` | kłęby na `800 ± 45` | gromady stoją na podstawie swojego miejsca i sięgają do wierzchołka (rozdz. 7). |
| `FlightController` | `high = 800 + 190 + szum`, `y > 800` | `high = base + DECK.thick + 140 + szum` w punkcie lotu, czyli nad najgłębszą ławicą, jaką region może mieć (maks. 1720 < 2000); cel nie podskakuje, gdy pod lotem przepływa ławica. `cloudOrigin` porównuje z tym samym wierzchołkiem. Kontroler dostaje `deckBase: (x, z) => number` w zależnościach, jak dziś dostaje `groundAt`; zostaje czystym CPU. |
| `Opening` | `startY = 730` | `openingStartY(top) = top − 60` w punkcie startu (rozdz. 9). |
| `tools/vantages.ts` | `deck` na 980 m | `deck` na `top(0, 0) + 180`. |

## 6. Morze chmur: powierzchnia z bokami

Z góry nadal jedna siatka wokół lotnika, rysowana tylko nad pokładem, ale:

- **Topologia.** Siatka pierścieniowa zamiast kwadratu 96²: gęsta pod
  lotnikiem (ok. 25 m na krok w promieniu 1,5 km), rzadsza dalej, do 4,5 km.
  Ta sama liczba trójkątów rzędu 20–25 tys., lepiej rozłożona. Pozycje
  w lokalnym układzie, przesuwane w całych krokach siatki, żeby wierzchołki
  nie pływały po polu.
- **Wysokość wierzchołka** to `top` z pola plus dzisiejsza fałda (`heap`).
  **Boki**: tam, gdzie `bank` spada do zera, powierzchnia opada do podstawy,
  a nie o 30 m jak dziś, więc brzeg ławicy jest ścianą 120–350 m, którą widać
  z ukosa i w którą świeci słońce. Przerwa między ławicami pokazuje ziemię
  (jak dziś); wierzchołki w przerwie chowa przezroczystość, nie geometria.
- **Światło.** Normalna z gradientu całej wysokości (pole + fałda), nie tylko
  fałdy. Oświetlenie owinięte (wrap) na zboczach słonecznych, rozproszenie
  w przód przy krawędzi pod słońce (srebrzenie), cień własny w dolinach
  z tego samego `hollow`, niebo z góry jako światło otoczenia. Paleta bez
  zmian: `uCloudWhite`, `uGlow`, Wenus, księżyc.
- Daleka krawędź nadal wtapia się w `horizonTint`.

## 7. Gromady sprite'ów zamiast kłębów

- **Gromada** to 12–20 kwadów w jednym `InstancedMesh`, rozłożonych
  w elipsoidzie spłaszczonej od dołu (płaska podstawa, kopuła u góry). Ok.
  96 gromad w polu owiniętym wokół lotnika, jak dziś 64 kłęby; łącznie do
  ok. 1900 instancji.
- **Gdzie stoją.** Jak dziś: tylko tam, gdzie pole ma ławicę, noszone przez
  wiatr. Nowe: podstawa gromady na `base` jej miejsca, wysokość do `top`,
  więc nad pełną ławicą gromada wystaje ponad morze jako wieża, a przy brzegu
  jest niska. Z dołu i z boku to one są objętością chmur; z góry wystają nad
  powierzchnię.
- **Kwad** zwrócony do kamery w shaderze wierzchołków, miękki okrągły profil
  liczony w shaderze (bez tekstury), poszarpany szumem przesuwanym w czasie
  symulacji.
- **Światło** z pseudonormalnej: kierunek od środka gromady do kwadu
  złożony z normalną sfery na kwadzie. Strona słoneczna jasna, spód w cieniu
  (mnożnik z wysokości w gromadzie), srebrny brzeg pod słońce, kolor nieba od
  góry. Wieczorem `uGlow`, nocą księżyc, jak powierzchnia w rozdz. 6.
- **Kolejność.** Przezroczyste, bez zapisu głębi. CPU sortuje gromady od
  najdalszej i kwady w gromadzie wzdłuż osi widzenia co klatkę (1900 elementów,
  rzędu 0,1 ms), bo mieszanie jest wrażliwe na kolejność.
- **Wypełnienie.** Największe ryzyko to overdraw. Kwad blisko kamery zanika
  (zamiast dzisiejszego kurczenia się), rozmiar na ekranie ma górną granicę,
  a przy `uWhiteout` gromady wokół kamery znikają, bo i tak jest biało.
  Pomiar `npm run bench` na vantage `deck` i nowym `inside` przed i po.
- **Bufory wierzchołków**: pozycja, uv, macierz instancji i jeden `vec4`
  instancji (środek gromady względem kwadu + wysokość w gromadzie). Cztery
  z ośmiu; test liczy jak w `structureKit.test.ts`.

## 8. Czego nie zmieniamy

- Malowane chmury na kopule (wyższa warstwa) i gwiazdy za nimi.
- Cienie chmur na ziemi: dalej z pokrycia, bez przesunięcia o kierunek słońca
  i wysokość podstawy (osobna, mała zmiana później, jeśli właściciel zechce).
- Wiatr, okres pola, udział zachmurzenia 30–60%.
- Sufit `MAX_ALTITUDE = 2000`.

## 9. Rozstrzygnięte w rozmowie

1. **Otwarcie.** Dziś wznoszenie trwa 9 s (≈130 m) i przebija pas bieli
   80 m; przy grubości 120–350 m to za mało. Start 60 m pod wierzchołkiem
   w punkcie startu: film zaczyna się w bieli, jeśli nad startem stoi ławica,
   a akt wznoszenia jest wynurzeniem ponad chmury. Długość aktów bez zmian.
2. **Wzgórza w chmurach.** Podstawa 700 m przy terenie do 851 m oznacza
   szczyty w ławicy. Zostaje: szczyt w chmurze to dobry widok. Podnoszenie
   podstawy nad terenem odrzucone, bo teren nie jest okresowy i nie da się
   go wpiec w pole.

## 10. Etapy

1. **Pole wysokości i konsumenci** (rozdz. 4–5): bez zmiany wyglądu poza tym,
   że pokład stoi na różnych wysokościach. Testy w Node dla `CloudCover`
   (zakres, nachylenie, determinizm, `deckAt`), `Atmosphere`,
   `FlightController` (przejście górą nad lokalnym wierzchołkiem),
   `Opening`; spód kopuły; e2e przejścia przez pokład.
2. **Morze chmur** (rozdz. 6): siatka, boki, światło. Parity `deck`.
3. **Gromady** (rozdz. 7): zastępują `Clouds.ts`. Bench przed i po.

Każdy etap to osobny PR z `npm run check` i zrzutami z tych samych punktów
co `docs/screenshots/`.

# TODO właściciela: widoczność drzew i forma trawy (2026-09-16)

> **Zrobione tego samego dnia.** Właściciel rozstrzygnął oba punkty: przy
> drzewach „wygaszać + większy pierścień" (pełna naprawa), przy trawie
> „zasięg zostawiamy, forma na losowe". Co poszło i ile kosztuje — w
> `docs/perf-notes.md`, sekcja „The ring reaches further, and the grass is
> tufts". Poniższa diagnoza zostaje jako zapis tego, skąd się to wzięło.
>
> Jedna rzecz z punktu 2 **nie** została ruszona świadomie: zasięg trawy. Nadal
> stoi na `GRASS_FADE = [120, 190]`, bo okno przyrostowe to wciąż przebudowa
> portu, a właściciel powiedział, żeby zostawić.
>
> **Dopisek 2026-09-17: zrobione, i przebudowa wyszła taniej niż to, co
> zastąpiła.** Właściciel wrócił z tym samym („trawa nadal pojawia się, jak lecę
> nad ziemią"), więc okno jest dziś zbiorem kafli pisanym po obrzeżu:
> `GRASS_FADE = [260, 360]`, `REACH = 480`. Zasięg 1,9× dalej, trawy 3,7×
> więcej, a przebudów droższych niż 5 ms zrobiło się **zero z 459** zamiast
> 255 z 917. Liczby i trzy zależności, które trzymają się razem, w
> `docs/perf-notes.md`.

Dwie uwagi wizualne zgłoszone po obejrzeniu M3b/M4a na Pages. Nie są zaplanowane
w żadnym etapie; to jest ich zapis wraz z tym, co kod naprawdę dziś robi, żeby
ten, kto je weźmie, nie zaczynał od zgadywania.

Stan na `main` po scaleniu M4a (`910bee1`). Liczby niżej są odczytane z kodu,
nie z pamięci.

## 1. Drzewa „rysują się na oczach"

**Co widzi właściciel:** drzewa pojawiają się tuż przed lotem, zamiast stać
w oddali.

**Co robi kod.** Drzewo nie pojawia się — ono **rośnie z ziemi**.
`src/engine/scenery/Pools.ts`:

```
const RING_FADE = [1680, 1850];
const ringScale = 1 - smoothstep(RING_FADE[0], RING_FADE[1], baseDistance);
const grown = (position) => treeBase + (position - treeBase) * ringScale;
```

`grown` skaluje cały wierzchołek wokół podstawy drzewa, więc drzewo 1850 m
przed lotem jest punktem w gruncie i skaluje się do pełnej wysokości dopiero
na 1680 m. To nie jest wtapianie w mgłę — to jest wzrost. Przy `SPEED = 40`
(a `AIRSPEED.max = 62`) przelot przez tę 170-metrową wstęgę trwa **2,7 do 4,3
sekundy**, i tyle właśnie trwa wyrastanie każdego drzewa.

Drugi próg, niezależny: `CROWN_FADE = [540, 680]` — pełna korona ustępuje
przerzedzonej, a `NEAR_CROWN = 830 / FAR_CROWN = 400` decydują, którą koronę
drzewo w ogóle dostaje przy przebudowie. Jeśli po naprawie wzrostu dalej coś
„wskakuje", to jest ten próg, nie tamten.

**Czego nie da się zrobić samą liczbą.** Wstęga kończy się na 1850 m, bo
`TREE_RADIUS = 1900` — pierścień dalej nie sięga. Wypchnięcie wtapiania dalej
znaczy wypchnięcie pierścienia, a ten ma dwa sufity: `MAX_TREES = 4000`
(pule są alokowane na ten pułap, około 10 MB danych instancji po obu stronach
magistrali, niezależnie od tego, co stoi) i koszt przebudowy — zmierzone 6,4–7,8
ms na 890 komórek (`docs/perf-notes.md`). Zasięg rośnie z kwadratem: 1900 → 2700
m to dwukrotność powierzchni, czyli dwukrotność komórek i drzew.

**Kierunki, w kolejności rosnącego kosztu:**

1. Zamienić skalowanie na wtapianie krycia (dithering albo `opacityNode`, tak
   jak robi to trawa) w tej samej wstędze. Drzewo stoi w pełnej wysokości
   i gaśnie, zamiast rosnąć. Nic nie kosztuje, bo to ta sama liczba drzew.
2. Poszerzyć wstęgę (np. 1200 → 1850), żeby zmiana rozłożyła się na sekundy
   zamiast na jedną. Też za darmo, ale samo w sobie nie usuwa wzrostu.
3. Wypchnąć pierścień i podnieść `MAX_TREES` — to jest ten kosztowny, i to on
   wymaga pomiaru przed decyzją, nie po.

Uwaga: 1 i 2 są niezależne i obie są tanie; 3 warto ruszać dopiero, gdy 1 nie
wystarczy.

## 2. Trawa: pęki zamiast kresek, wcześniej i wyżej

**Co widzi właściciel:** trawa czyta się jak kreski na ziemi. Mają to być
okrągłe pęki — albo różne, losowe. Ma też być widoczna wcześniej i wyższa.

**Co robi kod.** `src/engine/scenery/Grass.ts`:

```
const BLADE_WIDTH = 2.6, BLADE_HEIGHT = 1;   // karta szersza niż wyższa
const BLADE_SCALE = 0.55, BLADE_SCALE_SPAN = 0.8;
geometry = new PlaneGeometry(BLADE_WIDTH, BLADE_HEIGHT);
```

Jedno źdźbło to **jedna karta 2,6 × 1 m**, czyli prostokąt leżący szerzej niż
wyżej, obrócony losowo wokół pionu. Stąd kreski: z góry i z boku karta czyta się
jako pasek, a nie jako kępa. Wysokość po przeskalowaniu wypada między **0,55
a 1,35 m**.

Widoczność: `GRASS_FADE = [120, 190]` w `Painted.ts` gasi ostatnie źdźbło na
190 m, a `REACH = 260` w `Grass.ts` to tylko zasięg zapisu kafli — materiał
wygasza trawę na długo przed krawędzią okna. Do tego `CEILING = 250` wyłącza
trawę zupełnie powyżej 250 m nad ziemią.

**Co trzeba rozstrzygnąć przy formie.** „Okrągły pęk" da się zrobić na trzy
sposoby i różnią się kosztem na źdźbło:

- dwie lub trzy karty skrzyżowane w jednej instancji (pęk jest bryłą, nie
  kartą) — najbardziej oczywiste, mnoży trójkąty przez 2–3;
- jedna karta z inną teksturą (kępa namalowana zamiast pasków) — za darmo pod
  względem geometrii, ale z boku dalej jest płaska;
- mieszanka kilku upieczonych form losowanych na instancję, o co właściciel
  prosi wprost („albo różne — losowe").

Budżet: `BLADES = 20000` instancji w oknie, `ROLLS = 256` prób na kafel, 11 × 11
kafli.

**Czego nie da się zrobić samą liczbą.** Zasięgu trawy nie wolno podnieść bez
przebudowy okna. `docs/perf-notes.md` mierzy zapis okna na **6,9 ms** przy
budżecie 4 ms — i to jest cena dzisiejszego zasięgu 260 m. Okno przebudowuje się
co 32 m właśnie po to, żeby ten koszt płacić o połowę rzadziej. Zasięg rośnie
z kwadratem, więc 190 → 400 m to ponad czterokrotność pracy: trzydzieści
milisekund na jedną klatkę. Prawdziwą naprawą jest zapisywanie **tylko tych
kafli, które weszły do okna**, zamiast przepisywania całego okna — to jest
przebudowa portu i notatka wydajnościowa nazywa ją wprost.

Kolejność, jeśli ktoś to bierze: **najpierw okno przyrostowe, potem zasięg.**
Forma i wysokość są od tego niezależne i można je zrobić od razu.

## Czego tu nie ma

Żadna z tych uwag nie jest błędem: obie rzeczy działają tak, jak je napisano,
i obie są wiernym portem. To są decyzje wizualne właściciela i wymagają jego
rozstrzygnięcia przy formie pęku (trzy warianty wyżej) oraz zgody na koszt
przy zasięgu — jednym i drugim.

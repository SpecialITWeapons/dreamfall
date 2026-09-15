# Punkt startu M3b (2026-09-15)

Sesja, która zrobiła M2.1 i M3a, kończy się na pełnym oknie kontekstu. To jest
wszystko, co było tylko w rozmowie i musi przeżyć jej koniec.

## Gdzie jesteśmy

Na `main`: M0, M1, M2, M2.1 (sylwetka, stery, prędkość, kamera), M3a (kontrakt
v2, sloty biomów, ziemia malowana hakami, dziesięć biomów z danych), etapy
zasłony i pomiar startu, naprawa `?profile=1`.

Na gałęzi `claude/epic-hypatia-ufoge4`, **niescalone**: jeden commit
dokumentacji z pomiarami z prawdziwego GPU (`docs/perf-notes.md`). Może pojechać
razem z pierwszym PR-em M3b.

## Ustalenia właściciela, które obowiązują w M3b

- **Wszystkie dziewięć gatunków drzew** oryginału od razu (acacia, birch,
  blossom, cypress, deadwood, elder, oak, palm, pine), nie cztery ze spec §15.4.
- **Skala gór bez zmian** — pola bazowe zamrożone, wzorce ziarna 42 nietknięte.
- **Zasięg widzenia / „wyspa we mgle"** — poza zakresem M3, siatka i kurtyna bez
  zmian (notatki M2 §2).
- Podział M3 na M3a i M3b był decyzją właściciela; M3b to druga połowa spec
  §15.4: streaming komórek, pule, warstwa nadpisań, drzewa z morfingiem koron,
  propsy, trawa, cień pod drzewami.

## Luka, której nie ma w żadnym planie: obiekty liniowe

Właściciel pytał o krzaki, kamienie, skały, **płoty**, domy. Wszystko poza
płotami jest pokryte: krzaki i kamienie to `defineProp` (M3b), domy to
`defineStructure` i generator osad (M4, spec §8 wymienia nawet płoty wsi).

**Płot ciągnący się przez pole to obiekt liniowy — wstęga wzdłuż łamanej, jak
droga — i takiego zestawu nie ma nigdzie.** `RoadKit` z M4 robi wstęgi dla dróg;
płoty poza osadą wymagałyby albo rozszerzenia go, albo własnego „line kit".
Do decyzji przy planowaniu M3b (czy wchodzi) albo M4 (czy dojeżdża z drogami).

## Materiał do portu ginie razem z kontenerem

`fly-with-me` **nie jest częścią tego repozytorium**. Ta sesja klonowała je do
`/home/user/kunchenguid/fly-with-me` (publiczne, MIT,
`github.com/kunchenguid/fly-with-me`). Nowa sesja musi je sklonować ponownie,
zanim zacznie pisać plan M3b, i **wkleić liczby do planu na sztywno**, tak jak
zrobiły to plany M1, M2 i M3a.

Co stamtąd będzie potrzebne (numery linii z commita `38857e6`):

| co | gdzie |
| --- | --- |
| `TREE_CELL 96`, `TREE_RADIUS 1900` | `src/main.js` ~1607 |
| `CROWN_FADE [540, 680]`, `RING_FADE [1680, 1850]` | ~1363 |
| `MAX_TREES 4000`, trzy pule na gatunek | ~1410, ~1555–1590 |
| pętla po komórkach pierścienia, rozrzut drzew | ~1690–1810 |
| trawa (`InstancedMesh`, 20 000) | ~1916 |
| arkusz cienia pod drzewami, `aoMap.flipY = false` | ~1654 |
| pule propsów, `BUDGET.propInstances` | ~1638–1642 |
| dziewięć gatunków | `library/species/*.js` |
| dwa propsy (wzorce dla każdego obiektu, który stoi) | `library/props/boulders.js`, `cairns.js` |

Kontrakt v2 w `library/contract.ts` **już ma** typy, których M3b potrzebuje:
`defineSpecies`, `defineProp`, `defineStructure`, `PopulateHook`, `Cell`,
`SceneryKit`, `SitesSpec`, `BUDGET` (crownCards 200, propTriangles 6000,
propInstances 2000, siteInstances 4, speciesScale 3). Nic z tego nie jest
wołane — M3b jest pierwszym, który je wywoła.

## Co jeszcze czeka

- **Postać**: cztery zmierzone wady w
  `docs/superpowers/notes/2026-09-15-postac-do-poprawy.md`, kolejność zapisana
  (bark wiszący 8,3 cm poza tułowiem idzie pierwszy). Właściciel narzekał na to
  dwa razy i świadomie odłożył.
- **Jeden malarz zamiast dziesięciu gałęzi** w shaderze ziemi: opisany w
  `docs/perf-notes.md` jako droga wyjścia, **celowo niezbudowany** — przy
  3,15 ms mediany na klatkę nie ma powodu. Wraca, gdy rejestr urośnie dwu- lub
  trzykrotnie.
- **Wady planów** M2 i M3a: `docs/superpowers/notes/*-plan-defects.md`, do ręki
  dla przeglądu całej gałęzi.

# Postać: co jeszcze jest nie tak (2026-09-15)

Lista z oglądania w locie po rundzie M2.1, **do zrobienia później** — decyzja
właściciela: nie teraz, żeby nie mieszać do M3. Każdy punkt z liczbą, jeśli
liczbę dało się policzyć, żeby następna sesja nie zaczynała od zgadywania.

## 1. Ramiona odklejone od tułowia (twardy błąd geometrii)

Bark siedzi w `SHOULDER = (±0,24, 0,03, 0,26)`, a tułów to elipsoida
`(0,21, 0,13, 0,31)` w punkcie `(0, 0, 0,05)`. Punkt barku w układzie elipsoidy:

    (0,24/0,21)² + (0,03/0,13)² + (0,21/0,31)² = 1,306 + 0,053 + 0,459 = 1,818

Wartość > 1 znaczy **na zewnątrz bryły**. Powierzchnia tułowia w kierunku barku
leży w `(0,178, 0,022, 0,156)`, czyli staw wisi około **8,3 cm** za nią. Ramię
to kapsuła o promieniu 5,5 cm, więc zostaje jakieś **2,8 cm czystego powietrza**
między ramieniem a tułowiem — dokładnie to, co widać.

Do wyboru przy poprawce: przesunąć bark do środka (x ≈ 0,17), poszerzyć tułów
w barkach (rx ≈ 0,25 z przewężeniem w pasie — wymaga drugiej bryły, bo jedna
elipsoida nie ma talii), albo dołożyć bryłę obojczyka/naramiennika mostkującą
staw. Trzecia opcja jest najbliżej tego, jak wygląda kombinezon.

## 2. Ręce w nurkowaniu mają składać się do tyłu **wzdłuż ciała**

Dziś `sweep` przy pełnym nurkowaniu to 0,32 rad ≈ **18°** obrotu wokół osi „góra”
postaci. Właściciel chce pozycji track/delta: ramiona przyciągnięte do boków,
przedramiona wzdłuż tułowia, dłonie przy biodrach. To jest rzędu **60–75°** w
barku plus wyprost w łokciu (dziś łokieć trzyma 80° niezależnie od pochylenia).

Przy okazji trzeba będzie sprawdzić, czy przy takim złożeniu ręce nie wchodzą w
tułów — patrz punkt 1, bo dziś mają 8 cm zapasu, który akurat wtedy zniknie.

## 3. FPP: widać same przedramiona, bez ramion

`fppHands` pokazuje tylko siatki `forearm` i `hand` (cztery bryły). Ramię jest
ukryte, więc przedramiona wiszą w powietrzu bez połączenia z kadrem. Trzy
wyjścia: pokazać też `upperArm` (wtedy widać kikut barku, więc najpierw punkt 1),
wyłączyć `fppHands` domyślnie (spec §9 mówi „domyślnie włączone” — zmiana specu),
albo dać w FPP osobną, krótszą pozę rąk, tak jak robią to gry z bronią.

## 4. Animacja w całości

Dziś to sinus na pięciu zawiasach plus wolny szum i `gust`. Brakuje: reakcji na
przechył (ręka po wewnętrznej stronie schodzi, ale reszta ciała nie skręca),
opóźnienia między tułowiem a kończynami (wszystko rusza się w tej samej klatce),
i jakiegokolwiek „ciężaru” — kończyny nie mają bezwładności.

Najtańsza poprawa bez szkieletu: dodać każdemu zawiasowi własne opóźnienie
fazowe zależne od odległości od tułowia i wygładzać kąty filtrem pierwszego
rzędu zamiast ustawiać je wprost. Prawdziwa poprawa to model szkieletowy —
interfejs `Avatar` jest na to gotowy (spec §9) i nic w silniku nie trzeba ruszać.

## Kolejność, gdy wrócimy

1 (geometria barku) przed 2 i 3, bo oba opierają się o to, gdzie naprawdę jest
staw. 4 na końcu, bo to strojenie, a nie naprawa.

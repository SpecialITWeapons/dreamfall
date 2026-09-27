# Drzewa, krok 4: drzewa w osadach — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** W wioskach i miastach stoją drzewa, rzadziej niż w okolicy i w zwykłym rozmiarze: drzewa krainy gęściej niż dziś (A) oraz pojedyncze drzewa z planu osady (B), także w krainie bez lasu.

**Architecture:** (A) `clearing` 0,4 → 0,6. (B) `SiteKit.tree(species | null, x, z, opts)` zapisuje drzewo w `plan.trees`; `Sites` rozwiązuje `null` na gatunek krainy wokół osady (sloty w środku osady, `countryOf`, wagi `populate`). Plany wybierają miejsca bez losowań ze strumienia osady (hasz pozycji), więc domy się nie przesuwają. Pierścień stawia drzewa planu w `raise`, przez nową metodę `Sowing.stand` (rozmiar z hasza pozycji, kolor klimatu w miejscu drzewa); `Claims` rezerwuje wokół nich 4 m, żeby drzewo krainy nie stanęło w tym samym miejscu.

**Tech Stack:** TypeScript, JS + JSDoc (biblioteka), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-drzewa-daleko-i-w-osadach-design.md` (4.7, 4.8, 7 krok 4).

## Global Constraints

- Domy istniejących osad się nie przesuwają: istniejące testy planów przechodzą bez zmian.
- Drzewa planu: poza obrysem domu i poza drogą (≥ 1 m), w granicy osady; rozmiar z zakresu gatunku.
- Gęstość drzew w osadzie w krainie z lasem: mniej niż w okolicy.
- Plan nadal nie sieje: pojedyncze drzewa w miejscach wybranych przez plan.

## Rulings wobec specu

- **Test gęstości mierzy całość (A + B), nie samo A**: spec podaje 40–70 % dla A, ale życzenie właściciela to „rzadziej niż w okolicy” dla tego, co widać. Test: w krainie z lasem osada ma 30–100 % gęstości okolicy; w krainie bez lasu osada ma drzewa.
- **Miasto nie sadzi w ogrodach za domem**, tylko na pustych działkach i przy placu: w siatce miasta tył działki to często tył działki z sąsiedniej ulicy.

## Review Focus

1. Osada w krainie, której żaden biom nie ma gatunków (`populate` bez `species`) — `null` nie może rzucić; drzewo pominięte.
2. Drzewo planu na drodze krzyżującej (wioska: ścieżka boczna przecina tył ogrodu) — test odległości od wszystkich dróg planu.
3. Plan wraca po wyjściu z zasięgu — drzewa w tych samych miejscach (hasz pozycji, bez stanu).
4. Pula gatunku pełna — drzewo planu odrzucone liczy się w `treesRefused`, nie przerywa domów.

---

### Task 1: kontrakt, `Sites`, `Claims`, `Sowing.stand`, `raise`

**Files:** `library/contract.ts` (`SiteKit.tree`, `TreeSpec`, `SitePlan.trees?`), `src/engine/scenery/Sites.ts`, `Claims.ts`, `Sowing.ts`, `Ring.ts`, `Scenery.ts` (statystyka `treesRefused`); testy `tests/unit/sites.test.ts`, `claims.test.ts`, `ring.test.ts`, `sowing.test.ts`.

- [ ] Testy: plan wołający `kit.tree(null, …)` dostaje gatunek krainy (seed 42, osada testowa), `kit.tree('nieznany', …)` rzuca; `claims.trees` prawdziwe 3 m od drzewa planu; pierścień stawia drzewa planu (sink dostaje je po domach, z przeszkodą), ten sam wynik przy dwóch przebudowach; `Sowing.stand` nie zmienia następnej komórki.
- [ ] Commit „Let a settlement's plan stand a tree of its country”.

### Task 2: wioska i miasto sadzą

**Files:** `library/settlements/geometry.js` (`rollAt`), `plan.js`, `plan-town.js`, `village.js`, `town.js`; testy `tests/unit/settlementPlan.test.ts`, `townPlan.test.ts`, nowy `tests/unit/settlementTrees.test.ts`.

- [ ] Testy: drzewa planu istnieją, są ≥ 1 m od obrysu każdego domu i od każdej drogi, w granicy osady; domy identyczne jak przed zmianą (istniejące testy); gęstość w osadach seeda 42 w krainie z lasem 30–100 % okolicy, w krainie bez lasu > 0.
- [ ] `AGENTS.md`: reguła planu, `clearing`.
- [ ] `npm run check`, e2e GPU, zdjęcie wioski; commit „Plant the villages and the towns, sparser than their country”.

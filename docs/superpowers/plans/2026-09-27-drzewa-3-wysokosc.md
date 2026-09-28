# Drzewa, krok 3: tryb wysokościowy — plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wysoko nad ziemią wszystkie drzewa są kartami: pasmo, w którym pełne drzewo oddaje miejsce karcie, przybliża się z wysokością kamery nad terenem aż do zera, a pełne pule przestają być rysowane.

**Architecture:** Czysta funkcja `scenery/TreeLimit.ts` liczy pasmo z wysokości (`sstep(from, to, alt)` skaluje `RING_FADE`, przez `treeLimitOf`). `Scenery.update` wpisuje je co klatkę do `pools.treeLimit` (czytanego przez pełne drzewa i karty) i ukrywa pule drzew, gdy pasmo spadło do zera. Progi stroi `?dev=1`.

**Tech Stack:** TypeScript, three (TSL uniform już istnieje), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-drzewa-daleko-i-w-osadach-design.md` (4.6, 7 krok 3).

## Global Constraints

- Przy ziemi (`alt ≤ from`) pasmo = `RING_FADE = [2300, 2560]`, nic się nie zmienia.
- Start: `TREE_LIMIT = { from: 700, to: 1100 }` m nad terenem pod kamerą.
- Pasmo nigdy o zerowej szerokości (`treeLimitOf`).
- Rekwizyty i domy zostają przy stałym `RING_FADE`.
- Warstwy: silnik ukrywa pule drzew ze swoich powodów, `layers.apply()` działa po nim.

## Review Focus

1. Kamera nad morzem przy ziemi na wysokości 0 — `alt` liczone od wysokości terenu, a nie od morza; nad wodą wysokość terenu < 0 daje większe `alt` (więcej kart) — akceptowalne, bo drzew tam nie ma.
2. Przełącznik warstwy „trees” wyłączony, a silnik co klatkę ustawia `visible = true` przy niskim locie — `layers.apply()` musi je ukryć z powrotem (test w przeglądarce).
3. Suwaki z `from > to` — funkcja ma zamienić je miejscami albo trzymać `to ≥ from + 1`.

---

### Task 1: `scenery/TreeLimit.ts`

**Files:** Create `src/engine/scenery/TreeLimit.ts`; Modify `src/engine/scenery/Pools.ts` (`RING_FADE` przeniesione, re-eksport); Test `tests/unit/treeLimit.test.ts`.

**Produces:** `export const RING_FADE: readonly [number, number]`, `export const TREE_LIMIT = { from: 700, to: 1100 }`, `export type TreeLimitForm = { from: number; to: number }`, `export function treeBandAt(alt: number, form?: TreeLimitForm): [number, number]`.

- [ ] Testy: przy `alt` 0 i 700 → `[2300, 2560]`; przy 1100 i 5000 → `[0, 1]`; monotonicznie malejące między; `from > to` nie daje NaN i daje pasmo z `y ≥ x + 1`.
- [ ] PASS; commit „Hand every tree to its card as the flight climbs”.

### Task 2: wpięcie, panel, przeglądarka

**Files:** Modify `Scenery.ts` (pasmo co klatkę, ukrywanie pul drzew, `treeLimit` control, statystyki `treeBand`, `fullTrees`), `src/page/Debug.ts`, `src/main.ts`, `src/dev/Panel.ts` (suwaki `from`/`to`, „print”, odczyt kart), `tests/unit/devPanel.test.ts` (atrapa), `tests/e2e/smoke.spec.ts`, `AGENTS.md`.

- [ ] `Scenery.update`: `alt = cameraY − heightfield.heightAt(x, z)`, `band = treeBandAt(alt, form)`, `pools.treeLimit.value.set(...band)`, pule drzew `visible = band[1] > 1`.
- [ ] Test e2e: 150 m nad lasem → `fullTrees` prawda i `treeBand[0] = 2300`; 1 300 m → `fullTrees` fałsz; z warstwą „trees” wyłączoną na 150 m pule zostają ukryte po klatce.
- [ ] `npm run check`, zestaw e2e GPU, zdjęcia `tools/trees/look.mjs` (900 i 1 300 m); commit „Let the dev panel move where the trees become cards”.

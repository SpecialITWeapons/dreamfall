// The wardrobe: a panel of tiles behind the HUD's own button, one tile per
// outfit and one chip per marking.
//
// Every tile is drawn from the catalogue's own numbers -- the outfit's colours
// and the pattern's `mark`, the same function the figure's repaint walks -- so
// a tile cannot show a marking the figure would not wear. Drawing them some
// other way is how a wardrobe ends up lying about the seventh outfit somebody
// adds.
import { OUTFITS, PATTERNS, type Outfit, type Pattern } from '../engine/avatar/Outfits';

/** The sleeve a tile draws: a strip of chain, and the half of the ring facing us. */
const CELLS = { along: 20, around: 7 };
const TILE = { w: 44, h: 26, r: 8 };

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * One tile, as SVG. The sleeve is sampled cell by cell and the cells of a row
 * that came back the same are drawn as one rectangle -- a tile is a hundred and
 * forty samples and ends up a dozen rectangles, which is what keeps a panel of
 * thirty of them cheap.
 */
export function outfitTile(outfit: Outfit, pattern: Pattern): string {
  const cw = TILE.w / CELLS.along,
    ch = TILE.h / CELLS.around;
  const rects: string[] = [];
  for (let row = 0; row < CELLS.around; row++) {
    // Across the front of the tube and no further: the back of a sleeve is not
    // in the picture, and a marking that wraps would read as two of itself.
    const around = (-0.5 + (row + 0.5) / CELLS.around) * Math.PI;
    let runStart = 0;
    let runTrim = false;
    for (let col = 0; col <= CELLS.along; col++) {
      const along = (col + 0.5) / CELLS.along;
      const trim = col < CELLS.along && pattern.mark('suit', along, around) === 'trim';
      if (trim === runTrim && col < CELLS.along) continue;
      if (runTrim && col > runStart)
        rects.push(
          `<rect x="${(runStart * cw).toFixed(2)}" y="${(row * ch).toFixed(2)}" width="${(
            (col - runStart) *
            cw
          ).toFixed(2)}" height="${(ch + 0.02).toFixed(2)}" fill="${hex(outfit.trim)}"/>`,
        );
      runStart = col;
      runTrim = trim;
    }
  }
  const dots = [outfit.helmet, outfit.gloves, outfit.boots]
    .map((c, i) => `<circle cx="${6 + i * 8}" cy="${TILE.h + 6}" r="2.6" fill="${hex(c)}"/>`)
    .join('');
  return `<svg viewBox="0 0 ${TILE.w} ${TILE.h + 12}" width="${TILE.w}" height="${TILE.h + 12}" aria-hidden="true" focusable="false">
  <clipPath id="c-${outfit.id}-${pattern.id}"><rect width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}"/></clipPath>
  <g clip-path="url(#c-${outfit.id}-${pattern.id})">
    <rect width="${TILE.w}" height="${TILE.h}" fill="${hex(outfit.suit)}"/>
    ${rects.join('')}
  </g>
  <rect width="${TILE.w}" height="${TILE.h}" rx="${TILE.r}" fill="none" stroke="rgba(246,242,234,0.35)"/>
  ${dots}
</svg>`;
}

export interface Wardrobe {
  readonly open: boolean;
  /** Open, close, or toggle when nothing is said. */
  toggle(on?: boolean): void;
  /** What is being worn now; the panel marks it and redraws the markings in that outfit's colours. */
  show(outfitId: string, patternId: string): void;
  onPick(cb: (outfitId: string, patternId: string) => void): void;
  dispose(): void;
}

export function createWardrobe(doc: Document): Wardrobe {
  const panel = doc.getElementById('wardrobe');
  const outfitRow = doc.getElementById('wardrobeOutfits');
  const patternRow = doc.getElementById('wardrobePatterns');
  const listeners: Array<(outfitId: string, patternId: string) => void> = [];
  let worn = { outfit: OUTFITS[0]!.id, pattern: PATTERNS[0]!.id };
  let open = false;

  const button = (id: string, name: string, svg: string, onClick: () => void) => {
    const node = doc.createElement('button');
    node.type = 'button';
    node.dataset.id = id;
    node.setAttribute('aria-pressed', 'false');
    node.title = name;
    node.innerHTML = `${svg}<span>${name}</span>`;
    node.addEventListener('click', onClick);
    return node;
  };

  const pick = (outfitId: string, patternId: string) => {
    worn = { outfit: outfitId, pattern: patternId };
    paint();
    for (const cb of listeners) cb(outfitId, patternId);
  };

  /** Redraw both rows for what is worn: the markings wear the chosen outfit's colours. */
  const paint = () => {
    const outfit = OUTFITS.find((o) => o.id === worn.outfit) ?? OUTFITS[0]!;
    const pattern = PATTERNS.find((p) => p.id === worn.pattern) ?? PATTERNS[0]!;
    if (outfitRow) {
      outfitRow.replaceChildren(
        ...OUTFITS.map((o) => {
          const node = button(o.id, o.name, outfitTile(o, pattern), () => pick(o.id, worn.pattern));
          node.setAttribute('aria-pressed', String(o.id === outfit.id));
          return node;
        }),
      );
    }
    if (patternRow) {
      patternRow.replaceChildren(
        ...PATTERNS.map((p) => {
          const node = button(p.id, p.name, outfitTile(outfit, p), () => pick(worn.outfit, p.id));
          node.setAttribute('aria-pressed', String(p.id === pattern.id));
          return node;
        }),
      );
    }
  };

  paint();

  return {
    get open() {
      return open;
    },
    toggle(on) {
      open = on ?? !open;
      panel?.toggleAttribute('hidden', !open);
      if (open) panel?.querySelector('button')?.focus({ preventScroll: true });
    },
    show(outfitId, patternId) {
      worn = { outfit: outfitId, pattern: patternId };
      paint();
    },
    onPick(cb) {
      listeners.push(cb);
    },
    dispose() {
      listeners.length = 0;
      outfitRow?.replaceChildren();
      patternRow?.replaceChildren();
    },
  };
}

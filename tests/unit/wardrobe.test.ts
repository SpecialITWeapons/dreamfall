// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTFITS, PATTERNS, outfitById, patternById } from '../../src/engine/avatar/Outfits';
import { createWardrobe, outfitTile } from '../../src/page/Wardrobe';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="wardrobe" hidden>
      <div id="wardrobeOutfits"></div>
      <div id="wardrobePatterns"></div>
    </div>`;
});

describe('a wardrobe tile', () => {
  it('is drawn in the outfit it names', () => {
    const svg = outfitTile(outfitById('moss'), patternById('plain'));
    expect(svg).toContain(hex(outfitById('moss').suit));
    expect(svg).toContain(hex(outfitById('moss').helmet));
    // Plain is plain: nothing is painted over the suit.
    expect(svg).not.toContain(hex(outfitById('moss').trim));
  });

  it('paints the marking with the same function the figure is painted with', () => {
    const outfit = outfitById('dusk');
    for (const pattern of PATTERNS) {
      const svg = outfitTile(outfit, pattern);
      const marks = svg.match(/<rect x=/g)?.length ?? 0;
      if (pattern.id === 'plain') expect(marks, pattern.id).toBe(0);
      else expect(marks, pattern.id).toBeGreaterThan(0);
    }
  });

  it('draws a row as one rectangle where the marking does not change', () => {
    // Twenty samples across and seven down is a hundred and forty questions; a
    // banded sleeve is a dozen rectangles, and that is what keeps a panel of
    // thirty tiles cheap enough to redraw on every click.
    const svg = outfitTile(outfitById('dusk'), patternById('bands'));
    expect((svg.match(/<rect x=/g) ?? []).length).toBeLessThan(40);
  });
});

describe('the wardrobe panel', () => {
  it('offers every outfit and every marking, and says which is worn', () => {
    const wardrobe = createWardrobe(document);
    wardrobe.show('moss', 'sash');
    const outfits = [...document.querySelectorAll<HTMLButtonElement>('#wardrobeOutfits button')];
    const patterns = [...document.querySelectorAll<HTMLButtonElement>('#wardrobePatterns button')];
    expect(outfits).toHaveLength(OUTFITS.length);
    expect(patterns).toHaveLength(PATTERNS.length);
    expect(outfits.find((b) => b.dataset.id === 'moss')!.getAttribute('aria-pressed')).toBe('true');
    expect(outfits.find((b) => b.dataset.id === 'dusk')!.getAttribute('aria-pressed')).toBe('false');
    expect(patterns.find((b) => b.dataset.id === 'sash')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws the markings in the outfit that is worn', () => {
    const wardrobe = createWardrobe(document);
    wardrobe.show('frost', 'plain');
    const chip = document.querySelector('#wardrobePatterns button[data-id="bands"]')!;
    expect(chip.innerHTML).toContain(hex(outfitById('frost').trim));
    wardrobe.show('ember', 'plain');
    const again = document.querySelector('#wardrobePatterns button[data-id="bands"]')!;
    expect(again.innerHTML).toContain(hex(outfitById('ember').trim));
    expect(again.innerHTML).not.toContain(hex(outfitById('frost').suit));
  });

  it('hands a pick over with both halves of what is worn', () => {
    const wardrobe = createWardrobe(document);
    const picked = vi.fn();
    wardrobe.onPick(picked);
    wardrobe.show('dusk', 'plain');
    document.querySelector<HTMLButtonElement>('#wardrobeOutfits button[data-id="plum"]')!.click();
    expect(picked).toHaveBeenLastCalledWith('plum', 'plain');
    // The marking is picked against the outfit that is now worn, not the one
    // that was worn when the panel was built.
    document.querySelector<HTMLButtonElement>('#wardrobePatterns button[data-id="yoke"]')!.click();
    expect(picked).toHaveBeenLastCalledWith('plum', 'yoke');
    expect(
      document.querySelector('#wardrobeOutfits button[data-id="plum"]')!.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('opens, closes, and starts closed', () => {
    const panel = document.getElementById('wardrobe')!;
    const wardrobe = createWardrobe(document);
    expect(wardrobe.open).toBe(false);
    expect(panel.hasAttribute('hidden')).toBe(true);
    wardrobe.toggle();
    expect(wardrobe.open).toBe(true);
    expect(panel.hasAttribute('hidden')).toBe(false);
    wardrobe.toggle(true);
    expect(wardrobe.open).toBe(true);
    wardrobe.toggle(false);
    expect(panel.hasAttribute('hidden')).toBe(true);
  });
});

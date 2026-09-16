import { describe, expect, it } from 'vitest';
import { cellKey, createOverrides, siteKey, type Override } from '../../src/engine/scenery/Overrides';
import type { Placement } from '../../library/contract';

/** The ring's loop over its 41x41 cells, with a counter where it builds the key. */
function sweep(layer: { readonly size: number; for(key: string): Override | null }) {
  let built = 0,
    found = 0;
  const key = (gx: number, gz: number) => {
    built++;
    return cellKey(gx, gz);
  };
  for (let gz = -20; gz <= 20; gz++)
    for (let gx = -20; gx <= 20; gx++) if (layer.size !== 0 && layer.for(key(gx, gz)) !== null) found++;
  return { built, found };
}

describe('createOverrides', () => {
  it('spells the two key shapes, negative cells included', () => {
    expect(cellKey(0, 0)).toBe('cell:0,0');
    expect(cellKey(-2, 13)).toBe('cell:-2,13');
    expect(siteKey('millpond')).toBe('site:millpond');
  });

  it('answers null to everything while it is empty, and is not asked to build a key', () => {
    const layer = createOverrides();
    expect(layer.size).toBe(0);
    expect(layer.for(cellKey(3, -7))).toBeNull();
    expect(layer.for(siteKey('millpond'))).toBeNull();
    expect(layer.for('')).toBeNull();
    expect(sweep(layer)).toEqual({ built: 0, found: 0 });
    expect(createOverrides([]).size).toBe(0);
  });

  it('answers by key, and null for any other', () => {
    const cell: Override = { key: cellKey(3, -7), skip: true };
    const site: Override = { key: siteKey('millpond'), skip: true };
    const layer = createOverrides([cell, site]);
    expect(layer.size).toBe(2);
    expect(layer.for(cellKey(3, -7))).toBe(cell);
    expect(layer.for(siteKey('millpond'))).toBe(site);
    expect(layer.for(cellKey(-7, 3))).toBeNull();
    expect(layer.for(cellKey(3, -8))).toBeNull();
    expect(layer.for(siteKey('millpon'))).toBeNull();
    expect(layer.for('3,-7')).toBeNull();
    // the counter of the empty case is worth something: a layer with an entry does build keys
    expect(sweep(layer)).toEqual({ built: 41 * 41, found: 1 });
  });

  it('hands skip and placements back unchanged', () => {
    const placements: Placement[] = [
      { x: 12, z: -4 },
      { x: 30.5, z: 8, yaw: 1.2, scale: [1, 2, 1], sink: 0.4, tint: 'rock' },
    ];
    const layer = createOverrides([
      { key: cellKey(0, 0), skip: true },
      { key: cellKey(1, 0), placements },
    ]);
    expect(layer.for(cellKey(0, 0))).toEqual({ key: 'cell:0,0', skip: true });
    const entry = layer.for(cellKey(1, 0));
    expect(entry?.skip).toBeUndefined();
    expect(entry?.placements).toBe(placements);
    expect(entry?.placements).toEqual([
      { x: 12, z: -4 },
      { x: 30.5, z: 8, yaw: 1.2, scale: [1, 2, 1], sink: 0.4, tint: 'rock' },
    ]);
  });
});

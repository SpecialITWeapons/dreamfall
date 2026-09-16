// The override layer: the one place that can tell a ring cell or a site "not
// here" or "exactly this" before its hooks run. It is empty in M3b on purpose
// (spec 18.2): it exists so that the ring asks from its very first cell, which
// is what lets lasting changes to the world -- damage, what someone builds, the
// world editor of M6 -- arrive later without the streaming learning anything
// new. Pure CPU, no Three.js.
//
// The ring asks once per cell, 1681 times per rebuild, every 96 m of flight, so
// the empty case has to cost nothing at all. Ask size before building the key:
//
//   const entry = overrides.size === 0 ? null : overrides.for(cellKey(gx, gz));
//
// and an empty layer never makes the string. `for` checks the size again, so a
// caller that forgets pays for its own key and nothing more.

import type { Placement } from '../../../library/contract';

/** What one key may say: nothing stands here, or exactly this does. */
export interface Override {
  key: string;
  skip?: boolean;
  placements?: Placement[];
}

/** The key of a ring cell, by its cell coordinates. */
export const cellKey = (gx: number, gz: number): string => `cell:${gx},${gz}`;
/** The key of a site, by its id. */
export const siteKey = (id: string): string => `site:${id}`;

export interface Overrides {
  readonly size: number;
  /** The entry filed under that key, or null; always null while the layer is empty. */
  for(key: string): Override | null;
}

export function createOverrides(entries: Override[] = []): Overrides {
  // Read once into the lookup: a layer is replaced whole, never edited through
  // this object, so the ring cannot be looking at a half-written world.
  const byKey = new Map<string, Override>();
  for (const entry of entries) byKey.set(entry.key, entry);
  return {
    get size() {
      return byKey.size;
    },
    for(key) {
      if (byKey.size === 0) return null;
      return byKey.get(key) ?? null;
    },
  };
}

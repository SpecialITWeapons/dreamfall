// What a card carries, as numbers: the pure half of the card pool, so the
// packing and the band a full tree hands over to its card in are read by a
// test in Node. Cards.ts is the GPU half.
import type { ImpostorShape } from './ImpostorBake';

/** The instance attributes of a card and their widths. */
export const CARD_ATTRIBUTES = { cardA: 4, cardB: 4, cardC: 3 } as const;

/** A tree as the card pool is handed one: a ring tree's scratch colour or a far tree's three numbers. */
export interface CardTree {
  x: number;
  y: number;
  z: number;
  scale: number;
  tall: number;
  yaw: number;
  tint: ArrayLike<number> | { r: number; g: number; b: number };
}

const TAU = Math.PI * 2;

/**
 * Writes card `i`: `a` is where it stands in the scene and which picture it
 * shows -- the species' tile times two, plus one when it is mirrored -- `b` its
 * side width, its height, its width seen from above and the height of its
 * foot, all in metres at this tree's size, and `c` its climate tint.
 *
 * Half a species' trees show their picture mirrored, chosen by the tree's own
 * yaw, so a wood of one species is not one stamp.
 */
export function packCard(
  out: { a: Float32Array; b: Float32Array; c: Float32Array },
  i: number,
  tree: CardTree,
  local: { x(v: number): number; z(v: number): number },
  tile: number,
  shape: ImpostorShape,
): void {
  const yaw = ((tree.yaw % TAU) + TAU) % TAU;
  out.a[i * 4] = local.x(tree.x);
  out.a[i * 4 + 1] = tree.y;
  out.a[i * 4 + 2] = local.z(tree.z);
  out.a[i * 4 + 3] = tile * 2 + (yaw >= Math.PI ? 1 : 0);
  out.b[i * 4] = shape.width * tree.scale;
  out.b[i * 4 + 1] = shape.height * tree.tall;
  out.b[i * 4 + 2] = shape.width * tree.scale;
  out.b[i * 4 + 3] = shape.bottom * tree.tall;
  const t = tree.tint;
  if ('r' in t) {
    out.c[i * 3] = t.r;
    out.c[i * 3 + 1] = t.g;
    out.c[i * 3 + 2] = t.b;
  } else {
    out.c[i * 3] = t[0]!;
    out.c[i * 3 + 1] = t[1]!;
    out.c[i * 3 + 2] = t[2]!;
  }
}

/**
 * The band over which a full tree dissolves and its card comes up, m: the
 * ring's own band scaled by `k` (one on the ground, nothing high up). Never a
 * band of no width, because a smoothstep over one divides by zero.
 */
export function treeLimitOf(near: number, far: number, k: number): [number, number] {
  const a = near * k;
  return [a, Math.max(far * k, a + 1)];
}

/**
 * The band a card comes up in, given the band its full tree dissolves in: the
 * width before it, so the card is whole by the time the tree starts to go.
 * Both are drawn through alpha-to-coverage, whose masks nest, so a tree at
 * `1 - s` over a card at `s` covers `max(s, 1 - s)` -- half the pixels at the
 * middle of a shared band, which reads as a ring of thinner forest.
 */
export function cardBand(tree: readonly [number, number]): [number, number] {
  const width = tree[1] - tree[0];
  return [tree[0] - width, tree[0]];
}

/**
 * The tile and the mirror back out of `a.w` (`tile * 2 + mirror`), as the
 * card's shader reads them: rounded, because the fragment stage reads it
 * interpolated, and a hair under an even number must not be the neighbour's.
 */
export function decodeCard(w: number): { tile: number; mirror: number } {
  const tile = Math.floor(w * 0.5 + 0.25);
  return { tile, mirror: w - tile * 2 >= 0.5 ? 1 : 0 };
}

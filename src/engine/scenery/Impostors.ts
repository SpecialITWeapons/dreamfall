// The species photographed for their cards, from what the pools baked: the
// browser half of ImpostorBake, which reads the painted canvases and hands the
// pure rasterizer their pixels.
import type { Color, Texture } from 'three';
import {
  TILE,
  bakeView,
  buildAtlas,
  shapeOf,
  type Atlas,
  type BakeSource,
  type ImpostorShape,
  type Picture,
} from './ImpostorBake';
import type { BakedSpecies } from './TreeKit';

/** A painted texture's pixels, as its canvas holds them. */
function pictureOf(map: Texture): Picture {
  const canvas = map.image as HTMLCanvasElement | OffscreenCanvas;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('impostors: a painted texture has no 2d canvas context');
  const { width, height } = canvas;
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

/** The bark's mean colour, alpha-weighted and linear, as `paintedSample` means it. */
function meanOf(picture: Picture): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    w = 0;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  for (let i = 0; i < picture.data.length; i += 4) {
    const a = picture.data[i + 3]! / 255;
    r += lin(picture.data[i]!) * a;
    g += lin(picture.data[i + 1]!) * a;
    b += lin(picture.data[i + 2]!) * a;
    w += a;
  }
  w = Math.max(w, 1e-6);
  return [r / w, g / w, b / w];
}

const arrays = (geometry: BakedSpecies['wood']) => ({
  position: geometry.getAttribute('position').array as ArrayLike<number>,
  normal: geometry.getAttribute('normal').array as ArrayLike<number>,
  uv: geometry.getAttribute('uv').array as ArrayLike<number>,
});

export interface Impostors {
  atlas: Atlas;
  /** Each species' tile in the atlas and its frame at scale one. */
  species: Map<string, { tile: number; shape: ImpostorShape }>;
}

/** Every species from the side and from above, into one atlas, in the registry's order. */
export function photograph(
  species: ReadonlyArray<{ id: string; baked: BakedSpecies; trunkTint: Color }>,
  bark: Texture,
): Impostors {
  const barkMean = meanOf(pictureOf(bark));
  const tiles: Array<{ side: ReturnType<typeof bakeView>; top: ReturnType<typeof bakeView> }> = [];
  const out = new Map<string, { tile: number; shape: ImpostorShape }>();
  for (const [tile, entry] of species.entries()) {
    const src: BakeSource = {
      wood: arrays(entry.baked.wood),
      crown: entry.baked.crown ? arrays(entry.baked.crown) : null,
      barkColor: [
        barkMean[0] * entry.trunkTint.r,
        barkMean[1] * entry.trunkTint.g,
        barkMean[2] * entry.trunkTint.b,
      ],
      leaf: entry.baked.leaf ? pictureOf(entry.baked.leaf) : null,
    };
    tiles.push({ side: bakeView(src, 'side', TILE), top: bakeView(src, 'top', TILE) });
    out.set(entry.id, { tile, shape: shapeOf(src) });
  }
  return { atlas: buildAtlas(tiles), species: out };
}

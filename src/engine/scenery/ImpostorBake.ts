// A species photographed for its card: the baked wood and crown rasterized
// on the CPU, from the side and from above, into one atlas of colour and
// surface direction the far trees are drawn from.
//
// On the CPU and not through the renderer on purpose. The scenery has no
// renderer; reading a render target back is asynchronous; and a render into a
// target of its own compiles the materials a second time, as a capture does.
// Nine species from two sides is a few thousand triangles into 256-texel
// squares -- milliseconds -- and done here it is the same picture on every
// machine and a picture a test in Node can look at.
//
// The picture carries no light and no climate: the card is lit by the same
// lighting model as the tree it stands in for, through the directions baked
// beside the colour, and tinted per instance as the tree's pools are.
//
// Pure CPU: no three at all.

/** Texels a side of one view in the atlas. The largest card on screen is about thirty pixels tall. */
export const TILE = 128;
/** Species across the atlas; each column holds one species, its side view under its top view. */
export const ATLAS_COLUMNS = 16;
export const ATLAS_ROWS = 2;
/** The leaf cards' own cutout (`LEAF_ALPHA_TEST` in Painted.ts): a texel of leaf fainter than this is a hole. */
export const LEAF_CUTOFF = 0.04;
/**
 * How far a leaf's colour is pulled toward the leaf's mean colour (`PAINTED_MEAN`
 * in Painted.ts): the near crown is sampled that way, so its picture is too.
 */
const PAINTED_MEAN = 0.38;
/** Room left either side of the widest reach, so a crown does not touch its neighbour's tile. */
const MARGIN = 0.03;
/** Samples a texel side: the picture is drawn at twice its size and averaged down, which is its edge. */
const SUPERSAMPLE = 2;

/** An image as the canvas holds it: sRGB bytes, rows from the top. */
export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
/** A non-indexed geometry's arrays: three numbers a vertex for position and normal, two for uv. */
export interface Mesh3 {
  position: ArrayLike<number>;
  normal: ArrayLike<number>;
  uv: ArrayLike<number>;
}
export interface BakeSource {
  wood: Mesh3;
  crown: Mesh3 | null;
  /** The bark's mean colour times the trunk's tint, linear: at a card's size a trunk is a few texels. */
  barkColor: [number, number, number];
  /** The crown's painted cards; null for a bare tree. */
  leaf: Picture | null;
}
/** A species' frame at scale one, m: the side view's width and height and the height of its foot. */
export interface ImpostorShape {
  width: number;
  height: number;
  bottom: number;
}
export type View = 'side' | 'top';
export interface ViewPicture {
  /** Linear rgb and coverage, a texel after another, rows from the bottom (v up). */
  color: Float32Array;
  /** The surface direction in the view's own frame -- x right, y up the picture, z toward the eye -- or zero where nothing is. */
  normal: Float32Array;
  /** The mean coverage of the view. */
  coverage: number;
}
export interface Atlas {
  width: number;
  height: number;
  /** sRGB rgb and linear alpha bytes, level 0 first, down to one texel. */
  color: Uint8Array[];
  /** Directions as bytes (n / 2 + 0.5), level 0 first. */
  normal: Uint8Array[];
}

const TO_LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});
const toSrgb = (c: number) => {
  const v = Math.max(0, Math.min(1, c));
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
};

/** Where a species' view lives in the atlas, in uv: a column per species, the side view in the lower row. */
export function tileOf(index: number, view: View): { u: number; v: number; w: number; h: number } {
  return {
    u: index / ATLAS_COLUMNS,
    v: (view === 'top' ? 1 : 0) / ATLAS_ROWS,
    w: 1 / ATLAS_COLUMNS,
    h: 1 / ATLAS_ROWS,
  };
}

/** The frame both views are taken in: the tree's foot to its top, and its widest reach either side. */
export function shapeOf(src: BakeSource): ImpostorShape {
  let reach = 0,
    bottom = Infinity,
    top = -Infinity;
  for (const mesh of [src.wood, src.crown]) {
    if (!mesh) continue;
    const p = mesh.position;
    for (let i = 0; i < p.length; i += 3) {
      reach = Math.max(reach, Math.abs(p[i]!), Math.abs(p[i + 2]!));
      bottom = Math.min(bottom, p[i + 1]!);
      top = Math.max(top, p[i + 1]!);
    }
  }
  if (!Number.isFinite(bottom)) return { width: 1, height: 1, bottom: 0 };
  return { width: 2 * Math.max(reach, 0.01) * (1 + MARGIN), height: Math.max(top - bottom, 0.01), bottom };
}

/** The leaf painting's mean colour, alpha-weighted and linear, as `paintedSample` takes it. */
function meanOf(picture: Picture): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    w = 0;
  const d = picture.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]! / 255;
    r += TO_LINEAR[d[i]!]! * a;
    g += TO_LINEAR[d[i + 1]!]! * a;
    b += TO_LINEAR[d[i + 2]!]! * a;
    w += a;
  }
  w = Math.max(w, 1e-6);
  return [r / w, g / w, b / w];
}

/** One view of a species, rasterized at twice its size with a depth buffer and averaged down. */
export function bakeView(src: BakeSource, view: View, size: number): ViewPicture {
  const shape = shapeOf(src);
  const half = shape.width / 2;
  const R = size * SUPERSAMPLE;
  const depth = new Float32Array(R * R).fill(-Infinity);
  const rgb = new Float32Array(R * R * 3);
  const dir = new Float32Array(R * R * 3);
  const leafMean = src.leaf ? meanOf(src.leaf) : ([0, 0, 0] as [number, number, number]);

  // A vertex in the picture: u right, v up, and d toward the eye.
  const project = (x: number, y: number, z: number, out: number[]) => {
    out[0] = ((x + half) / shape.width) * R;
    if (view === 'side') {
      out[1] = ((y - shape.bottom) / shape.height) * R;
      out[2] = z;
    } else {
      out[1] = ((half - z) / shape.width) * R;
      out[2] = y;
    }
  };
  // A direction in the view's frame: right, up the picture, toward the eye.
  const turn = (nx: number, ny: number, nz: number, out: number[]) => {
    if (view === 'side') {
      out[0] = nx;
      out[1] = ny;
      out[2] = nz;
    } else {
      out[0] = nx;
      out[1] = -nz;
      out[2] = ny;
    }
  };

  const a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0],
    na = [0, 0, 0],
    nb = [0, 0, 0],
    nc = [0, 0, 0];
  const draw = (mesh: Mesh3, leaf: Picture | null) => {
    const p = mesh.position,
      n = mesh.normal,
      t = mesh.uv;
    for (let v = 0; v + 2 < p.length / 3; v += 3) {
      project(p[v * 3]!, p[v * 3 + 1]!, p[v * 3 + 2]!, a);
      project(p[v * 3 + 3]!, p[v * 3 + 4]!, p[v * 3 + 5]!, b);
      project(p[v * 3 + 6]!, p[v * 3 + 7]!, p[v * 3 + 8]!, c);
      const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
      if (Math.abs(area) < 1e-9) continue;
      turn(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!, na);
      turn(n[v * 3 + 3]!, n[v * 3 + 4]!, n[v * 3 + 5]!, nb);
      turn(n[v * 3 + 6]!, n[v * 3 + 7]!, n[v * 3 + 8]!, nc);
      const x0 = Math.max(0, Math.floor(Math.min(a[0]!, b[0]!, c[0]!))),
        x1 = Math.min(R - 1, Math.ceil(Math.max(a[0]!, b[0]!, c[0]!))),
        y0 = Math.max(0, Math.floor(Math.min(a[1]!, b[1]!, c[1]!))),
        y1 = Math.min(R - 1, Math.ceil(Math.max(a[1]!, b[1]!, c[1]!)));
      for (let py = y0; py <= y1; py++)
        for (let px = x0; px <= x1; px++) {
          const sx = px + 0.5,
            sy = py + 0.5;
          // barycentric weights; either winding, since a card is seen from both sides
          const wa = ((b[0]! - sx) * (c[1]! - sy) - (b[1]! - sy) * (c[0]! - sx)) / area,
            wb = ((c[0]! - sx) * (a[1]! - sy) - (c[1]! - sy) * (a[0]! - sx)) / area,
            wc = 1 - wa - wb;
          if (wa < 0 || wb < 0 || wc < 0) continue;
          const d = wa * a[2]! + wb * b[2]! + wc * c[2]!;
          const k = py * R + px;
          if (d <= depth[k]!) continue;
          let r = src.barkColor[0],
            g = src.barkColor[1],
            bl = src.barkColor[2];
          if (leaf) {
            const u = wa * t[v * 2]! + wb * t[v * 2 + 2]! + wc * t[v * 2 + 4]!,
              w = wa * t[v * 2 + 1]! + wb * t[v * 2 + 3]! + wc * t[v * 2 + 5]!;
            const tx = Math.min(leaf.width - 1, Math.max(0, Math.floor(u * leaf.width))),
              ty = Math.min(leaf.height - 1, Math.max(0, Math.floor((1 - w) * leaf.height)));
            const o = (ty * leaf.width + tx) * 4;
            if (leaf.data[o + 3]! / 255 < LEAF_CUTOFF) continue;
            r = TO_LINEAR[leaf.data[o]!]! * (1 - PAINTED_MEAN) + leafMean[0] * PAINTED_MEAN;
            g = TO_LINEAR[leaf.data[o + 1]!]! * (1 - PAINTED_MEAN) + leafMean[1] * PAINTED_MEAN;
            bl = TO_LINEAR[leaf.data[o + 2]!]! * (1 - PAINTED_MEAN) + leafMean[2] * PAINTED_MEAN;
          }
          depth[k] = d;
          rgb[k * 3] = r;
          rgb[k * 3 + 1] = g;
          rgb[k * 3 + 2] = bl;
          const nx = wa * na[0]! + wb * nb[0]! + wc * nc[0]!,
            ny = wa * na[1]! + wb * nb[1]! + wc * nc[1]!,
            nz = wa * na[2]! + wb * nb[2]! + wc * nc[2]!;
          const len = Math.hypot(nx, ny, nz) || 1;
          dir[k * 3] = nx / len;
          dir[k * 3 + 1] = ny / len;
          dir[k * 3 + 2] = nz / len;
        }
    }
  };
  draw(src.wood, null);
  if (src.crown && src.leaf) draw(src.crown, src.leaf);

  // Averaged down: coverage is the share of samples hit, colour and direction the mean of those hit.
  const color = new Float32Array(size * size * 4);
  const normal = new Float32Array(size * size * 3);
  let coverage = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0,
        r = 0,
        g = 0,
        bl = 0,
        nx = 0,
        ny = 0,
        nz = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++)
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const k = (y * SUPERSAMPLE + sy) * R + x * SUPERSAMPLE + sx;
          if (depth[k] === -Infinity) continue;
          hits++;
          r += rgb[k * 3]!;
          g += rgb[k * 3 + 1]!;
          bl += rgb[k * 3 + 2]!;
          nx += dir[k * 3]!;
          ny += dir[k * 3 + 1]!;
          nz += dir[k * 3 + 2]!;
        }
      const o = y * size + x;
      if (hits === 0) continue;
      const alpha = hits / (SUPERSAMPLE * SUPERSAMPLE);
      color[o * 4] = r / hits;
      color[o * 4 + 1] = g / hits;
      color[o * 4 + 2] = bl / hits;
      color[o * 4 + 3] = alpha;
      const len = Math.hypot(nx, ny, nz) || 1;
      normal[o * 3] = nx / len;
      normal[o * 3 + 1] = ny / len;
      normal[o * 3 + 2] = nz / len;
      coverage += alpha;
    }
  return { color, normal, coverage: coverage / (size * size) };
}

/**
 * Every clear texel takes the colour and direction of the nearest covered one,
 * so a mip that averages a leaf's edge with the air around it averages it with
 * more leaf, never with black.
 */
function dilate(color: Float32Array, normal: Float32Array, width: number, height: number) {
  const from = new Int32Array(width * height).fill(-1);
  const queue = new Int32Array(width * height);
  let head = 0,
    tail = 0;
  for (let i = 0; i < width * height; i++)
    if (color[i * 4 + 3]! > 0) {
      from[i] = i;
      queue[tail++] = i;
    }
  while (head < tail) {
    const i = queue[head++]!,
      x = i % width,
      y = (i - x) / width;
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ]) {
      if (j < 0 || from[j] !== -1) continue;
      const src = from[i]!;
      from[j] = src;
      color[j * 4] = color[src * 4]!;
      color[j * 4 + 1] = color[src * 4 + 1]!;
      color[j * 4 + 2] = color[src * 4 + 2]!;
      normal[j * 3] = normal[src * 3]!;
      normal[j * 3 + 1] = normal[src * 3 + 1]!;
      normal[j * 3 + 2] = normal[src * 3 + 2]!;
      queue[tail++] = j;
    }
  }
}

/**
 * The atlas: every species' two views at level 0, and every level under it
 * down to one texel. A level is the plain box average of the one above --
 * alpha included, which keeps a tile's mean alpha and so, under
 * alpha-to-coverage, the share of the screen its tree covers -- with the
 * colour weighted by alpha, so a clear texel's borrowed colour does not dim it.
 */
export function buildAtlas(tiles: Array<{ side: ViewPicture; top: ViewPicture }>): Atlas {
  const width = TILE * ATLAS_COLUMNS,
    height = TILE * ATLAS_ROWS;
  if (tiles.length > ATLAS_COLUMNS)
    throw new Error(`impostors: ${tiles.length} species, the atlas holds ${ATLAS_COLUMNS}`);
  let color = new Float32Array(width * height * 4);
  let normal = new Float32Array(width * height * 3);
  tiles.forEach((tile, index) => {
    for (const view of ['side', 'top'] as const) {
      const picture = tile[view];
      const x0 = index * TILE,
        y0 = view === 'top' ? TILE : 0;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const s = y * TILE + x,
            d = (y0 + y) * width + x0 + x;
          color.set(picture.color.subarray(s * 4, s * 4 + 4), d * 4);
          normal.set(picture.normal.subarray(s * 3, s * 3 + 3), d * 3);
        }
    }
  });
  dilate(color, normal, width, height);

  const encode = (c: Float32Array, n: Float32Array, count: number) => {
    const cb = new Uint8Array(count * 4),
      nb = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      cb[i * 4] = toSrgb(c[i * 4]!);
      cb[i * 4 + 1] = toSrgb(c[i * 4 + 1]!);
      cb[i * 4 + 2] = toSrgb(c[i * 4 + 2]!);
      cb[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, c[i * 4 + 3]!)) * 255);
      for (let k = 0; k < 3; k++)
        nb[i * 4 + k] = Math.round((Math.max(-1, Math.min(1, n[i * 3 + k]!)) * 0.5 + 0.5) * 255);
      nb[i * 4 + 3] = 255;
    }
    return [cb, nb] as const;
  };

  const atlas: Atlas = { width, height, color: [], normal: [] };
  let w = width,
    h = height;
  for (;;) {
    const [cb, nb] = encode(color, normal, w * h);
    atlas.color.push(cb);
    atlas.normal.push(nb);
    if (w === 1 && h === 1) break;
    const nw = Math.max(1, w >> 1),
      nh = Math.max(1, h >> 1);
    const nc = new Float32Array(nw * nh * 4),
      nn = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        let a = 0,
          r = 0,
          g = 0,
          b = 0,
          pr = 0,
          pg = 0,
          pb = 0,
          nx = 0,
          ny = 0,
          nz = 0;
        const xs = w > 1 ? [2 * x, 2 * x + 1] : [0],
          ys = h > 1 ? [2 * y, 2 * y + 1] : [0];
        const count = xs.length * ys.length;
        for (const sy of ys)
          for (const sx of xs) {
            const s = sy * w + sx,
              alpha = color[s * 4 + 3]!;
            a += alpha;
            r += color[s * 4]! * alpha;
            g += color[s * 4 + 1]! * alpha;
            b += color[s * 4 + 2]! * alpha;
            pr += color[s * 4]!;
            pg += color[s * 4 + 1]!;
            pb += color[s * 4 + 2]!;
            nx += normal[s * 3]!;
            ny += normal[s * 3 + 1]!;
            nz += normal[s * 3 + 2]!;
          }
        const d = y * nw + x;
        if (a > 0) {
          nc[d * 4] = r / a;
          nc[d * 4 + 1] = g / a;
          nc[d * 4 + 2] = b / a;
        } else {
          nc[d * 4] = pr / count;
          nc[d * 4 + 1] = pg / count;
          nc[d * 4 + 2] = pb / count;
        }
        nc[d * 4 + 3] = a / count;
        nn[d * 3] = nx / count;
        nn[d * 3 + 1] = ny / count;
        nn[d * 3 + 2] = nz / count;
      }
    color = nc;
    normal = nn;
    w = nw;
    h = nh;
  }
  return atlas;
}

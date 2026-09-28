// The shade sheet's painter: the ground's ambient occlusion under the trees,
// one soft spot per tree, multiplied into a square of bytes on the CPU.
//
// It was a 2D canvas, one radial gradient per tree. Chromium accelerates a
// canvas, so the three thousand gradients were recorded here and rasterised in
// the GPU process when the texture was uploaded -- 15 to 35 ms of it on this
// machine's GPU -- and the frame after every ring cell crossing waited that long
// for the GPU to take its first command (docs/perf-notes.md, "The frames around
// a crossing"). A spot is a texel or two across at 8 m a texel, so the same
// sheet painted here costs about two milliseconds, in the frame after the ring's.
//
// The spot is the gradient the canvas drew, stop for stop: black at 0.4 at the
// middle, 0.27 at three tenths of the way out and nothing at the rim, read at
// each texel's centre, taken as much as the spot's square covers the texel, and
// laid over what is there, so overlapping trees darken multiplicatively as
// `source-over` did. Pure CPU, tested in Node.

/** The side of the square of world the sheet covers, m. */
export const AO_SPAN = 4096;
/** The sheet itself, texels per side. */
export const AO_SIZE = 512;
/** How much of a tree's own radius its shade covers. */
export const SHADE_RADIUS = 0.6;
/** The spot's stops, from the middle out: (where, how dark). */
const STOPS: ReadonlyArray<readonly [number, number]> = [
  [0, 0x66 / 255],
  [0.3, 0x44 / 255],
  [1, 0],
];

/** What the sheet asks of a record: where it stands and how wide it is, in the world. */
export interface ShadeRecord {
  x: number;
  z: number;
  radius: number;
}

/** How dark a spot is at a fraction `t` of its radius out from its middle. */
export function spotAt(t: number): number {
  if (t >= 1) return 0;
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, a1] = STOPS[i]!;
    if (t <= t1) {
      const [t0, a0] = STOPS[i - 1]!;
      return a0 + ((a1 - a0) * (t - t0)) / (t1 - t0);
    }
  }
  return 0;
}

export interface ShadeSheet {
  /** The sheet, a byte a texel, row by row in world z and x from the corner: 255 is open ground. */
  readonly data: Uint8Array;
  /**
   * Paints the whole sheet around (centerX, centerZ) in world metres -- the
   * centre of the ring's cell -- from the records the ring has just placed.
   */
  paint(records: readonly ShadeRecord[], centerX: number, centerZ: number): void;
}

/** How much of the span [a, b] lies inside the texel [i, i + 1]. */
const overlap = (a: number, b: number, i: number) => Math.max(0, Math.min(b, i + 1) - Math.max(a, i));

export function createShadeSheet(size = AO_SIZE, span = AO_SPAN): ShadeSheet {
  const data = new Uint8Array(size * size).fill(255);
  // How much light is left in each texel while the spots go on, 1 where none
  // fell; only the texels a spot touched are listed, turned into bytes and
  // opened again, so a sheet of mostly open ground costs its spots and a fill.
  const light = new Float32Array(size * size).fill(1);
  const marked = new Uint8Array(size * size);
  let touched = new Int32Array(4096),
    count = 0;
  const perMetre = size / span;
  return {
    data,
    paint(records, centerX, centerZ) {
      count = 0;
      for (const record of records) {
        const px = ((record.x - centerX) / span + 0.5) * size,
          pz = ((record.z - centerZ) / span + 0.5) * size,
          r = record.radius * SHADE_RADIUS * perMetre;
        if (!(r > 0)) continue;
        // The canvas filled the square around the spot, and a texel it only
        // partly covered took that part of the spot: a spot is often under a
        // texel across, so that is most of what it drew and is kept.
        const x0 = px - r,
          x1 = px + r,
          z0 = pz - r,
          z1 = pz + r;
        const i0 = Math.max(0, Math.floor(x0)),
          i1 = Math.min(size - 1, Math.ceil(x1) - 1),
          j0 = Math.max(0, Math.floor(z0)),
          j1 = Math.min(size - 1, Math.ceil(z1) - 1);
        for (let j = j0; j <= j1; j++) {
          const dz = j + 0.5 - pz,
            cz = overlap(z0, z1, j);
          for (let i = i0; i <= i1; i++) {
            const dx = i + 0.5 - px;
            const dark = spotAt(Math.sqrt(dx * dx + dz * dz) / r) * cz * overlap(x0, x1, i);
            if (dark <= 0) continue;
            const k = j * size + i;
            if (marked[k] === 0) {
              marked[k] = 1;
              if (count === touched.length) {
                const grown = new Int32Array(count * 2);
                grown.set(touched);
                touched = grown;
              }
              touched[count++] = k;
            }
            light[k]! *= 1 - dark;
          }
        }
      }
      data.fill(255);
      for (let n = 0; n < count; n++) {
        const k = touched[n]!;
        data[k] = Math.round(light[k]! * 255);
        light[k] = 1;
        marked[k] = 0;
      }
    },
  };
}

// The floating origin. The simulation keeps world coordinates in JavaScript
// numbers (double precision); the presentation, whose GPU buffers are single
// precision, sees coordinates relative to this origin. The origin follows the
// flyer in jumps of whole terrain cells, so heightfield texel indices stay
// integers and the terrain grid never straddles a cell boundary.

export interface Origin {
  readonly x: number;
  readonly z: number;
  /** Moves the origin next to (x, z) when either axis drifted past the threshold; true when it moved. */
  shiftFor(x: number, z: number): boolean;
  localX(wx: number): number;
  localZ(wz: number): number;
  worldX(lx: number): number;
  worldZ(lz: number): number;
}

export function createOrigin(opts: { cell?: number; threshold?: number } = {}): Origin {
  const cell = opts.cell ?? 16;
  const threshold = opts.threshold ?? 4000;
  let x = 0;
  let z = 0;
  const snap = (v: number) => Math.round(v / cell) * cell;
  return {
    get x() {
      return x;
    },
    get z() {
      return z;
    },
    shiftFor(px, pz) {
      if (Math.abs(px - x) <= threshold && Math.abs(pz - z) <= threshold) return false;
      x = snap(px);
      z = snap(pz);
      return true;
    },
    localX: (wx) => wx - x,
    localZ: (wz) => wz - z,
    worldX: (lx) => lx + x,
    worldZ: (lz) => lz + z,
  };
}

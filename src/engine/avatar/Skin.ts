// What a chain of the figure is, and the arrays a surface over it comes out
// as. The chain is the data half of the figure -- joints, a profile, a section,
// a swatch -- and it knows nothing about the renderer; the surface is grown
// over a set of chains by `Flesh.ts`, from a distance field, and comes back as
// a `Skin`: the arrays a `SkinnedMesh` takes, plus what each vertex is. This
// used to hold the sweep that threaded rings along a chain and stitched them
// into a tube; the field replaced it because a tube pushed into another tube
// is a seam, and a body is not made of seams.
import type { Vector3 } from 'three';

/**
 * How far either side of a joint the skin shares between two bones, as a share
 * of the segment. Nothing is a crease, a half is a rubber hose: this is the
 * one number to turn when an elbow looks wrong.
 */
export const BLEND = 0.34;

/** One limb, spine or neck: the bones it runs along and how thick it is. */
export interface Chain {
  /** Bone names, root first. Every vertex is bound to two of these. */
  bones: string[];
  /** Where those bones rest, in the figure's frame, m. */
  joints: Vector3[];
  /** Half-width across the chain at this distance along it, 0..1 -> m. */
  profile: (t: number) => number;
  /** Which swatch the surface takes at this distance along it. */
  swatch: (t: number) => string;
  /**
   * A swatch for one *place* on the surface rather than one band around it:
   * the distance along the chain and the angle around the ring, in radians
   * from the first across-axis. Returning null leaves the band's own colour.
   *
   * A band cannot paint a visor. It paints a stripe the whole way round the
   * head, and a dark stripe across a pale oval is a face from every angle at
   * once -- so the figure appeared to turn its head to follow the camera, all
   * the way round to its own back. Nothing was turning. A patch is what a
   * visor, a badge or a flash down one sleeve actually is.
   */
  patch?: (t: number, around: number) => string | null;
  /**
   * The cross-section's shape: 1 is a circle, above it an ellipse wider across
   * the first axis than the second. A chest is wider than it is thick and a
   * boot is longer than it is wide, and neither is a pipe. Given as a function
   * of the distance along the chain, it may change on the way: a chest is
   * flatter than the waist under it.
   */
  flatten?: number | ((t: number) => number);
  /**
   * Which way the first axis points, when it matters. The across-axis is
   * otherwise seeded from x and carried along the chain, which is fine for a
   * limb -- it only has to not spin -- and a lottery for anything flattened: a
   * palm is wide across the hand and thin through it, and a palm whose first
   * axis came out edge-on is a blade. Given here, it is projected square to the
   * chain and carried from there as usual.
   */
  across?: Vector3;
}

export interface Skin {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  index: Uint32Array;
  /** The swatch each vertex takes, so painting is a walk of this array. */
  swatch: string[];
  /**
   * The swatch on the other side of an edge that runs through this vertex's
   * cell, and how much of the cell it covers, 0..1. A patch's edge -- the
   * visor's -- falls between vertices, and a vertex painted one colour or the
   * other makes a stair of the edge at the grid's own pitch; painted a mix in
   * proportion, the edge reads straight from three metres.
   */
  swatch2: string[];
  mix: Float32Array;
  /** How dark each vertex sits against its swatch, 0..1; 1 is the swatch itself. */
  shade: Float32Array;
  /**
   * Where each vertex sits on its own chain, 0..1 from the first joint to the
   * last, and where it sits around the ring, 0..2pi. The pair is what a
   * *pattern* is painted with -- a band across a sleeve is a range of the
   * first, a stripe down the outside of a leg is a range of the second -- and
   * they are written here rather than worked out again later, because the only
   * place that knows them is the field that put the vertex there.
   */
  along: Float32Array;
  around: Float32Array;
}

/** Lay several surfaces into one set of arrays, keeping every vertex's swatch and shade. */
export function mergeSkins(parts: Skin[]): Skin {
  const count = parts.reduce((n, p) => n + p.position.length / 3, 0);
  const indices = parts.reduce((n, p) => n + p.index.length, 0);
  const out: Skin = {
    position: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    skinIndex: new Uint16Array(count * 4),
    skinWeight: new Float32Array(count * 4),
    index: new Uint32Array(indices),
    swatch: new Array<string>(count),
    swatch2: new Array<string>(count),
    mix: new Float32Array(count),
    shade: new Float32Array(count),
    along: new Float32Array(count),
    around: new Float32Array(count),
  };
  let v = 0,
    i = 0;
  for (const part of parts) {
    const n = part.position.length / 3;
    out.position.set(part.position, v * 3);
    out.normal.set(part.normal, v * 3);
    out.skinIndex.set(part.skinIndex, v * 4);
    out.skinWeight.set(part.skinWeight, v * 4);
    out.shade.set(part.shade, v);
    out.mix.set(part.mix, v);
    out.along.set(part.along, v);
    out.around.set(part.around, v);
    for (let k = 0; k < n; k++) {
      out.swatch[v + k] = part.swatch[k]!;
      out.swatch2[v + k] = part.swatch2[k]!;
    }
    for (let k = 0; k < part.index.length; k++) out.index[i + k] = part.index[k]! + v;
    v += n;
    i += part.index.length;
  }
  return out;
}

// The road kit: a polyline becomes a ribbon of ground-hugging geometry.
//
// A road is geometry rather than a mask painted into the ground because a
// terrain texel is 16 m across: a street painted by the ground material would
// be a smudge three times wider than the street, and it would move with the
// texel rather than with the polyline. The ribbon costs triangles and buys a
// road with edges.
//
// Geometry only, like the tree kit: no material, no TSL, no DOM, so the whole
// of it runs in Node under a test. The coordinates are the site's own world
// metres; the pools move them into the scene's local frame, as they do for
// everything the ring places.
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { swatchColor, validateBaked, type RoadSpec, type SceneryColor } from '../../../library/contract';

/** Metres between samples along a polyline; a corner is always a sample too. */
export const ROAD_SAMPLE = 4;
/** Metres the ribbon rides above the ground, enough that it never fights the terrain for a pixel. */
export const ROAD_LIFT = 0.15;
/** Triangles one site may spend on all its roads (spec 5.5). */
export const ROAD_TRIANGLES = 60000;
/** Packed earth: what a track is unless the site paints it otherwise. */
const ROAD_COLOR: SceneryColor = 'clay';
/**
 * How far a corner may stretch along its bisector. A turn approaching a hairpin
 * has a mitre that runs away to infinity, and one spike of road reaching across
 * the village is worse than a corner that is a little short of square.
 */
const MITER_LIMIT = 4;
/**
 * Metres either side for the central difference the normal comes from. It is
 * well inside one terrain texel, so the ribbon is lit by the slope of the very
 * ground it lies on rather than by an average of the hill.
 */
const NORMAL_PROBE = 2;
/** Shorter than this and two points of a polyline are one point, with no direction between them. */
const EPSILON = 1e-6;

export interface RoadDeps {
  /** The terrain, in the site's world metres: the CPU heightfield, or a stub in a test. */
  heightAt(x: number, z: number): number;
  /** Metres above the ground; ROAD_LIFT by default. */
  lift?: number;
  /** Triangles this site's roads may spend; ROAD_TRIANGLES by default. */
  triangles?: number;
  /** The site the roads belong to, so an overrun says whose it is. */
  site?: string;
  /**
   * What the geometry is measured from, in the world. The ground is still read
   * at world coordinates; only the vertices move, so the mesh can be hung at
   * this point in the scene's local frame and an origin jump costs a position
   * rather than a rebuild. Defaults to the world origin.
   */
  at?: [number, number];
}

/** One sample along a polyline: where it is, and which way the ribbon spreads from it. */
export interface PolylineSample {
  x: number;
  z: number;
  /** The half-width direction, already stretched by the mitre at a corner. */
  ox: number;
  oz: number;
  /** Metres walked to here, for the texture coordinate. */
  along: number;
}

/**
 * Where a corner spreads: the perpendicular of the bisector of the two
 * directions, stretched by 1/cos so the rim lands on the crossing of the two
 * segments' own edges. Without the stretch the ribbon pinches in every turn --
 * the rim pair would still be the road's width apart, but measured across the
 * bisector instead of across the road.
 */
function miter(d0x: number, d0z: number, d1x: number, d1z: number): [number, number] {
  const bx = d0x + d1x,
    bz = d0z + d1z;
  const b = Math.hypot(bx, bz);
  // a reversal has no bisector: keep the rim square to the segment arriving
  if (b < EPSILON) return [d0z, -d0x];
  const ox = bz / b,
    oz = -bx / b;
  const square = ox * d0z + oz * -d0x;
  return square > 1 / MITER_LIMIT ? [ox / square, oz / square] : [ox * MITER_LIMIT, oz * MITER_LIMIT];
}

/**
 * One polyline walked every `step` metres. Corners are samples of both the
 * segment that arrives and the one that leaves, so the ribbon turns on one rim
 * pair and never tears.
 *
 * The line kit walks with this too: a fence follows a polyline the way a road
 * does, and there is one mitre in this engine. The step is the caller's,
 * because it is not the same choice for the two of them -- it says how finely
 * that kind of ribbon follows the ground, and a road that is lifted and a fence
 * that is buried forgive a chord differently.
 */
export function walkPolyline(points: Array<[number, number]>, step: number): PolylineSample[] {
  const pts: Array<[number, number]> = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > EPSILON) pts.push(p);
  }
  if (pts.length < 2) return [];
  let total = 0;
  for (let s = 0; s + 1 < pts.length; s++)
    total += Math.hypot(pts[s + 1]![0] - pts[s]![0], pts[s + 1]![1] - pts[s]![1]);
  // a run shorter than a single sample is a stray point of a plan, not a run
  if (total < step) return [];

  const out: PolylineSample[] = [];
  let along = 0;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [x0, z0] = pts[s]!,
      [x1, z1] = pts[s + 1]!;
    const length = Math.hypot(x1 - x0, z1 - z0);
    const dx = (x1 - x0) / length,
      dz = (z1 - z0) / length;
    const steps = Math.max(1, Math.ceil(length / step));
    const next = pts[s + 2];
    // the first sample of a segment is the corner the segment before it ended on
    for (let i = s === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      const [ox, oz] =
        i === steps && next
          ? miter(dx, dz, ...unit(x1, z1, next[0], next[1]))
          : ([dz, -dx] as [number, number]);
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, ox, oz, along: along + length * t });
    }
    along += length;
  }
  return out;
}

/** The direction from one point to the next, as a unit vector. */
function unit(x0: number, z0: number, x1: number, z1: number): [number, number] {
  const length = Math.hypot(x1 - x0, z1 - z0);
  return [(x1 - x0) / length, (z1 - z0) / length];
}

/** One rim vertex, sitting on the ground and lit by it. */
interface Rim {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
}

/**
 * Every road of one site as a single non-indexed geometry with vertex colors,
 * or null when there is nothing to build. The ribbon is sampled every
 * ROAD_SAMPLE metres, lifted ROAD_LIFT above the ground and normalled from it.
 */
export function buildRoads(roads: RoadSpec[], deps: RoadDeps): BufferGeometry | null {
  const lift = deps.lift ?? ROAD_LIFT,
    cap = deps.triangles ?? ROAD_TRIANGLES,
    site = deps.site ?? 'unnamed';
  const [ox, oz] = deps.at ?? [0, 0];

  // A road too short to sample drops out here, with its spec: what is left
  // keeps its own width and its own colour, whatever fell out before it.
  const walks = roads
    .map((road) => ({ road, samples: walkPolyline(road.points, ROAD_SAMPLE) }))
    .filter(({ samples }) => samples.length > 1);
  const quads = walks.reduce((sum, { samples }) => sum + samples.length - 1, 0);
  if (quads === 0) return null;
  // Counted before a single float is allocated: a plan that asks for a hundred
  // kilometres of street is refused, not built and then measured.
  if (quads * 2 > cap)
    throw new Error(`scenery library: site ${site}: ${quads * 2} triangles, the road budget is ${cap}`);

  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  const push = (rim: Rim, color: Color) => {
    positions.push(rim.x, rim.y, rim.z);
    normals.push(rim.nx, rim.ny, rim.nz);
    colors.push(color.r, color.g, color.b);
    uvs.push(rim.u, rim.v);
  };
  const rimAt = (x: number, z: number, u: number, v: number): Rim => {
    const gx = (deps.heightAt(x + NORMAL_PROBE, z) - deps.heightAt(x - NORMAL_PROBE, z)) / (2 * NORMAL_PROBE);
    const gz = (deps.heightAt(x, z + NORMAL_PROBE) - deps.heightAt(x, z - NORMAL_PROBE)) / (2 * NORMAL_PROBE);
    const length = Math.hypot(gx, 1, gz);
    return {
      x: x - ox,
      y: deps.heightAt(x, z) + lift,
      z: z - oz,
      nx: -gx / length,
      ny: 1 / length,
      nz: -gz / length,
      u,
      v,
    };
  };

  for (const { road, samples } of walks) {
    const color = new Color(swatchColor(road.color ?? ROAD_COLOR));
    const half = road.width / 2;
    // the texture runs as far along as the road is wide, so it is never stretched
    const rims = samples.map((s): [Rim, Rim] => [
      rimAt(s.x + s.ox * half, s.z + s.oz * half, 0, s.along / road.width),
      rimAt(s.x - s.ox * half, s.z - s.oz * half, 1, s.along / road.width),
    ]);
    for (let i = 0; i + 1 < rims.length; i++) {
      const [a0, b0] = rims[i]!,
        [a1, b1] = rims[i + 1]!;
      // Six vertices a quad, the near rim pair first and both triangles facing
      // the sky: the order is what lets a test read the width of the ribbon
      // straight out of the buffer.
      push(a0, color);
      push(b0, color);
      push(a1, color);
      push(b0, color);
      push(b1, color);
      push(a1, color);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  // Measured like every other baked geometry. The count is already known; what
  // this catches is the colour, which came from a site's build hook and has met
  // no validator on the way here.
  const problems = validateBaked({ kind: 'site', id: site, budget: { triangles: cap } }, geometry);
  if (problems.length) throw new Error(`scenery library: ${problems.join('; ')}`);
  return geometry;
}

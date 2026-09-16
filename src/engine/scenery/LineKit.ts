// The line kit: a polyline becomes a ribbon that stands up.
//
// A fence across a field, a low wall, a hedge along a lane: none of them is a
// prop scattered thinly along a route, because a prop stands where it is put
// and these things run. They are the road's mechanism turned on its edge -- the
// road spreads a width across the ground and takes its normal from the slope;
// a line spends a height instead of a width, stands on the ground at every
// sample, and is looked at from both sides.
//
// The walk is the road's own, `walkPolyline`: there is one polyline sampling
// and one mitre in this engine. A mitre corrected in two places is a mitre
// corrected in one of them, and the one left wrong is always the one nobody is
// looking at.
//
// Geometry only, like the road kit and the tree kit: no material, no TSL, no
// DOM, so the whole of it runs in Node under a test. The coordinates are the
// site's own world metres; the pools move them into the scene's local frame,
// as they do for everything the ring places.
import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import { swatchColor, validateBaked, type LineSpec, type SceneryColor } from '../../../library/contract';
import { walkPolyline, type PolylineSample } from './RoadKit';

/**
 * Metres between samples along a line. It is the road's step, for the road's
 * reason rather than by inheritance: between two samples the foot of the line
 * is a straight chord while the ground under it is not, and measured over
 * 15 360 four-metre spans of seed 42 that chord floats above the ground by
 * nothing at all on half of them -- a span inside one terrain cell is a chord
 * of a plane -- by 0.07 m at the ninety-ninth percentile and by 0.50 m at the
 * worst crossing of a ridge. Halving the step would buy four centimetres at
 * that percentile and cost every triangle here twice.
 */
export const LINE_SAMPLE = 4;
/**
 * Metres the foot is buried, which is what makes the measurement above
 * harmless: it covers the chord of all but a thousandth of spans, it costs
 * nothing to look at -- the bottom of a fence stands in the grass anyway -- and
 * daylight under a fence costs the whole illusion. A line sinks for the reason
 * a road lifts.
 */
export const LINE_SINK = 0.2;
/**
 * Triangles one site may spend on all its lines. The road's 60 000 buys it
 * 120 km of street; this buys 20 km of wall or 30 km of fence, which is more
 * line than a site 900 m across has anything to stand it along. What it is for
 * is the generator that edges every lot of a town: two thousand lots of sixty
 * metres is 120 km, which asks for 120 000 triangles as a fence and 185 000 as
 * a hedge, and a plan that asks should be told so rather than quietly drawn.
 */
export const LINE_TRIANGLES = 30000;

/** What one kind of line is: how tall it stands, how thick it is, what it is made of. */
export interface LineKind {
  /** Metres above the ground, unless the line asks for its own height. */
  height: number;
  /**
   * Metres across. Zero is one ribbon painted on both faces; anything more is
   * a box with a top on it, and a top is what a thing a metre wide needs in a
   * world that is looked at from above. The lesson is the grass tuft's: one
   * card is a line seen from overhead.
   */
  thickness: number;
  color: SceneryColor;
}

/**
 * The kinds a plan may ask for: a fence, a low wall, a hedge. Three, because
 * three are what the design has been asking for since it named them, and they
 * differ in these numbers and in nothing else -- one mechanism, one table.
 *
 * None of them has gaps. A gap is a cutout, a cutout is an alpha test, and the
 * material a plan's geometry is drawn with carries no texture to cut out of;
 * building the pickets instead would cost about seven triangles a metre
 * against one, for a detail that is a line from the air and reads only on a low
 * pass. A painted fence is the first thing to add here when a line has a
 * material of its own -- the paint coordinates are already written.
 */
export const LINE_KINDS: Record<string, LineKind> = {
  fence: { height: 1.2, thickness: 0, color: 'barkWarm' },
  wall: { height: 1.1, thickness: 0.45, color: 'stoneWarm' },
  hedge: { height: 1.4, thickness: 0.9, color: 'forest' },
};

export interface LineDeps {
  /** The terrain, in the site's world metres: the CPU heightfield, or a stub in a test. */
  heightAt(x: number, z: number): number;
  /** Triangles this site's lines may spend; LINE_TRIANGLES by default. */
  triangles?: number;
  /** The site the lines belong to, so an overrun says whose it is. */
  site?: string;
  /**
   * What the geometry is measured from, in the world. The ground is still read
   * at world coordinates; only the vertices move, so the mesh can be hung at
   * this point in the scene's local frame and an origin jump costs a position
   * rather than a rebuild. Defaults to the world origin.
   */
  at?: [number, number];
}

/** A corner of a quad: where it stands, and where it sits in the paint. */
interface Corner {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
}
/** Which way a face looks, as a unit vector. */
type Normal = [number, number, number];
/** Two triangles out of one corner loop. */
const FAN = [0, 1, 2, 0, 2, 3] as const;
const UP: Normal = [0, 1, 0];

/** The horizontal direction from one sample to the next. */
function heading(from: PolylineSample, to: PolylineSample): Normal {
  const dx = to.x - from.x,
    dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, 0, dz / length];
}

/** The same corner, moved in the paint: a top and an end run across the line, not along it. */
const paint = (c: Corner, u: number, v: number): Corner => ({ x: c.x, y: c.y, z: c.z, u, v });

/**
 * Every line of one site as a single non-indexed geometry with vertex colors,
 * or null when there is nothing to build. Each line is sampled every
 * LINE_SAMPLE metres and stands from LINE_SINK below the ground to its own
 * height above it -- both ends of every span, so the top follows the terrain.
 * A level top over a slope is a retaining wall, and this kit does not build
 * one: the hillside a fence climbs is the shape the fence takes.
 */
export function buildLines(lines: LineSpec[], deps: LineDeps): BufferGeometry | null {
  const cap = deps.triangles ?? LINE_TRIANGLES,
    site = deps.site ?? 'unnamed';
  const [atX, atZ] = deps.at ?? [0, 0];

  // Resolved before anything is counted, let alone allocated: a plan naming a
  // kind nobody has is the plan's mistake, and the queue is where it is safe to
  // say whose plan it is -- the ring would drop it in a frame without a word.
  const runs = lines
    .map((line) => {
      const kind = LINE_KINDS[line.kind];
      if (!kind) throw new Error(`scenery library: site ${site}: unknown line kind "${line.kind}"`);
      const height = line.height ?? kind.height;
      if (!(height > 0))
        throw new Error(`scenery library: site ${site}: a ${line.kind} ${height} m tall stands nothing up`);
      return { kind, height, samples: walkPolyline(line.points, LINE_SAMPLE) };
    })
    // A line too short to sample drops out here with its spec: what is left
    // keeps its own kind and its own height, whatever fell out before it.
    .filter(({ samples }) => samples.length > 1);

  // A box spends a span on two faces and a top, and a whole line on two ends;
  // a ribbon spends a span on one face pushed twice, facing both ways.
  const triangles = runs.reduce(
    (sum, { kind, samples }) =>
      sum + (samples.length - 1) * (kind.thickness > 0 ? 6 : 4) + (kind.thickness > 0 ? 4 : 0),
    0,
  );
  if (triangles === 0) return null;
  // Counted before a single float is allocated, as the road counts its own: a
  // plan that fences a county is refused, not built and then measured.
  if (triangles > cap)
    throw new Error(`scenery library: site ${site}: ${triangles} triangles, the line budget is ${cap}`);

  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    uvs: number[] = [];
  const push = (c: Corner, n: Normal, color: Color) => {
    positions.push(c.x, c.y, c.z);
    normals.push(n[0], n[1], n[2]);
    colors.push(color.r, color.g, color.b);
    uvs.push(c.u, c.v);
  };
  /** A quad as two triangles; the loop runs counter-clockwise seen from where its normals point. */
  const quad = (
    corners: [Corner, Corner, Corner, Corner],
    ns: [Normal, Normal, Normal, Normal],
    color: Color,
  ) => {
    for (const i of FAN) push(corners[i]!, ns[i]!, color);
  };
  /**
   * A quad wound to face `out`, with the normal its own corners give it. A top
   * and an end are the faces whose loop is easiest to write backwards, and a
   * back-facing end is a hole in the wall rather than a shading mistake, so the
   * winding is decided from the corners instead of from four indices in the
   * right order. The normal is measured rather than assumed because a top
   * follows the ground and is never quite level.
   */
  const sheet = (corners: [Corner, Corner, Corner, Corner], out: Normal, color: Color) => {
    const [a, b, c, d] = corners;
    const ux = c.x - a.x,
      uy = c.y - a.y,
      uz = c.z - a.z;
    const vx = d.x - b.x,
      vy = d.y - b.y,
      vz = d.z - b.z;
    const cx = uy * vz - uz * vy,
      cy = uz * vx - ux * vz,
      cz = ux * vy - uy * vx;
    const length = Math.hypot(cx, cy, cz) || 1;
    const facing = (cx * out[0] + cy * out[1] + cz * out[2] < 0 ? -1 : 1) / length;
    const n: Normal = [cx * facing, cy * facing, cz * facing];
    if (facing < 0) quad([a, d, c, b], [n, n, n, n], color);
    else quad(corners, [n, n, n, n], color);
  };

  for (const { kind, height, samples } of runs) {
    const color = new Color(swatchColor(kind.color));
    const half = kind.thickness / 2;
    // The paint runs along the line in units of the line's own height, so it is
    // never stretched; v climbs a face, 0 at the foot and 1 at the head.
    const scale = height + LINE_SINK;
    const across = kind.thickness / scale;
    const column = (x: number, z: number, u: number) => {
      // Each face stands on its own ground rather than on the centre line's:
      // across a hedge a metre wide a hillside is a hand's breadth of height,
      // and the foot that reads the middle is the foot that floats.
      const ground = deps.heightAt(x, z);
      return {
        top: { x: x - atX, y: ground + height, z: z - atZ, u, v: 1 },
        bottom: { x: x - atX, y: ground - LINE_SINK, z: z - atZ, u, v: 0 },
      };
    };
    const columns = samples.map((s) => {
      const length = Math.hypot(s.ox, s.oz);
      const u = s.along / scale;
      const a = column(s.x + s.ox * half, s.z + s.oz * half, u);
      return {
        // The mitre stretched the offset so that the faces of the two segments
        // meet over the corner; the faces themselves still look straight out of
        // the turn, so the normal is the offset's own direction -- which is the
        // bisector at a corner, and a corner is smooth for free.
        out: [s.ox / length, 0, s.oz / length] as Normal,
        back: [-s.ox / length, 0, -s.oz / length] as Normal,
        a,
        // A line with no thickness is one plane, so it is one column: asking the
        // ground twice for the same point is the fence paying the wall's price.
        b: half > 0 ? column(s.x - s.ox * half, s.z - s.oz * half, u) : a,
      };
    });

    for (let i = 0; i + 1 < columns.length; i++) {
      const near = columns[i]!,
        far = columns[i + 1]!;
      // The face along the offset, then the face against it. A fence has no
      // thickness, so those are one ribbon pushed twice and facing both ways:
      // the material a plan's geometry is drawn with culls backs, so a ribbon
      // that is not pushed twice is a fence with one side missing.
      quad(
        [near.a.top, far.a.top, far.a.bottom, near.a.bottom],
        [near.out, far.out, far.out, near.out],
        color,
      );
      quad(
        [near.b.top, near.b.bottom, far.b.bottom, far.b.top],
        [near.back, near.back, far.back, far.back],
        color,
      );
      if (half > 0)
        sheet(
          [
            paint(near.a.top, near.a.top.u, 0),
            paint(near.b.top, near.b.top.u, across),
            paint(far.b.top, far.b.top.u, across),
            paint(far.a.top, far.a.top.u, 0),
          ],
          UP,
          color,
        );
    }

    if (half > 0) {
      // The ends. A box left open is a wall that is seen through from the end,
      // because the far face of it is facing away.
      const last = columns.length - 1;
      for (const [at, out] of [
        [0, heading(samples[1]!, samples[0]!)] as const,
        [last, heading(samples[last - 1]!, samples[last]!)] as const,
      ]) {
        const c = columns[at]!;
        sheet(
          [
            c.a.top,
            c.a.bottom,
            paint(c.b.bottom, c.b.bottom.u + across, 0),
            paint(c.b.top, c.b.top.u + across, 1),
          ],
          out,
          color,
        );
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  // Measured like every other baked geometry. The count is already known; what
  // this catches is the colour, which came out of the kind table and has met no
  // validator on the way here.
  const problems = validateBaked({ kind: 'site', id: site, budget: { triangles: cap } }, geometry);
  if (problems.length) throw new Error(`scenery library: ${problems.join('; ')}`);
  return geometry;
}

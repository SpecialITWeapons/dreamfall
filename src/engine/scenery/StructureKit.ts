// The structure kit: one building recipe baked into one geometry -- walls, a
// roof, a chimney -- and the two numbers the flight needs in order to miss it.
// A recipe is data (a footprint, a range of floors, a kind of roof, a palette),
// so a village costs a handful of numbers per kind rather than a modelling job.
//
// One bake per kind and per floor count, because whole buildings are instanced:
// a village of a hundred houses is six geometries.
//
// Windows are the part with a future. Every floor gets a band of window colour
// on its walls, and the very same vertices carry `glow` = 1; the night material
// multiplies that by the instance's own `lit` and by the sky's uNight, so a
// village lights up without a second geometry, a second material or a texture.
// The day sees the colour, the night reads the attribute, and it costs four
// bytes a vertex because it is decided here rather than after the bake.
//
// Geometry only, like the tree kit: no material, no TSL, no DOM, so all of it
// runs in Node under a test. The clearance a building claims is measured off
// the baked shape and never off the entry, so a recipe cannot understate how
// much sky it takes.
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
// A recipe that bakes itself is handed the whole of three, as a species is.
import * as THREE from 'three';
import {
  swatchColor,
  validateBaked,
  type SceneryColor,
  type Structure,
  type StructureKit,
} from '../../../library/contract';
import { hash2, mulberry32, sstep } from '../terrain/noise';
import { matrix as composeMatrix, mergeParts, type MergePart } from './TreeKit';

/** A storey, when the recipe does not say, m. */
export const FLOOR_HEIGHT = 2.8;
/** How far a roof rises over half the short side, when the recipe does not say. */
export const ROOF_PITCH = 0.7;
/** How far a roof hangs past its walls, m. */
const EAVE = 0.35;
/** A flat roof is still a slab with an edge to it, m. */
const FLAT_SLAB = 0.3;
/** Where a floor's windows begin and how tall they are, as shares of the storey. */
const SILL = 0.32,
  WINDOW_BAND = 0.42;
/**
 * A window and the wall between two of them, m. The band used to run the whole
 * way round a floor without a break in it, which from the air reads as a stripe
 * painted round the house -- the owner's word for it, and the right one. These
 * two numbers are what turns the stripe into windows: panes of `PANE_WIDTH`
 * every `PANE_PITCH`, laid out so a pier lands in each corner rather than a
 * pane being sliced in half by one.
 */
const PANE_WIDTH = 1.05,
  PANE_PITCH = 2.2;
/** A chimney: how wide it is, and how far it stands over the ridge, m. */
const CHIMNEY = 0.7,
  CHIMNEY_RISE = 0.9;
/** How far off vertical a face may lean and still be a wall: a roof never is one. */
const WALL_NORMAL = 0.35;
/** Metres of slack the obstacle radius keeps around the baked shape, as a tree keeps. */
const CLEARANCE = 1.5;
/** Nothing is cut this close to a plane it already lies on, and nothing this small is kept. */
const EPS = 1e-4;

/** What the pools and the ring get out of a bake. */
export interface BakedStructure {
  /** Walls, roof and chimney in one geometry, with vertex colours and a glow attribute. */
  geometry: BufferGeometry;
  /** The top of the baked shape, m over the ground it stands on. */
  top: number;
  /** What the flight must clear around its centre, m. */
  radius: number;
}

/**
 * The verbs, without the two things that vary per bake. One kit bakes every
 * kind; `bakeStructure` completes it with the spec and the floor count, which
 * is what a recipe's own bake() reads off it.
 */
export type StructureVerbs = Omit<StructureKit, 'spec' | 'floors'>;

/** A geometry the kit made is missing an attribute only if the kit is broken. */
function attributeOf(geometry: BufferGeometry, name: string): BufferAttribute | InterleavedBufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (!attribute) throw new Error(`structure kit: a geometry has no ${name} attribute`);
  return attribute;
}

/**
 * One colour over a whole geometry. The kit's primitives carry their colour
 * this way, and the kit's merge reads it back: mergeParts paints a part with
 * the colour the merge call names, so a recipe that names none would otherwise
 * get white walls out of a box it asked to be painted.
 */
function paint(geometry: BufferGeometry, color: SceneryColor): BufferGeometry {
  const c = new Color(swatchColor(color)),
    count = attributeOf(geometry, 'position').count,
    colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** The colour a primitive was painted, for a merge that names none. */
function paintedColor(geometry: BufferGeometry): Color | undefined {
  const colors = geometry.getAttribute('color');
  if (!colors || colors.count === 0) return undefined;
  // stored in the working space, which is where a Color keeps its channels too
  return new Color().setRGB(colors.getX(0), colors.getY(0), colors.getZ(0));
}

/** A box with vertex colours, centred on its own origin: the only primitive a recipe needs. */
function box(w: number, h: number, d: number, color: SceneryColor): BufferGeometry {
  return paint(new BoxGeometry(w, h, d), color);
}

type Point = [number, number, number];
const tri = (out: number[], a: Point, b: Point, c: Point): void => {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
};
const quad = (out: number[], a: Point, b: Point, c: Point, d: Point): void => {
  tri(out, a, b, c);
  tri(out, a, c, d);
};

/**
 * A roof over a footprint, standing on y = 0 and rising by `rise`. The ridge
 * runs along the longer side -- that is what makes a gable a gable and gives a
 * hip its two trapezoids -- and a hip over a square is a pyramid, built as one.
 * The underside is closed, because the eaves hang past the walls and a hole
 * seen from below is worse than two triangles.
 */
function roof(
  kind: Structure['roof'],
  w: number,
  d: number,
  rise: number,
  color: SceneryColor,
): BufferGeometry {
  if (kind === 'flat') return paint(new BoxGeometry(w, FLAT_SLAB, d).translate(0, FLAT_SLAB / 2, 0), color);
  // Built with the ridge along x and turned at the end, so one set of faces
  // serves a roof either way round.
  const alongX = w >= d,
    long = Math.max(w, d),
    short = Math.min(w, d);
  const hw = long / 2,
    hd = short / 2;
  // a gable's ridge reaches the ends; a hip's stops where the two hips begin
  const ridge = kind === 'gable' ? hw : Math.max(0, (long - short) / 2);
  const a: Point = [-hw, 0, -hd],
    b: Point = [hw, 0, -hd],
    c: Point = [hw, 0, hd],
    e: Point = [-hw, 0, hd];
  const r0: Point = [-ridge, rise, 0],
    r1: Point = [ridge, rise, 0];
  const p: number[] = [];
  if (ridge > EPS) {
    quad(p, a, r0, r1, b);
    quad(p, c, r1, r0, e);
  } else {
    tri(p, a, r0, b);
    tri(p, c, r1, e);
  }
  tri(p, b, r1, c);
  tri(p, a, e, r0);
  quad(p, a, b, c, e);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(p, 3));
  geometry.computeVertexNormals();
  if (!alongX) geometry.rotateY(Math.PI / 2);
  return paint(geometry, color);
}

/** The cross product of a triangle's two edges: its face normal, as long as twice its area. */
function faceCross(t: number[][], x: number): [number, number, number] {
  const a = t[0]!,
    b = t[1]!,
    c = t[2]!;
  const ux = b[x]! - a[x]!,
    uy = b[x + 1]! - a[x + 1]!,
    uz = b[x + 2]! - a[x + 2]!;
  const vx = c[x]! - a[x]!,
    vy = c[x + 1]! - a[x + 1]!,
    vz = c[x + 2]! - a[x + 2]!;
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** A face standing close enough to vertical is a wall; a roof is not one, whatever its pitch. */
function isWall(t: number[][], x: number): boolean {
  const n = faceCross(t, x),
    len = Math.hypot(...n);
  return len > EPS && Math.abs(n[1]) / len <= WALL_NORMAL;
}

/** Every vertex of a triangle as one row, whatever attributes the geometry carries. */
const between = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i]! - v) * t);

/**
 * The part of one triangle between two planes square to an axis, fanned back
 * into triangles. Where `cutAt` splits a triangle in place and hands back all
 * of it, this keeps one slice and throws the rest away -- which is what a band
 * of windows wants, because it is cut into a dozen slices in a row and
 * splitting in place a dozen times over turns two triangles into ninety. On a
 * cottage that was the difference between 1300 triangles and 300.
 */
function slabOf(t: number[][], axis: number, lo: number, hi: number): number[][][] {
  const half = (poly: number[][], level: number, sign: number): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!,
        b = poly[(i + 1) % poly.length]!;
      const da = (a[axis]! - level) * sign,
        db = (b[axis]! - level) * sign;
      if (da >= -EPS) out.push(a);
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) out.push(between(a, b, da / (da - db)));
    }
    return out;
  };
  const poly = half(half(t, lo, 1), hi, -1);
  const out: number[][][] = [];
  for (let i = 1; i + 1 < poly.length; i++)
    out.push([poly[0]!.slice(), poly[i]!.slice(), poly[i + 1]!.slice()]);
  return out;
}

/** Cut every triangle at one horizontal plane, so that no piece of one straddles it. */
function cutAt(pieces: number[][][], level: number, y: number): number[][][] {
  const out: number[][][] = [];
  for (const t of pieces) {
    const s = [t[0]![y]! - level, t[1]![y]! - level, t[2]![y]! - level];
    if (Math.min(...s) >= -EPS || Math.max(...s) <= EPS) {
      out.push(t);
      continue;
    }
    // the plane crosses, so exactly one vertex is alone on its side of it
    const alone = s.findIndex((v, i) => v > 0 !== s[(i + 1) % 3]! > 0 && v > 0 !== s[(i + 2) % 3]! > 0);
    const a = t[alone]!,
      b = t[(alone + 1) % 3]!,
      c = t[(alone + 2) % 3]!;
    const sa = s[alone]!,
      sb = s[(alone + 1) % 3]!,
      sc = s[(alone + 2) % 3]!;
    const ab = between(a, b, sa / (sa - sb)),
      ac = between(a, c, sa / (sa - sc));
    // Every piece gets its own copy of every row: the three of them share four
    // of the five corners, and a shared row would carry the paint of one piece
    // into its neighbour.
    const piece = (p: number[], q: number[], r: number[]): number[][] => [p.slice(), q.slice(), r.slice()];
    out.push(piece(a, ab, ac), piece(ab, b, c), piece(ab, c, ac));
  }
  return out;
}

/**
 * The windows of one floor: the colour the day sees, a glow of 1 on exactly
 * those vertices for the night to read, and a `pane` of its own on each one, so
 * the night can light some windows and leave others dark.
 *
 * The wall arrives as a box, with no vertices where the windows go, so they are
 * cut into it: every wall triangle that meets the band is split at the band's
 * own two heights, and the pieces inside it are split again along the wall's
 * own horizontal axis, at every edge of the pane pattern. That keeps a window
 * an edge on all four sides, and it works on any geometry a recipe hands over,
 * not only on the box this kit builds. The roof is left alone -- only a
 * near-vertical face is a wall.
 *
 * `pane` is a number of that window's own, the same on all its vertices and
 * different from its neighbour's: a hash of which wall it is on, how high, and
 * how far along. It is what lets one house have its kitchen lit and its bedroom
 * dark while the house next door, drawn from the same instanced geometry, has
 * the opposite -- the instance supplies the other half of the draw.
 */
function windows(geometry: BufferGeometry, y: number, height: number, color: SceneryColor): void {
  if (!(height > 0)) return;
  const top = y + height;
  // a recipe may hand over an indexed geometry; the band is cut out of a flat one
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = attributeOf(source, 'position').count;
  if (!source.getAttribute('color')) paint(source, 'white');
  if (!source.getAttribute('glow'))
    source.setAttribute('glow', new Float32BufferAttribute(new Float32Array(count), 1));
  if (!source.getAttribute('pane'))
    source.setAttribute('pane', new Float32BufferAttribute(new Float32Array(count), 1));

  const parts = Object.entries(source.attributes);
  const offsets = new Map<string, number>();
  let stride = 0;
  for (const [name, attribute] of parts) {
    offsets.set(name, stride);
    stride += attribute.itemSize;
  }
  const offsetOf = (name: string): number => {
    const at = offsets.get(name);
    if (at === undefined) throw new Error(`structure kit: a geometry has no ${name} attribute`);
    return at;
  };
  const X = offsetOf('position'),
    Y = X + 1,
    Z = X + 2,
    COLOR = offsetOf('color'),
    GLOW = offsetOf('glow'),
    PANE = offsetOf('pane');

  // Where the panes fall along each of the two horizontal axes. The pattern is
  // laid out inside the building's own extent and centred in it, so both
  // corners keep a pier: a pattern anchored at the origin instead cuts whatever
  // pane the corner happens to land in, and a house with half a window at every
  // corner is worse than a stripe.
  const bounds = (offset: number) => {
    const attribute = attributeOf(source, 'position'),
      k = offset - X;
    let lo = Infinity,
      hi = -Infinity;
    for (let i = 0; i < attribute.count; i++) {
      const v = attribute.getComponent(i, k);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo;
    // How many fit: n panes need n pitches of wall once the pier either side of
    // them is counted, which is what `n * PITCH` already is. Asking for
    // `span - (PITCH - WIDTH)` instead loses the last window on every wall --
    // a 7.7 m gable took two where three fit with a metre of pier to spare.
    const panes = Math.max(1, Math.floor(span / PANE_PITCH));
    const used = panes * PANE_PITCH - (PANE_PITCH - PANE_WIDTH);
    return { start: lo + (span - used) / 2, panes };
  };
  /**
   * The wall, along one axis, as a run of cells: pier, pane, pier, pane, pier.
   * A band triangle is sliced into these and nothing else, so a window has an
   * edge on all four sides and the wall between two of them is wall.
   */
  const cellsOf = (offset: number) => {
    const { start, panes } = bounds(offset);
    const cells: Array<{ lo: number; hi: number; pane: number }> = [];
    for (let i = 0; i < panes; i++) {
      const at = start + i * PANE_PITCH;
      cells.push({ lo: cells.length === 0 ? -Infinity : cells[cells.length - 1]!.hi, hi: at, pane: -1 });
      cells.push({ lo: at, hi: at + PANE_WIDTH, pane: i });
    }
    cells.push({ lo: cells[cells.length - 1]!.hi, hi: Infinity, pane: -1 });
    return cells;
  };
  const along = { [X]: cellsOf(X), [Z]: cellsOf(Z) } as Record<
    number,
    Array<{ lo: number; hi: number; pane: number }>
  >;

  const row = (i: number): number[] => {
    const out: number[] = [];
    for (const [, attribute] of parts)
      for (let k = 0; k < attribute.itemSize; k++) out.push(attribute.getComponent(i, k));
    return out;
  };
  const lit = new Color(swatchColor(color));
  const rows: number[][] = [];
  for (let i = 0; i < count; i += 3) {
    const t = [row(i), row(i + 1), row(i + 2)];
    const low = Math.min(t[0]![Y]!, t[1]![Y]!, t[2]![Y]!),
      high = Math.max(t[0]![Y]!, t[1]![Y]!, t[2]![Y]!);
    if (high <= y + EPS || low >= top - EPS || !isWall(t, X)) {
      rows.push(...t);
      continue;
    }
    for (const band of cutAt(cutAt([t], y, Y), top, Y)) {
      // a cut through a corner leaves a sliver of nothing; it is not kept
      if (Math.hypot(...faceCross(band, X)) <= EPS) continue;
      const middle = (band[0]![Y]! + band[1]![Y]! + band[2]![Y]!) / 3;
      if (!(middle > y && middle < top)) {
        rows.push(...band);
        continue;
      }
      // Which way this wall runs: a face looking along x is a wall whose
      // length is measured in z, and the panes are cut across that length.
      const n = faceCross(band, X);
      const axis = Math.abs(n[0]!) >= Math.abs(n[2]!) ? Z : X;
      const lo = Math.min(band[0]![axis]!, band[1]![axis]!, band[2]![axis]!),
        hi = Math.max(band[0]![axis]!, band[1]![axis]!, band[2]![axis]!);
      const side = n[0]! + n[2]! > 0 ? 1 : 0;
      for (const cell of along[axis]!) {
        if (cell.hi <= lo + EPS || cell.lo >= hi - EPS) continue;
        for (const piece of slabOf(band, axis, cell.lo, cell.hi)) {
          if (Math.hypot(...faceCross(piece, X)) <= EPS) continue;
          if (cell.pane >= 0) {
            // The window's own number: which wall, how high, how far along. Two
            // windows of one house never share it, and a house baked twice gets
            // the same one, because a bake is the same geometry every time.
            const roll =
              hash2(cell.pane * 4 + side * 2 + (axis === Z ? 1 : 0), Math.round(y * 100), 0x7719) /
              4294967296;
            for (const v of piece) {
              v[COLOR] = lit.r;
              v[COLOR + 1] = lit.g;
              v[COLOR + 2] = lit.b;
              v[GLOW] = 1;
              v[PANE] = roll;
            }
          }
          rows.push(...piece);
        }
      }
    }
  }

  let at = 0;
  for (const [name, attribute] of parts) {
    const size = attribute.itemSize,
      array = new Float32Array(rows.length * size);
    for (let i = 0; i < rows.length; i++)
      for (let k = 0; k < size; k++) array[i * size + k] = rows[i]![at + k]!;
    geometry.setAttribute(name, new Float32BufferAttribute(array, size));
    at += size;
  }
  geometry.setIndex(null);
  if (source !== geometry) source.dispose();
}

/**
 * The kit a building recipe is baked through: the prop kit, and the three verbs
 * a wall needs. It holds no state, so one kit bakes every kind.
 */
export function createStructureKit(): StructureVerbs {
  return {
    THREE,
    random: (name) => {
      let h = 5;
      for (const ch of String(name)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
      return mulberry32(hash2(0x9e37, 0, h >>> 0));
    },
    // mergeParts paints a part the colour the call names; a part made by box()
    // or roof() already knows its own, so the call may leave it out.
    merge: (parts) =>
      mergeParts(
        parts.map((part) =>
          part.color === undefined ? { ...part, color: paintedColor(part.geometry) } : part,
        ),
      ),
    matrix: composeMatrix,
    sstep,
    color: (value) => new Color(swatchColor(value)),
    box,
    roof,
    windows,
  };
}

/** The built-in generator: a box of walls, a roof over it, a chimney, a band of windows per floor. */
function buildStructure(spec: Structure, storeys: number, kit: StructureKit): BufferGeometry {
  const floorHeight = spec.floorHeight ?? FLOOR_HEIGHT;
  const w = spec.footprint[0],
    d = spec.footprint[1];
  const wallHeight = storeys * floorHeight;
  const rise = spec.roof === 'flat' ? FLAT_SLAB : (spec.roofPitch ?? ROOF_PITCH) * 0.5 * Math.min(w, d);
  const parts: MergePart[] = [
    { geometry: kit.box(w, wallHeight, d, spec.palette.wall), matrix: kit.matrix(0, wallHeight / 2, 0) },
    {
      geometry: kit.roof(spec.roof, w + 2 * EAVE, d + 2 * EAVE, rise, spec.palette.roof),
      matrix: kit.matrix(0, wallHeight, 0),
    },
  ];
  if (spec.chimney) {
    // on the ridge, a third of the way in from one end, and tall enough to clear it
    const height = rise + CHIMNEY_RISE,
      alongX = w >= d;
    parts.push({
      geometry: kit.box(CHIMNEY, height, CHIMNEY, spec.palette.trim ?? spec.palette.roof),
      matrix: kit.matrix(alongX ? -w * 0.3 : 0, wallHeight + height / 2, alongX ? 0 : -d * 0.3),
    });
  }
  const geometry = kit.merge(parts);
  for (const part of parts) part.geometry.dispose();
  // A recipe with no window colour has no windows: that is how a barn is a barn.
  const pane = spec.palette.window;
  if (pane !== undefined)
    for (let floor = 0; floor < storeys; floor++)
      kit.windows(geometry, (floor + SILL) * floorHeight, WINDOW_BAND * floorHeight, pane);
  return geometry;
}

/**
 * Bake one kind of building at one floor count. A recipe with a bake hook of
 * its own grows its way, exactly as a species does, and is measured and
 * budgeted the same either way.
 */
export function bakeStructure(spec: Structure, floors: number, kit: StructureVerbs): BakedStructure {
  // The floor count comes from a site plan; half a storey would run a window
  // band through a ceiling.
  const storeys = Math.max(1, Math.round(floors));
  const own: StructureKit = { ...kit, spec, floors: storeys };
  const geometry = spec.bake ? spec.bake(own) : buildStructure(spec, storeys, own);
  // Every building carries both attributes, windows or none, because one
  // material reads them for all of them and a barn must not need a program of
  // its own: a node program is keyed on the geometry's attribute set, and a
  // missing one is a warning in the console and a second compile of the
  // material. `glow` alone was not enough once the panes arrived.
  for (const name of ['glow', 'pane'] as const)
    if (!geometry.getAttribute(name))
      geometry.setAttribute(
        name,
        new Float32BufferAttribute(new Float32Array(attributeOf(geometry, 'position').count), 1),
      );
  const problems = validateBaked(spec, geometry);
  if (problems.length > 0) throw new Error(`scenery library:\n${problems.join('\n')}`);

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error(`scenery library: structure ${spec.id}: the baked shape has no bounds`);
  // Measured off the shape, never off the entry, so a recipe cannot understate
  // how much sky it takes; the entry's own obstacle may only ask for more room.
  // The reach is to the corner rather than to the wall, because a building is
  // square and the obstacle the flight reads is a disc.
  const reach = Math.hypot(
    Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
  );
  return {
    geometry,
    top: Math.max(bounds.max.y, spec.obstacle?.height ?? 0),
    radius: Math.max(reach + CLEARANCE, spec.obstacle?.radius ?? 0),
  };
}

// The tree kit: one species baked into a trunk, its limbs and a crown of
// painted cards, plus -- from that same card list -- the sparse crown the
// distance morphs into. A species grows through two verbs, branch() lays wood
// and card() hangs a card, so a generator of its own (cypress) keeps the crown
// morph, the ring shrink and the climate tint without asking for them.
//
// Geometry only, and that is the point: the leaf map arrives as an injected
// factory rather than an import, the materials and the instanced pools live
// elsewhere, and nothing here reads the DOM. The clearance a tree claims is
// measured off the baked shape, never off the entry's own numbers, so a
// generator cannot understate what the flight has to miss.
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Euler,
  Float32BufferAttribute,
  MathUtils,
  Matrix3,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  TubeGeometry,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
  type Texture,
} from 'three';
// The contract hands a species the whole of three, because a species that
// bakes itself builds its own vectors and angles; nothing else here needs it.
import * as THREE from 'three';
import { BUDGET, swatchColor, validateBaked, type Species, type TreeKit } from '../../../library/contract';
import { mulberry32 } from '../terrain/noise';

/** The tube a branch is built from: rings along the curve, sides around it. */
const TUBE_ALONG = 4,
  TUBE_AROUND = 6;
/** Limbs and cone cards spiral by the golden angle, so neither ever stacks on itself. */
const GOLDEN_ANGLE = 2.39996;
/** The card count the distant crown aims for, whatever the near crown hangs. */
const DISTANT_CARDS = 35;
/** Metres of slack the obstacle radius keeps around the baked shape. */
const CLEARANCE = 2;

/** Which painted palette a species hangs; also the memo key of its card map. */
export type LeafForm = NonNullable<Species['leaf']>;

/** One part on its way into a merge: a geometry, where it goes, and what it is painted. */
export interface MergePart {
  geometry: BufferGeometry;
  matrix?: Matrix4;
  color?: Color | number;
  /** Leaf cards only: the card's centre, and whether the distant crown keeps it. */
  card?: { center: Vector3; kept: boolean };
}

/** What the pools and the ring get out of a bake. */
export interface BakedSpecies {
  id: string;
  wood: BufferGeometry;
  crown: BufferGeometry | null;
  distant: BufferGeometry | null;
  leaf: Texture | null;
  /** The top of the baked shape at scale one, m. */
  top: number;
  /** What the flight must clear around the trunk at scale one, m. */
  radius: number;
  tint: { cold: Color; warm: Color; dry: Color };
  /** How many cards the near crown hangs. */
  cards: number;
}

/** What the bake needs from the rest of the engine: the painted card map, and nothing else. */
export interface TreeKitDeps {
  leafTexture(form: LeafForm): Texture;
}

/**
 * How the distant crown is thinned: keep every n-th card and enlarge what is
 * left to cover for the rest. The pools read the scale again to morph the near
 * crown into the far one, so the arithmetic lives here and only here.
 */
export function crownThinning(cards: number): { keepEvery: number; distantScale: number } {
  const keepEvery = Math.max(1, Math.round(cards / DISTANT_CARDS));
  return { keepEvery, distantScale: 1 + 0.85 * ((keepEvery - 1) / 4) };
}

/**
 * Duck-typed rather than instanceof: a card is placed either by three angles or
 * by a full basis, and asking the object which it is survives a second copy of
 * three in the bundle.
 */
const isEuler = (rotation: Euler | Matrix4): rotation is Euler => (rotation as Euler).isEuler === true;

/** A geometry we built ourselves is missing an attribute only if the kit is broken. */
function attributeOf(geometry: BufferGeometry, name: string): BufferAttribute | InterleavedBufferAttribute {
  const attribute = geometry.getAttribute(name);
  if (!attribute) throw new Error(`tree kit: a baked geometry has no ${name} attribute`);
  return attribute;
}

/**
 * One non-indexed geometry out of many parts, with vertex colors. Leaf cards
 * also carry their centre and whether the distant crown keeps them, packed
 * into a single attribute: WebGPU allows only eight vertex buffers.
 *
 * The props bake through this too, so it is exported and knows nothing about trees.
 */
export function mergeParts(parts: MergePart[]): BufferGeometry {
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    uvs: number[] = [],
    cards: number[] = [];
  const normalMatrix = new Matrix3(),
    vertex = new Vector3(),
    normal = new Vector3();
  for (const part of parts) {
    const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const position = attributeOf(geometry, 'position'),
      source = attributeOf(geometry, 'normal'),
      uv = geometry.getAttribute('uv');
    const matrix = part.matrix ?? new Matrix4();
    normalMatrix.getNormalMatrix(matrix);
    const color = part.color !== undefined ? new Color(part.color) : new Color(0xffffff);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions.push(vertex.x, vertex.y, vertex.z);
      normal.fromBufferAttribute(source, i).applyMatrix3(normalMatrix).normalize();
      normals.push(normal.x, normal.y, normal.z);
      colors.push(color.r, color.g, color.b);
      uvs.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
      if (part.card)
        cards.push(part.card.center.x, part.card.center.y, part.card.center.z, part.card.kept ? 1 : 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (cards.length) geometry.setAttribute('card', new Float32BufferAttribute(cards, 4));
  return geometry;
}

/** Position, scale and Euler rotation in one matrix; the prop and tree kits both place with it. */
export function matrix(
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  rx = 0,
  ry = 0,
  rz = 0,
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

/** A card waiting to become two triangles: where it hangs, which way it faces, how wide. */
interface Card {
  p: Vector3;
  normal: Vector3;
  size: number;
  matrix: Matrix4;
}

/**
 * Bake one species: a trunk, its limbs, a crown of painted cards, and the kept
 * cards enlarged for the distance. Whole trees are instanced, so this runs once
 * per species and never again.
 */
export function bakeSpecies(species: Species, deps: TreeKitDeps): BakedSpecies {
  const id = species.id;
  const random = mulberry32(9702 + [...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7));
  const woodParts: MergePart[] = [],
    crownParts: MergePart[] = [],
    distantParts: MergePart[] = [];
  const cards: Card[] = [];

  // A limb, a trunk, a twig: one tapered tube along a curve that bows out of
  // the straight line, so nothing in the tree is a cylinder.
  const branch = (a: Vector3, b: Vector3, r1: number, r2: number): CatmullRomCurve3 => {
    const length = a.distanceTo(b),
      curve = new CatmullRomCurve3([
        a,
        a
          .clone()
          .lerp(b, 0.3)
          .add(new Vector3(-r1 * 0.3, length * 0.13, r1 * 0.4)),
        a.clone().lerp(b, 0.72),
        b,
      ]);
    const tube = new TubeGeometry(curve, TUBE_ALONG, 1, TUBE_AROUND, false);
    const position = attributeOf(tube, 'position'),
      uv = attributeOf(tube, 'uv');
    // TubeGeometry is built at radius one: push each ring out to the radius the
    // branch has there, so one tube tapers from root to tip.
    for (let i = 0; i <= TUBE_ALONG; i++) {
      const t = i / TUBE_ALONG,
        center = curve.getPointAt(t),
        radius = MathUtils.lerp(r1, r2, t);
      for (let j = 0; j <= TUBE_AROUND; j++) {
        const k = i * (TUBE_AROUND + 1) + j;
        position.setXYZ(
          k,
          center.x + (position.getX(k) - center.x) * radius,
          center.y + (position.getY(k) - center.y) * radius,
          center.z + (position.getZ(k) - center.z) * radius,
        );
        // the bark repeats every third of the way around and every six metres up
        uv.setXY(k, j / 3, (t * length) / 6);
      }
    }
    tube.computeVertexNormals();
    woodParts.push({ geometry: tube });
    return curve;
  };

  const card: TreeKit['card'] = (p, normal, rotation, size) => {
    cards.push({
      p,
      normal,
      size,
      matrix: isEuler(rotation)
        ? matrix(p.x, p.y, p.z, 1, 1, 1, rotation.x, rotation.y, rotation.z)
        : rotation,
    });
  };

  // The built-in generator: the four crown shapes over one leaning trunk.
  const growTree = (): void => {
    const T = species.trunk;
    if (!T) throw new Error(`scenery library: species ${id}: needs a trunk or a bake hook`);
    // A crown carries only the fields its shape reads, and a bare one carries
    // none, so the numbers are taken once with the zeros a bare crown implies.
    const K = species.crown ?? { shape: 'bare' as const },
      crownCards = K.cards ?? 0,
      crownSize = K.size ?? 0,
      crownRadius = K.radius ?? 0,
      crownHeight = K.height ?? 0,
      crownFrom = K.from ?? 0;
    const limbCount = species.limbs?.count ?? 0,
      limbSpread = species.limbs?.spread ?? 0,
      limbRise = species.limbs?.rise ?? 0,
      limbFrom = species.limbs?.from ?? 0.5;
    const trunk = branch(
      new Vector3(0, -1, 0),
      new Vector3(T.lean, T.height, -T.lean * 0.25),
      T.radius,
      T.radius * (K.shape === 'cone' ? 0.12 : 0.33),
    );
    // limbs leave the trunk in a spiral; dome crowns hang a cloud of cards on each tip
    for (let j = 0; j < limbCount; j++) {
      const a = j * GOLDEN_ANGLE + random() * 0.4,
        radius = limbSpread * (0.85 + random() * 0.3);
      const tip = new Vector3(Math.cos(a) * radius, limbRise * (0.9 + random() * 0.25), Math.sin(a) * radius);
      branch(trunk.getPointAt(Math.min(0.95, limbFrom + j * 0.08)), tip, T.radius * 0.33, T.radius * 0.095);
      if (K.shape !== 'dome') continue;
      for (let k = 0; k < crownCards; k++) {
        // an even scatter through the ellipsoid, pulled outward by the 0.35 power
        const u = random() * Math.PI * 2,
          v = Math.acos(2 * random() - 1),
          rr = Math.pow(random(), 0.35);
        const p = new Vector3(
          tip.x + Math.cos(u) * Math.sin(v) * rr * crownRadius,
          tip.y + Math.cos(v) * rr * crownHeight,
          tip.z + Math.sin(u) * Math.sin(v) * rr * crownRadius,
        );
        card(
          p,
          new Vector3(
            (p.x - tip.x) / crownRadius,
            (p.y - tip.y) / crownHeight + 0.35,
            (p.z - tip.z) / crownRadius,
          ).normalize(),
          new Euler((random() - 0.5) * 2.1, random() * Math.PI * 2, (random() - 0.5) * 0.7),
          crownSize + random() * crownSize * 0.5,
        );
      }
    }
    if (K.shape === 'cone') {
      // cards along the trunk in a cone that narrows toward the top
      for (let k = 0; k < crownCards; k++) {
        const t = crownFrom + (1 - crownFrom) * Math.pow(k / crownCards, 0.85),
          a = k * GOLDEN_ANGLE,
          width = crownRadius * Math.pow(1 - t, 0.75) * (0.55 + random() * 0.55);
        const center = trunk.getPointAt(Math.min(1, t)),
          p = new Vector3(
            center.x + Math.cos(a) * width,
            center.y + (random() - 0.3) * 0.8,
            center.z + Math.sin(a) * width,
          );
        card(
          p,
          new Vector3(Math.cos(a), 0.55, Math.sin(a)).normalize(),
          new Euler(
            -0.5 + (random() - 0.5) * 0.9,
            -a + Math.PI / 2 + (random() - 0.5) * 0.5,
            (random() - 0.5) * 0.4,
          ),
          crownSize * (0.7 + 0.45 * (1 - t)) + random() * 0.6,
        );
      }
    } else if (K.shape === 'fan') {
      // a ring of fronds from the top of the trunk, each painted from the
      // card's foot upward, so the card's own up axis is laid along the frond:
      // outward, drooping, its face turned to the sky
      const top = trunk.getPointAt(1);
      for (let k = 0; k < crownCards; k++) {
        const a = (k / crownCards) * Math.PI * 2 + random() * 0.3,
          droop = 0.15 + random() * 0.55,
          size = crownSize * (0.85 + random() * 0.3);
        const out = new Vector3(Math.cos(a), 0, Math.sin(a)),
          right = new Vector3(-Math.sin(a), 0, Math.cos(a)),
          frond = out.clone().multiplyScalar(Math.cos(droop)).setY(-Math.sin(droop)),
          face = new Vector3().crossVectors(frond, right).normalize();
        if (face.y < 0) face.negate();
        const p = top
          .clone()
          .addScaledVector(frond, size * 0.5 - 0.4)
          .add(new Vector3(0, crownHeight * 0.3, 0));
        card(p, face, new Matrix4().makeBasis(right, frond, face).setPosition(p), size);
      }
    }
  };

  if (species.bake) species.bake({ THREE, random, branch, card, matrix, spec: species });
  else growTree();

  if (cards.length > BUDGET.crownCards)
    throw new Error(
      `scenery library: species ${id}: ${cards.length} cards, the crown budget is ${BUDGET.crownCards}`,
    );
  const { keepEvery, distantScale } = crownThinning(cards.length);
  for (const [k, c] of cards.entries()) {
    const kept = k % keepEvery === 0;
    // the enlarged twin sits on the same matrix, so it grows around its own centre
    const plane = (factor: number): BufferGeometry => {
      const g = new PlaneGeometry(c.size * factor, c.size * factor);
      g.applyMatrix4(c.matrix);
      const normals = attributeOf(g, 'normal');
      for (let i = 0; i < normals.count; i++) normals.setXYZ(i, c.normal.x, c.normal.y, c.normal.z);
      return g;
    };
    crownParts.push({ geometry: plane(1), card: { center: c.p, kept } });
    if (kept) distantParts.push({ geometry: plane(distantScale) });
  }

  // Every baked geometry is measured, wood and both crowns: this is what counts
  // the triangles and judges the vertex colors against the palette envelope.
  // The attributes are handed over one by one because the validator asks for a
  // shape a BufferGeometry's open attribute record does not satisfy.
  const checked = (geometry: BufferGeometry): BufferGeometry => {
    const problems = validateBaked(species, {
      index: geometry.index,
      attributes: {
        position: attributeOf(geometry, 'position'),
        color: geometry.getAttribute('color'),
      },
    });
    if (problems.length) throw new Error(`scenery library: ${problems.join('; ')}`);
    return geometry;
  };
  const wood = checked(mergeParts(woodParts)),
    crown = cards.length ? checked(mergeParts(crownParts)) : null,
    distant = cards.length ? checked(mergeParts(distantParts)) : null;
  for (const part of [...woodParts, ...crownParts, ...distantParts]) part.geometry.dispose();

  // Clearance from the baked shape itself, so any generator is honest.
  const shape = crown ?? wood;
  shape.computeBoundingBox();
  const box = shape.boundingBox;
  if (!box) throw new Error(`scenery library: species ${id}: the baked shape has no bounds`);
  return {
    id,
    wood,
    crown,
    distant,
    leaf: cards.length ? deps.leafTexture(species.leaf ?? 'broad') : null,
    top: box.max.y,
    radius:
      Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) +
      CLEARANCE,
    tint: {
      cold: new Color(swatchColor(species.tint.cold)),
      warm: new Color(swatchColor(species.tint.warm)),
      dry: new Color(swatchColor(species.tint.dry)),
    },
    cards: cards.length,
  };
}

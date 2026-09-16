// The grass of the near ground: a window of tufts around the flyer, written as
// 64 m tiles and rewritten whenever it crosses a 32 m cell. Ported from
// fly-with-me's placeGrass. The window is not streamed like the ring -- it is
// thrown away and written again, because at twenty thousand tufts that is
// cheaper than remembering which tile held which instance.
//
// A tuft is three painted cards crossed about its own axis, and there are four
// baked forms of it an instance takes one of. One card is a line seen from
// above and disappears along its own plane, which is what a meadow of them
// reads as; three crossed cards read as a clump from wherever they are seen,
// and four forms mean a meadow is not one clump repeated. A form is an
// instanced mesh of its own, so what is handed back is the group of them.
//
// Nothing here paints: the blade texture and the material are Painted.ts's,
// and the group is handed back rather than added to a scene, so the aggregate
// that owns the scene graph owns this one too.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { positionWorld } from 'three/tsl';
import { swatchColor, type Library } from '../../../library/contract';
import { resolvePopulate } from '../../../library/standard/index.js';
import type { SkyUniforms } from '../sky/SkyUniforms';
import type { Origin } from '../sim/Origin';
import type { Heightfield } from '../terrain/Heightfield';
import { hash2, mulberry32 } from '../terrain/noise';
import { CELL, SLOTS } from '../terrain/WorldSampler';
import type { GroundShade } from './GroundShade';
import type { SceneryMaterials } from './Painted';

/**
 * How far the flyer moves before the window is written again, m. The original
 * rebuilt on its 16 m terrain cell; measured at 7 ms a rebuild (docs/perf-notes),
 * that is a hitch twice a second on a low pass, and the window reaches 260 m
 * with the blades faded out by 190, so nobody can see it lag half a cell.
 */
const STEP = CELL * 2;
/** The side of one placement tile, m. */
const TILE = 64;
/** Tiles either side of the flyer's own, so eleven by eleven of them. */
const SPAN = 5;
/** A tile whose centre is further than this from the flyer is not written, m. */
const REACH = 260;
/** Attempts per tile; each survives with the tile's own thickness. */
const ROLLS = 256;
/** Baked tuft forms, and the tufts of one form its own mesh may hold. */
export const FORMS = 4;
export const PER_FORM = 5000;
/**
 * Tufts the window may hold at once. The forms share it in equal parts, which
 * is what lets a full form hand a tuft on to one with room instead of dropping
 * it: below this ceiling at least one of them always has room.
 */
export const TUFTS = FORMS * PER_FORM;
/**
 * Cards to a tuft. Three is the fewest that reads as a clump rather than as a
 * streak: spread over half a turn, a form seen from its thinnest side still
 * shows three fifths of what it shows from its widest, where the one card this
 * replaces showed nothing at all along its own plane.
 */
export const CARDS = 3;
/**
 * One card, in the nominal tuft the scale below is measured in: a tuft stands 1
 * tall and about 1 across. The tallest card carries the full height and the
 * others fall back to CARD_LOW; a card is wider at the tip than at the root
 * (CARD_SPLAY) and leans out of its own plane (CARD_LEAN), so the painted
 * blades splay the way a tuft does instead of standing in a wall. CARD_OFF
 * lifts the roots off the axis and CARD_JITTER strays a card from its even
 * share of the turn, because evenly spread cards read as a star from above.
 */
const CARD_WIDTH = 0.55,
  CARD_WIDTH_SPAN = 0.3,
  CARD_LOW = 0.58,
  CARD_SPLAY = 0.3,
  CARD_LEAN = 0.16,
  CARD_OFF = 0.09,
  CARD_JITTER = 0.55;
/**
 * How wide the painted square is, in nominal tuft widths -- which is the width
 * of the one card it used to be stretched over. A card takes a slice of it as
 * wide as the card itself, so however narrow the card is a blade keeps the
 * shape it was painted in, and the cards of one tuft take their slices from
 * different places, so a clump never shows the same blades twice.
 */
const PAINTED_SPAN = 2.6;
/** The forms are baked off their own stream: the same four in every world. */
const FORM_SALT = 0x7c1f5;
/**
 * How tall a tuft stands, m: the nominal tuft scaled by this. The flight never
 * comes nearer than MIN_CLEARANCE (25 m), where grass under a metre is a stain
 * on the ground rather than grass; the wide span is what keeps a meadow from
 * reading as a crop, which is what one height would make of it.
 */
const TUFT_SCALE = 0.85,
  TUFT_SCALE_SPAN = 1.1;
/**
 * How far across a tuft may be squashed, as a fraction of itself. One axis
 * gives what the other takes, so the ground a tuft covers does not change with
 * it and no two tufts of a form are round the same way.
 */
const TUFT_SQUASH = 0.26;
/** Ground a tuft refuses: the shore below it, the peaks above it, and anything steep. */
const MIN_GROUND = 2,
  MAX_GROUND = 480,
  MAX_SLOPE = 0.65;
/** Height over the ground past which there is no grass at all, m. */
const CEILING = 250;
/** This window's own salt: it shares its stream with nothing the ring sows. */
const GRASS_SALT = 0x6a455;

/** One baked form, as the plain numbers a geometry is made of. */
export interface TuftForm {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array;
}

/**
 * Bakes one form: CARDS cards on one root, each with its own turn, height,
 * width, splay, lean and slice of the painted square. The cards are spread over
 * half a turn and not a whole one, because a card is painted on both faces and
 * half a turn already covers every direction one can face.
 *
 * Plain arrays rather than a geometry, so what the forms are is read in Node.
 * The uv keeps v at 0 on the root and 1 at the tip: the material mixes the
 * shade of the trees out along it, because a shadow lies on the ground and not
 * on what grows out of it.
 */
export function tuftForm(form: number): TuftForm {
  const r = mulberry32(hash2(form, 0, FORM_SALT));
  const position = new Float32Array(CARDS * 4 * 3),
    normal = new Float32Array(CARDS * 4 * 3),
    uv = new Float32Array(CARDS * 4 * 2),
    index = new Uint16Array(CARDS * 6);
  let at = 0;
  const put = (x: number, y: number, z: number, u: number, v: number, outX: number, outZ: number) => {
    position.set([x, y, z], at * 3);
    // The lit material answers by a normal of its own (the ground's, straight
    // up); this one is here because the geometry has a face and a card that
    // carries no normals is a different program from one that does.
    normal.set([outX, 0, outZ], at * 3);
    uv.set([u, v], at * 2);
    at++;
  };
  for (let c = 0; c < CARDS; c++) {
    const turn = ((c + (r() - 0.5) * CARD_JITTER) / CARDS) * Math.PI;
    // The first card is the whole of the tuft's height, so the scale is in
    // metres of the tallest blade and not of an average nobody can see.
    const height = c === 0 ? 1 : CARD_LOW + r() * (1 - CARD_LOW),
      width = CARD_WIDTH + (r() - 0.5) * CARD_WIDTH_SPAN,
      splay = r() * CARD_SPLAY,
      lean = (r() - 0.5) * 2 * CARD_LEAN,
      off = (r() - 0.5) * 2 * CARD_OFF,
      slice = width / PAINTED_SPAN,
      u0 = r() * (1 - slice);
    // Along the card's face, and out of it: the root stands off the axis by the
    // second and the tip leans by it as well.
    const alongX = Math.cos(turn),
      alongZ = -Math.sin(turn),
      outX = Math.sin(turn),
      outZ = Math.cos(turn);
    const root = width / 2,
      tip = root * (1 + splay),
      rootX = outX * off,
      rootZ = outZ * off,
      tipX = rootX + outX * lean * height,
      tipZ = rootZ + outZ * lean * height;
    const base = at;
    put(rootX - alongX * root, 0, rootZ - alongZ * root, u0, 0, outX, outZ);
    put(rootX + alongX * root, 0, rootZ + alongZ * root, u0 + slice, 0, outX, outZ);
    put(tipX - alongX * tip, height, tipZ - alongZ * tip, u0, 1, outX, outZ);
    put(tipX + alongX * tip, height, tipZ + alongZ * tip, u0 + slice, 1, outX, outZ);
    index.set([base, base + 1, base + 2, base + 2, base + 1, base + 3], c * 6);
  }
  return { position, normal, uv, index };
}

export interface Grass {
  /**
   * What the caller adds to the scene, because the scene is not this module's:
   * one instanced mesh per baked form, in a group.
   */
  readonly mesh: Group;
  /**
   * Places the window around (x, z) in world metres. Rebuilds when the 32 m
   * cell changed or when forced -- an origin jump -- and does nothing at all
   * while the flyer is too high to see a blade.
   */
  update(x: number, z: number, cameraY: number, origin: Origin, forced: boolean): void;
  /** Tufts standing after the last rebuild, over all the forms. */
  readonly count: number;
  /** Milliseconds the last rebuild took. */
  readonly ms: number;
  dispose(): void;
}

export interface GrassDeps {
  seed: number;
  library: Library;
  heightfield: Heightfield;
  materials: SceneryMaterials;
  shade: GroundShade;
  uniforms: SkyUniforms;
}

export function createGrass(deps: GrassDeps): Grass {
  const { seed, library, heightfield, materials, shade, uniforms } = deps;
  const salt = (seed ^ GRASS_SALT) >>> 0;

  // The shade under the trees is anchored in the world, so it is read at the
  // world position of the tuft -- the scene's own coordinates plus the origin
  // -- exactly as the ground reads it. One material for all four forms: they
  // differ in their vertices and in nothing a shader can see.
  const material = materials.grass(shade.aoNode(positionWorld.xz.add(uniforms.uWorldOrigin)));

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0),
    foot = new Vector3(),
    size = new Vector3();
  const tint = new Color();
  const slotIds = new Uint8Array(4);
  const slotWeights = new Float32Array(4);

  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const meshes: InstancedMesh[] = [];
  for (let f = 0; f < FORMS; f++) {
    const form = tuftForm(f);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(form.position, 3));
    geometry.setAttribute('normal', new BufferAttribute(form.normal, 3));
    geometry.setAttribute('uv', new BufferAttribute(form.uv, 2));
    geometry.setIndex(new BufferAttribute(form.index, 1));
    const mesh = new InstancedMesh(geometry, material, PER_FORM);
    mesh.count = 0;
    // The window is a disc the flyer stands in the middle of, and its bounding
    // sphere is never recomputed; culling by it would drop the whole window.
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // A node program is built once per object, and the first rebuild may be
    // many minutes away -- a flight that begins at altitude never enters it. So
    // the instance colors exist from the start (setColorAt fills them white) on
    // every form, or a form would compile without them and its tint would never
    // arrive.
    mesh.setColorAt(0, tint.setRGB(1, 1, 1));
    group.add(mesh);
    geometries.push(geometry);
    meshes.push(mesh);
  }

  // What each biome contributes to a tile, resolved once. A biome whose
  // populate is a hook in code carries no grass data and adds nothing: that is
  // an absence, not a default (contract: ScatterSpec).
  const sown = library.biomes.map((biome) => {
    const grass = biome.populate ? resolvePopulate(biome.populate).scatter?.grass : undefined;
    return grass ? { density: grass.density, color: new Color(swatchColor(grass.tint)) } : null;
  });

  const standing = new Int32Array(FORMS);
  let count = 0,
    ms = 0;

  const rebuild = (x: number, z: number, origin: Origin) => {
    const started = performance.now();
    const cx = Math.floor(x / TILE),
      cz = Math.floor(z / TILE);
    standing.fill(0);
    let placed = 0;
    for (let tz = cz - SPAN; tz <= cz + SPAN; tz++)
      for (let tx = cx - SPAN; tx <= cx + SPAN; tx++) {
        const midX = (tx + 0.5) * TILE,
          midZ = (tz + 0.5) * TILE;
        if (Math.hypot(midX - x, midZ - z) > REACH) continue;
        // Thickness and tint belong to the tile, not the tuft: one weight read
        // per 64 m rather than one per attempt, and the border between two
        // biomes is a tile wide, which at this distance nobody reads as a line.
        heightfield.weightsAt(midX, midZ, slotIds, slotWeights);
        let thickness = 0;
        tint.setRGB(0, 0, 0);
        for (let s = 0; s < SLOTS; s++) {
          const weight = slotWeights[s]!,
            grass = sown[slotIds[s]!];
          if (weight <= 0 || !grass) continue;
          thickness += weight * grass.density;
          tint.r += weight * grass.color.r;
          tint.g += weight * grass.color.g;
          tint.b += weight * grass.color.b;
        }
        const roll = mulberry32(hash2(tx, tz, salt));
        for (let i = 0; i < ROLLS && placed < TUFTS; i++) {
          // Every attempt draws its six numbers before anything is tested, so
          // a tile looks the same however thick its neighbours turned out. The
          // sixth is two numbers in one: a whole form to take, and what is left
          // of it to squash that form by. Fifty-two tiles are within REACH and
          // each is 256 attempts, so at 2.5 ns a roll the sixth costs 0.03 ms
          // of a rebuild that measures 6.9 (docs/perf-notes).
          const px = (tx + roll()) * TILE,
            pz = (tz + roll()) * TILE,
            scale = TUFT_SCALE + roll() * TUFT_SCALE_SPAN,
            // A whole turn, where a single card only ever needed half of one:
            // a tuft has no face to be symmetric about.
            yaw = roll() * Math.PI * 2,
            pick = roll() * FORMS,
            keep = roll() < thickness;
          // The original measured the ground before this test; the ground does
          // not answer differently for being asked later, and most attempts
          // die here.
          if (!keep) continue;
          const h = heightfield.heightAt(px, pz);
          if (h < MIN_GROUND || h > MAX_GROUND || heightfield.slopeAt(px, pz) > MAX_SLOPE) continue;
          const squash = 1 - TUFT_SQUASH + (pick % 1) * TUFT_SQUASH * 2;
          // The forms come up equally often and hold equal shares, so a full
          // one is the ceiling arriving and not a form out of favour; the tuft
          // goes to whoever still has room.
          let f = pick | 0;
          while (standing[f]! === PER_FORM) f = (f + 1) % FORMS;
          rotation.setFromAxisAngle(up, yaw);
          // The sampling above is the world's, in double precision, and the
          // matrix is the scene's: the same point, written through Origin. This
          // is why an origin jump has to force a rebuild -- the matrices are
          // relative to an origin that is 4 km away by then, and a flight
          // covers that in under two minutes.
          matrix.compose(
            foot.set(origin.localX(px), h, origin.localZ(pz)),
            rotation,
            size.set(scale * squash, scale, scale / squash),
          );
          const mesh = meshes[f]!,
            at = standing[f]!++;
          mesh.setMatrixAt(at, matrix);
          mesh.setColorAt(at, tint);
          placed++;
        }
      }
    for (let f = 0; f < FORMS; f++) {
      const mesh = meshes[f]!;
      mesh.count = standing[f]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    count = placed;
    ms = performance.now() - started;
  };

  let atX = NaN,
    atZ = NaN,
    jumped = false;
  return {
    mesh: group,
    update(x, z, cameraY, origin, forced) {
      // An origin jump under a hidden window invalidates its matrices just the
      // same, so it is remembered until there is something to rebuild.
      if (forced) jumped = true;
      const visible = cameraY - heightfield.heightAt(x, z) < CEILING;
      group.visible = visible;
      // From any normal altitude the whole window costs that one height read:
      // the material has faded the last blade out long before this.
      if (!visible) return;
      const ix = Math.floor(x / STEP),
        iz = Math.floor(z / STEP);
      if (!jumped && ix === atX && iz === atZ) return;
      jumped = false;
      atX = ix;
      atZ = iz;
      rebuild(x, z, origin);
    },
    get count() {
      return count;
    },
    get ms() {
      return ms;
    },
    dispose() {
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}

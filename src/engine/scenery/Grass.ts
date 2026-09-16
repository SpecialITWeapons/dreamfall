// The grass of the near ground: one instanced mesh of blades, rewritten as a
// window of 64 m tiles around the flyer whenever it crosses a 16 m cell.
// Ported from fly-with-me's placeGrass. The window is not streamed like the
// ring -- it is thrown away and written again, because at 20 000 blades that
// is cheaper than remembering which tile held which instance.
//
// Nothing here paints: the blade texture and the material are Painted.ts's,
// and the mesh is handed back rather than added to a scene, so the aggregate
// that owns the scene graph owns this one too.
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
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

/** The side of one placement tile, m. */
const TILE = 64;
/** Tiles either side of the flyer's own, so eleven by eleven of them. */
const SPAN = 5;
/** A tile whose centre is further than this from the flyer is not written, m. */
const REACH = 260;
/** Attempts per tile; each survives with the tile's own thickness. */
const ROLLS = 256;
/** Blades the window may hold at once. */
const BLADES = 20000;
/** One blade: a card wider than it is tall, standing on its root. */
const BLADE_WIDTH = 2.6,
  BLADE_HEIGHT = 1;
const BLADE_SCALE = 0.55,
  BLADE_SCALE_SPAN = 0.8;
/** Ground a blade refuses: the shore below it, the peaks above it, and anything steep. */
const MIN_GROUND = 2,
  MAX_GROUND = 480,
  MAX_SLOPE = 0.65;
/** Height over the ground past which there is no grass at all, m. */
const CEILING = 250;
/** This window's own salt: it shares its stream with nothing the ring sows. */
const GRASS_SALT = 0x6a455;

export interface Grass {
  /** The mesh; the caller adds it to the scene, because the scene is not this module's. */
  readonly mesh: InstancedMesh;
  /**
   * Places the window around (x, z) in world metres. Rebuilds when the 16 m
   * cell changed or when forced -- an origin jump -- and does nothing at all
   * while the flyer is too high to see a blade.
   */
  update(x: number, z: number, cameraY: number, origin: Origin, forced: boolean): void;
  /** Blades standing after the last rebuild. */
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

  const geometry = new PlaneGeometry(BLADE_WIDTH, BLADE_HEIGHT);
  // Raised by half its height, so an instance matrix places the foot of the
  // blade and not its middle: the placement knows the ground, not the tip.
  geometry.translate(0, BLADE_HEIGHT / 2, 0);
  // The shade under the trees is anchored in the world, so it is read at the
  // world position of the blade -- the scene's own coordinates plus the origin
  // -- exactly as the ground reads it.
  const material = materials.grass(shade.aoNode(positionWorld.xz.add(uniforms.uWorldOrigin)));
  const mesh = new InstancedMesh(geometry, material, BLADES);
  mesh.count = 0;
  // The window is a disc the flyer stands in the middle of, and its bounding
  // sphere is never recomputed; culling by it would drop the whole window.
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const up = new Vector3(0, 1, 0),
    foot = new Vector3(),
    size = new Vector3();
  const tint = new Color();
  const slotIds = new Uint8Array(4);
  const slotWeights = new Float32Array(4);

  // A node program is built once per object, and the first rebuild may be many
  // minutes away -- a flight that begins at altitude never enters it. So the
  // instance colors exist from the start (setColorAt fills them white), or the
  // material would compile without them and the tint would never arrive.
  mesh.setColorAt(0, tint.setRGB(1, 1, 1));

  // What each biome contributes to a tile, resolved once. A biome whose
  // populate is a hook in code carries no grass data and adds nothing: that is
  // an absence, not a default (contract: ScatterSpec).
  const sown = library.biomes.map((biome) => {
    const grass = biome.populate ? resolvePopulate(biome.populate).scatter?.grass : undefined;
    return grass ? { density: grass.density, color: new Color(swatchColor(grass.tint)) } : null;
  });

  let count = 0,
    ms = 0;

  const rebuild = (x: number, z: number, origin: Origin) => {
    const started = performance.now();
    const cx = Math.floor(x / TILE),
      cz = Math.floor(z / TILE);
    let placed = 0;
    for (let tz = cz - SPAN; tz <= cz + SPAN; tz++)
      for (let tx = cx - SPAN; tx <= cx + SPAN; tx++) {
        const midX = (tx + 0.5) * TILE,
          midZ = (tz + 0.5) * TILE;
        if (Math.hypot(midX - x, midZ - z) > REACH) continue;
        // Thickness and tint belong to the tile, not the blade: one weight read
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
        for (let i = 0; i < ROLLS && placed < BLADES; i++) {
          // Every attempt draws its five numbers before anything is tested, so
          // a tile looks the same however thick its neighbours turned out.
          const px = (tx + roll()) * TILE,
            pz = (tz + roll()) * TILE,
            scale = BLADE_SCALE + roll() * BLADE_SCALE_SPAN,
            yaw = roll() * Math.PI,
            keep = roll() < thickness;
          // The original measured the ground before this test; the ground does
          // not answer differently for being asked later, and most attempts
          // die here.
          if (!keep) continue;
          const h = heightfield.heightAt(px, pz);
          if (h < MIN_GROUND || h > MAX_GROUND || heightfield.slopeAt(px, pz) > MAX_SLOPE) continue;
          rotation.setFromAxisAngle(up, yaw);
          // The sampling above is the world's, in double precision, and the
          // matrix is the scene's: the same point, written through Origin. This
          // is why an origin jump has to force a rebuild -- the matrices are
          // relative to an origin that is 4 km away by then, and a flight
          // covers that in under two minutes.
          matrix.compose(foot.set(origin.localX(px), h, origin.localZ(pz)), rotation, size.setScalar(scale));
          mesh.setMatrixAt(placed, matrix);
          mesh.setColorAt(placed++, tint);
        }
      }
    mesh.count = count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    ms = performance.now() - started;
  };

  let atX = NaN,
    atZ = NaN,
    jumped = false;
  return {
    mesh,
    update(x, z, cameraY, origin, forced) {
      // An origin jump under a hidden window invalidates its matrices just the
      // same, so it is remembered until there is something to rebuild.
      if (forced) jumped = true;
      const visible = cameraY - heightfield.heightAt(x, z) < CEILING;
      mesh.visible = visible;
      // From any normal altitude the whole window costs that one height read:
      // the material has faded the last blade out long before this.
      if (!visible) return;
      const ix = Math.floor(x / CELL),
        iz = Math.floor(z / CELL);
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
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

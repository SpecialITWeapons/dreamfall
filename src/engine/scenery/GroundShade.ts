// The shade under the trees: one bounded sheet of ambient occlusion, painted
// on a canvas out of the tree records the ring has just placed, and read by
// the ground as its AO map. The sun's shadow map only reaches the near field,
// so without this the far half of the forest floats a metre above its own
// ground. Repainted once per ring rebuild, never per frame.
// Ported from fly-with-me's updateGroundAO.
import { CanvasTexture, Vector2 } from 'three';
import type { Node } from 'three/webgpu';
import { Fn, abs, max, mix, smoothstep, texture, uniform } from 'three/tsl';

/** The side of the square of world the sheet covers, m. */
export const AO_SPAN = 4096;
/** The sheet itself, texels per side. */
const AO_SIZE = 512;
/** How much of a tree's own radius its shade covers. */
const SHADE_RADIUS = 0.6;

/** What the sheet asks of a record: where it stands and how wide it is, in the world. */
export interface ShadeRecord {
  x: number;
  z: number;
  radius: number;
}

export function createGroundShade() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = AO_SIZE;
  const context = canvas.getContext('2d');
  // The sheet is the ground's AO map; a terrain without it would light wrong
  // and say nothing, so this fails loud like the rest of the engine.
  if (!context) throw new Error('ground shade: the canvas has no 2d context');
  const map = new CanvasTexture(canvas);
  // The sheet is painted in world order, so it must upload unflipped: a
  // flipped upload mirrors every shade in z, and the mirrored shades then
  // jump two cells whenever the sheet re-centers.
  map.flipY = false;
  /** Where the middle of the sheet stands in the world. */
  const uOrigin = uniform(new Vector2(0, 0));
  return {
    map,
    // The uv is measured from worldXZ -- positionWorld.xz plus uWorldOrigin --
    // and not from the scene's own coordinates, because the sheet is anchored
    // in the world and the scene is not: Origin jumps a whole 4 km of cells
    // under a flight that never stops, and a sheet read in scene coordinates
    // would slide that whole distance sideways at the jump, leaving every
    // shade a few kilometres from its trunk. The flight is ~100 s old by then,
    // which is why this has to be right the first time rather than found.
    aoNode: Fn(([worldXZ]: [Node<'vec2'>]) => {
      const uv = worldXZ.sub(uOrigin).div(AO_SPAN).add(0.5);
      const edge = max(abs(uv.x.sub(0.5)), abs(uv.y.sub(0.5)));
      // Past the rim there are no records, so the shade lets go before it,
      // rather than smearing the border texels over the rest of the world.
      return mix(texture(map, uv).r, 1, smoothstep(0.45, 0.5, edge));
    }),
    /**
     * Repaints the whole sheet around (centerX, centerZ) in world metres -- the
     * centre of the ring's cell -- from the records the ring has just placed.
     * One radial gradient per tree and one upload; nothing here runs per frame.
     */
    update(records: readonly ShadeRecord[], centerX: number, centerZ: number) {
      uOrigin.value.set(centerX, centerZ);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, AO_SIZE, AO_SIZE);
      for (const record of records) {
        const px = ((record.x - centerX) / AO_SPAN + 0.5) * AO_SIZE,
          pz = ((record.z - centerZ) / AO_SPAN + 0.5) * AO_SIZE,
          r = ((record.radius * SHADE_RADIUS) / AO_SPAN) * AO_SIZE;
        const gradient = context.createRadialGradient(px, pz, 0, px, pz, r);
        gradient.addColorStop(0, '#0006');
        gradient.addColorStop(0.3, '#0004');
        gradient.addColorStop(1, '#0000');
        context.fillStyle = gradient;
        context.fillRect(px - r, pz - r, r * 2, r * 2);
      }
      map.needsUpdate = true;
    },
    dispose() {
      map.dispose();
    },
  };
}
export type GroundShade = ReturnType<typeof createGroundShade>;

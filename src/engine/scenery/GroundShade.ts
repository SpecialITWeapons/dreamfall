// The shade under the trees: one bounded sheet of ambient occlusion, painted
// out of the tree records the ring has just placed (`ShadeSheet.ts`, on the
// CPU) and read by the ground as its AO map. The sun's shadow map only reaches
// the near field, so without this the far half of the forest floats a metre
// above its own ground. Repainted once per ring rebuild, never per frame.
// Ported from fly-with-me's updateGroundAO.
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RedFormat,
  UnsignedByteType,
  Vector2,
} from 'three';
import type { Node } from 'three/webgpu';
import { Fn, abs, max, mix, smoothstep, texture, uniform } from 'three/tsl';
import { AO_SIZE, AO_SPAN, createShadeSheet, type ShadeRecord } from './ShadeSheet';

export function createGroundShade() {
  const sheet = createShadeSheet();
  // A byte a texel, in world order: row 0 is the sheet's low z, as the canvas's
  // top row was, and a DataTexture uploads unflipped. A flipped upload mirrors
  // every shade in z, and the mirrored shades then jump two cells whenever the
  // sheet re-centers.
  const map = new DataTexture(sheet.data, AO_SIZE, AO_SIZE, RedFormat, UnsignedByteType);
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
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
     * centre of the ring's cell -- from the records the ring has just placed,
     * and uploads it once.
     */
    update(records: readonly ShadeRecord[], centerX: number, centerZ: number) {
      uOrigin.value.set(centerX, centerZ);
      sheet.paint(records, centerX, centerZ);
      map.needsUpdate = true;
    },
    dispose() {
      map.dispose();
    },
  };
}
export type GroundShade = ReturnType<typeof createGroundShade>;

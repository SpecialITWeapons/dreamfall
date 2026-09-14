import { Color, Mesh, PlaneGeometry } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { fract, mix, positionWorld, vec3 } from 'three/tsl';

/** Side of a checker cell on the ground, in meters; the same 32 m as two terrain cells in M1. */
export const GROUND_CELL = 32;

/**
 * Flat checkered ground in the two greens from fly-with-me's sample swatch
 * (meadow and forest). The color is computed from world position, so
 * shifting the mesh under the camera doesn't move the pattern. Replaced by
 * the height-field terrain in M1.
 */
export function createGroundPlane(size = 24_000): Mesh {
  const geometry = new PlaneGeometry(size, size, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicNodeMaterial();
  const meadow = new Color(0x7caa48);
  const forest = new Color(0x618a43);
  const cell = positionWorld.xz.div(GROUND_CELL).floor();
  const parity = fract(cell.x.add(cell.y).mul(0.5)).mul(2);
  material.colorNode = mix(vec3(meadow.r, meadow.g, meadow.b), vec3(forest.r, forest.g, forest.b), parity);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

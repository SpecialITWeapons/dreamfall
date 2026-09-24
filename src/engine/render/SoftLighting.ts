// The approved illustrated response: broad diffuse bands, no specular lobe,
// softened shadow edges. Every lit surface of the world (terrain, water,
// later trees and props) goes through createLitMaterial, which is what keeps
// ten biomes reading as one world. Ported from fly-with-me's main.js.
import type { Matrix4 } from 'three';
import {
  LightingModel,
  MeshStandardNodeMaterial,
  type LightingModelDirectInput,
  type MeshStandardNodeMaterialParameters,
  type Node,
  type NodeBuilder,
  type NodeMaterial,
  type UniformNode,
} from 'three/webgpu';
import {
  Fn,
  abs,
  diffuseColor,
  dot,
  float,
  max,
  mix,
  normalView,
  positionViewDirection,
  positionWorld,
  pow,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl';
import { LOOK } from './ColorGrade';

/** What the lighting model reads from the builder context; the typings leave it `unknown`. */
interface IndirectContext {
  irradiance: Node<'vec3'>;
  ambientOcclusion: Node<'float'>;
  reflectedLight: { indirectDiffuse: Node<'vec3'> };
}

export class SoftIllustratedLighting extends LightingModel {
  /** How much light a thin surface lets through toward an eye looking into the light (leaves, grass). */
  constructor(private readonly translucency = 0) {
    super();
  }
  // The light data arrives as untyped nodes; at runtime they are the vec3 direction and color.
  override direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput) {
    const nl = dot(normalView, lightDirection as Node<'vec3'>);
    const bands = mix(LOOK.bands.floor, 0.72, smoothstep(-0.18, 0.15, nl)).add(
      smoothstep(0.5, 0.85, nl).mul(0.15),
    );
    (reflectedLight.directDiffuse as Node<'vec3'>).addAssign(
      (lightColor as Node<'vec3'>)
        .mul(mix(max(nl, 0), bands, LOOK.bands.share))
        .mul(diffuseColor.rgb)
        .mul(1 / Math.PI),
    );
    if (this.translucency > 0) {
      // Looking into the sun through a leaf: the light is the one that reached
      // it, cast shadow and clouds included, so a crown in shade stays dark.
      const into = pow(max(dot(positionViewDirection.negate(), lightDirection as Node<'vec3'>), 0), 4);
      (reflectedLight.directDiffuse as Node<'vec3'>).addAssign(
        (lightColor as Node<'vec3'>)
          .mul(into.mul(this.translucency))
          .mul(diffuseColor.rgb)
          .mul(1 / Math.PI),
      );
    }
  }
  override indirect(builder: NodeBuilder) {
    const { irradiance, ambientOcclusion, reflectedLight } = builder.context as IndirectContext;
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb).mul(1 / Math.PI));
    reflectedLight.indirectDiffuse.mulAssign(ambientOcclusion);
  }
}

/**
 * A shadow that fades out toward the edge of the shadow camera's frame instead
 * of cutting off, times `through`: what else stands between the point and the
 * light (the clouds), so it dims the sun alone and never the sky.
 */
export function createSoftShadow(shadowMatrix: UniformNode<'mat4', Matrix4>, through?: Node<'float'>) {
  return Fn(([shadow]: [Node<'float'>]) => {
    const projected = shadowMatrix.mul(vec4(positionWorld, 1));
    const edge = max(
      abs(projected.x.div(projected.w).sub(0.5)),
      abs(projected.y.div(projected.w).sub(0.5)),
    ).mul(2);
    const cast = mix(float(1), shadow, float(1).sub(smoothstep(0.72, 0.98, edge)));
    return through ? cast.mul(through) : cast;
  });
}
export type SoftShadow = ReturnType<typeof createSoftShadow>;

export interface LitMaterialOptions {
  basic?: MeshStandardNodeMaterialParameters;
  emissiveNode?: Node<'vec3'>;
  /** Light let through toward an eye looking into it: leaves and grass glow against the sun. */
  translucency?: number;
}

/** The one material factory of the world: illustrated response, softened shadow, graded color. */
export function createLitMaterial(receivedShadowNode: SoftShadow) {
  return (colorNode: Node<'vec3'>, opts: LitMaterialOptions = {}): MeshStandardNodeMaterial => {
    const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, ...(opts.basic ?? {}) });
    const base = vec4(colorNode, 1);
    const compressed = pow(max(base.rgb, vec3(0.0001)), vec3(LOOK.materialPow)).mul(0.94);
    const value = dot(compressed, vec3(0.2126, 0.7152, 0.0722));
    m.colorNode = vec4(mix(compressed, vec3(value), LOOK.materialGray), base.a);
    // The standard material's typing pins the model to PhysicalLightingModel; NodeMaterial accepts any.
    (m as NodeMaterial).setupLightingModel = () => new SoftIllustratedLighting(opts.translucency);
    // The typing says a thunk; at runtime it is the Fn node the material calls with the shadow.
    m.receivedShadowNode = receivedShadowNode as unknown as MeshStandardNodeMaterial['receivedShadowNode'];
    if (opts.emissiveNode) m.emissiveNode = opts.emissiveNode.mul(0.25);
    return m;
  };
}
export type LitMaterial = ReturnType<typeof createLitMaterial>;

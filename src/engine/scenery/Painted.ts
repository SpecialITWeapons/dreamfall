// The painted look of the scenery: bark, leaves and grass drawn into canvases
// at start-up, and the materials that hang them on the pools. Ported from
// fly-with-me's main.js. Nothing here places anything and nothing here owns an
// instance: the ring says what stands where, the pools own the meshes, this
// file only says what they look like.
import { CanvasTexture, Color, DoubleSide, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Node } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  length,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { LEAVES } from '../../../library/contract';
import type { LitMaterial } from '../render/SoftLighting';
import type { SkyUniforms } from '../sky/SkyUniforms';
import { mulberry32 } from '../terrain/noise';

/** Which painted palette a species asks for; seven of them share four card forms. */
export type LeafName = keyof typeof LEAVES;

/** One palette as the painter reads it: three dark tones, three mid, one light. */
interface LeafPalette {
  form: string;
  dark: readonly string[];
  mid: readonly string[];
  light: string;
}

/** How much of a texture's own mean a painted surface keeps, and the mip bias feeding the sharp half. */
const PAINTED_MEAN = 0.38,
  PAINTED_BIAS = 0.8;
/** Bark is relief, not geometry: shallow enough that a trunk stays a cylinder. */
const BARK_BUMP = 0.015;
const LEAF_ALPHA_TEST = 0.04,
  LEAF_EMISSIVE = 0.025;
/**
 * Where a thing standing on the ground stops being drawn as it reaches the edge
 * of the ring. Low on purpose: the coverage samples are what dissolve it, and a
 * higher test would cut the last of it off in one step instead of thinning it.
 */
const FADE_ALPHA_TEST = 0.02;
const GRASS_ALPHA_TEST = 0.08;
/**
 * Blades fade out over this band of camera distance, meters. Tied to the grass
 * window's own reach, not chosen: a tuft may stand half a tile's diagonal past
 * `REACH` and is dropped once the flyer has moved `STEP`, so the far end has to
 * sit under `REACH - STEP - 45` or the window's rim is visible. At 650, 64 and
 * 45 the ceiling is 541.
 *
 * It ended at 190 until the owner said grass was still appearing in front of a
 * low pass, which it was: two seconds of warning at this world's speeds. Then
 * at 360, and the owner, flying as low as the flight allows, still watched it
 * grow in front of the figure. At 540 a tuft coming in is one or two pixels
 * tall, and a low pass has about thirteen seconds before it is under the
 * figure. What that costs is in `docs/perf-notes.md`.
 */
export const GRASS_FADE: [number, number] = [400, 540];

const BARK_GROOVES = ['#4f5b43', '#8d906a', '#656c50', '#a2a07b', '#596347'];
/** The blades' own greens; a tuft's tint multiplies them (`Grass.ts`, `tuftTint`). */
export const GRASS_BLADES = ['#638c37', '#7ca448', '#8cae50', '#a2bb61'];

/** A fresh canvas of this size, ready to paint on; the canvas comes back as ctx.canvas. */
function paint(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('painted scenery: this page has no 2d canvas context');
  return ctx;
}

/** Bark: vertical grooves under a wash, on a canvas that tiles across the seam. */
function paintBark(): HTMLCanvasElement {
  const ctx = paint(512, 1024),
    r = mulberry32(911);
  ctx.fillStyle = '#73775b';
  ctx.fillRect(0, 0, 512, 1024);
  for (let j = 0; j < 150; j++) {
    const x = r() * 512,
      phase = r() * Math.PI * 2,
      width = 2 + r() * 14;
    // Painted three times, a page left and a page right as well: a groove that
    // leaves one edge has to come back at the other, or the seam shows.
    for (const wrap of [-512, 0, 512]) {
      ctx.strokeStyle = BARK_GROOVES[j % 5]!;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let y = -16; y <= 1040; y += 16) {
        const xx =
          x +
          wrap +
          Math.sin((y / 1024) * Math.PI * 4 + phase) * 8 +
          Math.sin((y / 1024) * Math.PI * 10 + phase) * 3;
        if (y === -16) ctx.moveTo(xx, y);
        else ctx.lineTo(xx, y);
      }
      ctx.stroke();
      // the same path again, a pale hairline: the lit edge of the groove
      ctx.strokeStyle = '#b0ac8060';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }
  // A wash over all of it, so the grooves read as one trunk instead of stripes.
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#92947a';
  ctx.fillRect(0, 0, 512, 1024);
  ctx.globalAlpha = 1;
  return ctx.canvas;
}

/** One card of foliage. Each form is a different way of filling the square. */
function paintLeaf(leaf: LeafPalette): HTMLCanvasElement {
  const ctx = paint(512, 512),
    r = mulberry32(178);
  ctx.lineCap = 'round';
  const form = leaf.form;
  if (form === 'frond') {
    // long feathered blades radiating from the stem
    for (let j = 0; j < 9; j++) {
      const a = -0.35 + (j / 8) * 0.7 - Math.PI / 2 + (r() - 0.5) * 0.12,
        len = 215 + r() * 30;
      ctx.strokeStyle = leaf.dark[j % 3]!;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(256, 470);
      ctx.lineTo(256 + Math.cos(a) * len, 470 + Math.sin(a) * len);
      ctx.stroke();
      for (let k = 8; k < len; k += 7) {
        const x = 256 + Math.cos(a) * k,
          y = 470 + Math.sin(a) * k,
          w = 26 * (1 - k / len) + 6;
        ctx.strokeStyle = [...leaf.mid, leaf.light][((k / 7 + j) % 4) | 0]!;
        ctx.lineWidth = 3.5;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(a + side * 1.1) * w, y + Math.sin(a + side * 1.1) * w);
          ctx.stroke();
        }
      }
    }
  } else if (form === 'needle') {
    // bundles of short needles around twigs
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2;
      ctx.strokeStyle = '#4a4634';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 256);
      ctx.lineTo(256 + Math.cos(a) * 190, 256 + Math.sin(a) * 190);
      ctx.stroke();
    }
    for (let j = 0; j < 900; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * 200;
      const x = 256 + Math.cos(a) * rad,
        y = 256 + Math.sin(a) * rad,
        dir = a + (r() - 0.5) * 1.2,
        len = 14 + r() * 16;
      ctx.strokeStyle = [...leaf.dark, ...leaf.mid, leaf.light][j % 7]!;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(dir) * len, y + Math.sin(dir) * len);
      ctx.stroke();
    }
  } else {
    // broad leaves and petals: twigs first, then the leaves hung on them
    for (let j = 0; j < 11; j++) {
      const a = (j / 11) * Math.PI * 2,
        x = 256 + Math.cos(a) * 170,
        y = 256 + Math.sin(a) * 170;
      ctx.strokeStyle = form === 'petal' ? '#6b5a4a' : '#526b3e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(256, 275);
      ctx.quadraticCurveTo((256 + x) / 2, 220, x, y);
      ctx.stroke();
    }
    for (let j = 0; j < 360; j++) {
      const a = r() * Math.PI * 2,
        rad = Math.sqrt(r()) * (177 + 20 * Math.sin(a * 5));
      ctx.save();
      ctx.translate(256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad);
      ctx.rotate(a + (r() - 0.5) * 1.8);
      const len = 16 + r() * 15,
        w = 7 + r() * 7,
        g = ctx.createLinearGradient(-len / 2, w, len / 2, -w);
      g.addColorStop(0, leaf.dark[j % 3]!);
      g.addColorStop(0.55, leaf.mid[j % 3]!);
      g.addColorStop(1, leaf.light);
      ctx.fillStyle = g;
      ctx.beginPath();
      if (form === 'petal') {
        // five round petals about a small heart
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2;
          ctx.moveTo(Math.cos(pa) * w * 0.9 + w * 0.55, Math.sin(pa) * w * 0.9);
          ctx.arc(Math.cos(pa) * w * 0.9, Math.sin(pa) * w * 0.9, w * 0.55, 0, Math.PI * 2);
        }
      } else {
        ctx.moveTo(-len * 0.55, 0);
        ctx.bezierCurveTo(-len * 0.2, -w, len * 0.24, -w * 0.7, len * 0.6, 0);
        ctx.bezierCurveTo(len * 0.15, w * 0.8, -len * 0.28, w, -len * 0.55, 0);
      }
      ctx.fill();
      if (form !== 'petal') {
        ctx.strokeStyle = '#cee09a55';
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(-len * 0.4, 0);
        ctx.lineTo(len * 0.45, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  return ctx.canvas;
}

/** Grass: ninety-six blades standing on the bottom edge of the square. */
function paintGrass(): HTMLCanvasElement {
  const ctx = paint(256, 256),
    r = mulberry32(614);
  for (let i = 0; i < 96; i++) {
    const x = 6 + r() * 244,
      h = 55 + r() * 180,
      bend = (r() - 0.5) * 60,
      width = 1.5 + r() * 3;
    ctx.fillStyle = GRASS_BLADES[i % 4]!;
    ctx.beginPath();
    ctx.moveTo(x - width, 256);
    ctx.quadraticCurveTo(x - width * 0.5, 256 - h * 0.65, x + bend, 256 - h);
    ctx.quadraticCurveTo(x + width * 0.6, 256 - h * 0.4, x + width, 256);
    ctx.fill();
  }
  return ctx.canvas;
}

/**
 * Every painted texture of the scenery. A leaf palette is painted the first
 * time a species asks for it and kept: nine species share seven palettes, and
 * a 512 square of hand-drawn leaves is not worth drawing twice.
 */
export function createPaintedTextures() {
  const barkCanvas = paintBark();
  const bark = new CanvasTexture(barkCanvas);
  bark.colorSpace = SRGBColorSpace;
  bark.wrapS = bark.wrapT = RepeatWrapping;
  // The same canvas a second time, and deliberately without a color space: as
  // a bump map it carries depth, not color, and a transfer function applied to
  // depth would flatten the grooves.
  const barkRelief = new CanvasTexture(barkCanvas);
  barkRelief.wrapS = barkRelief.wrapT = RepeatWrapping;
  const grass = new CanvasTexture(paintGrass());
  grass.colorSpace = SRGBColorSpace;
  grass.anisotropy = 4;
  const leaves = new Map<LeafName, CanvasTexture>();
  return {
    bark,
    barkRelief,
    grass,
    leaf(name: LeafName): CanvasTexture {
      let map = leaves.get(name);
      if (!map) {
        map = new CanvasTexture(paintLeaf(LEAVES[name]));
        map.colorSpace = SRGBColorSpace;
        map.anisotropy = 4;
        leaves.set(name, map);
      }
      return map;
    },
    dispose() {
      for (const map of [bark, barkRelief, grass, ...leaves.values()]) map.dispose();
      leaves.clear();
    },
  };
}
export type PaintedTextures = ReturnType<typeof createPaintedTextures>;

/**
 * A painted texture sampled the way a distance wants it: the sharp sample,
 * pulled toward the texture's own mean color. A crown is a few hundred cards
 * of leaves with holes in them; sampled sharply from far away it becomes a
 * grid that sparkles as the flyer moves. Mixing in the mean turns the far
 * crown into the patch of color it should be, while the near one keeps its
 * drawing. The mean is weighted by alpha, because a transparent pixel is not
 * part of the leaf, and taken in linear space, because that is where the
 * shader mixes; averaged as bytes it would come out too dark.
 */
export function paintedSample(map: CanvasTexture): Node<'vec4'> {
  const image = map.image;
  const ctx = image.getContext('2d');
  if (!ctx) throw new Error('painted scenery: the texture has no 2d canvas context');
  const bytes = ctx.getImageData(0, 0, image.width, image.height).data;
  // One table for the two hundred and fifty-six byte values a channel can hold,
  // rather than a color conversion per pixel of a 512 square.
  const linear = Array.from({ length: 256 }, (_, i) => new Color().setRGB(i / 255, 0, 0, SRGBColorSpace).r);
  const mean = new Color(0, 0, 0);
  let weight = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const a = bytes[i + 3]! / 255;
    mean.r += linear[bytes[i]!]! * a;
    mean.g += linear[bytes[i + 1]!]! * a;
    mean.b += linear[bytes[i + 2]!]! * a;
    weight += a;
  }
  mean.multiplyScalar(1 / Math.max(1, weight));
  const sharp = texture(map);
  // bias() clones the node, so the alpha stays the sharp one: the cutout of a
  // leaf must keep its edge however blurred its color is.
  return vec4(mix(sharp.bias(float(PAINTED_BIAS)).rgb, uniform(mean), PAINTED_MEAN), sharp.a);
}

/**
 * The materials of everything that stands. They read the engine's own lit
 * material, so a tree answers the light exactly as the ground does.
 */
export function createSceneryMaterials(deps: {
  litMaterial: LitMaterial;
  uniforms: SkyUniforms;
  textures: PaintedTextures;
}) {
  const { litMaterial, uniforms: u, textures } = deps;
  // The near crown and the distant crown of a species share one map, and the
  // mean behind paintedSample costs a pass over every pixel of it; sample once.
  const samples = new WeakMap<CanvasTexture, Node<'vec4'>>();
  const sampleOf = (map: CanvasTexture): Node<'vec4'> => {
    let sample = samples.get(map);
    if (!sample) samples.set(map, (sample = paintedSample(map)));
    return sample;
  };
  // Wind in the leaves and in the grass: one horizontal wave, growing with the
  // height of the vertex over its own root, so roots hold and tips move. It
  // reads the vertex attribute rather than positionLocal, because by then the
  // crown morph has already moved the vertex and a card would sway by the
  // height of the tree instead of its own.
  //
  // The clock is uniforms.time, the simulation's, never TSL's own time: a
  // paused world has a still forest, exactly as it has still clouds.
  //
  // The node type is spelled out as a type argument because attribute() infers
  // it from its second argument as `string`, and a node of unknown type has no
  // `.y` to swing.
  const vertexY = attribute<'vec3'>('position', 'vec3').y;
  const sway = (rate: number, wave: number, amount: Node<'float'>) =>
    vec3(sin(u.time.mul(rate).add(positionWorld.x.mul(wave))).mul(amount), 0, 0);
  const leafSway = sway(0.8, 0.05, vertexY.mul(0.018));
  const grassSway = sway(1.4, 0.08, vertexY.pow(2).mul(0.16));
  const bark = sampleOf(textures.bark);
  return {
    /**
     * A trunk or a limb: the painted bark, tinted per species. `fade` is how
     * much of this tree is there at all -- one at any normal distance, falling
     * to nothing at the edge of the ring. It travels through opacity against an
     * alpha test, so a trunk dissolves into the haze in the coverage samples
     * rather than shrinking into the ground, which is a thing a tree does not do.
     */
    wood(tint: Color, fade: Node<'float'>) {
      // Only the color: the lit material of this engine takes no alpha, and the
      // bark canvas has none to take.
      const m = litMaterial(bark.rgb.mul(uniform(tint.clone())), {
        basic: { alphaTest: FADE_ALPHA_TEST, alphaToCoverage: true },
      });
      m.opacityNode = fade;
      m.bumpMap = textures.barkRelief;
      m.bumpScale = BARK_BUMP;
      return m;
    },
    /**
     * One crown of cards. `visible` is the band this crown owns (the near one
     * and the distant one of a species trade places across it) and `position`
     * is where the pool wants the vertex: the crown morph and the shrink at the
     * edge of the ring are already in it, and the sway rides on top.
     */
    leaf(map: CanvasTexture, visible: Node<'float'>, position: Node<'vec3'>) {
      const sample = sampleOf(map);
      const m = litMaterial(sample.rgb, {
        basic: { side: DoubleSide, alphaTest: LEAF_ALPHA_TEST, alphaToCoverage: true },
      });
      // Cards are flat and two-sided; lighting them by their own normal would
      // turn a crown into a set of dark squares, so they answer as they face.
      m.normalNode = transformNormalToView(normalLocal);
      // Straight on the material, not through litMaterial's emissive option:
      // that option scales what it is given by 0.25, and this 0.025 is the
      // whole of the glow the leaves carry.
      m.emissiveNode = texture(map).rgb.mul(LEAF_EMISSIVE);
      // The cutout travels through opacity because this engine's lit material
      // takes a color and no alpha; the material multiplies opacity into the
      // alpha before the alpha test, so the product is what the original's
      // four-component color carried.
      m.opacityNode = sample.a.mul(visible);
      // The original shrank the swayed card; here the card sways after the
      // pool has shrunk it, which differs only where a tree is already folding
      // into its base two kilometers out, by centimeters.
      m.positionNode = position.add(leafSway);
      return m;
    },
    /**
     * Anything that stands and is not a tree: the color is the geometry's own,
     * darkened per instance through instanceColor. The original saturated it
     * here; in this engine the grade lives in the display chain, so the ground
     * and the boulder on it are graded once, together.
     */
    prop(fade?: Node<'float'>) {
      if (!fade) return litMaterial(attribute<'vec3'>('color', 'vec3'));
      const m = litMaterial(attribute<'vec3'>('color', 'vec3'), {
        basic: { alphaTest: FADE_ALPHA_TEST, alphaToCoverage: true },
      });
      m.opacityNode = fade;
      return m;
    },
    /**
     * The grass of the local window. `ao` is the shade sheet under the trees,
     * read at this blade's foot; it is mixed out toward the tip of the blade,
     * because a shadow lies on the ground and not on what grows out of it.
     */
    grass(ao: Node<'float'>) {
      const sample = sampleOf(textures.grass);
      const m = litMaterial(sample.rgb, {
        basic: { side: DoubleSide, alphaTest: GRASS_ALPHA_TEST, alphaToCoverage: true },
      });
      // Blades are lit from above like the ground they stand in, never by the
      // normal of the quad they are painted on.
      m.normalNode = transformNormalToView(vec3(0, 1, 0));
      m.aoNode = mix(ao, 1, attribute<'vec2'>('uv', 'vec2').y);
      // The window ends before its edge shows: blades thin out with distance
      // long before the last tile the placement wrote.
      m.opacityNode = sample.a.mul(
        float(1).sub(smoothstep(GRASS_FADE[0], GRASS_FADE[1], length(positionWorld.sub(cameraPosition)))),
      );
      m.positionNode = positionLocal.add(grassSway);
      return m;
    },
  };
}
export type SceneryMaterials = ReturnType<typeof createSceneryMaterials>;

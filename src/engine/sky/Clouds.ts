// Clouds: the deck's bodies near the flyer, as clusters of soft sprites.
//
// There were sixty-four puffs of seven merged spheres, coloured by which way
// their surface faced and lit by nothing, so under a low sun they were flat
// grey pebbles along the horizon. Now each cloud is a cluster of camera-facing
// sprites heaped into a dome with a flat base, lit as one body: each sprite
// takes its normal from where it sits in the cluster, bent by the round of its
// own disc, so the sunward side of a cluster is bright, its underside is in
// its own shadow and its edge against the sun is lined with light.
//
// A cluster stands where the deck is: only where the field has a bank (the
// same bytes the sea and the shadows sample on the GPU, `CloudCover.at`),
// carried by the wind itself as the field is, with its base on the deck's
// base there and its crown at the bank's top -- and over a solid bank above
// it, a tower standing out of the sea. From over the deck the sprites buried
// in the bank under its top are let go, so the sea is not painted over with
// what is inside it.
//
// A cluster lies along the wind and has a flat base, cut where the deck's base
// is, because a round heap of round sprites read as a ball; how long, how tall,
// how puffed, how ragged and how soft its base is are `CloudForm`, which the dev
// panel moves while the world runs.
//
// Transparent sprites blend in the order they are drawn, so the CPU sorts them
// back to front every frame, draws only the ones it can see, and fades the
// ones the camera is about to fly into rather than let them fill the screen.
// Positions are decided in the world and written in the local frame.
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  attribute,
  cameraPosition,
  dot,
  float,
  length,
  max,
  mix,
  mx_noise_float,
  normalize,
  pow,
  positionWorld,
  smoothstep,
  sqrt,
  uniform,
  vec3,
} from 'three/tsl';
import { mulberry32, sstep } from '../terrain/noise';
import { deckTop, type CloudCover } from './CloudCover';
import type { SkyUniforms } from './SkyUniforms';

const VENUS = vec3(0.86, 0.46, 0.52);

export const CLUSTER = {
  /** Clusters in the field that wraps round the flyer. */
  count: 96,
  /** Sprites a cluster. */
  sprites: 16,
  /** The field's side, m: clusters wrap inside it as the flyer moves. */
  field: 6400,
  /** A cluster's horizontal radius, m, smallest and largest. */
  radius: [120, 260] as const,
  /** How far a tower stands over the bank's top, m, at most. */
  tower: 170,
  /** Where the far clusters are gone, m: the fog has them by then. */
  far: [2300, 2900] as const,
};
export const CLUSTER_SPRITES = CLUSTER.count * CLUSTER.sprites;

/**
 * What a cloud looks like, as numbers the dev panel moves while the world runs.
 * The layout reads the first three every frame; the last two are uniforms.
 */
export interface CloudForm {
  /** How much longer a cluster is along the wind than across it; its footprint keeps its area. */
  stretch: number;
  /** How tall a cluster stands, over the bank's own depth. */
  height: number;
  /** How big a sprite is, over its cluster's radius. */
  puff: number;
  /** How ragged a sprite's edge is. */
  rag: number;
  /** How soft the flat base is, m: the height over which a sprite fades in above it. */
  floor: number;
}

/** Each number's range and where it starts: the panel's sliders, and the clamp on `set`. */
export const CLOUD_FORM: { [K in keyof CloudForm]: readonly [min: number, max: number, start: number] } = {
  stretch: [1, 3, 1.8],
  height: [0.5, 1.6, 1],
  puff: [0.6, 1.6, 1.15],
  rag: [0, 0.8, 0.4],
  floor: [2, 120, 30],
};

/** A form at its starting values. */
export const cloudForm = (): CloudForm => ({
  stretch: CLOUD_FORM.stretch[2],
  height: CLOUD_FORM.height[2],
  puff: CLOUD_FORM.puff[2],
  rag: CLOUD_FORM.rag[2],
  floor: CLOUD_FORM.floor[2],
});

/** Writes into `form` what `change` asks for, each number clamped to its range and a non-number ignored. */
export function setCloudForm(form: CloudForm, change: Partial<CloudForm>): CloudForm {
  for (const key of Object.keys(CLOUD_FORM) as Array<keyof CloudForm>) {
    const v = change[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [min, max] = CLOUD_FORM[key];
    form[key] = Math.min(max, Math.max(min, v));
  }
  return form;
}

/** One cluster's shape: where its sprites sit, 0..1 up it and -1..1 across, and how big each is. */
export interface ClusterShape {
  x: number;
  z: number;
  rot: number;
  drift: number;
  /** Radius, m, before the bank thins it. */
  radius: number;
  /** How much of a tower it grows over a solid bank, 0..1. */
  tower: number;
  sprites: Array<{ ox: number; oy: number; oz: number; size: number }>;
}

/**
 * The clusters of a world. Each sprite sits inside a dome with a flat base:
 * `oy` is how far up the cluster, and the higher a sprite the closer to the
 * axis and the smaller it is, so a cluster is a heap and not a ball.
 */
export function clusterShapes(seed: number): ClusterShape[] {
  const r = mulberry32(seed ^ 0xc10d);
  const shapes: ClusterShape[] = [];
  for (let c = 0; c < CLUSTER.count; c++) {
    const sprites: ClusterShape['sprites'] = [];
    for (let k = 0; k < CLUSTER.sprites; k++) {
      const oy = Math.pow(r(), 0.85);
      const room = 0.15 + 0.85 * Math.sqrt(Math.max(0, 1 - oy * oy));
      const a = r() * Math.PI * 2,
        rr = Math.sqrt(r()) * room;
      sprites.push({
        ox: Math.cos(a) * rr,
        oy,
        oz: Math.sin(a) * rr,
        size: (0.75 + 0.45 * r()) * (1 - 0.35 * oy),
      });
    }
    shapes.push({
      x: r() * CLUSTER.field,
      z: r() * CLUSTER.field,
      rot: r() * Math.PI * 2,
      drift: 0.95 + r() * 0.1,
      radius: CLUSTER.radius[0] + (CLUSTER.radius[1] - CLUSTER.radius[0]) * r(),
      tower: r() * r(),
      sprites,
    });
  }
  return shapes;
}

/** Where the sprites are this frame: filled by `layoutClusters`, read by the GPU. */
export interface ClusterLayout {
  /** Per drawn sprite, back to front: local centre (x, y, z) and size, m. */
  sprite: Float32Array;
  /** Per drawn sprite: where it sits in its cluster (ox, oy, oz) and its opacity. */
  shape: Float32Array;
  /** Per drawn sprite: its cluster's base, m, under which it is cut away. */
  floor: Float32Array;
  /** How many of them are drawn. */
  count: number;
  /** The same, unsorted, as the sweep finds them. */
  scratch: {
    sprite: Float32Array;
    shape: Float32Array;
    floor: Float32Array;
    dist: Float32Array;
    order: number[];
  };
}

export function createClusterLayout(): ClusterLayout {
  const arrays = () => ({
    sprite: new Float32Array(CLUSTER_SPRITES * 4),
    shape: new Float32Array(CLUSTER_SPRITES * 4),
    floor: new Float32Array(CLUSTER_SPRITES),
  });
  return {
    ...arrays(),
    count: 0,
    scratch: { ...arrays(), dist: new Float32Array(CLUSTER_SPRITES), order: [] },
  };
}

/**
 * Places every cluster for this frame and writes the sprites worth drawing,
 * farthest first. `bx, bz` is the flyer, the camera is in the world, and
 * `originX, originZ` turns world positions into the local frame's.
 */
export function layoutClusters(
  shapes: ClusterShape[],
  cover: CloudCover,
  out: ClusterLayout,
  f: {
    bx: number;
    bz: number;
    t: number;
    camera: { x: number; y: number; z: number };
    originX: number;
    originZ: number;
    wind: { x: number; z: number };
  },
  form: CloudForm = cloudForm(),
): ClusterLayout {
  const { sprite: pos, shape, floor, dist, order } = out.scratch;
  const F = CLUSTER.field;
  let n = 0;
  order.length = 0;
  // A cluster lies along the wind, give or take a little of its own: a cloud
  // is drawn out by the air it rides, and a field of them lines up.
  const wl = Math.hypot(f.wind.x, f.wind.z);
  const windAngle = wl > 1e-6 ? Math.atan2(f.wind.x, f.wind.z) : 0;
  // Its footprint keeps its area: longer along, narrower across.
  const along = Math.sqrt(form.stretch),
    across = 1 / along;
  for (const c of shapes) {
    let x = c.x + f.t * f.wind.x * c.drift - f.bx,
      z = c.z + f.t * f.wind.z * c.drift - f.bz;
    x = (((x % F) + F * 1.5) % F) - F / 2;
    z = (((z % F) + F * 1.5) % F) - F / 2;
    const px = f.bx + x,
      pz = f.bz + z;
    // Moved against the wind as the shader moves its point, so the CPU and the
    // GPU read the one field at one place.
    const bank = sstep(0.35, 0.8, cover.at(px - f.wind.x * f.t, pz - f.wind.z * f.t));
    if (bank <= 0.001) continue;
    const base = cover.baseAt(px, pz),
      top = deckTop(base, bank);
    const height = (top - base + CLUSTER.tower * c.tower * sstep(0.7, 1, bank)) * form.height;
    const radius = c.radius * (0.55 + 0.45 * bank);
    // The heading the cluster's long axis takes: the wind's, turned by up to a
    // fifth of a right angle either way.
    const heading = windAngle + ((c.rot - Math.PI) / Math.PI) * 0.35;
    const sin = Math.sin(heading),
      cos = Math.cos(heading);
    // From over the deck the bank's top is the sea's to draw: a sprite buried
    // under it is let go.
    const over = sstep(top - 40, top + 40, f.camera.y);
    // A thinning bank has smaller clusters, and fainter ones, rather than a
    // scatter of little balls.
    const fade = sstep(0.15, 0.6, bank);
    for (const s of c.sprites) {
      const size = s.size * radius * (0.7 + 0.3 * bank) * form.puff;
      // `oz` runs along the long axis (x = sin, z = cos of the heading), `ox` across it.
      const a = s.oz * radius * along,
        b = s.ox * radius * across;
      const sx = px + a * sin + b * cos,
        sz = pz + a * cos - b * sin,
        // Low enough that the bottom row reaches the base, where it is cut flat.
        sy = base + s.oy * height + size * 0.12;
      const dx = sx - f.camera.x,
        dy = sy - f.camera.y,
        dz = sz - f.camera.z;
      const d = Math.hypot(dx, dy, dz);
      const buried = 1 - over * (1 - sstep(top + 20, top + 70, sy));
      const alpha =
        sstep(size * 0.9, size * 2, d) * (1 - sstep(CLUSTER.far[0], CLUSTER.far[1], d)) * buried * fade;
      if (alpha <= 0.003) continue;
      pos[n * 4] = sx - f.originX;
      pos[n * 4 + 1] = sy;
      pos[n * 4 + 2] = sz - f.originZ;
      pos[n * 4 + 3] = size;
      shape[n * 4] = s.ox;
      shape[n * 4 + 1] = s.oy;
      shape[n * 4 + 2] = s.oz;
      shape[n * 4 + 3] = alpha;
      floor[n] = base;
      dist[n] = d;
      order.push(n);
      n++;
    }
  }
  order.sort((a, b) => dist[b]! - dist[a]!);
  for (let i = 0; i < n; i++) {
    const k = order[i]!;
    out.sprite.set(pos.subarray(k * 4, k * 4 + 4), i * 4);
    out.shape.set(shape.subarray(k * 4, k * 4 + 4), i * 4);
    out.floor[i] = floor[k]!;
  }
  out.count = n;
  return out;
}

export function createClouds(seed: number, u: SkyUniforms, cover: CloudCover) {
  const shapes = clusterShapes(seed);
  const layout = createClusterLayout();
  const form = cloudForm();
  const uRag = uniform(form.rag),
    uFloor = uniform(form.floor);
  // The camera's own right and up in the world: a sprite is laid in the plane
  // of the screen, so every sprite faces the eye and none is seen edge on.
  const uRight = uniform(new Vector3(1, 0, 0)),
    uUp = uniform(new Vector3(0, 1, 0));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const sprite = attribute<'vec4'>('sprite', 'vec4'),
    shape = attribute<'vec4'>('shape', 'vec4'),
    floorY = attribute<'float'>('floor', 'float');
  const corner = attribute<'vec3'>('position', 'vec3').xy;
  material.positionNode = sprite.xyz
    .add(uRight.mul(corner.x.mul(sprite.w)))
    .add(uUp.mul(corner.y.mul(sprite.w)));
  // The disc: soft, and its edge worn by a slow noise carried with the sprite,
  // so a cluster's outline is ragged and moves a little as it goes.
  const q = corner.mul(2);
  const d = length(q);
  const seedXZ = shape.xz.mul(7);
  const rag = mx_noise_float(vec3(q.mul(1.6).add(seedXZ), u.time.mul(0.04)))
    .mul(0.7)
    .add(mx_noise_float(vec3(q.mul(4.2).sub(seedXZ), u.time.mul(0.06))).mul(0.3));
  // A cumulus has a flat base, all of a region's at one height: whatever of a
  // round sprite hangs below its cluster's base is cut away, softly.
  const above = positionWorld.y.sub(floorY);
  // Ragged, but never to the quad's own edge, or the edge shows as a straight cut.
  const edge = smoothstep(1, 0.82, max(q.x.abs(), q.y.abs()));
  const disc = smoothstep(0.0, 0.3, float(1).sub(d).add(rag.mul(uRag)))
    .mul(edge)
    .mul(smoothstep(0, uFloor, above));
  // The normal: where the sprite sits in its cluster (out of its middle, a
  // little under half way up), bent by the round of its own disc.
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const round = normalize(
    uRight
      .mul(q.x)
      .add(uUp.mul(q.y))
      .add(toEye.mul(sqrt(max(float(1).sub(d.mul(d)), 0.0)))),
  );
  const place = normalize(vec3(shape.x, shape.y.sub(0.35).mul(1.2), shape.z).add(vec3(0, 0.0001, 0)));
  // Mostly the cluster's: a sprite shaded on its own reads as a grape.
  const n = normalize(place.add(round.mul(0.35)));
  const view = toEye.negate();
  const sunUp = smoothstep(-0.04, 0.06, u.uSunDir.y);
  const s = max(dot(view, u.uSunDir), 0.0).mul(sunUp);
  const sunCol = mix(u.uSunColor, u.uGlow, u.uLowSun.mul(0.6));
  const lit = smoothstep(u.uSunDir.y.sub(0.9), u.uSunDir.y.add(0.35), dot(n, u.uSunDir)).mul(sunUp);
  const moonlit = smoothstep(u.uMoonDir.y.sub(0.6), u.uMoonDir.y.add(0.3), dot(n, u.uMoonDir)).mul(
    u.uMoonLight,
  );
  // The underside is in the cluster's own shadow, the top takes the sky.
  const shade = mix(u.uUpper.mul(0.6), u.uCloudWhite, 0.45)
    .mul(mix(0.74, 1, shape.y))
    // and the flat underside itself is the darkest of it
    .mul(mix(0.82, 1, smoothstep(0, 90, above)))
    .mul(float(0.92).add(rag.mul(0.16)));
  // Seen against the sun a cluster's thin edge glows.
  const rim = pow(s, 6)
    .mul(smoothstep(0.35, 0.95, d))
    .mul(1.4);
  // And the sun comes through where it is thin: a cluster seen against the
  // sun glows through its body instead of going dark in its middle.
  const through = pow(s, 3)
    .mul(float(1).sub(disc.mul(0.5)))
    .mul(0.45);
  material.colorNode = Fn(() => {
    const light = mix(u.uCloudWhite, sunCol, u.uLowSun.mul(0.7).add(pow(s, 4).mul(0.3))).toVar();
    light.assign(mix(light, u.uGlow, u.uLowSun.mul(pow(s, 1.5)).mul(0.5)));
    light.assign(mix(light, mix(light, VENUS, 0.5), u.uVenusI.mul(pow(float(1).sub(s), 3)).mul(0.3)));
    return mix(shade, light, lit)
      .add(sunCol.mul(rim).mul(0.4))
      .add(sunCol.mul(through))
      .add(vec3(0.42, 0.5, 0.72).mul(moonlit).mul(0.1));
  })();
  material.opacityNode = disc.mul(shape.w).mul(u.uCloudBodies).mul(0.88);

  const quad = new PlaneGeometry(1, 1);
  quad.deleteAttribute('normal');
  quad.deleteAttribute('uv');
  const spriteAttr = new InstancedBufferAttribute(layout.sprite, 4);
  const shapeAttr = new InstancedBufferAttribute(layout.shape, 4);
  spriteAttr.setUsage(DynamicDrawUsage);
  shapeAttr.setUsage(DynamicDrawUsage);
  quad.setAttribute('sprite', spriteAttr);
  quad.setAttribute('shape', shapeAttr);
  const floorAttr = new InstancedBufferAttribute(layout.floor, 1);
  floorAttr.setUsage(DynamicDrawUsage);
  quad.setAttribute('floor', floorAttr);
  const mesh = new InstancedMesh(quad, material, CLUSTER_SPRITES);
  // The instance matrix is the identity: every sprite's place is in `sprite`.
  const identity = new Matrix4();
  for (let i = 0; i < CLUSTER_SPRITES; i++) mesh.setMatrixAt(i, identity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  // After the sea: a tower stands out of it.
  mesh.renderOrder = 3;
  const camera = { x: 0, y: 0, z: 0 };
  const frame = { bx: 0, bz: 0, t: 0, camera, originX: 0, originZ: 0, wind: { x: 0, z: 0 } };
  const e = new Float32Array(16);
  return {
    mesh,
    /** What the clouds look like; `setForm` changes it while the world runs. */
    get form(): Readonly<CloudForm> {
      return form;
    },
    setForm(change: Partial<CloudForm>) {
      setCloudForm(form, change);
      uRag.value = form.rag;
      uFloor.value = form.floor;
    },
    /** How many sprites the last frame drew. */
    get drawn() {
      return layout.count;
    },
    update(
      bx: number,
      bz: number,
      t: number,
      cameraLocal: Vector3,
      cameraWorld: Matrix4,
      originX: number,
      originZ: number,
      wind: { x: number; z: number },
    ) {
      camera.x = cameraLocal.x + originX;
      camera.y = cameraLocal.y;
      camera.z = cameraLocal.z + originZ;
      Object.assign(frame, { bx, bz, t, originX, originZ, wind });
      layoutClusters(shapes, cover, layout, frame, form);
      cameraWorld.toArray(e);
      uRight.value.set(e[0]!, e[1]!, e[2]!).normalize();
      uUp.value.set(e[4]!, e[5]!, e[6]!).normalize();
      mesh.count = layout.count;
      for (const [attr, size] of [
        [spriteAttr, 4],
        [shapeAttr, 4],
        [floorAttr, 1],
      ] as const) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, layout.count * size);
        attr.needsUpdate = true;
      }
    },
    dispose() {
      quad.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
export type Clouds = ReturnType<typeof createClouds>;

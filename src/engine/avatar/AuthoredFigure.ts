// The figure, as someone drew it in Blender.
//
// This implements `Avatar` and nothing else: it is handed a flight pose every
// frame, puts the whole body where the flight says, and drives the joints off
// `Posture`. The skeleton is 31 CMU bones, of which the posture speaks to ten
// limbs; `DRIVEN` is the whole of which is which, and the spine, the neck and
// the collarbones are driven here from the posture's torso and gaze.
//
// The one thing done to the file that is not driving it: `rebind` re-cuts the
// skin into the pose the figure flies in, because a body modelled in a T and
// flown with its arms back is a right angle away from the only pose its skin
// is correct in, and linear blend skinning does not survive that.
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HUMAN_BOUNDS, type Avatar, type FlightPose } from './Avatar';
import { SPEED } from '../flight/FlightController';
import { OUTFIT } from './Outfit';
import { createPosture, type Kind } from './Posture';
import figureUrl from './figure.glb?url';

/**
 * Where the hips sit in the authored file, in metres up from its feet. The
 * model stands on the origin and the engine's figure is centred on the flight,
 * so the body is dropped by this much before it is laid down. Read from the
 * `Hips` joint of the exported skeleton; a re-export that moves it moves this.
 */
const HIPS = 0.877;

/**
 * The eye, in the figure's frame -- x left, y up, z ahead -- taken from where
 * the authored head's eyes sit once the body is laid out: 1.556 m up and
 * 0.064 m forward while it stands, which is 0.679 m ahead and 0.064 m under
 * the body's axis once it is flying face-down.
 */
const EYE = new Vector3(0, -0.064, 0.679);

/**
 * Which bone of the authored skeleton each of the posture's ten joints writes
 * to, left first. This is the whole of the retarget's table: the engine drives
 * five joints a side and the CMU skeleton has a name for every one of them, so
 * nothing here is a guess about which bone is which.
 *
 * The other twenty-one bones -- three vertebrae, two clavicles, two hip
 * joints, a second neck, a head and six for the fingers -- keep the pose they
 * were exported in and ride along. A segmented spine is what a skydiver's arch
 * is made of and the engine has no joint to drive it with; that is the next
 * thing to want, not this one.
 */
const DRIVEN: Record<Kind, readonly [left: string, right: string]> = {
  shoulder: ['LeftArm', 'RightArm'],
  elbow: ['LeftForeArm', 'RightForeArm'],
  hip: ['LeftUpLeg', 'RightUpLeg'],
  knee: ['LeftLeg', 'RightLeg'],
  ankle: ['LeftFoot', 'RightFoot'],
};

/**
 * The two joints whose parent in the authored skeleton is not the joint above
 * them in the engine's chain. The engine hangs a shoulder and a hip straight
 * off the chest; this skeleton puts a clavicle above the one and a hip joint
 * above the other, and neither is driven. So those two take the limb's
 * orientation in the figure's frame and undo their own parent, and the three
 * below them -- elbow, knee, ankle -- hang off a bone this does drive and wear
 * the engine's parent-relative rotation exactly as it comes.
 */
const UNDER_A_STRANGER: ReadonlySet<Kind> = new Set(['hip']);

/**
 * The three vertebrae between the hips and the shoulders, and how much of the
 * torso each carries. A lower back bends more than a thorax does -- ribs are
 * in the way of the top one -- so the shares are not equal, and they add to
 * one because `Torso` hands over the whole bend rather than a bend per bone.
 */
const SPINE: ReadonlyArray<{ bone: string; share: number }> = [
  { bone: 'LowerBack', share: 0.45 },
  { bone: 'Spine', share: 0.35 },
  { bone: 'Spine1', share: 0.2 },
];

/**
 * The neck, and the head on the end of it. A real neck turns furthest at the
 * top -- the joint under the skull does about half of it on its own -- so the
 * head takes the largest share and the two cervical bones divide the rest.
 * Written the other way round, the head stays square to the shoulders and only
 * the throat bends, which reads as a wound rather than as looking.
 */
const NECK: ReadonlyArray<{ bone: string; share: number }> = [
  { bone: 'Neck', share: 0.25 },
  { bone: 'Neck1', share: 0.3 },
  { bone: 'Head', share: 0.45 },
];

/**
 * How much of the upper arm's travel the collarbone goes with it.
 *
 * A shoulder is not a hinge on a post. Lift an arm and the girdle under it
 * turns too -- about one degree for every two past the first thirty, which
 * anatomy calls scapulohumeral rhythm -- and the collarbone is the part of
 * that this skeleton has a bone for. A quarter is the collarbone's own share
 * of it; the scapula does the rest and is not here. Without it the arms read
 * as bolted to the chest, which is the one thing a shoulder must not look
 * like.
 *
 * It is not a lever on the armpit, and raising it was tried as one. Over the
 * flight's four shapes the armpit's worst triangle measures 0.04 of its
 * modelled area at a quarter, 0.08 at a third and 0.07 at nearly a half: noise
 * either side of a number the girdle does not set. What sets it is how far the
 * arm is from the pose the skin was cut in, which is `rebind`'s business and
 * not this one. (An earlier sweep read a clean fourfold gain here. It was
 * measuring a half-finished rebind, whose distorted bind matrices the
 * collarbone happened to unpick.)
 */
const CLAVICLE = 0.24;

/** A bone bent about two of the figure's own axes, as a share of the whole bend. */
interface Bendable {
  bone: Object3D;
  /** What the bone was exported wearing; a bend is laid over this, never instead of it. */
  rest: Quaternion;
  share: number;
}

interface Driven {
  kind: Kind;
  side: 1 | -1;
  bone: Object3D;
  /**
   * The inverse of this bone's parent's orientation in the figure's frame,
   * taken once. Only the two above have one, and only because nothing between
   * them and the root ever moves -- the day the spine is driven, this is read
   * every frame instead.
   */
  fromParent?: Quaternion;
}

/**
 * The pose the skin is cut in once `rebind` has run: level flight at the
 * nominal airspeed, still air, no gust. That is the posture's `box`, which is
 * the shape the figure is in whenever it is not doing something, and the shape
 * every other one is a departure from.
 */
const BAKE: FlightPose = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  bank: 0,
  pitch: 0,
  vy: 0,
  speed: SPEED,
  windPhase: 0,
  gust: 0,
  view: 'tpp',
};

/**
 * How close two meshes have to be drawn before they are treated as one
 * surface, in metres. The suit's cuffs are laid over the bare wrists and
 * ankles about five millimetres clear of them and its collar over the helmet
 * about nine; those two places are the whole of where this figure has two
 * meshes near each other, and 65 pairs of vertices and 72 come out of it.
 */
const SEAM = 0.01;

/**
 * Make two meshes that are modelled touching move as though they were one.
 *
 * The figure is three skinned meshes -- the bare body, the suit over it and
 * the helmet -- rigged separately, and where they meet they disagree. Measured
 * on the file: at the ankle the suit's last ring is 66 per cent shin and 34 per
 * cent foot while the skin under it is 82 per cent foot and 18 per cent shin.
 * In the pose they were all drawn in that is invisible, because every one of
 * them is exactly where it was drawn. Move the foot and they go different ways:
 * at pairs modelled within ten millimetres of each other, a steep dive opened
 * 126 millimetres of daylight and a banked turn 104. That is the gap between
 * the boot and the trouser leg, between the glove and the sleeve, and at the
 * collar.
 *
 * So wherever a vertex of one mesh was drawn within `SEAM` of a vertex of
 * another, both are given the same skin weights -- the average of the two,
 * renormalised over the four bones that survive it. Averaging rather than
 * letting one side win is what makes the result independent of the order the
 * meshes were loaded in, and it costs nothing: what matters at a seam is not
 * whose weights are used but that one pair of numbers is used twice.
 *
 * The two surfaces then go through one and the same blend matrix, so neither
 * can slide out from under the other. That is not quite a promise that the gap
 * keeps its size -- a blend of four bone matrices is not a rigid motion, and a
 * joint bent far enough stretches whatever stands on it -- but measured over
 * the flight's four shapes, the cuffs now open by 0.0 millimetres in every one
 * of them and the collar, which sits on the neck and is worked hardest, by 3.7
 * at its worst. Against 126 that is the fault gone.
 *
 * It runs in the pose the file was drawn in, before `rebind`, and the order is
 * not a preference. The bake is itself a skinning, so two vertices a
 * millimetre apart with different weights are two vertices the bake pulls
 * apart; welded afterwards it is already too late, and welding afterwards
 * cannot be made to work at all, because at `BAKE` every bone matrix is the
 * identity and changing a weight moves nothing.
 *
 * 165 ms over 34 000 vertices, once, behind the veil.
 *
 * There is no test on the normals. One was tried, on the argument that a cuff
 * must not weld to whatever happens to be behind it; it threw away a fifth of
 * the seam, including the pairs that opened furthest, because the rim of a
 * sleeve faces along the rim and not out of it. Nothing on this figure has two
 * meshes within a centimetre of each other except where they are meant to read
 * as one surface, so being close is the whole test.
 */
function weldSeams(meshes: readonly SkinnedMesh[]): number {
  interface Vertex {
    mesh: number;
    at: number;
    position: Vector3;
    /** Which cell of the hash grid it lands in, worked out once. */
    cell: [number, number, number];
  }
  const all: Vertex[] = [];
  for (const [mesh, skin] of meshes.entries()) {
    const position = skin.geometry.attributes.position as BufferAttribute;
    for (let at = 0; at < position.count; at += 1) {
      const where = new Vector3().fromBufferAttribute(position, at);
      all.push({
        mesh,
        at,
        position: where,
        cell: [Math.floor(where.x / SEAM), Math.floor(where.y / SEAM), Math.floor(where.z / SEAM)],
      });
    }
  }

  // A hash grid at the seam's own size, so a lookup reads 27 cells. The cell
  // a vertex lands in is worked out once and kept as three integers: hashing
  // off the metres again for each of the 27 meant three divisions and three
  // floors nine hundred thousand times over, which was most of what this cost.
  const hash = (x: number, y: number, z: number) =>
    (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) | 0;
  const grid = new Map<number, number[]>();
  // Which meshes have a vertex in each cell, one bit each. A neighbourhood
  // holding one mesh cannot hold a seam, and on this figure that is nearly all
  // of them: the check turns 1.5 million distances into 30 thousand.
  const present = new Map<number, number>();
  for (const [i, v] of all.entries()) {
    const key = hash(v.cell[0]!, v.cell[1]!, v.cell[2]!);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
    present.set(key, (present.get(key) ?? 0) | (1 << v.mesh));
  }

  // Union-find over the whole point set. A pair is not enough: two vertices of
  // the suit's rim can both be nearest the same vertex of the skin, and
  // averaging pair by pair then writes that skin vertex twice and leaves the
  // first of the two suit vertices disagreeing with what it was welded to.
  // Whole groups, averaged once, is the only form of this that is
  // order-independent -- which it has to be, because nothing decides which
  // mesh the loader hands over first.
  const parent = all.map((_, i) => i);
  const root = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    for (let step = i; parent[step] !== r;) {
      const next = parent[step]!;
      parent[step] = r;
      step = next;
    }
    return r;
  };
  for (const [i, v] of all.entries()) {
    const [cx, cy, cz] = v.cell as [number, number, number];
    let neighbours = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          neighbours |= present.get(hash(cx + dx, cy + dy, cz + dz)) ?? 0;
        }
      }
    }
    // Nothing but this vertex's own mesh anywhere near: no seam here.
    if ((neighbours & ~(1 << v.mesh)) === 0) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(hash(cx + dx, cy + dy, cz + dz));
          if (!bucket) continue;
          for (const j of bucket) {
            const w = all[j]!;
            // Only across meshes: two vertices of one mesh at one place are a
            // split for a uv or a crease and already move together.
            if (w.mesh === v.mesh || j <= i) continue;
            if (v.position.distanceTo(w.position) >= SEAM) continue;
            const a = root(i);
            const b = root(j);
            if (a !== b) parent[a] = b;
          }
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (const i of all.keys()) {
    const r = root(i);
    const group = groups.get(r);
    if (group) group.push(i);
    else groups.set(r, [i]);
  }

  /** A vertex's weights as a bone-to-share map, which is what can be averaged. */
  const read = (
    j: BufferAttribute,
    w: BufferAttribute,
    v: number,
    into: Map<number, number>,
    scale: number,
  ) => {
    for (let k = 0; k < 4; k += 1) {
      const weight = w.getComponent(v, k);
      if (weight <= 0) continue;
      const bone = j.getComponent(v, k);
      into.set(bone, (into.get(bone) ?? 0) + weight * scale);
    }
  };

  let welded = 0;
  const touched = new Set<number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const share = new Map<number, number>();
    for (const i of group) {
      const v = all[i]!;
      const geometry = meshes[v.mesh]!.geometry;
      read(
        geometry.attributes.skinIndex as BufferAttribute,
        geometry.attributes.skinWeight as BufferAttribute,
        v.at,
        share,
        1 / group.length,
      );
    }
    // The four heaviest bones, renormalised: what a `skinIndex`/`skinWeight`
    // pair can hold, and what the shader reads.
    const top = [...share].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((sum, [, weight]) => sum + weight, 0) || 1;
    for (const i of group) {
      const v = all[i]!;
      const geometry = meshes[v.mesh]!.geometry;
      const joints = geometry.attributes.skinIndex as BufferAttribute;
      const weights = geometry.attributes.skinWeight as BufferAttribute;
      for (let k = 0; k < 4; k += 1) {
        joints.setComponent(v.at, k, top[k]?.[0] ?? 0);
        weights.setComponent(v.at, k, (top[k]?.[1] ?? 0) / total);
      }
      touched.add(v.mesh);
      welded += 1;
    }
  }
  for (const mesh of touched) {
    (meshes[mesh]!.geometry.attributes.skinIndex as BufferAttribute).needsUpdate = true;
    (meshes[mesh]!.geometry.attributes.skinWeight as BufferAttribute).needsUpdate = true;
  }
  return welded;
}

/**
 * Move the bind pose to wherever the skeleton is standing.
 *
 * The body was modelled in a T -- arms straight out to the sides, which is
 * where a human is easiest to draw and rig -- and it is never once flown in
 * it. Measured against the flight's own envelope, the upper arm points 93
 * degrees off the T in level flight, and no less than that in anything else:
 * the figure spends its whole life about a right angle from the only pose its
 * skin is correct in. Linear blend skinning averages two rigid moves, so at a
 * joint bent that far the surface between the two bones folds into the chord
 * between them. The armpit measured 0.82 of its modelled area on average and
 * 0.25 at its worst triangle **flying straight and level**, which is the
 * hard-edged wedge between the arm and the chest.
 *
 * So the skin is re-cut. Every vertex is skinned once into the pose the figure
 * flies in, that becomes the stored geometry, and the mesh is bound again
 * where it now stands. At `BAKE` the skinning is then the identity by
 * construction -- not approximately, exactly -- and the armpit in level flight
 * goes to 1.00 and 0.98, and in a banked turn from 0.79 and 0.15 to 0.94 and
 * 0.73.
 *
 * It does nothing for a steep dive or a climb, and that is not a shortfall of
 * the bake but the size of what it is asked to cover: the upper arm swings 120
 * degrees between the box and the dive and 102 between the box and the climb,
 * so no single pose can be near both ends. Baking at the middle was tried and
 * is the trade it looks like -- the dive's worst triangle goes 0.04 to 0.36
 * and the climb's 0.12 to 0.34, while level flight falls 0.98 to 0.60, the
 * turn 0.73 to 0.53, and the cuffs, which the box holds shut to a tenth of a
 * millimetre, open eight. Level flight is what the figure is in whenever the
 * pilot is not doing something, so level flight is what it is cut for. What
 * would actually fix the dive is a smaller swing or a second bone in the
 * shoulder, and both of those are somebody's decision rather than this
 * function's.
 *
 * The arithmetic is three's own, from `skinning_vertex` and
 * `skinnormal_vertex`: the blended matrix is `bindMatrixInverse . sum(w .
 * bone) . bindMatrix`, a point goes through it whole and a normal through its
 * linear part.
 *
 * Meshes can share one `Skeleton` -- all three of this figure's do -- so every
 * geometry is re-cut before any of them is bound again: the other order bakes
 * the second mesh against bones that already believe they are at rest, and
 * leaves it in the T while the first one flies.
 *
 * 88 ms over 34 000 vertices, once, behind the veil, next to two megabytes of
 * download.
 */
function rebind(meshes: readonly SkinnedMesh[]): void {
  const blend = new Matrix4();
  const bone = new Matrix4();
  const point = new Vector3();

  for (const mesh of meshes) {
    const { skeleton, geometry } = mesh;
    const position = geometry.attributes.position as BufferAttribute;
    const normal = geometry.attributes.normal as BufferAttribute | undefined;
    const joints = geometry.attributes.skinIndex as BufferAttribute;
    const weights = geometry.attributes.skinWeight as BufferAttribute;
    // The bone's whole move, bind to now, once per bone rather than once per
    // vertex: 31 inversions instead of 26 000 weighted ones.
    const moved = skeleton.bones.map((b, i) =>
      new Matrix4().multiplyMatrices(b.matrixWorld, skeleton.boneInverses[i]!),
    );

    for (let v = 0; v < position.count; v += 1) {
      blend.elements.fill(0);
      for (let k = 0; k < 4; k += 1) {
        const w = weights.getComponent(v, k);
        if (w === 0) continue;
        const m = moved[joints.getComponent(v, k)];
        if (!m) continue;
        for (let e = 0; e < 16; e += 1) blend.elements[e]! += w * m.elements[e]!;
      }
      bone.multiplyMatrices(blend, mesh.bindMatrix);
      blend.multiplyMatrices(mesh.bindMatrixInverse, bone);
      position.setXYZ(v, ...point.fromBufferAttribute(position, v).applyMatrix4(blend).toArray());
      if (!normal) continue;
      // A direction: the translation is dropped and the length is thrown away,
      // which is right for a rotation and is the best a skin can do at a joint
      // the blend has squashed.
      point.fromBufferAttribute(normal, v).transformDirection(blend);
      normal.setXYZ(v, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    // Both are the T-pose's, and nothing else recomputes them.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  // And only now the bind itself, which is three's own `bind` with no matrix
  // handed to it: that recomputes `boneInverses` from where the bones are
  // standing and takes `bindMatrix` from where the mesh is standing. Both,
  // not just the first. `bindMode` here is the default, `attached`, under
  // which three recomputes `bindMatrixInverse` from the mesh's live world
  // matrix every frame -- so a `bindMatrix` left at what it was when the file
  // was loaded is no longer the thing that inverse undoes, and the whole body
  // comes out through the quarter turn that lays it down. Half a rebind put
  // the fixture's skin 640 mm from where it had just been baked.
  for (const mesh of meshes) mesh.bind(mesh.skeleton);
}

/**
 * Which bones carry a glove and which a boot: the whole of each limb, not just
 * the hand and the foot. The body under the suit ends in a rim at the wrist
 * and the ankle weighted to the forearm and the shin, and painting only the
 * hand's bones left that rim skin-coloured -- a pale line round every cuff.
 */
const GEAR: ReadonlyArray<{ swatch: 'gloves' | 'boots'; bones: ReadonlySet<string> }> = [
  {
    swatch: 'gloves',
    bones: new Set(
      ['Left', 'Right'].flatMap((side) => [
        `${side}Arm`,
        `${side}ForeArm`,
        `${side}Hand`,
        `${side}FingerBase`,
        `${side}HandFinger1`,
        `${side[0]}Thumb`,
      ]),
    ),
  },
  {
    swatch: 'boots',
    bones: new Set(
      ['Left', 'Right'].flatMap((side) => [`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`]),
    ),
  },
];

/** How much of vertex `v` the bones in `bones` move, 0..1. */
const shareOf = (mesh: SkinnedMesh, bones: ReadonlySet<string>) => {
  const joints = mesh.geometry.attributes.skinIndex as BufferAttribute;
  const weights = mesh.geometry.attributes.skinWeight as BufferAttribute;
  const names = mesh.skeleton.bones.map((bone) => bone.name);
  return (v: number) => {
    let share = 0;
    for (let k = 0; k < 4; k += 1) {
      if (bones.has(names[joints.getComponent(v, k)] ?? '')) share += weights.getComponent(v, k);
    }
    return share;
  };
};

/**
 * Put gloves on the bare body, and paint the feet the boots' colour under the
 * boots `cobble` builds over them.
 *
 * The file is three meshes: a suit, a helmet, and the body under them -- and
 * of the body only what the suit does not cover survived the trim, which is
 * two hands, two feet and a neck. Left as they were drawn, a flyer in a black
 * suit went barefoot and bare-handed, and from the chase camera the soles were
 * the palest thing on the figure. So the body is painted per vertex, off its
 * own skin weights; the neck stays the skin it was. A glove is not
 * re-modelled, because a glove has fingers where a hand does. A boot is, see
 * `cobble`: painted toes read as a sock with five toes in it.
 *
 * The body is found by what it is rather than by what Blender called it: the
 * mesh with the most vertices on the hands and feet. Its material's own colour
 * goes to white, because a vertex colour multiplies it, and the skin's colour
 * moves into the vertices with everything else.
 */
function dress(skins: readonly SkinnedMesh[]): SkinnedMesh | null {
  let body: SkinnedMesh | null = null;
  let most = 0;
  for (const mesh of skins) {
    const of = GEAR.map(({ bones }) => shareOf(mesh, bones));
    let count = 0;
    for (let v = 0; v < mesh.geometry.attributes.position!.count; v += 1) {
      if (of.some((share) => share(v) > 0.5)) count += 1;
    }
    if (count > most) [body, most] = [mesh, count];
  }
  if (!body) return null;

  const skin = new Color(OUTFIT.skin);
  const gear = GEAR.map(({ swatch }) => new Color(OUTFIT[swatch]));
  const of = GEAR.map(({ bones }) => shareOf(body, bones));
  const count = body.geometry.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  const paint = new Color();
  for (let v = 0; v < count; v += 1) {
    paint.copy(skin);
    // A limb's share is everything that is not the neck, so a vertex is gear
    // almost everywhere and skin only where the neck's bones hold it. Shares
    // of the two kinds cannot overlap: an arm and a leg share no vertex.
    for (const [i, share] of of.entries()) paint.lerp(gear[i]!, Math.min(1, share(v)));
    paint.toArray(colors, v * 3);
  }
  body.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = body.material as MeshStandardMaterial;
  material.vertexColors = true;
  material.color.set(0xffffff);
  material.needsUpdate = true;
  return body;
}

/**
 * The boot's shape: how many sections along the foot, how many points round
 * each, how far it stands off the foot in metres, and how square a section is
 * -- two is an ellipse, and a boot is squarer than that across the toe box.
 */
const BOOT = { sections: 18, around: 24, clear: 0.005, square: 3 };

/**
 * Build a boot over each foot, as a skinned mesh of its own.
 *
 * A painted foot is a foot: from above, the chase camera's usual place, its
 * outline is five toes. So the boot is grown over it instead. The foot is
 * measured in its own frame -- origin at the ankle, `ahead` level toward the
 * toe joint, `up` the file's own -- and cut into sections along its length;
 * each section is a rounded rectangle (a superellipse of power `square`) set on
 * the middle of what the foot has in that slab and grown until every vertex of
 * the slab is inside it, then `clear` more. Taking the extent across every toe
 * at once is what turns five toes into a toe box. The two ends are closed with
 * a fan, and the top is left to the suit's cuff, which comes down over it.
 *
 * A boot vertex wears the skin weights of the nearest vertex of the foot, so
 * the boot bends at the ankle the way the foot under it does and cannot slide
 * off it. It is built in the pose the file was drawn in, before the bake, which
 * then carries it into the box like every other mesh.
 */
function cobble(body: SkinnedMesh): SkinnedMesh[] {
  const position = body.geometry.attributes.position as BufferAttribute;
  const joints = body.geometry.attributes.skinIndex as BufferAttribute;
  const weights = body.geometry.attributes.skinWeight as BufferAttribute;
  const toLocal = body.matrixWorld.clone().invert();
  const where = (name: string) => {
    const bone = body.skeleton.bones.find((b) => b.name === name);
    if (!bone) throw new Error(`the figure has no bone called ${name}; it is not a CMU skeleton`);
    return bone.getWorldPosition(new Vector3()).applyMatrix4(toLocal);
  };
  const material = new MeshStandardMaterial({ color: OUTFIT.boots, roughness: 0.62, name: 'boots' });
  const boots: SkinnedMesh[] = [];
  const p = new Vector3();

  for (const side of ['Left', 'Right']) {
    // A body with no bare foot on this side has nothing to put a boot on.
    const onFoot = shareOf(body, new Set([`${side}Foot`, `${side}ToeBase`]));
    const bare: number[] = [];
    for (let v = 0; v < position.count; v += 1) if (onFoot(v) >= 0.5) bare.push(v);
    if (bare.length === 0) continue;
    const ankle = where(`${side}Foot`);
    const up = new Vector3(0, 1, 0);
    const ahead = where(`${side}ToeBase`).sub(ankle).setY(0).normalize();
    const across = new Vector3().crossVectors(up, ahead).normalize();
    const foot = bare.map((v) => {
      p.fromBufferAttribute(position, v).sub(ankle);
      return { v, a: p.dot(ahead), s: p.dot(across), h: p.dot(up) };
    });
    const heel = Math.min(...foot.map((f) => f.a));
    const tip = Math.max(...foot.map((f) => f.a));
    const step = (tip - heel) / (BOOT.sections - 1);
    const n = BOOT.square;

    // One section per step, each over a slab a step wide either side, so
    // neighbouring sections overlap and a toe between two is in both.
    const sections = Array.from({ length: BOOT.sections }, (_, i) => {
      const a = heel + i * step;
      const slab = foot.filter((f) => Math.abs(f.a - a) <= step);
      const s0 = Math.min(...slab.map((f) => f.s)),
        s1 = Math.max(...slab.map((f) => f.s));
      const h0 = Math.min(...slab.map((f) => f.h)),
        h1 = Math.max(...slab.map((f) => f.h));
      const s = (s0 + s1) / 2,
        h = (h0 + h1) / 2;
      let rs = Math.max((s1 - s0) / 2, 0.005),
        rh = Math.max((h1 - h0) / 2, 0.005);
      // Grown until the whole slab is inside: a superellipse through the
      // corners of the slab's box would cut them, so it is sized by the
      // vertex that sticks out furthest rather than by the box.
      let reach = 1;
      for (const f of slab) {
        reach = Math.max(reach, (Math.abs(f.s - s) / rs) ** n + (Math.abs(f.h - h) / rh) ** n);
      }
      reach **= 1 / n;
      rs = rs * reach + BOOT.clear;
      rh = rh * reach + BOOT.clear;
      return { a, s, h, rs, rh };
    });

    const vertices: number[] = [];
    const ring = (i: number, j: number) => 1 + i * BOOT.around + (j % BOOT.around);
    const point = (a: number, s: number, h: number) =>
      vertices.push(
        ...ankle
          .clone()
          .addScaledVector(ahead, a)
          .addScaledVector(across, s)
          .addScaledVector(up, h)
          .toArray(),
      );
    // The heel's cap centre first, then the rings, then the toe's cap centre.
    point(heel - BOOT.clear, sections[0]!.s, sections[0]!.h);
    for (const { a, s, h, rs, rh } of sections) {
      for (let j = 0; j < BOOT.around; j += 1) {
        const t = (j / BOOT.around) * Math.PI * 2;
        const c = Math.cos(t),
          d = Math.sin(t);
        point(
          a,
          s + rs * Math.sign(c) * Math.abs(c) ** (2 / n),
          h + rh * Math.sign(d) * Math.abs(d) ** (2 / n),
        );
      }
    }
    const last = sections[sections.length - 1]!;
    point(tip + BOOT.clear, last.s, last.h);
    const toe = vertices.length / 3 - 1;

    // `across`, `up`, `ahead` is right-handed and a ring runs counter-clockwise
    // seen from ahead, so these windings face out.
    const index: number[] = [];
    for (let j = 0; j < BOOT.around; j += 1) {
      index.push(0, ring(0, j + 1), ring(0, j));
      for (let i = 0; i + 1 < BOOT.sections; i += 1) {
        index.push(ring(i, j), ring(i, j + 1), ring(i + 1, j));
        index.push(ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j));
      }
      index.push(toe, ring(BOOT.sections - 1, j), ring(BOOT.sections - 1, j + 1));
    }

    // Each boot vertex takes the weights of the nearest vertex of the foot.
    const count = vertices.length / 3;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const at = new Vector3();
    for (let v = 0; v < count; v += 1) {
      at.fromArray(vertices, v * 3);
      let nearest = foot[0]!.v,
        best = Infinity;
      for (const f of foot) {
        const d = p.fromBufferAttribute(position, f.v).distanceToSquared(at);
        if (d < best) [nearest, best] = [f.v, d];
      }
      for (let k = 0; k < 4; k += 1) {
        skinIndex[v * 4 + k] = joints.getComponent(nearest, k);
        skinWeight[v * 4 + k] = weights.getComponent(nearest, k);
      }
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    const boot = new SkinnedMesh(geometry, material);
    boot.name = `${side}Boot`;
    boot.position.copy(body.position);
    boot.quaternion.copy(body.quaternion);
    boot.scale.copy(body.scale);
    boot.frustumCulled = false;
    boot.castShadow = true;
    body.parent?.add(boot);
    boot.updateMatrixWorld(true);
    boot.bind(body.skeleton, body.bindMatrix);
    boots.push(boot);
  }
  return boots;
}

/**
 * Give the suit and the helmet the outfit's colours instead of the file's.
 *
 * Both come out of the file textured, and both textures are one colour: the
 * suit's a flat 0x2a2a2a, the helmet's black under 98 per cent of its
 * vertices. Together with the bare body that made the figure one dark
 * silhouette with a pale neck in it. So each loses its texture and takes a
 * colour from `OUTFIT`, and a change of colour is one line there.
 *
 * Found by what they are rather than what Blender called them: of the textured
 * meshes, the one that rides the head -- nine in ten of its vertices mostly on
 * that bone -- is the helmet, and the other is the suit.
 */
function recolour(skins: readonly SkinnedMesh[]): void {
  for (const mesh of skins) {
    const material = mesh.material as MeshStandardMaterial;
    const map = material.map;
    if (!map) continue;
    const onHead = shareOf(mesh, new Set(['Head']));
    const count = mesh.geometry.attributes.position!.count;
    let headed = 0;
    for (let v = 0; v < count; v += 1) if (onHead(v) > 0.5) headed += 1;
    material.map = null;
    material.color.set(headed > 0.9 * count ? OUTFIT.helmet : OUTFIT.suit);
    material.needsUpdate = true;
    map.dispose();
  }
}

export interface AuthoredFigure extends Avatar {
  /** Every mesh of the figure, for a layer switch and for counting triangles. */
  readonly meshes: Object3D[];
  readonly triangles: number;
}

/**
 * Load the authored figure. Async because the file is a megabyte off the
 * network; `main.ts` awaits it behind the veil, in the stage the ground is
 * built in, so nothing is waiting on it that the player can see.
 */
export async function loadAuthoredFigure(url: string = figureUrl): Promise<AuthoredFigure> {
  return createAuthoredFigure((await new GLTFLoader().loadAsync(url)).scene);
}

/**
 * The retarget, with nothing about where the body came from.
 *
 * Split out from the load so that the arithmetic can be tested against a
 * skeleton made of bones rather than against a megabyte of .glb: the two
 * questions are different ones. Whether three accepts the file is
 * `tools/figure/load_glb.mjs`. Whether an arm ends up where the posture says
 * it should, on a skeleton whose every bone carries a rest rotation of its
 * own, is a test in Node -- and it is the question this file can get wrong.
 *
 * `body` is a scene holding a CMU-named skeleton. It is taken over, not
 * copied.
 */
export function createAuthoredFigure(body: Object3D): AuthoredFigure {
  const object = new Group();
  object.name = 'figure';
  // `YXZ`, the same order the flight's angles are written in, so the figure and
  // the camera agree about what a bank is.
  object.rotation.order = 'YXZ';

  // The authored body stands along +Y and faces +Z; the engine's flies along
  // +Z and looks down. A quarter turn about x takes the one to the other: the
  // head ends up ahead and the face ends up pointing at the ground, which is
  // where a person in a track suit is looking.
  const laid = new Group();
  laid.name = 'authored';
  laid.rotation.x = Math.PI / 2;
  // Along z, not down y: a matrix is translate-then-rotate read outwards, so
  // the offset is applied in the parent's frame, after the quarter turn. The
  // body has to move back along the axis it now lies on, and written as `-y`
  // it instead hung the figure most of a metre under the flight with its hips
  // a metre ahead of the camera's target.
  laid.position.z = -HIPS;
  laid.add(body);
  object.add(laid);

  const named = (name: string): Object3D => {
    const bone = body.getObjectByName(name);
    if (!bone) throw new Error(`the figure has no bone called ${name}; it is not a CMU skeleton`);
    return bone;
  };

  // `spine: true` moves the arch out of the hips, where a body with no
  // vertebra between them and the shoulders has to keep it, and into the three
  // that are there for it.
  const posture = createPosture({ spine: true });
  const driven: Driven[] = [];
  // The parents' orientations are taken while the figure is still at the
  // origin and unrotated, so what comes back is in the figure's own frame --
  // which is the frame the posture speaks, quarter turn and all.
  object.updateMatrixWorld(true);
  for (const kind of Object.keys(DRIVEN) as Kind[]) {
    // The shoulder is written by the collarbone loop, which needs where the
    // collarbone actually ended up and so cannot be done from a table.
    if (kind === 'shoulder') continue;
    const [left, right] = DRIVEN[kind];
    for (const [name, side] of [[left, 1] as const, [right, -1] as const]) {
      const bone = named(name);
      driven.push(
        UNDER_A_STRANGER.has(kind)
          ? { kind, side, bone, fromParent: bone.parent!.getWorldQuaternion(new Quaternion()).invert() }
          : { kind, side, bone },
      );
    }
  }

  const bendable = (names: typeof SPINE): Bendable[] =>
    names.map(({ bone, share }) => ({ bone: named(bone), share, rest: named(bone).quaternion.clone() }));
  const spine = bendable(SPINE);
  const neck = bendable(NECK);
  /** The hips, which nothing drives, so this is taken once. */
  const chest = named('Hips').getWorldQuaternion(new Quaternion());
  const collar = ([1, -1] as const).map((side) => {
    const bone = named(side > 0 ? 'LeftShoulder' : 'RightShoulder');
    return { side, bone, rest: bone.quaternion.clone(), arm: named(side > 0 ? 'LeftArm' : 'RightArm') };
  });

  /**
   * Where each upper arm stands in the pose the skin is cut in, in the
   * figure's frame. Read off the bone itself, twice: once here, where it is
   * still the authored T, and again after `rebind` below has re-cut the skin,
   * where it is the box. It is the second reading that is used every frame --
   * the first only gets the bake there.
   *
   * It has to be the pose the skin is cut in and not some other rest, because
   * this is what the collarbone takes its share of. Pointed at the T while the
   * skin was still cut in the T, it handed the girdle a fifth of a right angle
   * in level flight and left the other four fifths on the shoulder joint,
   * which is linear blend skinning's worst case: the armpit measured a quarter
   * of its modelled area with the figure flying straight. Now both are the
   * box, level flight is no departure at all, and what the girdle shares out
   * is only the dive, the climb and the turn.
   */
  const bindArm = collar.map(({ arm }) => arm.getWorldQuaternion(new Quaternion()));
  const IDENTITY = new Quaternion();
  const bend = new Quaternion();
  const sway = new Quaternion();
  const axis = new Vector3();
  const inv = new Quaternion();
  const spineTop = new Quaternion();
  const neckRoot = new Quaternion();
  const swing = new Quaternion();
  const clavicle = new Quaternion();

  /**
   * Bend a chain by `x` about the figure's left-right axis and `y` about its
   * up, and give back where the last bone ended up.
   *
   * The axes are the figure's and they are taken into each bone's parent's
   * frame **every frame**, from where that parent actually is. Taken once at
   * load they were wrong the moment anything above the chain moved: the neck
   * hangs off the top of the spine, so a back arched twenty degrees had the
   * head yawing about an axis twenty degrees out. A bone carries whatever
   * rotation Blender gave it, so its own local x is not the figure's and never
   * was the thing to use.
   */
  const flex = (chain: Bendable[], x: number, y: number, parent: Quaternion): Quaternion => {
    for (const part of chain) {
      inv.copy(parent).invert();
      bend.setFromAxisAngle(axis.set(1, 0, 0).applyQuaternion(inv), x * part.share);
      sway.setFromAxisAngle(axis.set(0, 1, 0).applyQuaternion(inv), y * part.share);
      part.bone.quaternion.copy(bend).multiply(sway).multiply(part.rest);
      parent.multiply(part.bone.quaternion);
    }
    return parent;
  };

  /**
   * Put every joint where the posture says, and give back nothing: the caller
   * has already placed the body itself. Split out of `update` because the
   * rebind below has to run exactly this, once, before the first frame.
   */
  const place = (pose: FlightPose, dt: number) => {
    posture.update(pose, dt);
    for (const d of driven) {
      if (d.fromParent) d.bone.quaternion.copy(d.fromParent).multiply(posture.world(d.kind, d.side));
      else d.bone.quaternion.copy(posture.local(d.kind, d.side));
    }
    // The back arches and leans; the head lifts its chin and looks into the
    // turn. Both are negative about x, because a rotation that way takes the
    // figure's `ahead` toward its `up` -- and up, for a body lying on the
    // air, is away from the ground it is looking at. The spine is walked
    // first because everything above it hangs off where it finished.
    const top = flex(spine, -posture.torso.arch, posture.torso.lean, spineTop.copy(chest));
    flex(neck, -posture.gaze.pitch, posture.gaze.yaw, neckRoot.copy(top));
    // The collarbones, and the arms on the ends of them. The girdle takes a
    // quarter of however far the upper arm has travelled from the shape the
    // skin was cut in, about the axis it travelled on; the arm then gets
    // exactly where the posture says it should be, in the figure's frame,
    // whatever the chest and the collarbone did on the way. That last part
    // is what keeps `POSE`'s thresholds meaning what they were measured to
    // mean: they were taken against the flight's envelope, not against an
    // arm that an arched back had already carried somewhere else.
    for (const { side, bone, rest, arm } of collar) {
      const wanted = posture.world('shoulder', side);
      swing.copy(wanted).multiply(inv.copy(bindArm[side > 0 ? 0 : 1]!).invert());
      swing.slerp(IDENTITY, 1 - CLAVICLE);
      bone.quaternion.copy(top).invert().multiply(swing).multiply(top).multiply(rest);
      clavicle.copy(top).multiply(bone.quaternion);
      arm.quaternion.copy(clavicle).invert().multiply(wanted);
    }
  };

  const meshes: Object3D[] = [];
  const skins: SkinnedMesh[] = [];
  let view: FlightPose['view'] | null = null;
  let triangles = 0;
  body.traverse((child) => {
    const mesh = child as Object3D & { isMesh?: boolean; geometry?: { index?: { count: number } | null } };
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    if ((mesh as Object3D & { isSkinnedMesh?: boolean }).isSkinnedMesh) skins.push(mesh as SkinnedMesh);
    const index = mesh.geometry?.index;
    if (index) triangles += index.count / 3;
    // A figure seen from every side of a chase camera is never culled by its
    // own bounding sphere usefully, and a skinned mesh's is the bind pose's.
    (mesh as Object3D & { frustumCulled: boolean }).frustumCulled = false;
    // The flyer's shadow on the ground is most of how its height reads from the
    // chase camera; the body the engine used to grow cast one, and this does.
    mesh.castShadow = true;
  });

  // The seams first and the bake second, in that order and not the other one.
  // A seam is two vertices drawn in the same place, which is a fact about the
  // file and is only true in the pose the file is in; and the bake is itself a
  // skinning, so two vertices a millimetre apart with different weights are
  // two vertices the bake pulls apart. Welded afterwards it is already too
  // late -- and welding afterwards cannot even be made to work, because at
  // `BAKE` every bone matrix is the identity and changing a weight moves
  // nothing at all.
  weldSeams(skins);
  // What the figure wears. Before the bake, because the boots are meshes of
  // their own and have to be carried into the box with everything else.
  recolour(skins);
  const bare = dress(skins);
  for (const boot of bare ? cobble(bare) : []) {
    meshes.push(boot);
    skins.push(boot);
    triangles += boot.geometry.index!.count / 3;
  }
  // Then re-cut the skin in the pose it flies in. `dt = 0` is the posture's "be
  // there now", so what is baked is the shape itself and not a spring on its
  // way to it, and the bake happens before a frame has been asked for, so no
  // vertex the player has seen ever moves. Afterwards the bones are standing
  // in the bind pose, which is what makes re-reading `bindArm` here the whole
  // of keeping the collarbone's reference and the skin's the same pose: from
  // now on level flight is no departure at all and the girdle shares out only
  // what the flight actually asks for.
  place(BAKE, 0);
  object.updateMatrixWorld(true);
  rebind(skins);
  for (const [i, joint] of collar.entries()) {
    bindArm[i]!.copy(joint.arm.getWorldQuaternion(spineTop));
    // And the collarbone's own rest, for the same reason. It is the one bone
    // here whose frame is a departure from something stored rather than a
    // place the posture names, so leaving it at the authored T while the skin
    // moved to the box made it snap a fifth of a right angle back on the first
    // frame -- and the arm, which is given where it should be whatever the
    // girdle did, swung the same amount the other way to cover it.
    joint.rest.copy(joint.bone.quaternion);
  }

  return {
    object,
    meshes,
    triangles,
    eye: EYE,
    // The envelope the flight's clearance is written against in `World.ts`,
    // measured for a 1.7 m body; this one is 1.67 m. Keeping them apart is what
    // keeps a change of body from also being a change to how it may fly.
    bounds: HUMAN_BOUNDS,
    update(pose: FlightPose, dt: number) {
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
      place(pose, dt);
      // The first person draws none of the figure: this is one surface on one
      // skeleton, and a skin cannot be culled part by part to leave the arms.
      if (pose.view !== view) {
        view = pose.view;
        for (const mesh of meshes) mesh.visible = view === 'tpp';
      }
    },
    dispose() {
      object.traverse((child) => {
        const node = child as Object3D & {
          geometry?: { dispose(): void };
          material?: { dispose(): void } | { dispose(): void }[];
        };
        node.geometry?.dispose();
        const material = node.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      object.clear();
    },
  };
}

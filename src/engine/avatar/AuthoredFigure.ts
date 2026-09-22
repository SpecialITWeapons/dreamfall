// The figure as someone drew it, rather than as the engine grows it.
//
// This implements `Avatar` and nothing else: it is handed a flight pose every
// frame and puts the whole body where the flight says, in its bind pose. It
// does not move a single joint. That is the point of it -- the authored
// skeleton is 31 CMU bones against the engine's 16, and retargeting the pose
// system onto it is the next piece of work, not this one. Standing this up
// first answers the question that decides whether that work is worth doing:
// whether a mesh bound in a T-pose reads at all when it is laid out flat and
// flown, and what the seams look like at the shoulders and hips where linear
// blend skinning is worst.
//
// `?figure=glb` picks it. Without that the procedural body is unchanged.
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HUMAN_BOUNDS, type Avatar, type FlightPose } from './Avatar';
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
const UNDER_A_STRANGER: ReadonlySet<Kind> = new Set(['shoulder', 'hip']);

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
 * A vertebra, with the two axes it bends about written in its parent's frame.
 *
 * Not its own local axes: those carry whatever rotation the bone was exported
 * with, and `LowerBack`'s idea of x is not the figure's. What an arch is, is a
 * rotation about the figure's own left-right axis, so that axis is taken into
 * each parent's frame once and the bend is applied there.
 */
interface Vertebra {
  bone: Object3D;
  /** What the bone was exported wearing; the bend is laid over this, never instead of it. */
  rest: Quaternion;
  /** The figure's x and y, in this bone's parent's frame. */
  archAxis: Vector3;
  leanAxis: Vector3;
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
  const gltf = await new GLTFLoader().loadAsync(url);

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
  laid.add(gltf.scene);
  object.add(laid);

  // `spine: true` moves the arch out of the hips, where a body with no
  // vertebra between them and the shoulders has to keep it, and into the three
  // that are there for it.
  const posture = createPosture({ spine: true });
  const driven: Driven[] = [];
  const spine: Vertebra[] = [];
  // The parents' orientations are taken while the figure is still at the
  // origin and unrotated, so what comes back is in the figure's own frame --
  // which is the frame the posture speaks, quarter turn and all.
  object.updateMatrixWorld(true);
  for (const kind of Object.keys(DRIVEN) as Kind[]) {
    const [left, right] = DRIVEN[kind];
    for (const [name, side] of [[left, 1] as const, [right, -1] as const]) {
      const bone = gltf.scene.getObjectByName(name);
      if (!bone) throw new Error(`the figure has no bone called ${name}; it is not a CMU skeleton`);
      driven.push(
        UNDER_A_STRANGER.has(kind)
          ? { kind, side, bone, fromParent: bone.parent!.getWorldQuaternion(new Quaternion()).invert() }
          : { kind, side, bone },
      );
    }
  }

  for (const { bone: name, share } of SPINE) {
    const bone = gltf.scene.getObjectByName(name);
    if (!bone) throw new Error(`the figure has no bone called ${name}; it is not a CMU skeleton`);
    const intoParent = bone.parent!.getWorldQuaternion(new Quaternion()).invert();
    spine.push({
      bone,
      share,
      rest: bone.quaternion.clone(),
      archAxis: new Vector3(1, 0, 0).applyQuaternion(intoParent),
      leanAxis: new Vector3(0, 1, 0).applyQuaternion(intoParent),
    });
  }

  const bend = new Quaternion();
  const sway = new Quaternion();
  const meshes: Object3D[] = [];
  let view: FlightPose['view'] | null = null;
  let triangles = 0;
  gltf.scene.traverse((child) => {
    const mesh = child as Object3D & { isMesh?: boolean; geometry?: { index?: { count: number } | null } };
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    const index = mesh.geometry?.index;
    if (index) triangles += index.count / 3;
    // A figure seen from every side of a chase camera is never culled by its
    // own bounding sphere usefully, and a skinned mesh's is the bind pose's --
    // which here is a T-pose, so an arm laid along the flight leaves it.
    (mesh as Object3D & { frustumCulled: boolean }).frustumCulled = false;
  });

  return {
    object,
    meshes,
    triangles,
    eye: EYE,
    // The same envelope the procedural figure flies in. The authored body is
    // 1.67 m against its 1.7 m and the flight's clearance is written against
    // these numbers in `World.ts`, so sharing them is what keeps a swap of the
    // figure from also being a change to how it is allowed to fly.
    bounds: HUMAN_BOUNDS,
    update(pose: FlightPose, dt: number) {
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
      posture.update(pose, dt);
      for (const d of driven) {
        if (d.fromParent) d.bone.quaternion.copy(d.fromParent).multiply(posture.world(d.kind, d.side));
        else d.bone.quaternion.copy(posture.local(d.kind, d.side));
      }
      // The back. Both bends are about axes in the parent's frame, so they go
      // on in front of the rest rather than after it, and the bone keeps
      // whatever the exporter gave it underneath.
      for (const v of spine) {
        bend.setFromAxisAngle(v.archAxis, -posture.torso.arch * v.share);
        sway.setFromAxisAngle(v.leanAxis, posture.torso.lean * v.share);
        v.bone.quaternion.copy(bend).multiply(sway).multiply(v.rest);
      }
      // The first person draws none of the figure, for the same reason the
      // grown one draws none of itself: this is one surface on one skeleton and
      // a skin cannot be culled part by part.
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

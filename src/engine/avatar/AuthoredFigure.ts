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
import { Group, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HUMAN_BOUNDS, type Avatar, type FlightPose } from './Avatar';
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

  const meshes: Object3D[] = [];
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
    update(pose: FlightPose) {
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.set(-pose.pitch, pose.heading, pose.bank);
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

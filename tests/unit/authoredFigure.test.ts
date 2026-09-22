import {
  Bone,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { createAuthoredFigure } from '../../src/engine/avatar/AuthoredFigure';
import { createPosture } from '../../src/engine/avatar/Posture';
import { SPEED } from '../../src/engine/flight/FlightController';

/**
 * A CMU skeleton made of bones rather than of a megabyte of .glb, and every
 * one of them wearing a rest rotation of its own. That is the whole point of
 * the fixture: the retarget's arithmetic must not assume that anything starts
 * at identity, because on the real figure nothing does.
 */
const TREE: Record<string, readonly string[]> = {
  Hips: ['LowerBack', 'LHipJoint', 'RHipJoint'],
  LowerBack: ['Spine'],
  Spine: ['Spine1'],
  Spine1: ['LeftShoulder', 'RightShoulder', 'Neck'],
  LeftShoulder: ['LeftArm'],
  LeftArm: ['LeftForeArm'],
  RightShoulder: ['RightArm'],
  RightArm: ['RightForeArm'],
  Neck: ['Neck1'],
  Neck1: ['Head'],
  LHipJoint: ['LeftUpLeg'],
  LeftUpLeg: ['LeftLeg'],
  LeftLeg: ['LeftFoot'],
  RHipJoint: ['RightUpLeg'],
  RightUpLeg: ['RightLeg'],
  RightLeg: ['RightFoot'],
};

const skeleton = () => {
  let n = 0;
  const build = (name: string): Object3D => {
    const bone = new Object3D();
    bone.name = name;
    // Nothing tidy: a spread of angles and offsets no formula here could
    // accidentally agree with.
    n += 1;
    bone.quaternion.setFromEuler(new Euler(0.11 * n, -0.07 * n, 0.19 * n, 'XYZ'));
    bone.position.set(0, 0.1 + 0.01 * n, 0);
    for (const child of TREE[name] ?? []) bone.add(build(child));
    return bone;
  };
  const root = new Object3D();
  root.add(build('Hips'));
  return root;
};

const pose = (over: Partial<FlightPose> = {}): FlightPose => ({
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
  ...over,
});

/**
 * Where a bone faces **in the figure's own frame** -- x left, y up, z ahead --
 * which is the frame the posture speaks. Not the scene's: `object` carries the
 * flight's own pitch, heading and bank, so a bone's world rotation is the
 * figure's pose with the whole flight laid on top of it.
 */
const worldOf = (figure: { object: Object3D }, name: string) => {
  figure.object.updateMatrixWorld(true);
  const inFigure = figure.object.getWorldQuaternion(new Quaternion()).invert();
  return inFigure.multiply(figure.object.getObjectByName(name)!.getWorldQuaternion(new Quaternion()));
};

describe('createAuthoredFigure', () => {
  it('refuses a skeleton that is not a CMU one, by name', () => {
    const stripped = skeleton();
    stripped.getObjectByName('LeftForeArm')!.name = 'arm.L';
    expect(() => createAuthoredFigure(stripped)).toThrow(/LeftForeArm/);
  });

  it('puts the upper arm exactly where the posture says, however far the back is arched', () => {
    // A hard dive: the spine is bent about as far as this figure ever bends it.
    const dive = pose({ vy: -20, pitch: -0.4, speed: SPEED * 1.4, bank: 0.3 });
    const figure = createAuthoredFigure(skeleton());
    figure.update(dive, 0);
    const expected = createPosture({ spine: true });
    expected.update(dive, 0);
    for (const [side, bone] of [
      [1, 'LeftArm'],
      [-1, 'RightArm'],
    ] as const) {
      // This is the invariant the whole retarget rests on. The arm hangs off a
      // collarbone that hangs off a spine that is bending, and `POSE`'s
      // thresholds were measured against the flight's envelope rather than
      // against an arm an arched back had already carried somewhere else.
      expect(worldOf(figure, bone).angleTo(expected.world('shoulder', side))).toBeLessThan(1e-6);
    }
  });

  it('the collarbone goes about a quarter of the way with the arm', () => {
    const rest = createAuthoredFigure(skeleton());
    rest.update(pose(), 0);
    const restArm = worldOf(rest, 'LeftArm');
    const restCollar = worldOf(rest, 'LeftShoulder');

    const track = pose({ vy: -20, pitch: -0.4, speed: SPEED * 1.45 });
    const moved = createAuthoredFigure(skeleton());
    moved.update(track, 0);
    const travelled = restArm.angleTo(worldOf(moved, 'LeftArm'));
    const carried = restCollar.angleTo(worldOf(moved, 'LeftShoulder'));
    expect(travelled).toBeGreaterThan(0.25);
    // Not exact: the collarbone also rides the spine, which is arching under
    // it, and the arm's travel is measured against a rest the spine has since
    // left. A quarter and change is the shape of it, and nought or a half
    // would both be the fault worth catching.
    expect(carried / travelled).toBeGreaterThan(0.12);
    expect(carried / travelled).toBeLessThan(0.45);
  });

  it('the joints under a driven bone wear the posture as it comes', () => {
    const flight = pose({ vy: -12, pitch: -0.3, speed: SPEED * 1.2, bank: -0.2 });
    const figure = createAuthoredFigure(skeleton());
    figure.update(flight, 0);
    const expected = createPosture({ spine: true });
    expected.update(flight, 0);
    for (const [bone, kind, side] of [
      ['LeftForeArm', 'elbow', 1],
      ['RightLeg', 'knee', -1],
      ['LeftFoot', 'ankle', 1],
    ] as const) {
      const local = figure.object.getObjectByName(bone)!.quaternion;
      expect(local.angleTo(expected.local(kind, side))).toBeLessThan(1e-6);
    }
  });

  it('a level glide leaves the back straight and the head square', () => {
    const figure = createAuthoredFigure(skeleton());
    const straight = skeleton();
    figure.update(pose(), 0);
    for (const bone of ['LowerBack', 'Spine', 'Spine1', 'Neck', 'Neck1', 'Head']) {
      const now = figure.object.getObjectByName(bone)!.quaternion;
      expect(now.angleTo(straight.getObjectByName(bone)!.quaternion)).toBeLessThan(1e-6);
    }
  });

  it('reports an eye ahead of and under the body, where a face-down flyer has one', () => {
    const figure = createAuthoredFigure(skeleton());
    expect(figure.eye.z).toBeGreaterThan(0.5);
    expect(figure.eye.y).toBeLessThan(0);
    expect(figure.bounds.below).toBeGreaterThan(0);
    expect(new Vector3().copy(figure.eye).length()).toBeLessThan(1);
  });
});

/**
 * The fixture with a skin on it: two meshes over the same bones, drawn
 * touching at three vertices and weighted differently there, which is the
 * fault the real file has at its cuffs and its collar. Every other vertex is
 * a long way from the other mesh, so a weld that reached them would be caught.
 */
const skinned = () => {
  const root = skeleton();
  root.updateMatrixWorld(true);
  const bones: Bone[] = [];
  root.traverse((node) => {
    // The fixture is `Object3D`s, which is what the real loader hands over too
    // once `GLTFLoader` has flattened the armature; a `Skeleton` takes them.
    bones.push(node as unknown as Bone);
  });
  bones.shift(); // the holder the tree hangs off, which is not a joint
  const skeletonOf = new Skeleton(bones);

  /** A mesh of `at.length` vertices, each weighted as the table says. */
  const mesh = (name: string, at: Vector3[], weights: ReadonlyArray<ReadonlyArray<[string, number]>>) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        at.flatMap((v) => v.toArray()),
        3,
      ),
    );
    geometry.setAttribute(
      'normal',
      new Float32BufferAttribute(
        at.flatMap(() => [0, 1, 0]),
        3,
      ),
    );
    const joints: number[] = [];
    const shares: number[] = [];
    for (const row of weights) {
      for (let k = 0; k < 4; k += 1) {
        const entry = row[k];
        joints.push(entry ? bones.findIndex((b) => b.name === entry[0]) : 0);
        shares.push(entry ? entry[1] : 0);
      }
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(shares, 4));
    const skin = new SkinnedMesh(geometry, new MeshBasicMaterial());
    skin.name = name;
    root.add(skin);
    skin.bind(skeletonOf);
    return skin;
  };

  // Three places the two meshes touch, and one each where they do not.
  const seam = [new Vector3(0.2, 1, 0.1), new Vector3(0.21, 1.02, 0.1), new Vector3(-0.2, 0.6, 0)];
  const skin = mesh(
    'skin',
    [...seam, new Vector3(0, 2, 0)],
    [
      [['LeftFoot', 1]],
      [
        ['LeftFoot', 0.8],
        ['LeftLeg', 0.2],
      ],
      [['RightFoot', 1]],
      [['LeftArm', 1]],
    ],
  );
  // The same three places, a couple of millimetres off, weighted the other way
  // round -- which is what makes them part company the moment a foot moves.
  const suit = mesh(
    'suit',
    [...seam.map((v) => v.clone().addScalar(0.002)), new Vector3(0, -2, 0)],
    [
      [['LeftLeg', 1]],
      [
        ['LeftLeg', 0.7],
        ['LeftFoot', 0.3],
      ],
      [['RightLeg', 1]],
      [['RightArm', 1]],
    ],
  );
  return { root, skin, suit };
};

/** A vertex where three's own skinning puts it, in the mesh's frame. */
const skinnedAt = (mesh: SkinnedMesh, v: number) =>
  mesh.applyBoneTransform(v, new Vector3().fromBufferAttribute(mesh.geometry.attributes.position!, v));

const weightsAt = (mesh: SkinnedMesh, v: number) => {
  const joints = mesh.geometry.attributes.skinIndex!;
  const shares = mesh.geometry.attributes.skinWeight!;
  const share = new Map<number, number>();
  for (let k = 0; k < 4; k += 1) {
    const weight = shares.getComponent(v, k);
    if (weight > 0) share.set(joints.getComponent(v, k), weight);
  }
  return [...share].sort((a, b) => a[0] - b[0]);
};

describe('the skin the authored figure is cut in', () => {
  it('re-cuts it in the pose the figure flies in, exactly', () => {
    const { root, skin, suit } = skinned();
    const figure = createAuthoredFigure(root);
    // Level flight at the nominal airspeed: the pose `rebind` bakes to. What
    // is stored must be what three's own skinning gives back, or the bake has
    // moved the body somewhere the bind matrices do not undo.
    figure.update(pose(), 0);
    figure.object.updateMatrixWorld(true);
    for (const mesh of [skin, suit]) {
      mesh.skeleton.update();
      const position = mesh.geometry.attributes.position!;
      for (let v = 0; v < position.count; v += 1) {
        const stored = new Vector3().fromBufferAttribute(position, v);
        expect(skinnedAt(mesh, v).distanceTo(stored)).toBeLessThan(1e-6);
      }
    }
  });

  it('leaves the body somewhere else entirely, which is the point of it', () => {
    // The T the file was drawn in is nowhere near the box it is flown in, so
    // the bake has to have moved real distance. A rebind that did nothing
    // would pass the test above and fail this one.
    const { root, skin } = skinned();
    const before = new Vector3().fromBufferAttribute(skin.geometry.attributes.position!, 3);
    createAuthoredFigure(root);
    const after = new Vector3().fromBufferAttribute(skin.geometry.attributes.position!, 3);
    expect(after.distanceTo(before)).toBeGreaterThan(0.05);
  });

  it('gives two meshes drawn touching the same weights, and leaves the rest alone', () => {
    const { root, skin, suit } = skinned();
    createAuthoredFigure(root);
    for (let v = 0; v < 3; v += 1) expect(weightsAt(suit, v)).toEqual(weightsAt(skin, v));
    // The two vertices that are two metres from anything keep what they were
    // drawn with: a weld that reached across the body would be a worse fault
    // than the seam it was fixing.
    expect(weightsAt(skin, 3)).toHaveLength(1);
    expect(weightsAt(suit, 3)).toHaveLength(1);
    expect(weightsAt(skin, 3)[0]![1]).toBe(1);
  });

  it('holds the seam shut through every shape the flight can fly', () => {
    const { root, skin, suit } = skinned();
    const figure = createAuthoredFigure(root);
    const drawn: number[] = [];
    figure.update(pose(), 0);
    figure.object.updateMatrixWorld(true);
    skin.skeleton.update();
    for (let v = 0; v < 3; v += 1) drawn.push(skinnedAt(skin, v).distanceTo(skinnedAt(suit, v)));

    for (const flown of [
      pose({ pitch: -0.4, vy: -18, speed: SPEED * 1.45 }),
      pose({ pitch: 0.5, vy: 9, speed: SPEED * 0.8 }),
      pose({ bank: 0.45, pitch: -0.1, vy: -4, speed: SPEED * 1.2 }),
    ]) {
      figure.update(flown, 0);
      figure.object.updateMatrixWorld(true);
      skin.skeleton.update();
      for (let v = 0; v < 3; v += 1) {
        // Not equal: a blend of bone matrices is not a rigid motion, so a
        // seam may close. It may not open, which is the fault that shows.
        expect(skinnedAt(skin, v).distanceTo(skinnedAt(suit, v))).toBeLessThan(drawn[v]! + 1e-4);
      }
    }
  });
});

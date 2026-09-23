// The figure against the file it was drawn in: how its limbs are turned, and
// what it wears that the file does not.
//
// `authoredFigure.test.ts` checks the retarget on a fixture, and a fixture can
// say whether a bone points where the posture says. It cannot say whether a
// limb is **wrung**: a roll about the limb's own axis is invisible to any test
// that compares directions, and it is the number that twists the skin. The
// legs once shipped at 154 degrees of it -- the knee hinging backwards, the
// thigh turned inside its own sleeve -- with every direction test green. The
// only thing that sees it is the real body, loaded twice: once untouched, for
// the pose the file draws each bone in, and once flown.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Box3,
  Color,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type MeshStandardMaterial,
  type SkinnedMesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { createAuthoredFigure } from '../../src/engine/avatar/AuthoredFigure';
import { OUTFIT } from '../../src/engine/avatar/Outfit';
import { SPEED, createFlightController } from '../../src/engine/flight/FlightController';

// Enough of a browser for three's GLTFLoader to parse a .glb in Node: it wants
// `self`, and it hands every embedded image to an <img> whose load event
// nothing here would ever fire. No pixel is decoded and none is needed.
const stubImage = () => {
  const handlers: Record<string, Array<(event: unknown) => void>> = {};
  return {
    width: 1,
    height: 1,
    addEventListener: (kind: string, fn: (event: unknown) => void) => void (handlers[kind] ??= []).push(fn),
    removeEventListener: () => {},
    set src(_url: string) {
      queueMicrotask(() => (handlers.load ?? []).forEach((fn) => fn({ target: this })));
    },
  };
};
const global = globalThis as unknown as Record<string, unknown>;
global.self = globalThis;
global.document = { createElementNS: stubImage, createElement: () => ({ getContext: () => null }) };
URL.createObjectURL = () => 'blob:stub';
URL.revokeObjectURL = () => {};

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../src/engine/avatar/figure.glb');
const load = async (): Promise<Object3D> => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bytes = readFileSync(FILE);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  return gltf.scene;
};

/** Each limb bone with the one above it and the one it points at. */
const LIMBS = ['Left', 'Right'].flatMap((side) => {
  const s = side[0]!;
  return [
    { parent: `${side}Shoulder`, bone: `${side}Arm`, child: `${side}ForeArm` },
    { parent: `${side}Arm`, bone: `${side}ForeArm`, child: `${side}Hand` },
    { parent: `${s}HipJoint`, bone: `${side}UpLeg`, child: `${side}Leg` },
    { parent: `${side}UpLeg`, bone: `${side}Leg`, child: `${side}Foot` },
    { parent: `${side}Leg`, bone: `${side}Foot`, child: `${side}ToeBase` },
  ];
});

/** The part of `q` that turns about the unit axis `a`, in radians, -pi..pi. */
const twist = (q: Quaternion, a: Vector3) => {
  const t = 2 * Math.atan2(q.x * a.x + q.y * a.y + q.z * a.z, q.w);
  return Math.abs(t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t);
};

describe('the authored figure against its own file', () => {
  it('never wrings a limb inside its sleeve, however the flight is flown', async () => {
    // The file, laid down the way the figure lays it, so that both copies are
    // read in the figure's own frame: x left, y up, z ahead.
    const file = await load();
    const laid = new Object3D();
    laid.rotation.x = Math.PI / 2;
    laid.add(file);
    laid.updateMatrixWorld(true);
    const drawn = (name: string) => file.getObjectByName(name)!.getWorldQuaternion(new Quaternion());
    const at = (name: string) => file.getObjectByName(name)!.getWorldPosition(new Vector3());

    const figure = createAuthoredFigure(await load());
    const inFigure = new Quaternion();
    const flown = (name: string) =>
      inFigure.clone().multiply(figure.object.getObjectByName(name)!.getWorldQuaternion(new Quaternion()));

    // Two numbers per bone, and they are different faults. `limb` is the bone
    // against the file, about its own drawn axis: the leg that was turned
    // round. `joint` is the bone against its parent, against the same pair in
    // the file: a forearm or a foot turned on the bone above it, which is what
    // tears the skin at the elbow, the knee and the ankle.
    const worst = new Map<string, { limb: number; joint: number }>();
    const measure = () => {
      figure.object.updateMatrixWorld(true);
      inFigure.copy(figure.object.getWorldQuaternion(new Quaternion())).invert();
      for (const { parent, bone, child } of LIMBS) {
        const axis = at(child).sub(at(bone)).normalize();
        const limb = twist(flown(bone).multiply(drawn(bone).invert()), axis);
        const now = flown(parent).invert().multiply(flown(bone));
        const then = drawn(parent).invert().multiply(drawn(bone));
        const joint = twist(now.multiply(then.invert()), axis.applyQuaternion(drawn(parent).invert()));
        const w = worst.get(bone) ?? { limb: 0, joint: 0 };
        worst.set(bone, { limb: Math.max(w.limb, limb), joint: Math.max(w.joint, joint) });
      }
    };

    // Every corner of the envelope, on the real controller: the steepest dive
    // it can hold, the steepest climb, a hard turn, and level flight in between.
    for (const [yaw, climb, y] of [
      [0, 0, 800],
      [0, -1, 1400],
      [0, 1, 200],
      [-1, 0, 800],
    ] as const) {
      const flight = createFlightController({
        seed: 42,
        groundAt: () => -4000,
        dayPhase: () => 0.3,
        start: { y },
      });
      for (let i = 0; i < 900; i++) {
        flight.fly(i > 30 ? yaw : 0, i > 30 ? climb : 0);
        flight.step(1 / 60);
        const s = flight.state;
        const pose: FlightPose = {
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
          bank: s.bank,
          pitch: s.pitch,
          vy: s.vy,
          speed: s.speed,
          windPhase: s.windPhase,
          gust: s.gust,
          view: 'tpp',
        };
        figure.update(pose, i === 0 ? 0 : 1 / 60);
        if (i % 5 === 0) measure();
      }
    }

    const deg = (r: number) => (r * 180) / Math.PI;
    for (const [bone, { limb, joint }] of worst) {
      // The arm -- upper and forearm both, since the forearm carries the upper
      // arm's roll -- is left out of the first bound on purpose: the box holds
      // the forearm pointing at the head, which is a shoulder rotated a right
      // angle outward from the T the file was drawn in, about a hundred degrees
      // of real, intended roll. The legs have no such excuse.
      // Measured: thigh 6, shin 18, foot 24; the fault read 177, 164 and 158.
      if (!bone.endsWith('Arm')) expect(deg(limb), `${bone} against the file`).toBeLessThan(45);
      // Elbow 6, knee 3, ankle 21. The forearm and the shin do not turn on the
      // bone above them in any shape; the foot rolls a little on the shin,
      // which is an ankle and allowed to.
      if (!bone.endsWith('UpLeg') && bone !== 'LeftArm' && bone !== 'RightArm')
        expect(deg(joint), `${bone} on the bone above it`).toBeLessThan(35);
    }
  }, 30_000);

  it('wears boots over its feet, gloves on its hands, and the colours of the outfit', async () => {
    const figure = createAuthoredFigure(await load());
    const skins = figure.meshes as SkinnedMesh[];
    const named = (name: string) => skins.find((m) => m.name === name);
    const colour = (mesh: SkinnedMesh) => (mesh.material as MeshStandardMaterial).color.getHex();
    const body = named('first_modelsMesh')!;
    expect(colour(named('male_skinsuit_01Mesh')!)).toBe(OUTFIT.suit);
    expect(colour(named('motorcyclehelmetMesh')!)).toBe(OUTFIT.helmet);

    /** How much of vertex `v` of the body the named bones move. */
    const share = (mesh: SkinnedMesh, bones: string[]) => {
      const joints = mesh.geometry.attributes.skinIndex as BufferAttribute;
      const weights = mesh.geometry.attributes.skinWeight as BufferAttribute;
      return (v: number) => {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) {
          if (bones.includes(mesh.skeleton.bones[joints.getComponent(v, k)]!.name))
            sum += weights.getComponent(v, k);
        }
        return sum;
      };
    };
    const position = body.geometry.attributes.position as BufferAttribute;
    const painted = body.geometry.attributes.color as BufferAttribute;
    const gloves = new Color(OUTFIT.gloves);
    const skin = new Color(OUTFIT.skin);
    const onHand = share(body, ['LeftHand', 'LeftHandFinger1', 'RightHand', 'RightHandFinger1']);
    const onHead = share(body, ['Head']);
    // Stored as 32-bit floats, so a colour is itself to about seven digits.
    const same = (a: Color, b: Color) =>
      Math.max(...a.toArray().map((x, i) => Math.abs(x - b.toArray()[i]!))) < 1e-6;
    let hands = 0;
    for (let v = 0; v < position.count; v += 1) {
      const c = new Color().fromBufferAttribute(painted, v);
      // A hand is a glove all over, and the face under the helmet is still a face.
      if (onHand(v) > 0.99) {
        hands += 1;
        expect(same(c, gloves)).toBe(true);
      }
      if (onHead(v) > 0.99) expect(same(c, skin)).toBe(true);
    }
    expect(hands).toBeGreaterThan(1000);

    for (const side of ['Left', 'Right']) {
      const boot = named(`${side}Boot`)!;
      expect(boot, `${side} boot`).toBeDefined();
      // Eight vertex buffers a pipeline, and WebGPU draws nothing past them.
      expect(Object.keys(boot.geometry.attributes).length).toBeLessThanOrEqual(8);
      // Carried by that leg and nothing else, or a boot follows the wrong foot.
      const leg = [`${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`];
      const own = share(boot, leg);
      for (let v = 0; v < boot.geometry.attributes.position!.count; v += 1) expect(own(v)).toBeCloseTo(1, 5);
      // And over the whole foot: every vertex the foot bones hold is inside it.
      // Both are stored in the pose the skin was cut in, by the same bones.
      const box = new Box3().setFromBufferAttribute(boot.geometry.attributes.position as BufferAttribute);
      box.expandByScalar(0.002);
      const onFoot = share(body, [`${side}Foot`, `${side}ToeBase`]);
      let feet = 0;
      for (let v = 0; v < position.count; v += 1) {
        if (onFoot(v) < 0.5) continue;
        feet += 1;
        expect(box.containsPoint(new Vector3().fromBufferAttribute(position, v))).toBe(true);
      }
      expect(feet).toBeGreaterThan(1000);
    }
  });

  it('skins its limbs from the file, not from the box, in the shapes furthest from the box', async () => {
    // The skin is cut in the box and corrected per shape. In each corrected
    // shape it must come out where skinning straight from the file puts it --
    // the whole of what the correction is for -- and in the box it must not
    // move at all.
    const file = await load();
    file.updateMatrixWorld(true);
    const drawn = file.getObjectByName('male_skinsuit_01Mesh') as SkinnedMesh;
    const fromFile = new Map(
      drawn.skeleton.bones.map((b) => [
        b.name,
        new Matrix4().copy(drawn.matrixWorld).invert().multiply(b.matrixWorld),
      ]),
    );
    const figure = createAuthoredFigure(await load());
    const suit = figure.meshes.find((m) => m.name === 'male_skinsuit_01Mesh') as SkinnedMesh;
    const joints = suit.geometry.attributes.skinIndex as BufferAttribute;
    const weights = suit.geometry.attributes.skinWeight as BufferAttribute;
    const names = suit.skeleton.bones.map((b) => b.name);
    const pose = (over: Partial<FlightPose>): FlightPose => ({
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
    for (const [name, flown] of [
      ['track', pose({ pitch: -0.42, vy: -16, speed: SPEED * 1.48 })],
      ['climb', pose({ pitch: 0.56, vy: 12, speed: SPEED * 0.75 })],
    ] as const) {
      figure.update(flown, 0);
      figure.object.updateMatrixWorld(true);
      suit.skeleton.update();
      const moved = new Map(
        suit.skeleton.bones.map((b) => [
          b.name,
          new Matrix4()
            .copy(suit.matrixWorld)
            .invert()
            .multiply(b.matrixWorld)
            .multiply(fromFile.get(b.name)!.clone().invert()),
        ]),
      );
      let worst = 0,
        corrected = 0;
      const at = new Vector3();
      for (let v = 0; v < joints.count; v += 1) {
        const want = new Vector3();
        at.fromBufferAttribute(drawn.geometry.attributes.position as BufferAttribute, v);
        for (let k = 0; k < 4; k += 1) {
          const w = weights.getComponent(v, k);
          if (w)
            want.addScaledVector(at.clone().applyMatrix4(moved.get(names[joints.getComponent(v, k)]!)!), w);
        }
        const got = suit.getVertexPosition(v, new Vector3());
        const cut = suit.applyBoneTransform(
          v,
          new Vector3().fromBufferAttribute(suit.geometry.attributes.position!, v),
        );
        worst = Math.max(worst, got.distanceTo(want));
        corrected = Math.max(corrected, got.distanceTo(cut));
      }
      // The welded seams moved some weights after the file was drawn, and a
      // tenth of a millimetre is float32 over a metre and a half of body.
      expect(worst, `${name}: from the file`).toBeLessThan(1e-4);
      // And the correction is doing something: without it the skin is centimetres away.
      expect(corrected, `${name}: the correction`).toBeGreaterThan(0.01);
    }
    figure.update(pose({}), 0);
    expect(suit.morphTargetInfluences!.every((w) => w < 1e-6)).toBe(true);
  });

  it('holds its head up and turns its face into a turn, which is what a face does', async () => {
    // The face, as the file draws it, points ahead of a standing body; laid
    // down, that is straight at the ground. Read it into the head's own frame
    // once, from the untouched file, and follow the head with it.
    const file = await load();
    const laid = new Object3D();
    laid.rotation.x = Math.PI / 2;
    laid.add(file);
    laid.updateMatrixWorld(true);
    const drawnHead = file.getObjectByName('Head')!.getWorldQuaternion(new Quaternion());
    const faceInHead = new Vector3(0, -1, 0).applyQuaternion(drawnHead.invert());
    const figure = createAuthoredFigure(await load());
    const face = (bank: number) => {
      figure.update(
        {
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
          bank,
          pitch: 0,
          vy: 0,
          speed: SPEED,
          windPhase: 0,
          gust: 0,
          view: 'tpp',
        },
        0,
      );
      figure.object.updateMatrixWorld(true);
      const inFigure = figure.object.getWorldQuaternion(new Quaternion()).invert();
      const head = inFigure.multiply(
        figure.object.getObjectByName('Head')!.getWorldQuaternion(new Quaternion()),
      );
      return faceInHead.clone().applyQuaternion(head);
    };
    const deg = (r: number) => (r * 180) / Math.PI;
    // Level flight: the eyes ahead of the chest, somewhere between the ground
    // ahead and the horizon -- not on the ground under the figure, where a face
    // pointed down the spine had them.
    const level = face(0);
    const up = deg(Math.atan2(level.z, -level.y));
    expect(up).toBeGreaterThan(30);
    expect(up).toBeLessThan(60);
    expect(Math.abs(level.x)).toBeLessThan(0.05);
    // A turn: the face goes round toward the inner side. A negative bank takes
    // the left side down, and left is +x. The turn used to tip an ear and leave
    // the face where it was, which this reads as zero.
    expect(deg(Math.atan2(face(-0.47).x, -face(-0.47).y))).toBeGreaterThan(20);
    expect(deg(Math.atan2(face(0.47).x, -face(0.47).y))).toBeLessThan(-20);
  });
});

// The authored figure's limbs, measured against the file they were drawn in.
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
import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { createAuthoredFigure } from '../../src/engine/avatar/AuthoredFigure';
import { createFlightController } from '../../src/engine/flight/FlightController';

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
});

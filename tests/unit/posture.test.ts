import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { JOINTS, createPosture } from '../../src/engine/avatar/Posture';
import { SPEED } from '../../src/engine/flight/FlightController';

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

const UP = new Vector3(0, 1, 0);
/** Where a limb points in the figure's frame: the posture's own rotation, applied to +Y. */
const points = (q: Quaternion) => new Vector3().copy(UP).applyQuaternion(q);

describe('createPosture', () => {
  it('drives ten joints: five a side, and nothing that is not a limb', () => {
    expect(JOINTS).toHaveLength(10);
    expect(new Set(JOINTS.map((j) => j.kind))).toEqual(
      new Set(['shoulder', 'elbow', 'hip', 'knee', 'ankle']),
    );
    expect(JOINTS.filter((j) => j.side === 1)).toHaveLength(5);
  });

  it('walks the chain: a limb in the figure frame is its parent with its own laid on', () => {
    const posture = createPosture();
    posture.update(pose({ pitch: -0.3, speed: SPEED * 1.3 }), 0.4);
    for (const side of [1, -1] as const) {
      // The elbow hangs off the shoulder, the knee off the hip, the ankle off
      // the knee. If `world` and `local` ever disagree about that, a skeleton
      // with a clavicle in the way is posed from one and a skeleton without
      // one from the other, and the two bodies fly differently.
      const chain: Array<['shoulder' | 'hip', 'elbow' | 'knee' | 'ankle']> = [
        ['shoulder', 'elbow'],
        ['hip', 'knee'],
      ];
      for (const [above, below] of chain) {
        const expected = posture.world(above, side).clone().multiply(posture.local(below, side));
        expect(posture.world(below, side).angleTo(expected)).toBeLessThan(1e-5);
      }
      const ankle = posture.world('knee', side).clone().multiply(posture.local('ankle', side));
      expect(posture.world('ankle', side).angleTo(ankle)).toBeLessThan(1e-5);
      // A chain root's own rotation is its orientation, because the engine
      // hangs it straight off the chest.
      expect(posture.world('shoulder', side).angleTo(posture.local('shoulder', side))).toBe(0);
    }
  });

  it('mirrors across the body, and only across the body', () => {
    const posture = createPosture();
    posture.update(pose(), 0);
    // Only the two joints that hang off the chest, and only on `x`. The
    // shapes themselves are mirrored, but the air is not: the flutter runs 2.1
    // radians out of phase between the sides on purpose, so the figure does not
    // flap like a bird. That swing is about the figure's own x for a joint on
    // the chest, which moves y and z and leaves x alone -- so a shoulder still
    // mirrors there. An elbow does not mirror on any axis, because it wears its
    // shoulder's swing before its own, and asserting that it did would be
    // asking for the flapping back.
    for (const kind of ['shoulder', 'hip'] as const) {
      const left = points(posture.world(kind, 1));
      const right = points(posture.world(kind, -1));
      expect(right.x).toBeCloseTo(-left.x, 6);
      expect(Math.abs(left.x)).toBeGreaterThan(0.1);
    }
  });

  it('`dt <= 0` is "be there now", which is how a world places a body before its first frame', () => {
    const dive = pose({ pitch: -0.4, speed: SPEED * 1.4 });
    const now = createPosture();
    now.update(dive, 0);
    const slow = createPosture();
    for (let i = 0; i < 400; i++) slow.update(dive, 0.02);
    for (const { kind, side } of JOINTS) {
      // Eight seconds of settling arrives where one placement does, to within
      // six degrees. It is not closer than that and should not be: the drift
      // the air puts through a joint is a function of how long the figure has
      // been flying, so the one placed at t = 0 and the one flown to t = 8 are
      // reading the noise at two different places. What is being asked here is
      // that the shapes are there at once, not that the weather is.
      expect(now.world(kind, side).angleTo(slow.world(kind, side))).toBeLessThan(0.1);
    }
  });

  it('a dive sweeps the arms back and a climb does not', () => {
    const dive = createPosture();
    dive.update(pose({ pitch: -0.4, speed: SPEED * 1.4 }), 0);
    const climb = createPosture();
    climb.update(pose({ pitch: 0.5, speed: SPEED * 0.8 }), 0);
    // `z` is ahead: an arm swept back along the body has less of it than an arm
    // held out in front, whichever shape the names are given.
    expect(points(dive.world('shoulder', 1)).z).toBeLessThan(points(climb.world('shoulder', 1)).z);
  });
});

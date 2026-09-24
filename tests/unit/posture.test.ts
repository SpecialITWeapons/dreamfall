import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { JOINTS, POSE, createPosture } from '../../src/engine/avatar/Posture';
import { createFlightController } from '../../src/engine/flight/FlightController';
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
      expect(posture.world('shoulder', side).angleTo(posture.local('shoulder', side))).toBeLessThan(1e-6);
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

  it('the arch goes to the hips or to the spine, and never to both', () => {
    const dive = pose({ vy: -18, pitch: -0.4, speed: SPEED * 1.4 });
    const boned = createPosture({ spine: true });
    const boneless = createPosture();
    boned.update(dive, 0);
    boneless.update(dive, 0);
    // A body with vertebrae bends them; one without keeps the arch in its
    // hips, which is where an arch is felt anyway.
    expect(boned.torso.arch).toBeGreaterThan(0.2);
    expect(boneless.torso.arch).toBe(0);
    const hip = (p: ReturnType<typeof createPosture>) =>
      new Vector3().copy(UP).applyQuaternion(p.world('hip', 1));
    expect(hip(boned).angleTo(hip(boneless))).toBeGreaterThan(0.05);
  });

  it('the head looks into the turn, both ways, and by the same amount', () => {
    const left = createPosture({ spine: true });
    const right = createPosture({ spine: true });
    // A roll about +z takes the left side down, which is a turn to the left.
    left.update(pose({ bank: -POSE.bank }), 0);
    right.update(pose({ bank: POSE.bank }), 0);
    expect(left.gaze.yaw).toBeGreaterThan(0.4);
    expect(right.gaze.yaw).toBeCloseTo(-left.gaze.yaw, 6);
    // Level flight looks straight ahead, chin up: a flyer on their belly holds
    // the head up and looks ahead, and a face pointed down the line of the
    // spine is what the owner saw and asked to have lifted.
    const ahead = createPosture({ spine: true });
    ahead.update(pose(), 0);
    // `toBeCloseTo`, not `toBe`: a bank of zero comes out of the arithmetic as
    // negative zero, and `Object.is(-0, 0)` is false.
    expect(ahead.gaze.yaw).toBeCloseTo(0, 10);
    expect(ahead.gaze.pitch).toBeGreaterThan(0.9);
    expect(ahead.gaze.pitch).toBeLessThan(1.1);
  });

  it('the chin comes up further with the descent, and by less than the back bends', () => {
    const level = createPosture({ spine: true });
    level.update(pose(), 0);
    const posture = createPosture({ spine: true });
    posture.update(pose({ vy: -20 }), 0);
    const more = posture.gaze.pitch - level.gaze.pitch;
    expect(more).toBeGreaterThan(0.15);
    // Past the arch and the eyes leave the ground, which is the one thing a
    // skydiver is looking at.
    expect(more).toBeLessThan(posture.torso.arch);
  });

  it('an idle head looks about calmly, the same way every time, and never shakes', () => {
    // A minute of level flight in gusty air with the wind's phase running.
    const fly = (bank: number) => {
      const posture = createPosture({ spine: true });
      posture.update(pose({ bank }), 0);
      const seen: number[] = [];
      for (let i = 0; i < 3600; i++) {
        posture.update(pose({ bank, windPhase: i / 20, gust: 1, speed: SPEED * 1.3 }), 1 / 60);
        seen.push(posture.gaze.yaw);
      }
      return seen;
    };
    const idle = fly(0);
    expect(fly(0)).toEqual(idle);
    // It does look about...
    expect(Math.max(...idle) - Math.min(...idle)).toBeGreaterThan(0.2);
    expect(Math.max(...idle.map(Math.abs))).toBeLessThan(0.4);
    // ...and calmly: the owner saw the flutter reach the helmet and a glance
    // snap round in an eighth of a second, and read both as a head that
    // shakes. No frame turns the head more than a degree, and it never swings
    // back on itself within a quarter of a second.
    const steps = idle.slice(1).map((y, i) => y - idle[i]!);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThan(0.0175);
    let reversals = 0;
    for (let i = 15; i < steps.length; i++) {
      const moving = Math.abs(steps[i]!) > 1e-4 && Math.abs(steps[i - 15]!) > 1e-4;
      if (moving && Math.sign(steps[i]!) !== Math.sign(steps[i - 15]!)) reversals += 1;
    }
    expect(reversals).toBe(0);
    // In a hard turn the head is on the turn, and the glances are gone.
    const turn = fly(-POSE.bank).slice(120);
    expect(Math.max(...turn) - Math.min(...turn)).toBeLessThan(0.05);
  });

  it('the head nods into a climb before the body has made it', () => {
    const posture = createPosture({ spine: true });
    posture.update(pose(), 0);
    const still = posture.gaze.pitch;
    // The nose coming up at a brisk rate, for a fifth of a second.
    for (let i = 1; i <= 12; i++) posture.update(pose({ pitch: 0.02 * i }), 1 / 60);
    expect(posture.gaze.pitch).toBeGreaterThan(still + 0.03);
  });

  it('the head arrives before the shoulder does, because a person looks first', () => {
    const turning = pose({ bank: POSE.bank });
    const posture = createPosture({ spine: true });
    posture.update(pose(), 0);
    // One short step into a turn from level: how much of the way each has come.
    posture.update(turning, 1 / 60);
    const settled = createPosture({ spine: true });
    settled.update(turning, 0);
    const headShare = Math.abs(posture.gaze.yaw / settled.gaze.yaw);
    const shoulder = (p: ReturnType<typeof createPosture>) => p.world('shoulder', 1);
    const level = createPosture({ spine: true });
    level.update(pose(), 0);
    const shoulderShare =
      level.world('shoulder', 1).angleTo(shoulder(posture)) /
      level.world('shoulder', 1).angleTo(shoulder(settled));
    expect(headShare).toBeGreaterThan(shoulderShare);
  });

  /**
   * How far from level a turn has taken the shoulders, both sides summed. The
   * turn is the one shape the two sides disagree about, so one side alone
   * answers half the question.
   */
  const turned = (p: ReturnType<typeof createPosture>, level: ReturnType<typeof createPosture>) =>
    p.world('shoulder', 1).angleTo(level.world('shoulder', 1)) +
    p.world('shoulder', -1).angleTo(level.world('shoulder', -1));

  /** A second of flight at 60 Hz, with the bank written by `at`. */
  const fly = (at: (t: number) => number) => {
    const p = createPosture({ spine: true });
    for (let i = 0; i < 60; i++) p.update(pose({ bank: at(i / 60) }), 1 / 60);
    return p;
  };

  it('rolling into a turn wears more of it than sitting in the same bank', () => {
    const level = fly(() => 0);
    // Both arrive at the same bank. One has been rolling there at 0.3 rad/s,
    // which is a brisk entry and well inside what the controller can do; the
    // other has been sitting in it the whole time.
    const rolling = fly((t) => t * 0.3);
    const holding = fly(() => 0.3);
    expect(turned(rolling, level)).toBeGreaterThan(turned(holding, level) * 1.1);
  });

  it('rolling out of one starts letting go before the bank does', () => {
    const level = fly(() => 0);
    const leaving = fly((t) => 0.6 - t * 0.3);
    const holding = fly(() => 0.3);
    // Both end at 0.3 of bank. The one on its way out is already unwinding,
    // which is the only anticipation available to something that cannot see
    // what the flight is about to do.
    expect(turned(leaving, level)).toBeLessThan(turned(holding, level) * 0.9);
  });

  it('a roll rate nobody can fly would be a shape nobody can reach', () => {
    // The same guard AGENTS.md asks of every threshold in `POSE`, for the one
    // this file added: measured against the controller rather than written
    // from a picture. Holding the stick hard over rolls at about 0.32 rad/s
    // and reversing an S-turn peaks near 0.62.
    const flight = createFlightController({
      seed: 42,
      groundAt: () => -4000,
      dayPhase: () => 0.3,
      start: { y: 1000 },
    });
    let last = flight.state.bank;
    let peak = 0;
    for (let t = 0; t < 30; t += 1 / 60) {
      flight.fly(Math.floor(t / 3) % 2 === 0 ? -1 : 1, 0);
      flight.step(1 / 60);
      if (t > 0.5) peak = Math.max(peak, Math.abs(flight.state.bank - last) * 60);
      last = flight.state.bank;
    }
    expect(POSE.roll).toBeLessThanOrEqual(peak);
    // And not so far under it that every twitch of the stick is a whole roll.
    expect(POSE.roll).toBeGreaterThan(peak / 2);
  });

  it('a body placed before its first frame is not rolling', () => {
    // `dt <= 0` has no previous bank to difference against, and a resumed
    // flight arrives already banked: differencing that against a zero nobody
    // flew would throw the figure into a turn it is not in.
    const placed = createPosture({ spine: true });
    placed.update(pose({ bank: 0.35 }), 0);
    const settled = createPosture({ spine: true });
    for (let i = 0; i < 120; i++) settled.update(pose({ bank: 0.35 }), 1 / 60);
    const level = createPosture({ spine: true });
    level.update(pose(), 0);
    expect(Math.abs(turned(placed, level) - turned(settled, level))).toBeLessThan(0.05);
  });

  it('never swings an arm up over the back, however the flight is flown', () => {
    // The fault the owner saw before the arithmetic did, and the one this
    // file's blend was rebuilt for. Flown on the real controller rather than
    // on synthetic poses, because a step change in airspeed is not something
    // the flight can do and the fault was in the path between two shapes.
    //
    // The bound is 0.5 of the figure's up, about thirty degrees. The shapes
    // themselves reach 0.30 -- the turn's outer forearm -- so anything under
    // half is the authored pose and its overshoot, and anything over it is a
    // limb going somewhere nobody asked for. Before the rebuild this reached
    // 0.98 and held above 0.5 for a second and an eighth.
    for (const [name, stick] of [
      ['nose up', (t: number) => [0, t > 0.5 ? 1 : 0] as const],
      ['nose down', (t: number) => [0, t > 0.5 ? -1 : 0] as const],
      ['hard turn', (t: number) => [t > 0.5 ? -1 : 0, 0] as const],
      ['S-turn into a climb', (t: number) => [Math.floor(t / 2) % 2 === 0 ? -1 : 1, t > 2 ? 1 : 0] as const],
    ] as const) {
      const flight = createFlightController({
        seed: 42,
        groundAt: () => -4000,
        dayPhase: () => 0.3,
        start: { y: 2000 },
      });
      const posture = createPosture({ spine: true });
      let peak = -1;
      for (let i = 0; i < 600; i++) {
        const [yaw, climb] = stick(i / 60);
        flight.fly(yaw, climb);
        flight.step(1 / 60);
        const s = flight.state;
        posture.update(
          {
            x: s.x,
            y: s.y,
            z: s.z,
            heading: s.heading,
            bank: s.bank,
            pitch: s.pitch,
            vy: s.vy,
            speed: s.speed,
            windPhase: s.windPhase,
            gust: s.gust,
            view: 'tpp',
          },
          1 / 60,
        );
        for (const kind of ['shoulder', 'elbow'] as const)
          for (const side of [1, -1] as const) peak = Math.max(peak, points(posture.world(kind, side)).y);
      }
      expect(peak, name).toBeLessThan(0.5);
    }
  });

  it('a shape on its own is the shape that was written down', () => {
    // The blend was rebuilt twice over -- directions instead of rotations,
    // then the parent's frame instead of the figure's, then a decided roll on
    // the two joints that hang off the chest. None of that may move a pose
    // the figure actually holds, only the path between two of them.
    //
    // Within a hundredth, not to the bit: the air is never doing nothing. At a
    // nominal airspeed with no gust and the wind's phase at zero, the drift a
    // joint reads off the noise field is still not zero, so a limb sits a
    // fraction of a degree off the shape it wears. That is the figure
    // breathing, and asserting it away would be asserting it gone.
    const posture = createPosture();
    posture.update(pose(), 0);
    // `dir(...)` normalises, so these are the entries of `POSES.box` for the
    // left side, verbatim.
    const authored: Array<[string, 'shoulder' | 'elbow', Vector3]> = [
      ['upper arm', 'shoulder', new Vector3(0.78, -0.08, 0.62).normalize()],
      ['forearm', 'elbow', new Vector3(-0.46, 0.16, 0.87).normalize()],
    ];
    for (const [name, kind, want] of authored) {
      // A degree and a half, which is the drift and not the shape. The forearm
      // is the one that matters: it hangs off the upper arm and so reads its
      // roll as well, and a roll decided differently would show here first.
      expect(points(posture.world(kind, 1)).angleTo(want), name).toBeLessThan(0.026);
    }
  });

  it('says how much of each shape a joint wears, adding to one, and a pure shape is all of it', () => {
    const posture = createPosture({ spine: true });
    for (const [slot, flown] of [
      ['box', pose()],
      ['delta', pose({ pitch: -0.2, vy: -8, speed: SPEED * 1.14 })],
      ['track', pose({ pitch: -0.54, vy: -20.8, speed: SPEED * 1.47 })],
      ['climb', pose({ pitch: 0.71, vy: 14.3, speed: SPEED * 0.75 })],
    ] as const) {
      posture.update(flown, 0);
      for (const { kind, side } of JOINTS) {
        const shape = posture.shape(kind, side);
        expect(Object.values(shape).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        expect(shape[slot], `${slot} ${kind}`).toBeCloseTo(1, 9);
      }
    }
  });
});

import { Color, Mesh, Vector3, type Object3D } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { FPP } from '../../src/engine/flight/ChaseCamera';
import { SPEED, createFlightController } from '../../src/engine/flight/FlightController';
import { DEFAULT_OUTFIT, DEFAULT_PATTERN, outfitById } from '../../src/engine/avatar/Outfits';
import {
  HUMAN_BOUNDS,
  POSE,
  TORSO,
  UPPER,
  createProceduralHuman,
} from '../../src/engine/avatar/ProceduralHuman';

// A stand-in for the world's lit material: the figure only needs something to hang its geometry on.
const lit = () => new MeshStandardNodeMaterial();
const pose = (over: Partial<FlightPose> = {}): FlightPose => ({
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  bank: 0,
  pitch: 0,
  vy: 0,
  speed: 40,
  windPhase: 0,
  gust: 0,
  view: 'tpp',
  ...over,
});
const world = (root: Object3D, name: string) => {
  root.updateMatrixWorld(true);
  return root.getObjectByName(name)!.getWorldPosition(new Vector3());
};
/** Every mesh of this name, both sides, in the figure's own frame. */
const parts = (root: Object3D, name: string) => {
  root.updateMatrixWorld(true);
  const out: Vector3[] = [];
  root.traverse((c) => {
    if (c.name === name) out.push(c.getWorldPosition(new Vector3()));
  });
  return out;
};
const meshes = (root: Object3D) => {
  const out: Mesh[] = [];
  root.traverse((c) => {
    if (c instanceof Mesh) out.push(c);
  });
  return out;
};

/** Hold a pose until the joints have caught up: the limbs have weight, so one frame is not the answer. */
const hold = (
  human: ReturnType<typeof createProceduralHuman>,
  over: Partial<FlightPose> = {},
  seconds = 0.6,
) => {
  for (let t = 0; t < seconds; t += 0.05) human.update(pose(over), 0.05);
};

describe('createProceduralHuman', () => {
  /** A point of the figure in the figure's own frame, whatever the flight is doing to it. */
  const inBody = (human: ReturnType<typeof createProceduralHuman>, name: string) =>
    human.object.worldToLocal(parts(human.object, name)[0]!.clone());

  it('carries its limbs with weight: the far joints arrive after the near ones', () => {
    const human = createProceduralHuman(lit);
    human.update(pose(), 0); // placed, not flown: dt <= 0 means "be there now"
    const joint = (name: string) => human.object.getObjectByName(name)!.quaternion.clone();
    const shoulder = joint('shoulderL'),
      elbow = joint('elbowL');
    human.update(pose({ pitch: -0.5 }), 0.05); // one frame into a dive
    const movedShoulder = shoulder.angleTo(joint('shoulderL')),
      movedElbow = elbow.angleTo(joint('elbowL'));
    expect(movedShoulder).toBeGreaterThan(0.02);
    expect(movedElbow).toBeLessThan(movedShoulder);

    // and given the time, the same pose arrives in full: a lag, not a limit
    const settled = createProceduralHuman(lit);
    settled.update(pose({ pitch: -0.5 }), 0);
    hold(human, { pitch: -0.5 }, 2);
    for (const name of ['shoulderL', 'elbowL', 'kneeL']) {
      const there = settled.object.getObjectByName(name)!.quaternion;
      expect(joint(name).angleTo(there)).toBeLessThan(0.05);
    }
  });

  it('holds four shapes and picks them off three axes, not one', () => {
    // A skydiver changes shape in order to fly differently. This used to read
    // the shape off `pitch` alone, so a dive at 30 m/s and a dive at 62 were
    // the same figure and only the sound knew better. Four flight states, four
    // shapes, and the four are chosen so that each asks for one of them whole.
    const shape = (over: Partial<FlightPose>) => {
      const human = createProceduralHuman(lit);
      hold(human, over, 2);
      const at = (name: string) => inBody(human, name);
      const shoulder = at('shoulderL'),
        elbow = at('elbowL'),
        hand = at('wristL'),
        hip = at('hipL'),
        knee = at('kneeL'),
        ankle = at('ankleL');
      const between = (a: Vector3, b: Vector3, c: Vector3) => b.clone().sub(a).angleTo(c.clone().sub(b));
      return {
        /** How far in front of the shoulder the hands ride, m. */
        reach: hand.z - shoulder.z,
        /** Where the upper arm points along the flight: +1 straight ahead, -1 straight back. */
        armZ: new Vector3(0, 1, 0).applyQuaternion(human.object.getObjectByName('shoulderL')!.quaternion).z,
        elbow: between(shoulder, elbow, hand),
        knee: between(hip, knee, ankle),
        joints: ['shoulderL', 'elbowL', 'hipL', 'kneeL', 'ankleL'].map((n) =>
          human.object.getObjectByName(n)!.quaternion.clone(),
        ),
      };
    };
    const box = shape({}),
      delta = shape({ pitch: -0.5 }),
      track = shape({ pitch: -0.9, speed: 58 }),
      climb = shape({ pitch: 0.6, speed: 32 });

    // The same nose-down angle at two airspeeds is two different shapes, which
    // is the whole of what the second axis buys: at the nominal speed a dive is
    // a delta, and it is only a track once the figure is actually going fast.
    expect(delta.reach).toBeGreaterThan(track.reach);
    expect(delta.elbow).toBeGreaterThan(track.elbow + 0.5);

    // Only the box keeps the hands out in front. Everything the figure does in
    // order to fly differently puts them behind the shoulder -- the climb
    // included, which is the correction the owner asked for after seeing it:
    // arms reaching forward and high is a jumper's flare, and in a photograph
    // it read as a figure being lifted by the wrists.
    expect(box.reach).toBeGreaterThan(0.2);
    for (const other of [delta, track, climb]) expect(other.reach).toBeLessThan(0);
    expect(delta.reach).toBeGreaterThan(track.reach);
    // So a climb sweeps the arms back about as far as a track does, and what
    // tells the two apart is the legs: the track is a ruler and the climb keeps
    // a bend in the knee. It used to fold them hardest of all four -- the
    // owner's correction, from a photograph: in a climb *everything* trails,
    // the legs sweep back behind the arms rather than tucking up under the
    // figure, which is what a jumper does when someone is holding him up.
    expect(climb.armZ).toBeLessThan(-0.6);
    expect(Math.abs(climb.armZ - track.armZ)).toBeLessThan(0.25);
    expect(climb.knee).toBeGreaterThan(track.knee + 0.25);
    // the arm straightens on the way into the track
    expect(box.elbow).toBeGreaterThan(delta.elbow);
    expect(delta.elbow).toBeGreaterThan(track.elbow);
    expect(track.elbow).toBeLessThan(0.3);
    // and the knees run the whole way from folded to straight: the box holds
    // them hardest, the track not at all, and the two shapes that trail sit
    // between. Which of those two folds the more is not a fact about flying and
    // is deliberately not pinned here.
    expect(box.knee).toBeGreaterThan(delta.knee);
    expect(delta.knee).toBeGreaterThan(track.knee);
    expect(climb.knee).toBeLessThan(box.knee - 0.3);
    expect(track.knee).toBeLessThan(0.2);

    // and every one of them is the same shape twice: a pose set that drifts
    // with the wind phase it happens to be handed is not a pose set.
    for (const [name, one] of Object.entries({ box, delta, track, climb })) {
      const again = shape(
        {
          box: {},
          delta: { pitch: -0.5 },
          track: { pitch: -0.9, speed: 58 },
          climb: { pitch: 0.6, speed: 32 },
        }[name] as Partial<FlightPose>,
      );
      // 1e-6 and not zero: `angleTo` is an arccosine near one, where a double
      // has about eight digits left, so this is the floor and not a tolerance.
      one.joints.forEach((q, i) => expect(q.angleTo(again.joints[i]!)).toBeLessThan(1e-6));
    }
  });

  it('hangs the arms on the torso rather than beside it', () => {
    const human = createProceduralHuman(lit);
    for (const side of ['shoulderL', 'shoulderR']) {
      const joint = world(human.object, side);
      // Where the torso's surface is in the direction of the joint: the
      // ellipsoid's own radius at that bearing. A joint further out than the
      // arm is thick leaves daylight between the arm and the body, which is
      // exactly what it used to do (8.3 cm of it).
      const local = joint.clone().sub(TORSO.at);
      const reach = Math.hypot(local.x / TORSO.rx, local.y / TORSO.ry, local.z / TORSO.rz);
      const gap = local.length() * (1 - 1 / reach);
      expect(gap).toBeLessThan(UPPER.r);
    }
  });

  it('is made of enough to be a body, casts shadows, and has an eye ahead of the chest', () => {
    const human = createProceduralHuman(lit);
    // There is no ceiling here any more. `HUMAN_TRIANGLE_BUDGET` was 4 000, it
    // came from the spec's table of *starting values* and no measurement in
    // this repository ever stood behind it: the terrain draws 557 568
    // triangles a frame and the figure is one object drawn twice, so its own
    // count is two tenths of one per cent of the frame and the hands are worth
    // more than the saving. The floor stays, because a profile sanded down to
    // a stick is a real fault and this is what catches it.
    expect(human.triangles).toBeGreaterThan(700);
    expect(human.eye.z).toBeGreaterThan(0.4);
    expect(human.bounds).toEqual(HUMAN_BOUNDS);
    expect(HUMAN_BOUNDS.below).toBeGreaterThan(0);
    expect(HUMAN_BOUNDS.radius).toBeGreaterThan(0.8);
    // One surface for the body and one for the head: the head is separate only
    // so the first person can hide it, which "hide the mesh" cannot do to a
    // figure that is one mesh.
    const all = meshes(human.object);
    expect(all.length).toBe(2);
    expect(all.every((m) => m.castShadow)).toBe(true);
  });
  it('holds the box position: elbows and knees bent, hands ahead of the eye, feet above the back', () => {
    const human = createProceduralHuman(lit);
    human.update(pose(), 0.05);
    const shoulder = world(human.object, 'shoulderL'),
      elbow = world(human.object, 'elbowL'),
      hip = world(human.object, 'hipL'),
      knee = world(human.object, 'kneeL'),
      ankle = world(human.object, 'ankleL');
    // the upper arm reaches out and forward of the shoulder, the forearm turns in
    expect(elbow.x).toBeGreaterThan(shoulder.x + 0.15);
    expect(elbow.z).toBeGreaterThan(shoulder.z + 0.1);
    const upper = elbow.clone().sub(shoulder).normalize();
    const hands = [world(human.object, 'wristL'), world(human.object, 'wristR')];
    expect(hands.length).toBe(2);
    // both hands sit ahead of the eye, so the first-person view has something to show
    for (const hand of hands) {
      expect(hand.z).toBeGreaterThan(human.eye.z + 0.1);
      expect(Math.abs(hand.x)).toBeGreaterThan(0.2);
    }
    // the elbow is a real bend, not a kink: between 60 and 110 degrees
    const forearm = hands[0]!.clone().sub(elbow).normalize();
    const elbowBend = Math.acos(Math.max(-1, Math.min(1, upper.dot(forearm))));
    expect(elbowBend).toBeGreaterThan((60 * Math.PI) / 180);
    expect(elbowBend).toBeLessThan((110 * Math.PI) / 180);
    // the thigh trails back, the knee folds so the ankle rides above the hip
    expect(knee.z).toBeLessThan(hip.z - 0.3);
    expect(ankle.y).toBeGreaterThan(hip.y + 0.25);
    const thigh = knee.clone().sub(hip).normalize(),
      shin = ankle.clone().sub(knee).normalize();
    const kneeBend = Math.acos(Math.max(-1, Math.min(1, thigh.dot(shin))));
    expect(kneeBend).toBeGreaterThan((55 * Math.PI) / 180);
    expect(kneeBend).toBeLessThan((100 * Math.PI) / 180);
    // the boots break away from the shin instead of continuing it
    const toes = [world(human.object, 'toeL'), world(human.object, 'toeR')];
    expect(toes.length).toBe(2);
    const foot = toes[0]!.clone().sub(ankle).normalize();
    expect(Math.acos(Math.max(-1, Math.min(1, shin.dot(foot))))).toBeGreaterThan((20 * Math.PI) / 180);
  });
  it('answers the flight angles it is actually flown at, not only the corners', () => {
    // The shapes above are asked for at the ends of the envelope, where each of
    // them is worn whole. This asks the same question in the middle of it,
    // where the figure spends its time and every answer is a blend.
    const human = createProceduralHuman(lit);
    human.update(pose(), 0.05);
    const level = human.object.getObjectByName('shoulderL')!.quaternion.clone();
    // read the arm in the figure's own frame: the object's own pitch must not count
    const armIn = (p: Partial<FlightPose>) => {
      hold(human, p);
      return new Vector3(0, 1, 0).applyQuaternion(
        human.object.getObjectByName('shoulderL')!.quaternion.clone(),
      );
    };
    const kneeIn = (p: Partial<FlightPose>) => {
      hold(human, p);
      const at = (n: string) => inBody(human, n);
      const hip = at('hipL'),
        knee = at('kneeL'),
        ankle = at('ankleL');
      return knee.clone().sub(hip).angleTo(ankle.clone().sub(knee));
    };
    const restArm = new Vector3(0, 1, 0).applyQuaternion(level);
    // Both ends of the stick sweep the arms back out of the box: the figure is
    // doing something with the air either way, and only level flight has its
    // hands out in front.
    expect(armIn({ pitch: -0.43 }).z).toBeLessThan(restArm.z - 0.1);
    expect(armIn({ pitch: 0.55 }).z).toBeLessThan(restArm.z - 0.1);
    // Underneath, both ends open the knees out of the box: a figure doing
    // something with the air is not sitting in one. Which of the two opens them
    // further is not pinned -- measured, they land 0.547 against 0.522, and an
    // assertion on that is an assertion about a coin.
    expect(kneeIn({ pitch: -0.43 })).toBeLessThan(kneeIn({}));
    expect(kneeIn({ pitch: 0.55 })).toBeLessThan(kneeIn({}));
    // What does tell them apart is how far the arms are held off the body: a
    // dive keeps them out in the air where they steer, and a climb lays them
    // down the flanks with everything else that trails.
    expect(Math.abs(armIn({ pitch: -0.43 }).x)).toBeGreaterThan(Math.abs(armIn({ pitch: 0.55 }).x) + 0.1);
  });
  it('takes the pose: position, then yaw, pitch and roll in YXZ order', () => {
    const human = createProceduralHuman(lit);
    human.update(pose({ x: 1, y: 2, z: 3, heading: 0.5, pitch: 0.1, bank: -0.2 }), 0.05);
    expect(human.object.position.toArray()).toEqual([1, 2, 3]);
    expect(human.object.rotation.order).toBe('YXZ');
    expect(human.object.rotation.y).toBeCloseTo(0.5, 9);
    expect(human.object.rotation.x).toBeCloseTo(-0.1, 9);
    expect(human.object.rotation.z).toBeCloseTo(-0.2, 9);
  });
  it('flutters its hinges with the wind, and harder in a gust', () => {
    const human = createProceduralHuman(lit);
    const shoulderL = human.object.getObjectByName('shoulderL')!,
      knee = human.object.getObjectByName('kneeL')!;
    human.update(pose({ windPhase: 0 }), 0.05);
    const q0 = shoulderL.quaternion.clone(),
      k0 = knee.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2 }), 0.05);
    const calm = q0.angleTo(shoulderL.quaternion);
    // The floor here was 0.01 when the joints were first-order filters, which
    // move fastest in their first step. A spring starts from rest, so its first
    // step is smaller and its third is larger -- that asymmetry is the weight
    // this was changed to get, and the number moved with it rather than the
    // spring being tuned to the number.
    expect(calm).toBeGreaterThan(0.005);
    expect(calm).toBeLessThan(0.2);
    // and the knee less again in its first step, because it is a slower joint:
    // 0.17 s against the shoulder's 0.10
    expect(k0.angleTo(knee.quaternion)).toBeGreaterThan(0.002);
    human.update(pose({ windPhase: 0 }), 0.05);
    const g0 = shoulderL.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2, gust: 1 }), 0.05);
    expect(g0.angleTo(shoulderL.quaternion)).toBeGreaterThan(calm * 1.5);
  });
  it('owns no shape the flight cannot fly it into', () => {
    // The thresholds that pick a shape are numbers about a skydiver, and the
    // figure is flown by a controller with an envelope of its own. Written from
    // the picture rather than from the envelope, `dive` came out at 0.5 -- a
    // fifth past the steepest dive this world has -- so the track existed,
    // passed every test above, and could not be reached by flying.
    const corner = (yaw: number, climb: number) => {
      const flight = createFlightController({
        seed: 42,
        groundAt: () => -4000,
        dayPhase: () => 0.3,
        start: { y: 1000 },
      });
      // Room under it and half a minute of holding the stick: a corner of the
      // envelope is where the flight settles, not where it passes through.
      for (let t = 0; t < 30; t += 1 / 60) {
        flight.fly(yaw, climb);
        flight.step(1 / 60);
      }
      return flight.state;
    };
    const dive = corner(0, -1),
      climb = corner(0, 1),
      turn = corner(-1, 0);
    // Every axis saturates inside what the flight reaches, so every shape is
    // one the figure actually wears rather than one it approaches.
    expect(POSE.dive).toBeLessThanOrEqual(-dive.pitch);
    expect(1 + POSE.fast).toBeLessThanOrEqual(dive.speed / SPEED);
    expect(POSE.climb).toBeLessThanOrEqual(climb.pitch);
    expect(1 - POSE.slow).toBeGreaterThanOrEqual(climb.speed / SPEED);
    expect(POSE.bank).toBeLessThanOrEqual(Math.abs(turn.bank));

    // And it shows in the joints: pushing past the corner changes nothing,
    // because there is nothing left to change. Read at the flown airspeed on
    // both sides -- the air trails the limbs by speed as well, and that layer
    // has nothing to do with which shape is being worn.
    const joints = (over: Partial<FlightPose>) => {
      const human = createProceduralHuman(lit);
      hold(human, { windPhase: 0, ...over }, 2);
      return ['shoulderL', 'elbowL', 'hipL', 'kneeL', 'ankleL'].map((n) =>
        human.object.getObjectByName(n)!.quaternion.clone(),
      );
    };
    const same = (a: Partial<FlightPose>, b: Partial<FlightPose>) => {
      const one = joints(a),
        two = joints(b);
      one.forEach((q, i) => expect(q.angleTo(two[i]!)).toBeLessThan(1e-6));
    };
    same({ pitch: dive.pitch, speed: dive.speed }, { pitch: -0.9, speed: dive.speed });
    same({ pitch: climb.pitch, speed: climb.speed }, { pitch: 1.2, speed: climb.speed });
    same({ bank: turn.bank }, { bank: 0.9 });
  });
  it('turns with the whole body: the inner arm drops as the outer one rises', () => {
    // What this used to do was lower the inner arm by half the bank and leave
    // every other joint out of it. A bank one limb has heard of reads as a
    // twitch; a turn is a shape, so it is a pose now, laid over whatever the
    // figure was already doing.
    const arm = (over: Partial<FlightPose>, name: string) => {
      const human = createProceduralHuman(lit);
      hold(human, { windPhase: 0, ...over }, 2);
      // The joint's own quaternion, which is already the figure's frame: the
      // shoulder hangs on `body`, and the only thing between `body` and the
      // world is the roll this is trying to read past.
      return new Vector3(0, 1, 0).applyQuaternion(human.object.getObjectByName(name)!.quaternion);
    };
    const levelL = arm({}, 'shoulderL').y;
    // a left turn (bank < 0) drops the left arm and lifts the right one
    const leftL = arm({ bank: -0.4 }, 'shoulderL').y,
      leftR = arm({ bank: -0.4 }, 'shoulderR').y;
    expect(leftL).toBeLessThan(levelL - 0.1);
    expect(leftR).toBeGreaterThan(levelL + 0.1);
    // and a right turn is that turn mirrored. Measured by comparing each arm
    // against itself in the two turns, not the two arms against each other:
    // they flutter 2.1 rad apart on purpose, and that offset cancels only when
    // the same arm stands on both sides of the subtraction. Against each other
    // it leaves 13% and the assertion would have to be loose enough to miss a
    // real fault; this way the two agree to a hundredth.
    const rightL = arm({ bank: 0.4 }, 'shoulderL').y,
      rightR = arm({ bank: 0.4 }, 'shoulderR').y;
    const travelL = rightL - leftL,
      travelR = leftR - rightR;
    expect(travelL).toBeGreaterThan(0.3);
    expect(Math.abs(travelL - travelR)).toBeLessThan(0.01);
    // level flight is the shape it was: a turn that never let go would be a
    // figure permanently leaning into a corner it left minutes ago
    expect(arm({ bank: 0 }, 'shoulderL').y).toBeCloseTo(levelL, 6);
  });
  it('shows in the first person what an eye could see, and nothing an eye could not', () => {
    // This assertion used to be an inventory -- eight meshes with these four
    // names -- and an inventory is exactly what it should not be: it passed
    // while the figure showed the owner two black shapes in the top corners of
    // the frame, because those shapes were on the list.
    //
    // What is asked now is a property, and it is asked of vertices rather than
    // of mesh centres, because a centre says nothing about what crosses the
    // near plane. Anything of the figure that gets in front of the eye at all
    // has to be inside the frame. What stays behind the eye never rasterises
    // and may be anywhere.
    const human = createProceduralHuman(lit);
    hold(human, { view: 'fpp' });
    human.object.updateMatrixWorld(true);
    const visible = meshes(human.object).filter((m) => m.visible);
    // The first person's own camera, imported rather than written again: a 75
    // degree field, so half of it is 37.5 from the axis, and a near plane at
    // 0.1 m. The figure tests against the same numbers.
    const HALF = (FPP.fov / 2) * (Math.PI / 180);
    const at = new Vector3();
    let ahead = 0,
      worst = 0;
    for (const mesh of visible) {
      const position = mesh.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        at.fromBufferAttribute(position, i);
        mesh.localToWorld(at);
        human.object.worldToLocal(at).sub(human.eye);
        if (at.z <= FPP.near) continue; // behind the eye or inside the near plane: never drawn
        ahead++;
        worst = Math.max(worst, Math.atan2(Math.hypot(at.x, at.y), at.z));
      }
    }
    // Whatever is drawn is inside the frame, with the slack of a part that is
    // kept whole when its bounding sphere clips the cone.
    if (ahead > 0) expect(worst).toBeLessThan(HALF * 1.6);
    // Nothing is drawn, and that is two answers at once. The measurement: a
    // belly-to-earth jumper's arms sit 71.6 degrees off the axis of a frame
    // whose half is 37.5, and everything else is behind the eye, so there was
    // never anything here to show. The consequence: the body is one surface
    // now, and a surface cannot be culled part by part, so the choice is all of
    // it or none. What the owner was shown before was those forearms, smeared
    // across the top corners.
    expect(visible.length).toBe(0);
    human.update(pose({ view: 'tpp' }), 0.05);
    expect(meshes(human.object).every((m) => m.visible)).toBe(true);
  });
  it('feels the air it is flying through, which it used not to at all', () => {
    // `pose.speed` and `pose.vy` arrived every frame and were read nowhere.
    // The sound knew about a dive -- `AmbienceModel` reads `speed / SPEED` --
    // and the suit did not, so the rush of air got louder while the figure
    // fluttered exactly as before. The airspeed now does two separate things,
    // and they are read separately here because one of them swamps the other.
    const angle = (h: ReturnType<typeof createProceduralHuman>, name: string) =>
      h.object.getObjectByName(name)!.quaternion;
    const flown = (over: Partial<FlightPose>) => {
      const human = createProceduralHuman(lit);
      hold(human, { windPhase: 0, ...over }, 2);
      return human;
    };

    // One: the airspeed picks the shape. The same level flight at 30 m/s and at
    // 62 is a flare and a delta -- two whole shapes apart, not one shape shaking
    // harder.
    expect(
      angle(flown({ speed: 30 }), 'shoulderL').angleTo(angle(flown({ speed: 62 }), 'shoulderL')),
    ).toBeGreaterThan(0.8);

    // Two: the pressure trails the limbs, and the far ones trail further. Read
    // inside one shape -- a full track at two speeds that are both flat out --
    // because between two shapes the shoulder moves a radian and buries it.
    const track = (speed: number) => flown({ pitch: -0.9, speed });
    const slow = track(55),
      fast = track(62);
    const trail = (name: string) => angle(slow, name).angleTo(angle(fast, name));
    expect(trail('shoulderL')).toBeGreaterThan(0.02);
    expect(trail('elbowL')).toBeGreaterThan(trail('shoulderL'));
    expect(trail('ankleL')).toBeGreaterThan(trail('elbowL'));

    // Three: a dive arches the back, which the hips carry. Same airspeed,
    // different vy, so neither of the first two readings is in the way.
    const air = { windPhase: 1.1, gust: 0.3 };
    expect(
      angle(flown({ ...air, speed: 50, vy: 0 }), 'hipL').angleTo(
        angle(flown({ ...air, speed: 50, vy: -18 }), 'hipL'),
      ),
    ).toBeGreaterThan(0.05);
  });
  it('does not ring when a frame runs long, and is where it is told when there is no frame', () => {
    // The shoulder's own frequency is 10 rad/s; an explicit spring at 200 ms a
    // frame is over the edge and rings. The substep is what keeps it honest, so
    // this asks the joint to hold still against a still target across frames no
    // sane loop should produce.
    // Both figures fly the same eight seconds against the same still air; only
    // the frame length differs. A spring that rings would not merely differ
    // from the fine one, it would leave the flutter's own envelope entirely.
    const coarse = createProceduralHuman(lit),
      fine = createProceduralHuman(lit);
    for (let i = 0; i < 40; i++) coarse.update(pose({ windPhase: 0.4 }), 0.2);
    for (let i = 0; i < 400; i++) fine.update(pose({ windPhase: 0.4 }), 0.02);
    const a = coarse.object.getObjectByName('shoulderL')!.quaternion,
      b = fine.object.getObjectByName('shoulderL')!.quaternion;
    expect(a.angleTo(b)).toBeLessThan(0.02);
    // and dt <= 0 is still "be there now", velocity included: a spring that
    // merely started moving would arrive during the first frame instead of
    // before it
    const placed = createProceduralHuman(lit);
    placed.update(pose({ windPhase: 0.4 }), 0);
    const at = placed.object.getObjectByName('shoulderL')!.quaternion.clone();
    placed.update(pose({ windPhase: 0.4 }), 0.05);
    // Not zero, because the slow drift is a function of elapsed time and 50 ms
    // of it has now elapsed: 7e-5 rad. What it is being told apart from is a
    // spring that was still travelling, which covers 5e-3 in its first 50 ms --
    // seventy times as far.
    expect(at.angleTo(placed.object.getObjectByName('shoulderL')!.quaternion)).toBeLessThan(5e-4);
  });
  it('recolors with an outfit and falls back to the default for an unknown id', () => {
    const human = createProceduralHuman(lit);
    // One surface carries every swatch now, so a repaint is a walk of the
    // vertices rather than seven buffers; the first vertex of the body is on
    // the spine, which is suit.
    const skin = human.object.getObjectByName('skin') as Mesh;
    const before = (skin.geometry.getAttribute('color').array as Float32Array)[0]!;
    human.setOutfit({ ...DEFAULT_OUTFIT, id: 'test', suit: 0xff0000 }, DEFAULT_PATTERN);
    const after = skin.geometry.getAttribute('color').array as Float32Array;
    expect(after[0]).toBeCloseTo(1, 6);
    expect(after[1]).toBeCloseTo(0, 6);
    expect(after[0]).not.toBe(before);
    expect(outfitById('nope')).toBe(DEFAULT_OUTFIT);
    human.dispose();
  });
  it('wears every colour the outfit names, because a band nothing lands in is not a band', () => {
    // The goggles were written as the band from 0.58 to 0.80 of the head, and a
    // head of three rings a segment samples at 0, 0.107, 0.321, 0.428, 0.571,
    // 0.857 and 1: nothing landed in it, and the figure flew about in a plain
    // cream egg. Every other test here asked about weights, manifolds and
    // bounds, and not one of them asked what colour anything was.
    const hues: Record<string, number> = {
      suit: 0xff0000,
      trim: 0x00ff00,
      helmet: 0x0000ff,
      goggles: 0xffff00,
      boots: 0xff00ff,
      gloves: 0x00ffff,
      skin: 0x804020,
    };
    const human = createProceduralHuman(lit);
    human.setOutfit({ ...DEFAULT_OUTFIT, id: 'hues', ...hues }, DEFAULT_PATTERN);
    // A crease darkens a vertex, so what survives a repaint is the ratio, not
    // the value: compare the direction of the colour and nothing else.
    const direction = (r: number, g: number, b: number) => {
      const length = Math.hypot(r, g, b) || 1;
      return [r / length, g / length, b / length] as const;
    };
    const worn = new Set<string>();
    human.object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh) return;
      const color = mesh.geometry.getAttribute('color');
      for (let v = 0; v < color.count; v++) {
        const [r, g, b] = direction(color.getX(v), color.getY(v), color.getZ(v));
        for (const [key, hex] of Object.entries(hues)) {
          const want = new Color(hex);
          const [wr, wg, wb] = direction(want.r, want.g, want.b);
          if (Math.hypot(r - wr, g - wg, b - wb) < 1e-3) worn.add(key);
        }
      }
    });
    expect([...worn].sort()).toEqual(Object.keys(hues).sort());
    human.dispose();
  });
});

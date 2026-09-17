import { Mesh, Vector3, type Object3D } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { FlightPose } from '../../src/engine/avatar/Avatar';
import { FPP } from '../../src/engine/flight/ChaseCamera';
import { DEFAULT_OUTFIT, DEFAULT_PATTERN, outfitById } from '../../src/engine/avatar/Outfits';
import {
  HUMAN_BOUNDS,
  HUMAN_TRIANGLE_BUDGET,
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

  it('folds into a track in a dive: the arms come back along the body and straighten', () => {
    const human = createProceduralHuman(lit);
    human.update(pose(), 0);
    const boxHand = inBody(human, 'hand');
    const shoulder = inBody(human, 'shoulderL');
    const bend = (h: ReturnType<typeof createProceduralHuman>) => {
      const s = inBody(h, 'shoulderL'),
        e = inBody(h, 'elbowL'),
        hand = inBody(h, 'hand');
      return e.clone().sub(s).angleTo(hand.clone().sub(e));
    };
    // in the box the hands are out in front, and the elbow is well bent
    expect(boxHand.z).toBeGreaterThan(shoulder.z);
    expect(bend(human)).toBeGreaterThan(1.2);

    human.update(pose({ pitch: -0.5 }), 0); // full dive
    const trackHand = inBody(human, 'hand');
    // the hands come back past the shoulder, in toward the hips, and the arm
    // straightens, which together is what a track looks like
    expect(trackHand.z).toBeLessThan(shoulder.z);
    expect(Math.abs(trackHand.x)).toBeLessThan(Math.abs(boxHand.x));
    expect(bend(human)).toBeLessThan(0.7);

    human.update(pose({ pitch: 0.6 }), 0); // a climb spreads them again
    expect(inBody(human, 'hand').z).toBeGreaterThan(boxHand.z);
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

  it('stays inside the triangle budget, casts shadows, and has an eye ahead of the chest', () => {
    const human = createProceduralHuman(lit);
    expect(human.triangles).toBeLessThanOrEqual(HUMAN_TRIANGLE_BUDGET);
    expect(human.triangles).toBeGreaterThan(1500);
    expect(HUMAN_TRIANGLE_BUDGET).toBe(4000);
    expect(human.eye.z).toBeGreaterThan(0.4);
    expect(human.bounds).toEqual(HUMAN_BOUNDS);
    expect(HUMAN_BOUNDS.below).toBeGreaterThan(0);
    expect(HUMAN_BOUNDS.radius).toBeGreaterThan(0.8);
    const all = meshes(human.object);
    expect(all.length).toBe(20);
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
    const hands = parts(human.object, 'hand');
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
    const boots = parts(human.object, 'boot');
    expect(boots.length).toBe(2);
    const foot = boots[0]!.clone().sub(ankle).normalize();
    expect(Math.acos(Math.max(-1, Math.min(1, shin.dot(foot))))).toBeGreaterThan((20 * Math.PI) / 180);
  });
  it('sweeps the arms back in a dive and forward in a climb', () => {
    const human = createProceduralHuman(lit);
    const shoulderL = human.object.getObjectByName('shoulderL')!;
    human.update(pose(), 0.05);
    const level = shoulderL.quaternion.clone();
    // read the arm in the figure's own frame: the object's own pitch must not count
    const armIn = (p: Partial<FlightPose>) => {
      hold(human, p);
      const q = shoulderL.quaternion.clone();
      return new Vector3(0, 1, 0).applyQuaternion(q);
    };
    const restArm = new Vector3(0, 1, 0).applyQuaternion(level);
    const dive = armIn({ pitch: -0.43 });
    const climb = armIn({ pitch: 0.55 });
    expect(dive.z).toBeLessThan(restArm.z - 0.1);
    expect(climb.z).toBeGreaterThan(restArm.z + 0.02);
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
  it('flutters its hinges with the wind, harder in a gust, and drops the inner arm in a turn', () => {
    const human = createProceduralHuman(lit);
    const shoulderL = human.object.getObjectByName('shoulderL')!,
      shoulderR = human.object.getObjectByName('shoulderR')!,
      knee = human.object.getObjectByName('kneeL')!;
    human.update(pose({ windPhase: 0 }), 0.05);
    const q0 = shoulderL.quaternion.clone(),
      k0 = knee.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2 }), 0.05);
    const calm = q0.angleTo(shoulderL.quaternion);
    expect(calm).toBeGreaterThan(0.01);
    expect(calm).toBeLessThan(0.2);
    expect(k0.angleTo(knee.quaternion)).toBeGreaterThan(0.01);
    human.update(pose({ windPhase: 0 }), 0.05);
    const g0 = shoulderL.quaternion.clone();
    human.update(pose({ windPhase: Math.PI / 2, gust: 1 }), 0.05);
    expect(g0.angleTo(shoulderL.quaternion)).toBeGreaterThan(calm * 1.5);
    // a left turn (bank < 0) lowers the left arm (+x side) and leaves the right one alone
    human.update(pose({ windPhase: 0 }), 0.05);
    const restL = shoulderL.quaternion.clone(),
      restR = shoulderR.quaternion.clone();
    hold(human, { windPhase: 0, bank: -0.4 });
    const droppedL = restL.angleTo(shoulderL.quaternion),
      droppedR = restR.angleTo(shoulderR.quaternion);
    expect(droppedL).toBeGreaterThan(0.1);
    expect(droppedR).toBeLessThan(droppedL / 4);
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
    // And in the box position there is nothing to draw, which is a measurement
    // and not a choice: a belly-to-earth jumper's arms are out at shoulder
    // height and 71.6 degrees off the axis of a frame whose half is 37.5, and
    // everything else is behind the eye. What the owner was shown instead were
    // those forearms, smeared across the top corners.
    expect(visible.length).toBe(0);
    human.update(pose({ view: 'tpp' }), 0.05);
    expect(meshes(human.object).every((m) => m.visible)).toBe(true);
    const bare = createProceduralHuman(lit, { fppHands: false });
    bare.update(pose({ view: 'fpp' }), 0.05);
    expect(meshes(bare.object).some((m) => m.visible)).toBe(false);
  });
  it('recolors with an outfit and falls back to the default for an unknown id', () => {
    const human = createProceduralHuman(lit);
    const torso = human.object.getObjectByName('torso') as Mesh;
    const before = (torso.geometry.getAttribute('color').array as Float32Array)[0]!;
    human.setOutfit({ ...DEFAULT_OUTFIT, id: 'test', suit: 0xff0000 }, DEFAULT_PATTERN);
    const after = torso.geometry.getAttribute('color').array as Float32Array;
    expect(after[0]).toBeCloseTo(1, 6);
    expect(after[1]).toBeCloseTo(0, 6);
    expect(after[0]).not.toBe(before);
    expect(outfitById('nope')).toBe(DEFAULT_OUTFIT);
    human.dispose();
  });
});

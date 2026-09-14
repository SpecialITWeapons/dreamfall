import { Color, PerspectiveCamera, Scene } from 'three';
import { densityFogFactor, fog, uniform } from 'three/tsl';
import { createSimulation, type Simulation } from './sim/Simulation';
import { cameraPoseFor } from './sim/cameraPose';
import { GROUND_CELL, createGroundPlane } from './terrain/GroundPlane';

export interface World {
  readonly seed: number;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly sim: Simulation;
  update(dt: number): void;
  resize(aspect: number): void;
  dispose(): void;
}

/** Distance fog density from fly-with-me after grading (0.00018 x 0.82). */
const FOG_DENSITY = 0.00018 * 0.82;

/**
 * M0 world: one sky, one fog in the same color, checkered ground, and a
 * straight-flight simulation. Everything hangs off this object; no
 * module-level state beyond constants.
 */
export function createWorld(opts: { seed: number; aspect: number }): World {
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, opts.aspect, 0.5, 14_000);
  // Horizon color from fly-with-me's noon preset; background and fog are one uniform.
  const horizon = uniform(new Color(0x96bdcd));
  scene.backgroundNode = horizon;
  // densityFogFactor takes a node, not a number; a uniform also keeps the density tunable later.
  scene.fogNode = fog(horizon, densityFogFactor(uniform(FOG_DENSITY)));
  const ground = createGroundPlane();
  scene.add(ground);
  const sim = createSimulation({ seed: opts.seed });
  const place = () => {
    const { state } = sim;
    ground.position.set(
      Math.round(state.x / GROUND_CELL) * GROUND_CELL,
      0,
      Math.round(state.z / GROUND_CELL) * GROUND_CELL,
    );
    const pose = cameraPoseFor(state);
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
  };
  place();
  return {
    seed: opts.seed,
    scene,
    camera,
    sim,
    update(dt) {
      sim.step(dt);
      place();
    },
    resize(aspect) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
    dispose() {
      ground.geometry.dispose();
      (ground.material as { dispose(): void }).dispose();
      scene.clear();
    },
  };
}

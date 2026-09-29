// Searching a road between two settlements off the main thread: 14 to 45 ms
// over nine thousand samples of the ground, and past a hundred round a bay,
// which a frame cannot pay. The ground is the base height with the sea cliffs
// cut into it (RouteGround), which the registry does not touch, so the worker
// builds a sampler with no biomes and never loads the library.
import { createWorldSampler, type WorldSampler } from '../terrain/WorldSampler';
import type { RouteJob } from './Roads';
import { routeBetween } from './Route';
import { routeGround } from './RouteGround';

const samplers = new Map<number, WorldSampler>();

self.addEventListener('message', (event: MessageEvent<RouteJob>) => {
  const job = event.data;
  let sampler = samplers.get(job.seed);
  if (!sampler) samplers.set(job.seed, (sampler = createWorldSampler(job.seed)));
  const heightAt = routeGround(sampler, [job.a, job.b]);
  const route = routeBetween(job.a, job.b, heightAt, job.seed);
  const points = route ? new Float64Array(route.flat()) : null;
  (self as unknown as Worker).postMessage({ id: job.id, points }, points ? [points.buffer] : []);
});

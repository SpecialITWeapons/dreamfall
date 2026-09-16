/**
 * The standard hooks, in one door. A biome made of data names a descriptor and
 * the engine resolves it here; a biome made of code passes its own function
 * through untouched. An unknown type throws by name at load, rather than
 * returning something that fails one texel at a time later on.
 */
export { CLIMATE, climatePoint, heightBand, mul, max } from './presence.js';
export { offset, terraces } from './height.js';
export { layers } from './ground.js';
export { CELL_TREES, scatter } from './populate.js';
export { SNOW_LINE, snowLineAt } from './snowLine.js';

import { resolve as presence } from './presence.js';
import { resolve as height } from './height.js';
import { resolve as ground } from './ground.js';
import { resolve as populate } from './populate.js';

/** @type {(hook: import('../contract').Presence) => (f: import('../contract').Fields) => number} */
export const resolvePresence = presence;
/** @type {(hook: import('../contract').HeightHook) => (f: import('../contract').Fields, base: number) => number} */
export const resolveHeight = height;
/** @type {(hook: import('../contract').GroundHook) => (ctx: import('../contract').GroundCtx) => import('../contract').GroundOut} */
export const resolveGround = ground;
/** @type {(hook: import('../contract').PopulateHook) => { hook: (cell: import('../contract').Cell, kit: import('../contract').SceneryKit) => void, scatter: import('../contract').ScatterSpec | null }} */
export const resolvePopulate = populate;

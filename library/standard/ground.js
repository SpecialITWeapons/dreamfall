/**
 * The layer painter: a biome made of data says what its ground is as a stack of
 * colors, each mixed in by one mask. The first layer is the undercoat and its
 * mask is ignored; every later one comes in by how much of it there is here.
 *
 * Everything it needs arrives through the context the engine hands it -- color,
 * mix and ramp included -- so this file makes no nodes of its own, imports no
 * TSL, and can be read by a test in Node with numbers standing in for nodes.
 */

/**
 * How much of a layer there is at this fragment.
 *
 * @param {import('../contract').GroundCtx} ctx
 * @param {import('../contract').GroundLayer} layer
 */
function maskOf(ctx, layer) {
  switch (layer.mask) {
    case 'slope':
      return ctx.ramp(ctx.slope, layer.from ?? 0, layer.to ?? 1);
    case 'height':
      return ctx.ramp(ctx.height, layer.from ?? 0, layer.to ?? 1);
    case 'noise':
      return ctx.ramp(ctx.noise(layer.scale ?? 0.01, layer.salt ?? 0), layer.from ?? -1, layer.to ?? 1);
    default:
      return 1;
  }
}

/**
 * @param {import('../contract').GroundLayer[]} list
 * @returns {(ctx: import('../contract').GroundCtx) => import('../contract').GroundOut}
 */
export function layers(list) {
  const [undercoat, ...rest] = list ?? [];
  if (!undercoat) throw new Error('layers: a ground needs at least one layer');
  return (ctx) => {
    let albedo = ctx.color(undercoat.color);
    for (const layer of rest) albedo = ctx.mix(albedo, ctx.color(layer.color), maskOf(ctx, layer));
    return { albedo };
  };
}

/**
 * A hook or a descriptor, as a hook.
 *
 * @param {import('../contract').GroundHook} hook
 * @returns {(ctx: import('../contract').GroundCtx) => import('../contract').GroundOut}
 */
export function resolve(hook) {
  if (typeof hook === 'function') return hook;
  if (hook?.type === 'layers') return layers(hook.layers);
  const odd = /** @type {{ type?: string }} */ (hook);
  throw new Error(`unknown hook type "${odd?.type}"`);
}

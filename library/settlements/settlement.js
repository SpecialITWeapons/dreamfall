/**
 * A settlement as a biome: a place claimed on the lattice, a ground flattened
 * under it, and a site plan built on top. It is the one entry in this library
 * written as code over the standard hooks rather than as data (spec section 8),
 * because where a village stands and what it looks like are the same question
 * asked twice, and both answers come from one lattice cell.
 *
 * The three readers of that lattice -- presence, plateau and the site finder --
 * take the same cell and the same salt from the parameters. A disagreement of
 * one hash puts the village on the slope beside its own flat square, which
 * reads as a terrain bug and is not one.
 *
 * One entry serves every size of settlement: a village and a town differ in
 * their numbers and in the plan that reads them, and in nothing else. That is
 * why the parameters carry the settlement's own id and name -- a factory that
 * knew the word "village" could only ever make one.
 */
import { defineBiome } from '../contract';

/**
 * What every settlement's parameters must carry, whatever else they add for
 * their own plan. `settlement` reads exactly this much and no more.
 *
 * @typedef {object} SettlementParams
 * @property {string} id
 * @property {string} name
 * @property {{ cell: number, salt: number }} lattice
 * @property {number} odds
 * @property {[number, number]} radius
 * @property {{ strength: number, feather: number }} plateau
 * @property {{ land: number, minTemp: number, maxSlope: number, maxCut?: number }} ground
 * @property {Record<string, number>} buildings
 * @property {string} [landmark] The one building placed by name rather than drawn by weight.
 * @property {{ species: Record<string, number>, density: number, props?: Record<string, number>, grass?: { tint: import('../contract').SceneryColor, density: number } }} [scenery] What grows on the ground it claims.
 * @property {import('../contract').SceneryColor[]} [palette]
 * @property {{ base: import('../contract').SceneryColor, alt: import('../contract').SceneryColor, rock: import('../contract').SceneryColor }} [paint]
 */

/** Trodden ground, if the settlement does not say otherwise: earth where people walk. */
const PAINT = { base: 'clay', alt: 'ochre', rock: 'rockPale' };

/**
 * @template {SettlementParams} P
 * @param {P} params
 * @param {(site: import('../contract').Site, params: P, kit: import('../contract').SiteKit) => void} plan
 * @returns {import('../contract').Biome}
 */
export function settlement(params, plan) {
  const { cell, salt } = params.lattice;
  const paint = params.paint ?? PAINT;
  return defineBiome({
    id: params.id,
    name: params.name,
    params: { base: paint.base, alt: paint.alt, rock: paint.rock },
    presence: {
      type: 'lattice',
      cell,
      salt,
      // The range, not its top: the hook draws this cell's own width out of the
      // same lattice stream the site finder draws it from, so the ground that
      // is painted and flattened is the ground the settlement covers. Handing
      // it `radius[1]` claimed the widest a settlement of this kind could be,
      // whatever this one turned out to be -- and for a town that is five
      // hundred metres of levelled, painted nothing around a town that reads
      // from the air as a bald dune with buildings on top of it.
      radius: params.radius,
      feather: params.plateau.feather,
      odds: params.odds,
      land: params.ground.land,
      minTemp: params.ground.minTemp,
      maxSlope: params.ground.maxSlope,
      maxCut: params.ground.maxCut,
    },
    height: {
      type: 'plateau',
      cell,
      salt,
      // The same pair, and it must stay the same pair: a plateau wider than the
      // presence over it levels ground that belongs to nobody.
      radius: params.radius,
      feather: params.plateau.feather,
      strength: params.plateau.strength,
    },
    // What grows on it. A settlement that sows nothing is a disc of bare paint
    // as wide as its presence, because its own weight is what crowds the
    // country's biomes -- and their trees and their grass -- out of the ground
    // it stands on. The lots' reservations do the thinning: the same density
    // over the whole disc comes out sparse where the houses are.
    populate: params.scenery ? { type: 'scatter', ...params.scenery } : undefined,
    // Earth where people walk, with the grass of the country around it coming
    // back at the edges through the weight of the biome.
    ground: {
      type: 'layers',
      layers: [
        { color: paint.base },
        { color: paint.alt, mask: 'noise', scale: 0.03, salt: 5, from: -0.1, to: 0.5 },
        { color: paint.rock, mask: 'slope', from: 0.3, to: 0.5 },
      ],
    },
    sites: {
      cell,
      salt,
      radius: params.radius,
      // The landmark is placed by name and never drawn by weight, so it is not
      // among the buildings -- but it is a structure this settlement will ask
      // for years from now, and this is the list the validator checks against
      // the registry. A weight of zero is how it gets checked without being
      // drawn: every plan in this library draws from weights above zero.
      structures: params.landmark ? { ...params.buildings, [params.landmark]: 0 } : params.buildings,
      palette: params.palette,
      // The same two numbers the presence hook above reads, asked of the same
      // point: the site finder seats a settlement at the lattice centre, so
      // `fits` is evaluated there and answers exactly as the hook does. A
      // third number here would be a third lottery, and the ground would be
      // painted for settlements that never arrive.
      fits: (f) => f.baseHeight >= params.ground.land && f.temp >= params.ground.minTemp,
      build: (site, kit) => plan(site, params, kit),
    },
  });
}

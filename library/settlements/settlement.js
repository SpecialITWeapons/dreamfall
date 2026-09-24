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
 *
 * It stands in a country (`inherit`): the ground, the grass and the trees
 * under it are the country's, the trees thinned to a clearing.
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
 * @property {{ land: number, maxSlope: number, maxCut?: number, minTemp?: number }} ground `minTemp` is for a settlement that refuses the cold; none in this library does.
 * @property {number} clearing The share of the country's trees and props that stands on its ground, 0..1.
 * @property {Record<string, number>} buildings
 * @property {string} [landmark] The one building placed by name rather than drawn by weight.
 * @property {import('../contract').SceneryColor[]} [palette]
 */

/**
 * @template {SettlementParams} P
 * @param {P} params
 * @param {(site: import('../contract').Site, params: P, kit: import('../contract').SiteKit) => void} plan
 * @returns {import('../contract').Biome}
 */
export function settlement(params, plan) {
  const { cell, salt } = params.lattice;
  return defineBiome({
    id: params.id,
    name: params.name,
    params: {},
    presence: {
      type: 'lattice',
      cell,
      salt,
      // The range, not its top: the hook draws this cell's own width out of the
      // same lattice stream the site finder draws it from, so the ground that
      // is flattened is the ground the settlement covers. Handing
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
    // It stands in a country and is painted and sown by it. It used to paint a
    // disc of its own -- clay for a village, grey-green for a town -- and sow
    // its own three species, and from the air that read as a patch cut out of
    // the country rather than a place in it: the owner's words were that the
    // separate ground under the houses did not look good. Now its weight is its
    // presence and its plateau, and everything that grows or is painted there
    // is the country's, its trees and props thinned to a clearing.
    inherit: { trees: params.clearing },
    // A settlement sounds like its country with a bell in it -- more of one
    // where there is a landmark to hang it in -- and its air is the country's.
    ambience: { layers: { bells: params.landmark ? 0.6 : 0.3 } },
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
      // flattened for settlements that never arrive.
      fits: (f) =>
        f.baseHeight >= params.ground.land &&
        (params.ground.minTemp === undefined || f.temp >= params.ground.minTemp),
      build: (site, kit) => plan(site, params, kit),
    },
  });
}

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
 */
import { defineBiome } from '../contract';
import { planVillage } from './plan.js';
import { VILLAGE } from './village.js';

/**
 * @param {typeof VILLAGE} [params]
 * @returns {import('../contract').Biome}
 */
export function settlement(params = VILLAGE) {
  const { cell, salt } = params.lattice;
  // The widest a site of this kind may be: the ground is claimed and flattened
  // for that, whatever this particular village turns out to be. A narrow one
  // then sits in a slightly wider clearing, which is what a village does.
  const reach = params.radius[1];
  return defineBiome({
    id: 'village',
    name: 'Village',
    params: { base: 'clay', alt: 'ochre', rock: 'rockPale' },
    presence: {
      type: 'lattice',
      cell,
      salt,
      radius: reach,
      feather: params.plateau.feather,
      odds: params.odds,
      land: params.ground.land,
      minTemp: params.ground.minTemp,
      maxSlope: params.ground.maxSlope,
    },
    height: {
      type: 'plateau',
      cell,
      salt,
      radius: reach,
      feather: params.plateau.feather,
      strength: params.plateau.strength,
    },
    // Trodden ground: earth where people walk, with the grass of the country
    // around it coming back at the edges through the weight of the biome.
    ground: {
      type: 'layers',
      layers: [
        { color: 'clay' },
        { color: 'ochre', mask: 'noise', scale: 0.03, salt: 5, from: -0.1, to: 0.5 },
        { color: 'rockPale', mask: 'slope', from: 0.3, to: 0.5 },
      ],
    },
    sites: {
      cell,
      salt,
      radius: params.radius,
      structures: params.buildings,
      palette: params.palette,
      // The same two numbers the presence hook above reads, asked of the same
      // point: the site finder seats a village at the lattice centre, so
      // `fits` is evaluated there and answers exactly as the hook does. A
      // third number here would be a third lottery, and the ground would be
      // painted for villages that never arrive.
      fits: (f) => f.baseHeight >= params.ground.land && f.temp >= params.ground.minTemp,
      build: (site, kit) => planVillage(site, params, kit),
    },
  });
}

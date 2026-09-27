// The sowing of one cell: the country under it, the stream each entry draws
// from, and the trees its biomes' populate hooks put up. The ring sows its
// cells through this and the far trees sow theirs through it too, which is the
// whole of what makes a tree seen at three kilometres the tree the ring puts up
// when the flight gets there. It knows the Cell a hook is handed and the trees;
// props, overrides' props, obstacles, pools and plans are the caller's.
//
// Pure CPU: from three it takes Color and nothing else.
import { Color } from 'three';
import {
  swatchColor,
  type Cell,
  type Library,
  type SceneryKit,
  type Species,
} from '../../../library/contract';
import { CELL_TREES, resolvePopulate } from '../../../library/standard/index.js';
import { countryOf, standingOf } from '../terrain/Country';
import { createFields } from '../terrain/Fields';
import { hash2, mulberry32, sstep } from '../terrain/noise';
import type { GroundQuery } from '../terrain/SampledGround';
import { SLOTS, type WorldSampler } from '../terrain/WorldSampler';

/** Ground above this is land, in the only sense the scenery cares about. */
export const LAND = 3;
/** A biome with less than this share of a cell does not get to populate it (spec 7). */
export const POPULATE_FLOOR = 0.05;
const TAU = Math.PI * 2;

export interface TreeInstance {
  species: string;
  x: number;
  /** Ground height under it, m. */
  y: number;
  z: number;
  scale: number;
  /** Vertical scale; a tree is never quite as tall as it is wide. */
  tall: number;
  yaw: number;
  /** Scratch: the sink must copy it, because the next tree overwrites it. */
  tint: Color;
}

/** A hash of the whole id, so two entries collide only by being the same entry. */
export function idHash(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * The salt of one entry's streams, from the seed and the whole id: adding a
 * prop must not reshuffle the trees, and adding a biome must not reshuffle the props.
 */
export const saltOf = (seed: number, name: string) => (seed ^ idHash(name)) >>> 0;

export type PlantOpts = { scale?: number; yaw?: number; tint?: unknown };

export interface SowingDeps {
  seed: number;
  library: Library;
  sampler: WorldSampler;
  /** Where heights, slopes and the country come from: the near window, or the sampled ground past it. */
  ground: GroundQuery;
  /** The side of a cell, m. */
  size: number;
  /** Ground spoken for (scenery/Claims.ts): nothing is sown on it. */
  occupied(x: number, z: number): boolean;
  /** Whether a tree of this species may still stand: the caller's ceilings, asked before any roll is drawn. */
  admit(speciesId: string): boolean;
  /** Whether the species has a baked shape to stand. */
  baked(speciesId: string): boolean;
  /** Where a tree goes; false when it was refused, and then it does not count toward its cell. */
  emit(tree: TreeInstance): boolean;
  /** What a hook's `kit.prop` does. Without it a prop a hook asks for stands nowhere. */
  prop?: SceneryKit['prop'];
}

export interface Sowing {
  /** The cell a hook is handed, rewritten by `enter`. */
  readonly cell: Cell;
  /** Sets the cell up; false when its centre is under LAND, and nothing is sown there. */
  enter(ix: number, iz: number): boolean;
  /** Points `cell.roll` at this cell's own stream for one salt. */
  stream(salt: number): void;
  /** One tree on the current stream, held to CELL_TREES and the caller's ceilings. */
  plant(speciesId: string, x: number, z: number, opts?: PlantOpts): void;
  /** Every biome of the country with a share worth a visit, each on its own stream. */
  sowTrees(): void;
}

export function createSowing(deps: SowingDeps): Sowing {
  const { seed, library, sampler, ground, size } = deps;
  const biomes = library.biomes;
  const sown = biomes.map((biome) => (biome.populate ? resolvePopulate(biome.populate) : null));
  // What each biome wants of each prop, and the colours its params name: both
  // are read once per cell through the Cell, so resolve them once here.
  const wants = sown.map((entry) => entry?.scatter?.props ?? {});
  const palette = biomes.map((biome) => {
    const colors = new Map<string, Color>();
    for (const [key, value] of Object.entries(biome.params ?? {}))
      if (typeof value === 'string') colors.set(key, new Color(swatchColor(value)));
    return colors;
  });
  const speciesById = new Map((library.species ?? []).map((entry) => [entry.id, entry]));
  const tints = new Map(
    (library.species ?? []).map((entry) => [
      entry.id,
      {
        cold: new Color(swatchColor(entry.tint.cold)),
        warm: new Color(swatchColor(entry.tint.warm)),
        dry: new Color(swatchColor(entry.tint.dry)),
      },
    ]),
  );
  const biomeSalt = biomes.map((biome) => saltOf(seed, `biome:${biome.id}`));

  const fields = createFields(sampler);
  const slotIds = new Uint8Array(4);
  const slotWeights = new Float32Array(4);
  // The country under the cell. A settlement's slot is its presence and its
  // plateau, not a planting: its share goes to the biomes beside it, and what
  // they sow is thinned by `clearing` (terrain/Country.ts).
  const standing = standingOf(biomes);
  const countryIds = new Uint8Array(4);
  const countryWeights = new Float32Array(4);
  let clearing = 1;
  const blended = new Color();
  const scratch = new Color();

  let gx = 0,
    gz = 0,
    centerX = 0,
    centerZ = 0,
    // Not reset by `enter`: a prop placed before this cell's biomes have run
    // reads the last share of the cell before, as it always has.
    share = 0,
    cellTrees = 0,
    read = false;
  let here = fields.at(0, 0);
  let roll: () => number = () => 0;

  const cell: Cell = {
    size,
    corner: { x: 0, z: 0 },
    center: { x: 0, z: 0 },
    get share() {
      return share;
    },
    // Lazily: a cell that turns out to be sea, or that nobody claims, never
    // pays for a field sample, and a field sample is the expensive part.
    get fields() {
      if (!read) {
        here = fields.at(centerX, centerZ);
        read = true;
      }
      return here;
    },
    weight(id) {
      for (let s = 0; s < SLOTS; s++) if (biomes[countryIds[s]!]?.id === id) return countryWeights[s]!;
      return 0;
    },
    mix(id) {
      // A prop is thinned in a settlement exactly as a tree is: the country's
      // boulders, a clearing's share of them.
      let sum = 0;
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!;
        if (weight > 0) sum += weight * (wants[countryIds[s]!]?.[id] ?? 0);
      }
      return sum * clearing;
    },
    blend(param) {
      blended.setRGB(0, 0, 0);
      for (let s = 0; s < SLOTS; s++) {
        const weight = countryWeights[s]!,
          color = palette[countryIds[s]!]?.get(param);
        if (weight > 0 && color) {
          blended.r += weight * color.r;
          blended.g += weight * color.g;
          blended.b += weight * color.b;
        }
      }
      return blended;
    },
    height: (x, z) => ground.heightAt(x, z),
    slope: (x, z) => ground.slopeAt(x, z),
    land: (x, z) => ground.heightAt(x, z) > LAND,
    roll: () => roll(),
    occupied: (x, z) => deps.occupied(x, z),
  };

  /** The climate tint of one tree, in the scratch colour the caller copies. */
  const climateTint = (species: Species) => {
    const tint = tints.get(species.id)!;
    const climate = cell.fields;
    return scratch
      .copy(tint.cold)
      .lerp(tint.warm, sstep(0.3, 0.7, climate.temp))
      .lerp(tint.dry, sstep(0.45, 0.25, climate.moist));
  };

  const plant = (speciesId: string, x: number, z: number, opts?: PlantOpts) => {
    if (cellTrees >= CELL_TREES || !deps.admit(speciesId)) return;
    const species = speciesById.get(speciesId);
    if (!species || !deps.baked(speciesId)) return;
    const [min, max] = species.scale;
    const scale = opts?.scale ?? min + roll() * (max - min);
    const tall = scale * (0.9 + roll() * 0.4);
    const yaw = opts?.yaw ?? roll() * TAU;
    const y = ground.heightAt(x, z);
    const tint =
      opts?.tint === undefined
        ? climateTint(species)
        : scratch.set(swatchColor(opts.tint as string | number));
    if (!deps.emit({ species: speciesId, x, y, z, scale, tall, yaw, tint })) return;
    cellTrees++;
  };

  const kit: SceneryKit = {
    tree: (speciesId, x, z, opts) => plant(speciesId, x, z, opts),
    prop: (propId, x, z, opts) => deps.prop?.(propId, x, z, opts),
    structure: () => {
      // Not unfinished work: a scatter says what grows on a cell, and a
      // building is not something that grows. Buildings stand on site plans,
      // which are placed whole by the ring.
      throw new Error(
        'scenery library: a biome scatters, it does not build; a building belongs to a site plan',
      );
    },
    color: (value) => new Color(swatchColor(value)),
  };

  return {
    cell,
    enter(ix, iz) {
      const ccx = (ix + 0.5) * size,
        ccz = (iz + 0.5) * size;
      if (ground.heightAt(ccx, ccz) < LAND) return false;
      gx = ix;
      gz = iz;
      cell.corner.x = ix * size;
      cell.corner.z = iz * size;
      cell.center.x = centerX = ccx;
      cell.center.z = centerZ = ccz;
      read = false;
      cellTrees = 0;
      ground.weightsAt(ccx, ccz, slotIds, slotWeights);
      clearing = countryOf(slotIds, slotWeights, standing, countryIds, countryWeights);
      return true;
    },
    stream(salt) {
      roll = mulberry32(hash2(gx, gz, salt));
    },
    plant,
    sowTrees() {
      for (let s = 0; s < SLOTS; s++) {
        // The floor is the country's own share: which biomes get a say in a
        // cell is not changed by a village standing on it, only how much of
        // what they sow comes up.
        const weight = countryWeights[s]!;
        if (weight < POPULATE_FLOOR) continue;
        const entry = sown[countryIds[s]!];
        if (!entry) continue;
        share = weight * clearing;
        roll = mulberry32(hash2(gx, gz, biomeSalt[countryIds[s]!]!));
        entry.hook(cell, kit);
      }
    },
  };
}

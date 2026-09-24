import { LAYERS } from '../../src/engine/audio/AmbienceModel';
import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  ENVELOPE,
  colorProblem,
  defineBiome,
  defineProp,
  defineSpecies,
  swatchColor,
  validateLibrary,
  type Biome,
  type GroundHook,
  type Prop,
  type ScatterSpec,
  type SitesSpec,
  type Structure,
  type Species,
  defineStructure,
} from '../../library/contract';
import { createLibrary } from '../../library/index.js';
import { TREE_RADIUS } from '../../src/engine/scenery/Ring';

// The validator never calls a hook, so a stub of the right shape is enough.
const ground = (() => ({ albedo: null })) as unknown as GroundHook;
const biome = (over: Partial<Biome> = {}): Biome =>
  defineBiome({
    id: 'test',
    name: 'Test',
    params: { base: 'meadow' },
    presence: { type: 'climatePoint', point: [0.5, 0.5, 0.5], radius: 0.12 },
    ground,
    ...over,
  });

describe('colorProblem', () => {
  it('passes swatches and hex inside the envelope, and names what it refuses', () => {
    expect(colorProblem('meadow')).toBeNull();
    expect(colorProblem(0x7caa48)).toBeNull();
    expect(colorProblem('nosuch')).toBe('unknown swatch "nosuch"');
    // a hex string is a colour written out; a swatch name is one chosen
    expect(colorProblem('#7caa48')).toBeNull();
    expect(colorProblem('#00ff00')).toContain('outside the palette envelope');
    expect(colorProblem('#xyz')).toBe('unknown swatch "#xyz"');
    expect(colorProblem(1.5)).toBe('not a color');
    expect(colorProblem(-1)).toBe('not a color');
    // neon: saturation over the envelope
    expect(colorProblem(0x00ff00)).toContain('outside the palette envelope');
    // pitch black and pure white, by value; the swatch book passes by name
    expect(colorProblem(0x000000)).toContain('outside the palette envelope');
    expect(colorProblem(0xffffff)).toContain('outside the palette envelope');
    expect(colorProblem('white')).toBeNull();
    expect(ENVELOPE).toEqual({ maxSaturation: 0.62, minLightness: 0.18, maxLightness: 0.93 });
    expect(swatchColor('meadow')).toBe(0x7caa48);
    expect(swatchColor(0x123456)).toBe(0x123456);
  });
});

describe('validateLibrary', () => {
  it('accepts a library of one well-formed biome', () => {
    expect(validateLibrary({ biomes: [biome()] })).toEqual([]);
  });
  it('refuses bad ids, duplicates and missing hooks, by name', () => {
    const errors = validateLibrary({
      biomes: [
        biome({ id: 'Test' }),
        biome({ id: 'test' }),
        biome({ id: 'test' }),
        biome({ id: 'noground', ground: undefined as unknown as GroundHook }),
        biome({ id: 'nopresence', presence: undefined as unknown as Biome['presence'] }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('id must be lowercase letters, digits and dashes');
    expect(all).toContain('biome test: duplicate id');
    expect(all).toContain('biome noground: needs a ground hook');
    expect(all).toContain('biome nopresence: needs a presence hook');
  });
  it('refuses an ambience the engine cannot play, naming the path', () => {
    // A typo in a swatch name used to reach the sky as NaN: `swatchColor`
    // parses an unknown name as hex and the fog, the background and the
    // horizon went NaN together over that biome, in daylight.
    const errors = validateLibrary({
      biomes: [
        biome({ id: 'typo', ambience: { fogTint: 'rockRose', fogTintAmount: 0.2 } }),
        biome({ id: 'loud', ambience: { layers: { birds: 1.5, owls: 0.2 } as never } }),
        biome({ id: 'thick', ambience: { fogTint: 'frost', fogTintAmount: -1 } }),
        biome({ id: 'fine', ambience: { layers: { birds: 0.5 }, fogTint: 'frost' } }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome typo.ambience.fogTint');
    expect(all).toContain('biome loud.ambience.layers: unknown layer "owls"');
    expect(all).toContain('biome loud.ambience.layers.birds: 1.5 is not a share of 0..1');
    expect(all).toContain('biome thick.ambience.fogTintAmount: -1 is not an amount');
    expect(all).not.toContain('biome fine');
  });
  it('lets an entry stand in a country, and then it paints and sows nothing of its own', () => {
    const camp = (over: Partial<Biome> = {}): Biome =>
      defineBiome({
        id: 'camp',
        name: 'Camp',
        params: {},
        presence: { type: 'climatePoint', point: [0.5, 0.5, 0.5], radius: 0.12 },
        inherit: { trees: 0.4 },
        ...over,
      });
    // standing in a country with no ground of its own is the whole point
    expect(validateLibrary({ biomes: [biome(), camp()] })).toEqual([]);
    const errors = validateLibrary({
      biomes: [
        biome(),
        camp({ id: 'painted', ground }),
        camp({ id: 'sown', populate: { type: 'scatter', species: {}, density: 0 } }),
        camp({ id: 'dense', inherit: { trees: 1.5 } }),
        camp({ id: 'nan', inherit: { trees: Number.NaN } }),
        biome({ id: 'bare', ground: undefined }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome painted: stands in a country and paints no ground of its own');
    expect(all).toContain('biome sown: stands in a country and sows nothing of its own');
    expect(all).toContain('biome dense.inherit.trees: 1.5 is not a share of 0..1');
    expect(all).toContain('biome nan.inherit.trees: NaN is not a share of 0..1');
    expect(all).toContain('biome bare: needs a ground hook');
    // the first biome takes the ground nobody claims, so it has to be a country
    expect(validateLibrary({ biomes: [camp(), biome()] })).toContain(
      'biome camp: the first biome takes unclaimed ground and cannot stand in a country',
    );
  });
  it('refuses colors in params outside the envelope, naming the path', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'neon', params: { base: '#00ff00', alt: 'meadow' } })],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('biome neon.params.base');
    expect(errors[0]).toContain('outside the palette envelope');
  });
  it('leaves numbers in params alone: a colour in params is written as a name or a hex string', () => {
    // 1200 is a perfectly good dark blue (#0004b0) and a perfectly ordinary
    // metre count; only strings are read as colours, so a number is never
    // refused for being outside an envelope it was never in.
    expect(validateLibrary({ biomes: [biome({ params: { density: 0.35, scale: 1200 } })] })).toEqual([]);
  });
  it('refuses a height hook that exceeds MAX_HEIGHT_DELTA in its own descriptor', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'tall', height: { type: 'offset', meters: 400 } })],
    });
    expect(errors[0]).toContain(`biome tall.height: 400 m, the budget is ${BUDGET.heightDelta}`);
    expect(BUDGET.heightDelta).toBe(300);
  });
  it('names an unknown hook type instead of failing later, in the sampler', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'odd', presence: { type: 'nope' } as unknown as Biome['presence'] })],
    });
    expect(errors[0]).toBe('biome odd.presence: unknown hook type "nope"');
  });
  it('accepts a function in place of any descriptor, and the optional hooks left out', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'coded', presence: () => 1, height: (_f, base) => base })],
    });
    expect(errors).toEqual([]);
  });
  it('keeps the budgets M3b will need', () => {
    expect(BUDGET.crownCards).toBe(200);
    expect(BUDGET.propTriangles).toBe(6000);
    expect(BUDGET.propInstances).toBe(2000);
    expect(BUDGET.siteInstances).toBe(4);
    // The contract may not import the engine, so the ring's reach is written
    // here twice and this is the seam that refuses to let the copies drift: a
    // guard measured against a reach the ring no longer has is a guard that
    // lies, and it lied for exactly as long as it took to move the ring.
    expect(BUDGET.siteReach).toBe(TREE_RADIUS);
    expect(BUDGET.speciesScale).toBe(3);
  });
});

const species = (over: Partial<Species> = {}): Species =>
  defineSpecies({
    id: 'oak',
    name: 'oak',
    trunk: { height: 6.4, radius: 0.9, lean: 0.65, tint: 'white' },
    limbs: { count: 5, spread: 6, rise: 8.8, from: 0.55 },
    crown: { shape: 'dome', cards: 35, size: 3.8, radius: 5, height: 2.8 },
    leaf: 'broad',
    tint: { cold: 'canopyCold', warm: 'white', dry: 'canopyDry' },
    scale: [1.15, 2.4],
    ...over,
  });
const prop = (over: Partial<Prop> = {}): Prop =>
  defineProp({
    id: 'boulders',
    name: 'boulders',
    budget: { instances: 1500, triangles: 400 },
    bake: () => ({}) as never,
    place: () => [],
    ...over,
  });
const scatter = (over: Record<string, unknown> = {}): Biome['populate'] =>
  ({ type: 'scatter', species: { oak: 1 }, density: 0.75, ...over }) as Biome['populate'];

describe('validateLibrary: species and props', () => {
  it('accepts a library whose scenery is well formed, and one with none at all', () => {
    expect(validateLibrary({ biomes: [biome()], species: [species()], props: [prop()] })).toEqual([]);
    expect(validateLibrary({ biomes: [biome()] })).toEqual([]);
  });
  it('refuses a species that outgrows the budgets, by name of what is over', () => {
    const errors = validateLibrary({
      biomes: [biome()],
      species: [
        species({ id: 'tall', scale: [1, 4] }),
        species({ id: 'shrinking', scale: [2, 1] }),
        species({ id: 'bushy', crown: { shape: 'dome', cards: 260 } }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain(`species tall.scale: 4, the budget is ${BUDGET.speciesScale}`);
    expect(all).toContain('species shrinking.scale: [2, 1] does not grow');
    expect(all).toContain(`species bushy.crown.cards: 260, the budget is ${BUDGET.crownCards}`);
  });
  it('refuses a species with no way to grow, an unknown leaf, and a tint outside the envelope', () => {
    const errors = validateLibrary({
      biomes: [biome()],
      species: [
        species({ id: 'formless', trunk: undefined, bake: undefined }),
        species({ id: 'strange', leaf: 'nosuch' as Species['leaf'] }),
        species({ id: 'neon', tint: { cold: '#00ff00', warm: 'white', dry: 'canopyDry' } }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('species formless: needs a trunk or a bake hook');
    expect(all).toContain('species strange.leaf: unknown leaf "nosuch"');
    expect(all).toContain('species neon.tint.cold: #00ff00 is outside the palette envelope');
  });
  it('takes a species that grows its own way, with no trunk of data', () => {
    expect(
      validateLibrary({ biomes: [biome()], species: [species({ trunk: undefined, bake: () => {} })] }),
    ).toEqual([]);
  });
  it('refuses a prop without the two hooks it is made of, and one over its budgets', () => {
    const errors = validateLibrary({
      biomes: [biome()],
      props: [
        prop({ id: 'nobake', bake: undefined as unknown as Prop['bake'] }),
        prop({ id: 'noplace', place: undefined as unknown as Prop['place'] }),
        prop({ id: 'heavy', budget: { triangles: 9000, instances: 5000 } }),
        prop({ id: 'floating', obstacle: { radius: 0, height: 2 } }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('prop nobake: needs a bake hook');
    expect(all).toContain('prop noplace: needs a place hook');
    expect(all).toContain(`prop heavy.budget.triangles: 9000, the budget is ${BUDGET.propTriangles}`);
    expect(all).toContain(`prop heavy.budget.instances: 5000, the budget is ${BUDGET.propInstances}`);
    expect(all).toContain('prop floating.obstacle: radius and height must both be positive');
  });
});

const structure = (over: Partial<Structure> = {}): Structure =>
  defineStructure({
    id: 'cottage',
    name: 'cottage',
    footprint: [7, 9],
    floors: [1, 2],
    roof: 'gable',
    palette: { wall: 'sandPale', roof: 'terracotta', trim: 'barkDark', window: 'gold' },
    ...over,
  });
const sites = (over: Partial<SitesSpec> = {}): SitesSpec =>
  ({
    cell: 6000,
    radius: [120, 250],
    structures: { cottage: 1 },
    fits: () => true,
    build: () => {},
    ...over,
  }) as SitesSpec;

/** A biome that can actually carry a settlement: sites are seated off a lattice. */
const settled = (over: Partial<Biome> = {}): Biome =>
  biome({ presence: { type: 'lattice', cell: 6000, radius: 250 }, sites: sites(), ...over });

describe('validateLibrary: structures and the sites that place them', () => {
  it('accepts a library whose settlement names a structure it baked', () => {
    expect(
      validateLibrary({
        biomes: [settled()],
        structures: [structure()],
      }),
    ).toEqual([]);
  });
  it('refuses a structure that is not a building, by name of what is wrong', () => {
    const errors = validateLibrary({
      biomes: [biome()],
      structures: [
        structure({ id: 'flat', footprint: [0, 9] }),
        structure({ id: 'sinking', floors: [3, 1] }),
        structure({ id: 'odd', roof: 'dome' as Structure['roof'] }),
        structure({ id: 'neon', palette: { wall: '#00ff00', roof: 'terracotta' } }),
        structure({ id: 'huge', budget: { triangles: 9000 } }),
        // every storey count is its own bake and its own pool, so the range is
        // a budget and not a preference
        structure({ id: 'tower', floors: [1, 9] }),
      ],
    });
    const all = errors.join('\n');
    expect(all).toContain('structure flat.footprint: needs two positive meters');
    expect(all).toContain('structure sinking.floors: [3, 1] does not rise');
    expect(all).toContain('structure odd.roof: unknown roof "dome"');
    expect(all).toContain('structure neon.palette.wall: #00ff00 is outside the palette envelope');
    expect(all).toContain(`structure huge.budget.triangles: 9000, the budget is ${BUDGET.propTriangles}`);
    expect(all).toContain(`structure tower.floors: 9 storey counts, the budget is ${BUDGET.floorSpan}`);
  });
  it('names a structure the settlement asks for and nobody baked', () => {
    const errors = validateLibrary({
      biomes: [settled({ id: 'village', sites: sites({ structures: { manor: 1 } }) })],
      structures: [structure()],
    });
    expect(errors.join('\n')).toContain('biome village.sites: unknown structure "manor"');
  });
  it('holds the site budgets: a radius the ring cannot hold is refused', () => {
    const errors = validateLibrary({
      biomes: [
        settled({ id: 'sprawl', sites: sites({ radius: [400, 1200] }) }),
        // a settlement is seated at the centre of its presence lattice, so a
        // climate biome has nowhere to put one
        biome({ id: 'drifting', sites: sites() }),
        settled({ id: 'hookless', sites: sites({ build: undefined as unknown as SitesSpec['build'] }) }),
        // a lattice this fine is a town's, and a town is its own entry
        settled({ id: 'crowded', sites: sites({ cell: 900 }) }),
        // a tint is a colour like any other and meets the same envelope: this
        // one would paint a house in neon and is refused by its index
        settled({ id: 'garish', sites: sites({ palette: ['barkPale', '#00ff88'] }) }),
        // and this one is the drift itself: 2200 m fits four sites inside the
        // 1900 m the guard was written against and nine inside the 2600 the
        // ring actually reaches, so it passed until the reach was told the truth
        settled({ id: 'drifted', sites: sites({ cell: 2200 }) }),
      ],
      structures: [structure()],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome sprawl.sites.radius: 1200 m, the budget is 900');
    expect(all).toContain('biome drifting.sites: needs a lattice presence to stand on');
    expect(all).toContain('biome crowded.sites.cell: 900 m puts up to 36 sites in the ring, the budget is 4');
    expect(all).toContain('biome drifted.sites.cell: 2200 m puts up to 9 sites in the ring, the budget is 4');
    expect(all).toContain('biome garish.sites.palette[1]: #00ff88 is outside the palette envelope');
    expect(all).toContain('biome hookless.sites: needs a build hook');
  });
});

describe('validateLibrary: what a biome asks to grow in it', () => {
  it('accepts a scatter of known species and props, and a populate hook written in code', () => {
    expect(
      validateLibrary({
        biomes: [
          biome({
            populate: scatter({ props: { boulders: 0.3 }, grass: { tint: 'grassCool', density: 0.5 } }),
          }),
        ],
        species: [species()],
        props: [prop()],
      }),
    ).toEqual([]);
    expect(validateLibrary({ biomes: [biome({ populate: () => {} })], species: [species()] })).toEqual([]);
  });
  it('names the typo instead of letting the ring meet an id nobody baked', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'wild', populate: scatter({ species: { oka: 1 }, props: { rubble: 1 } }) })],
      species: [species()],
      props: [prop()],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome wild.populate: unknown species "oka"');
    expect(all).toContain('biome wild.populate: unknown prop "rubble"');
  });
  it('refuses a scatter with nothing to sow, a negative density and grass outside the envelope', () => {
    const errors = validateLibrary({
      biomes: [
        biome({ id: 'bare', populate: scatter({ species: {} }) }),
        biome({ id: 'dark', populate: scatter({ density: -1 }) }),
        biome({ id: 'lurid', populate: scatter({ grass: { tint: '#00ff00', density: 1 } }) }),
      ],
      species: [species()],
    });
    const all = errors.join('\n');
    expect(all).toContain('biome bare.populate: names no species');
    expect(all).toContain('biome dark.populate.density: -1 is not a density');
    expect(all).toContain('biome lurid.populate.grass.tint: #00ff00 is outside the palette envelope');
  });
  it('names an unknown populate type, like every other hook', () => {
    const errors = validateLibrary({
      biomes: [biome({ id: 'odd', populate: { type: 'sprinkle' } as unknown as Biome['populate'] })],
    });
    expect(errors[0]).toBe('biome odd.populate: unknown hook type "sprinkle"');
  });
});

describe('the library itself', () => {
  it('ships ten climate biomes and two settlements, and they pass their own validator', () => {
    const library = createLibrary();
    expect(library.biomes).toHaveLength(12);
    expect(library.biomes[0]!.id).toBe('wildsong'); // the fallback for an unclaimed texel
    expect(validateLibrary(library)).toEqual([]);
    expect(new Set(library.biomes.map((b) => b.id)).size).toBe(12);
    // The settlements are the odd ones: they are claimed off a lattice rather
    // than out of climate space, and they come last in the list because the
    // first biome is the one that takes unclaimed ground. Two lattices, two
    // salts, two cell sizes -- one for a village every 13 km and one for a town
    // every 41.
    expect(library.biomes.filter((b) => b.sites).map((b) => b.id)).toEqual(['village', 'town']);
    expect(library.biomes.at(-1)!.id).toBe('town');
    const lattices = library.biomes.filter((b) => b.sites).map((b) => `${b.sites!.cell}:${b.sites!.salt}`);
    expect(new Set(lattices).size).toBe(lattices.length);
    for (const biome of library.biomes) {
      expect(biome.kind).toBe('biome');
      expect(biome.name.length).toBeGreaterThan(2);
      // an entry standing in a country paints nothing, so it has nothing to paint with
      if (biome.inherit) expect(biome.params).toEqual({});
      else expect(Object.keys(biome.params)).toEqual(['base', 'alt', 'rock']);
    }
  });
  it('ships nine species and two props, and names only ids it baked', () => {
    const library = createLibrary();
    expect(library.species).toHaveLength(9);
    expect(library.props).toHaveLength(2);
    expect(validateLibrary(library)).toEqual([]);
    const baked = new Set(library.species!.map((s) => s.id));
    // Every country grows something baked; a settlement grows its country's.
    for (const biome of library.biomes) {
      if (biome.inherit) continue;
      const sown = biome.populate as ScatterSpec;
      expect(sown.type).toBe('scatter');
      expect(Object.keys(sown.species).length).toBeGreaterThan(0);
      for (const id of Object.keys(sown.species)) expect(baked.has(id)).toBe(true);
      for (const id of Object.keys(sown.props ?? {}))
        expect(library.props!.some((p) => p.id === id)).toBe(true);
    }
    // A settlement sows nothing of its own: it stands in a country, and the
    // country's trees come up on it at a clearing's share -- neither the wood
    // around it nor the bare disc of paint it was when it sowed for itself.
    const settled = library.biomes.filter((b) => b.sites);
    expect(settled.map((b) => b.id)).toEqual(['village', 'town']);
    for (const biome of settled) {
      expect(biome.populate).toBeUndefined();
      expect(biome.ground).toBeUndefined();
      expect(biome.inherit!.trees).toBeGreaterThan(0);
      expect(biome.inherit!.trees).toBeLessThan(1);
    }
    // one species grows its own way, so the bake hook has a live example
    expect(library.species!.find((s) => s.id === 'cypress')!.bake).toBeTypeOf('function');
    // and every crown fits the budget the baker will enforce again at bake time
    for (const s of library.species!) expect(s.crown?.cards ?? 0).toBeLessThanOrEqual(BUDGET.crownCards);
  });
  it('spreads them across climate space, so no two claim the same ground', () => {
    // The settlement stands apart: it claims a lattice cell, not a climate, so
    // it neither has a point here nor crowds anyone else's.
    const points = createLibrary()
      .biomes.filter((b) => !b.sites)
      .map((b) => (b.presence as { point: [number, number, number] }).point);
    expect(points).toHaveLength(10);
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) {
        const d = Math.hypot(...points[i]!.map((v, k) => v - points[j]![k]!));
        expect(d).toBeGreaterThan(0.06);
      }
  });
  it('gives every biome something to sound like, out of the five layers there are', () => {
    // `ambience` sat in the contract from M3a and nothing read it: ten biomes,
    // one wind. A field that nothing reads is not a feature, it is a promise,
    // and this is what keeps the promise kept once it has been.
    for (const biome of createLibrary().biomes) {
      // the settlement stands in a country and says so: its sound is the
      // country's, with a bell added
      if (biome.sites) {
        expect(biome.inherit, `${biome.id} stands in a country`).toBeDefined();
        expect(biome.ambience?.layers?.bells, `${biome.id} has a bell`).toBeGreaterThan(0);
        continue;
      }
      const layers = biome.ambience?.layers;
      expect(layers, `${biome.id} says nothing`).toBeTruthy();
      const named = Object.entries(layers!);
      expect(named.length).toBeGreaterThan(0);
      for (const [layer, amount] of named) {
        expect(LAYERS).toContain(layer);
        expect(amount).toBeGreaterThan(0);
        expect(amount).toBeLessThanOrEqual(1);
      }
    }
  });
  it('paints every biome out of the swatch book, undercoat first', () => {
    for (const biome of createLibrary().biomes) {
      if (biome.inherit) continue;
      const ground = biome.ground as { type: string; layers: Array<{ color: string; mask?: string }> };
      expect(ground.type).toBe('layers');
      expect(ground.layers[0]!.mask).toBeUndefined(); // the undercoat takes no mask
      for (const layer of ground.layers) expect(colorProblem(layer.color)).toBeNull();
    }
  });
});

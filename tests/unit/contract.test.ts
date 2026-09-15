import { describe, expect, it } from 'vitest';
import {
  BUDGET,
  ENVELOPE,
  colorProblem,
  defineBiome,
  swatchColor,
  validateLibrary,
  type Biome,
  type GroundHook,
} from '../../library/contract';

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
    expect(BUDGET.speciesScale).toBe(3);
  });
});

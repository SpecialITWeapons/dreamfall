// What the ring puts up over the real library, frozen before the sowing was
// lifted out of it (scenery/Sowing.ts). Every tree and prop of three places of
// seed 42, digested: a change to what the ring sows moves the digest, and the
// refactor that made the far trees possible must not have.
import { describe, expect, it } from 'vitest';
import { createLibrary } from '../../library/index.js';
import { createObstacles } from '../../src/engine/scenery/Obstacles';
import { createOverrides } from '../../src/engine/scenery/Overrides';
import { createRing, type ScenerySink } from '../../src/engine/scenery/Ring';
import { createHeightfield } from '../../src/engine/terrain/Heightfield';
import { createWorldSampler } from '../../src/engine/terrain/WorldSampler';

/** 32-bit FNV-1a over a string: enough to tell two sowings apart. */
const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
};

const lib = createLibrary();
const sampler = createWorldSampler(42, { biomes: lib.biomes });

const sow = (x: number, z: number) => {
  // 192 texels of 16 m reach 1.5 km either way: the ring's 1.2 km, a cell's
  // overhang and the slope's neighbour, with room to spare.
  const heightfield = createHeightfield(sampler, { size: 192 });
  heightfield.fillAll(Math.round(x / 16), Math.round(z / 16));
  const rows: string[] = [];
  let trees = 0,
    props = 0;
  const sink: ScenerySink = {
    begin() {
      rows.length = 0;
      trees = props = 0;
    },
    tree(t) {
      trees++;
      rows.push(
        `t ${t.species} ${t.x.toFixed(3)} ${t.z.toFixed(3)} ${t.y.toFixed(3)} ${t.scale.toFixed(4)} ${t.tall.toFixed(4)} ${t.yaw.toFixed(4)} ${t.tint.getHexString()}`,
      );
      return true;
    },
    prop(p) {
      props++;
      rows.push(
        `p ${p.prop} ${p.x.toFixed(3)} ${p.z.toFixed(3)} ${p.y.toFixed(3)} ${p.scale.map((s) => s.toFixed(3)).join(',')} ${p.yaw.toFixed(4)} ${p.sink.toFixed(3)} ${p.tint.getHexString()}`,
      );
      return true;
    },
    structure: () => true,
    site() {},
    end() {},
  };
  const ring = createRing({
    seed: 42,
    library: lib,
    sampler,
    heightfield,
    obstacles: createObstacles(),
    overrides: createOverrides(),
    metrics: {
      species: () => ({ top: 12, radius: 4 }),
      prop: () => ({ radius: 2, height: 2 }),
      structure: () => null,
    },
    sink,
    propKit: {
      sstep: (a: number, b: number, v: number) => Math.max(0, Math.min(1, (v - a) / (b - a || 1))),
    } as never,
    radius: 1200,
  });
  ring.update(x, z, true);
  return { trees, props, digest: fnv(rows.join('\n')) };
};

describe('the ring over the real library', () => {
  it('sows the origin as it always has', () => {
    expect(sow(0, 0)).toMatchInlineSnapshot(`
      {
        "digest": "57432997",
        "props": 132,
        "trees": 249,
      }
    `);
  });
  it('sows the woods as it always has', () => {
    expect(sow(-48000, -42000)).toMatchInlineSnapshot(`
      {
        "digest": "cb9a4917",
        "props": 45,
        "trees": 956,
      }
    `);
  });
  it('sows a third place as it always has', () => {
    expect(sow(20000, -15000)).toMatchInlineSnapshot(`
      {
        "digest": "e5c1f00c",
        "props": 20,
        "trees": 323,
      }
    `);
  });
});

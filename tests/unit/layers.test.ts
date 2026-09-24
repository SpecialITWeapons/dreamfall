import { describe, expect, it } from 'vitest';
import { createLayers, uniformGate, type Hideable } from '../../src/engine/render/Layers';

const thing = (): Hideable => ({ visible: true });

describe('layer switches', () => {
  it('lists its switches in the order they were given', () => {
    const layers = createLayers({ terrain: [], trees: [], sky: [] });
    expect(layers.names).toEqual(['terrain', 'trees', 'sky']);
    expect(layers.visible('terrain')).toBe(true);
  });

  it('hides every object of a switch that is off, and hands them back when it is on', () => {
    const trees = [thing(), thing()];
    const layers = createLayers({ trees });
    layers.set('trees', false);
    expect(trees.map((t) => t.visible)).toEqual([false, false]);
    layers.set('trees', true);
    expect(trees.map((t) => t.visible)).toEqual([true, true]);
  });

  it('only takes away: what the engine hides for its own reasons stays hidden', () => {
    const cloudSea = thing();
    const layers = createLayers({ deck: [cloudSea] });
    // the engine's own writes -- the deck is hidden from under it, shown from above
    cloudSea.visible = false;
    layers.apply();
    expect(cloudSea.visible).toBe(false);
    cloudSea.visible = true;
    layers.apply();
    expect(cloudSea.visible).toBe(true);
  });

  it('re-hides a switched-off layer after the engine has written over it', () => {
    const figure = thing();
    const layers = createLayers({ figure: [figure] });
    layers.set('figure', false);
    // what the avatar does every update: the first person hides it, the third shows it
    figure.visible = true;
    layers.apply();
    expect(figure.visible).toBe(false);
  });

  it('toggles, and ignores a name it does not have', () => {
    const grass = thing();
    const layers = createLayers({ grass: [grass] });
    expect(layers.toggle('grass')).toBe(false);
    expect(grass.visible).toBe(false);
    expect(layers.toggle('grass')).toBe(true);
    layers.set('nothing', false);
    expect(layers.visible('nothing')).toBe(false);
    expect(() => layers.apply()).not.toThrow();
  });
});

describe('uniformGate', () => {
  it('switches a shader term through its uniform: 1 on, 0 off', () => {
    const uShowHigh = { value: 1 };
    const layers = createLayers({ high: [uniformGate(uShowHigh)] });
    layers.set('high', false);
    expect(uShowHigh.value).toBe(0);
    layers.apply();
    expect(uShowHigh.value).toBe(0);
    layers.set('high', true);
    expect(uShowHigh.value).toBe(1);
    layers.apply();
    expect(uShowHigh.value).toBe(1);
  });
});

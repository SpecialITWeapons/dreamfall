// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevPanel, type DevPanel } from '../../src/dev/Panel';
import type { WorldDebug } from '../../src/page/Debug';

/**
 * What the panel reads, and nothing else. It is a view over `WorldDebug`, so a
 * stub of the parts it touches is the whole of its input -- and anything it
 * grows to show has to be on that surface first, where a browser test can
 * assert it too.
 */
const stub = () => {
  const on = new Map<string, boolean>([
    ['terrain', true],
    ['trees', true],
    ['figure', true],
  ]);
  const calls = {
    steps: 0,
    jumps: [] as Array<[number, number, number]>,
    layers: [] as Array<[string, boolean]>,
    measured: 0,
    clouds: [] as Array<Record<string, number>>,
  };
  const world = {
    seed: 42,
    backend: 'webgl2',
    frames: 10,
    gpuMs: 1.25,
    paused: false,
    autopilot: true,
    view: 'tpp' as const,
    obstacles: 7,
    dayPhase: 0.25,
    clearance: 118.4,
    galaxy: { baked: false, bakeMs: 0 },
    state: { x: 1525.4, z: 1588.2, y: 301.7, speed: 44.5, heading: Math.PI / 2, vy: -1.5 },
    memory: () => ({ geometries: 51, textures: 31, total: 175_520_506, draws: 34, triangles: 612_345 }),
    scenery: {
      trees: 1175,
      props: 210,
      buildings: 43,
      buildingsRefused: 2,
      grass: 3800,
      sites: 4,
      sitesQueued: 1,
      ringMs: 3.2,
      grassMs: 1.1,
      sitesMs: 0.04,
      rebuilds: 9,
      bakeMs: 620,
    },
    weightsAt: () => [
      { id: 'meadow', weight: 0.62 },
      { id: 'pine', weight: 0.38 },
      { id: 'frost', weight: 0 },
    ],
    siteNear: () => ({ id: 'village:0,0', x: 1500, z: 1600, radius: 180, lots: 24 }),
    clouds: {
      ranges: { stretch: [1, 3, 1.8], rag: [0, 0.8, 0.4] },
      form: { stretch: 1.8, rag: 0.4 },
      drawn: 640,
      set(change: Record<string, number>) {
        Object.assign(this.form, change);
        calls.clouds.push(change);
      },
    },
    layers: {
      names: [...on.keys()],
      visible: (name: string) => on.get(name) ?? false,
      set: (name: string, value: boolean) => {
        on.set(name, value);
        calls.layers.push([name, value]);
      },
      toggle: (name: string) => !on.get(name),
    },
    step: () => {
      calls.steps++;
    },
    frame: () => {
      calls.steps++;
    },
    jump: (x: number, z: number, above = 120) => {
      calls.jumps.push([x, z, above]);
    },
    setPaused: vi.fn(),
    setAutopilot: vi.fn(),
    setView: vi.fn(),
    measureHeightHooks: () => {
      calls.measured++;
      return {
        samples: 8192,
        base: 1.5,
        all: 3.75,
        hooks: 2.25,
        budget: 2,
        perBiome: [
          { id: 'meadow', us: 0.4 },
          { id: 'alpine', us: 0.9 },
        ],
      };
    },
  };
  return { world: world as unknown as WorldDebug, calls, raw: world };
};

let panel: DevPanel | null = null;
beforeEach(() => {
  document.body.innerHTML = '';
  // One frame, now: the cost button steps out of the click so the panel can
  // paint "measuring…" first, and a test should not have to wait for a screen.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  panel?.dispose();
  panel = null;
  vi.unstubAllGlobals();
});

const text = () => document.getElementById('dev')!.textContent ?? '';

describe('dev panel', () => {
  it('shows the page, the flight and the scenery the debug surface reports', () => {
    const { world } = stub();
    panel = createDevPanel(document, world);
    expect(document.getElementById('dev')).not.toBeNull();
    expect(text()).toContain('42');
    expect(text()).toContain('webgl2');
    expect(text()).toContain('1525');
    expect(text()).toContain('1175 · 210');
    // a refused house is a settlement quietly losing a building, so it is said
    expect(text()).toContain('43 (2 refused)');
    expect(text()).toContain('meadow 62%');
    expect(text()).toContain('34 · 612,345');
    expect(text()).toContain('village:0,0');
  });

  it('follows the world on refresh, and writes a reading only when it changed', () => {
    const { world, raw } = stub();
    panel = createDevPanel(document, world);
    expect(text()).toContain('baking');
    raw.state.x = -321.5;
    raw.galaxy = { baked: true, bakeMs: 3400 };
    panel.refresh();
    expect(text()).toContain('-322');
    expect(text()).toContain('3400 ms');
    // A refresh that changes nothing touches no text node: the setter on the
    // seed's own span is watched, and a refresh with the same world writes it
    // nowhere. (Four refreshes a second of DOM writes is a panel's whole cost.)
    const seed = [...panel.element.querySelectorAll('.row span')].find((span) => span.textContent === '42')!;
    expect(seed).toBeTruthy();
    let writes = 0;
    Object.defineProperty(seed, 'textContent', {
      get: () => '42',
      set: () => {
        writes++;
      },
    });
    panel.refresh();
    expect(writes).toBe(0);
  });

  it('has a switch per layer, and a click takes it away and redraws', () => {
    const { world, calls } = stub();
    panel = createDevPanel(document, world);
    const boxes = [...document.querySelectorAll<HTMLInputElement>('#dev label.layer input')];
    expect(boxes).toHaveLength(3);
    expect(document.querySelector('#dev label.layer')!.textContent).toContain('terrain');
    boxes[1]!.checked = false;
    boxes[1]!.dispatchEvent(new Event('change'));
    expect(calls.layers).toEqual([['trees', false]]);
    // the loop may well be stopped: a switch nobody draws is a switch nobody sees
    expect(calls.steps).toBeGreaterThan(0);
  });

  it('jumps where the fields say, and to the settlement when asked', () => {
    const { world, calls } = stub();
    panel = createDevPanel(document, world);
    const fields = [...document.querySelectorAll<HTMLInputElement>('#dev .fields input[type=number]')];
    fields[0]!.value = '-5289';
    fields[1]!.value = '-7577';
    fields[2]!.value = '200';
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('#dev .fields button')];
    buttons.find((b) => b.textContent === 'go')!.click();
    expect(calls.jumps).toEqual([[-5289, -7577, 200]]);
    buttons.find((b) => b.textContent === 'site')!.click();
    expect(calls.jumps[1]).toEqual([1500, 1600, 200]);
    expect(fields[0]!.value).toBe('1500');
  });

  it('measures the hooks on a click and prints them against their own budget', () => {
    const { world, calls } = stub();
    panel = createDevPanel(document, world);
    const measure = [...document.querySelectorAll<HTMLButtonElement>('#dev button')].find(
      (b) => b.textContent === 'measure hooks',
    )!;
    measure.click();
    expect(calls.measured).toBe(1);
    expect(text()).toContain('hooks 2.25 µs/texel (budget 2)');
    expect(text()).toContain('8192 samples');
    // the dearest biomes first, because that is the question being asked
    expect(text()).toContain('alpine 0.90 · meadow 0.40');
    expect(document.querySelector('#dev .bad')).not.toBeNull();
  });

  it('moves the clouds from a slider per number of their form, and puts them back', () => {
    const { world, calls, raw } = stub();
    panel = createDevPanel(document, world);
    expect(text()).toContain('640');
    const sliders = [...document.querySelectorAll<HTMLInputElement>('#dev input[type=range]')].filter(
      (input) => input.max === '3',
    );
    expect(sliders).toHaveLength(1);
    const stretch = sliders[0]!;
    stretch.value = '2.6';
    stretch.dispatchEvent(new Event('input'));
    expect(calls.clouds.at(-1)).toEqual({ stretch: 2.6 });
    expect(raw.clouds.form.stretch).toBe(2.6);
    expect(text()).toContain('2.60');
    const reset = [...document.querySelectorAll('#dev button')].find((b) => b.textContent === 'reset form')!;
    (reset as HTMLButtonElement).click();
    expect(calls.clouds.at(-1)).toEqual({ stretch: 1.8, rag: 0.4 });
  });

  it('takes itself and its styles away on dispose', () => {
    const { world } = stub();
    const it = createDevPanel(document, world);
    const styles = document.head.querySelectorAll('style').length;
    it.dispose();
    expect(document.getElementById('dev')).toBeNull();
    expect(document.head.querySelectorAll('style')).toHaveLength(styles - 1);
  });
});

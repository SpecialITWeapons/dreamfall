// The dev panel: `?dev=1`, and nothing else on the page knows it exists. It is
// imported dynamically for exactly that reason -- a player's bundle carries
// none of it -- and it is written by hand rather than pulled from a control
// library, which would be a dependency shipped in `dependencies` for a page
// only ever opened by whoever is building this.
//
// It reads the same `WorldDebug` surface the browser tests read. That is the
// point: one surface, so the panel cannot show a number no test can assert,
// and a test cannot assert one nobody can see.
//
// Every string in this file is a developer's, which is why they are here and
// not in `index.html` or `Hud.ts`, where the interface the player reads lives.
import type { HookCosts } from '../engine/terrain/HookCost';
import type { WorldDebug } from '../page/Debug';

export interface DevPanel {
  readonly element: HTMLElement;
  /** Redraw the readings now; the panel does this a few times a second by itself. */
  refresh(): void;
  dispose(): void;
}

const STYLE = `
#dev {
  position: fixed; inset: 8px auto auto 8px; width: 278px; z-index: 30;
  max-height: calc(100dvh - 16px); overflow: auto; overscroll-behavior: contain;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e6ecf2; background: rgba(9, 13, 19, 0.84); border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px; padding: 8px 10px 10px; backdrop-filter: blur(6px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
#dev.folded > :not(.dev-head) { display: none; }
#dev .dev-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#dev .dev-head b { font-weight: 600; letter-spacing: 0.04em; }
#dev h4 {
  margin: 10px 0 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
  text-transform: uppercase; color: #8fa3b8;
}
#dev .row { display: flex; justify-content: space-between; gap: 8px; }
#dev .row span:last-child { color: #a9d2ff; text-align: right; white-space: pre; }
#dev .wrap { color: #a9d2ff; overflow-wrap: anywhere; }
#dev .bad { color: #ff9a8b; }
#dev .controls { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
#dev button {
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.09);
  border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 5px; padding: 3px 7px; cursor: pointer;
}
#dev button:hover { background: rgba(255, 255, 255, 0.16); }
#dev input[type='number'], #dev input[type='text'] {
  font: inherit; color: inherit; background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 5px; padding: 2px 4px; width: 68px;
}
#dev input[type='range'] { width: 100%; accent-color: #6fb0ff; }
#dev label.layer { display: inline-flex; align-items: center; gap: 3px; width: 88px; cursor: pointer; }
#dev .fields { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-top: 5px; }
`;

const fixed = (v: number, digits = 0) => (Number.isFinite(v) ? v.toFixed(digits) : '--');
const degrees = (radians: number) => `${fixed(((radians * 180) / Math.PI + 360) % 360, 0)}°`;

export function createDevPanel(doc: Document, world: WorldDebug): DevPanel {
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const style = make('style');
  style.textContent = STYLE;
  doc.head.append(style);

  const panel = make('div');
  panel.id = 'dev';
  const head = make('div', 'dev-head');
  head.append(make('b', '', 'dreamfall dev'));
  const fold = make('button', '', '–');
  fold.title = 'fold';
  fold.addEventListener('click', () => {
    const folded = panel.classList.toggle('folded');
    fold.textContent = folded ? '+' : '–';
  });
  head.append(fold);
  panel.append(head);

  const section = (title: string) => {
    panel.append(make('h4', '', title));
  };
  /** A label and a number that is rewritten every refresh. */
  const reading = (label: string, read: () => string) => {
    const row = make('div', 'row');
    row.append(make('span', '', label));
    const value = make('span');
    row.append(value);
    panel.append(row);
    readings.push(() => {
      const text = read();
      if (value.textContent !== text) value.textContent = text;
    });
  };
  const readings: Array<() => void> = [];
  // What a refresh reads once and every reading below shares: the renderer's
  // counters are a copy each time they are asked for, and the scenery's stats
  // are a fresh object per call, so ten readings asked for ten of each.
  let frame = world.memory(),
    scenery = world.scenery;
  readings.push(() => {
    frame = world.memory();
    scenery = world.scenery;
  });
  const button = (label: string, onClick: () => void, into: HTMLElement) => {
    const node = make('button', '', label);
    node.addEventListener('click', onClick);
    into.append(node);
    return node;
  };
  const number = (label: string, value: number, into: HTMLElement) => {
    into.append(make('span', '', label));
    const input = make('input');
    input.type = 'number';
    input.value = String(Math.round(value));
    into.append(input);
    return input;
  };
  /**
   * A redraw: the panel changes the world while the loop may well be stopped,
   * and drawn on the spot rather than scheduled, because somebody just clicked
   * a switch and is looking at the result.
   */
  const draw = () => world.frame(1e-6);

  section('page');
  reading('seed', () => String(world.seed));
  reading('backend', () => world.backend);
  let frames = world.frames,
    marked = performance.now(),
    fps = 0;
  reading('fps', () => fixed(fps, 1));
  reading('gpu ms', () => fixed(world.gpuMs, 2));
  reading('geometries', () => String(frame.geometries));
  reading('textures', () => String(frame.textures));
  reading('gpu bytes', () => `${fixed(frame.total / 1e6, 1)} MB`);
  // What the last frame actually drew, which is the question behind every layer
  // switch below it.
  reading('draws · triangles', () => `${frame.draws} · ${frame.triangles.toLocaleString('en')}`);

  section('flight');
  reading('x  z', () => `${fixed(world.state.x)}  ${fixed(world.state.z)}`);
  reading('altitude', () => `${fixed(world.state.y)} m`);
  reading('clearance', () => `${fixed(world.clearance)} m`);
  reading('airspeed', () => `${fixed(world.state.speed, 1)} m/s`);
  reading('heading', () => degrees(world.state.heading));
  reading('climb', () => `${fixed(world.state.vy, 1)} m/s`);
  reading('obstacles', () => String(world.obstacles));
  const flightControls = make('div', 'controls');
  button('autopilot', () => world.setAutopilot(!world.autopilot), flightControls);
  button('view', () => world.setView(world.view === 'tpp' ? 'fpp' : 'tpp'), flightControls);
  button('pause', () => world.setPaused(!world.paused), flightControls);
  button('step', () => world.frame(1 / 60), flightControls);
  panel.append(flightControls);
  reading('autopilot · view · loop', () =>
    `${world.autopilot ? 'on' : 'off'} · ${world.view} · ${world.paused ? 'paused' : 'flying'}`.trim(),
  );

  const jump = make('div', 'fields');
  const jumpX = number('x', 0, jump);
  const jumpZ = number('z', 0, jump);
  const jumpAbove = number('+m', 120, jump);
  button(
    'go',
    () => {
      world.jump(Number(jumpX.value), Number(jumpZ.value), Number(jumpAbove.value));
    },
    jump,
  );
  button(
    'here',
    () => {
      jumpX.value = String(Math.round(world.state.x));
      jumpZ.value = String(Math.round(world.state.z));
    },
    jump,
  );
  button(
    'site',
    () => {
      const site = world.siteNear(world.state.x, world.state.z);
      if (!site) return;
      jumpX.value = String(Math.round(site.x));
      jumpZ.value = String(Math.round(site.z));
      world.jump(site.x, site.z, Number(jumpAbove.value));
    },
    jump,
  );
  panel.append(jump);

  section('world');
  reading('day', () => fixed(world.dayPhase, 3));
  const day = make('input');
  day.type = 'range';
  day.min = '0';
  day.max = '1';
  day.step = '0.001';
  day.addEventListener('input', () => {
    world.dayPhase = Number(day.value);
  });
  panel.append(day);
  readings.push(() => {
    if (doc.activeElement !== day) day.value = String(world.dayPhase);
  });
  reading('galaxy', () => (world.galaxy.baked ? `${world.galaxy.bakeMs} ms` : 'baking'));
  const ground = make('div', 'wrap');
  panel.append(ground);
  readings.push(() => {
    const here = world
      .weightsAt(world.state.x, world.state.z)
      .filter((slot) => slot.weight > 0.001)
      .map((slot) => `${slot.id} ${fixed(slot.weight * 100)}%`)
      .join(' · ');
    if (ground.textContent !== here) ground.textContent = here;
  });
  const site = make('div', 'wrap');
  panel.append(site);
  readings.push(() => {
    const near = world.siteNear(world.state.x, world.state.z);
    const text = near ? `${near.id} · r ${fixed(near.radius)} m · ${near.lots} lots` : 'no settlement near';
    if (site.textContent !== text) site.textContent = text;
  });

  section('clouds');
  reading('sprites drawn · inside', () => `${world.clouds.drawn} · ${fixed(world.clouds.inside, 2)}`);
  // One slider a number of a form, labelled with its value. The world clamps,
  // so the panel only has to say what was asked for.
  const formSliders = <K extends string>(
    ranges: { readonly [key in K]: readonly [number, number, number] },
    read: () => Readonly<Record<K, number>>,
    write: (change: Partial<Record<K, number>>) => void,
  ) => {
    const shows: Array<() => void> = [];
    for (const key of Object.keys(ranges) as K[]) {
      const [min, max] = ranges[key];
      const row = make('div', 'row');
      const value = make('span');
      row.append(make('span', '', key), value);
      const slider = make('input');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String((max - min) / 100);
      const show = () => {
        const now = read()[key];
        value.textContent = fixed(now, 2);
        if (doc.activeElement !== slider) slider.value = String(now);
      };
      slider.addEventListener('input', () => {
        write({ [key]: Number(slider.value) } as Partial<Record<K, number>>);
        show();
        draw();
      });
      show();
      shows.push(show);
      panel.append(row, slider);
    }
    return shows;
  };
  const forms = world.clouds.ranges;
  const sliders = formSliders(
    forms,
    () => world.clouds.form,
    (change) => world.clouds.set(change),
  );
  const cloudButtons = make('div', 'wrap');
  button(
    'reset form',
    () => {
      const start: Record<string, number> = {};
      for (const key of Object.keys(forms) as Array<keyof typeof forms>) start[key] = forms[key][2];
      world.clouds.set(start);
      for (const show of sliders) show();
      draw();
    },
    cloudButtons,
  );
  button('print', () => console.log('cloud form', JSON.stringify(world.clouds.form)), cloudButtons);
  panel.append(cloudButtons);
  // The high layer's cover is weather: it drifts with the flight's clock until
  // the slider pins it, and "weather" lets go.
  let pinned = false;
  reading('high cover', () => `${fixed(world.clouds.high, 2)}${pinned ? ' pinned' : ''}`);
  const high = make('input');
  high.type = 'range';
  high.min = '0';
  high.max = '1';
  high.step = '0.01';
  high.addEventListener('input', () => {
    pinned = true;
    world.clouds.pinHigh(Number(high.value));
    draw();
  });
  panel.append(high);
  readings.push(() => {
    if (doc.activeElement !== high) high.value = String(world.clouds.high);
  });
  const highButtons = make('div', 'wrap');
  button(
    'weather',
    () => {
      pinned = false;
      world.clouds.pinHigh(null);
      draw();
    },
    highButtons,
  );
  panel.append(highButtons);

  section('deck & air');
  const looks = world.look.ranges;
  const lookSliders = formSliders(
    looks,
    () => world.look.form,
    (change) => world.look.set(change),
  );
  const lookButtons = make('div', 'wrap');
  button(
    'reset look',
    () => {
      const start: Record<string, number> = {};
      for (const key of Object.keys(looks) as Array<keyof typeof looks>) start[key] = looks[key][2];
      world.look.set(start);
      for (const show of lookSliders) show();
      draw();
    },
    lookButtons,
  );
  button('print', () => console.log('sky look', JSON.stringify(world.look.form)), lookButtons);
  panel.append(lookButtons);

  section('scenery');
  reading('trees · props', () => `${scenery?.trees ?? 0} · ${scenery?.props ?? 0}`);
  reading('buildings', () => {
    const refused = scenery?.buildingsRefused ?? 0;
    return `${scenery?.buildings ?? 0}${refused > 0 ? ` (${refused} refused)` : ''}`;
  });
  reading('grass', () => String(scenery?.grass ?? 0));
  reading('sites · queued', () => `${scenery?.sites ?? 0} · ${scenery?.sitesQueued ?? 0}`);
  reading(
    'ring · grass · sites ms',
    () =>
      `${fixed(scenery?.ringMs ?? 0, 1)} · ${fixed(scenery?.grassMs ?? 0, 1)} · ${fixed(scenery?.sitesMs ?? 0, 2)}`,
  );
  reading('bake · rebuilds', () => `${scenery?.bakeMs ?? 0} ms · ${scenery?.rebuilds ?? 0}`);

  section('layers');
  const layerBox = make('div');
  for (const name of world.layers.names) {
    const label = make('label', 'layer');
    const box = make('input');
    box.type = 'checkbox';
    box.checked = world.layers.visible(name);
    box.addEventListener('change', () => {
      world.layers.set(name, box.checked);
      draw();
    });
    label.append(box, doc.createTextNode(name));
    layerBox.append(label);
  }
  panel.append(layerBox);

  section('costs');
  const costs = make('div', 'wrap');
  costs.textContent = 'height hooks: not measured yet';
  const costControls = make('div', 'controls');
  button(
    'measure hooks',
    () => {
      costs.textContent = 'measuring…';
      // A frame, so the panel shows that before the main thread goes away for
      // a third of a second measuring.
      requestAnimationFrame(() => {
        const measured: HookCosts = world.measureHeightHooks();
        const worst = [...measured.perBiome]
          .sort((a, b) => b.us - a.us)
          .slice(0, 4)
          .map((biome) => `${biome.id} ${fixed(biome.us, 2)}`)
          .join(' · ');
        costs.textContent =
          `hooks ${fixed(measured.hooks, 2)} µs/texel (budget ${measured.budget}) · ` +
          `base ${fixed(measured.base, 2)} · all ${fixed(measured.all, 2)} · ${measured.samples} samples\n${worst}`;
        costs.classList.toggle('bad', measured.hooks > measured.budget);
      });
    },
    costControls,
  );
  panel.append(costControls, costs);

  section('open');
  const open = make('div', 'fields');
  const seedField = number('seed', world.seed, open);
  seedField.style.width = '104px';
  button(
    'load',
    () => {
      // Written here rather than imported from `page/Params`: a value import
      // from the page pulls a shared chunk out of the main bundle, and every
      // player pays a request for a panel they never open.
      const url = new URL(location.href);
      url.searchParams.set('seed', String(Number(seedField.value) >>> 0));
      location.href = url.toString();
    },
    open,
  );
  button(
    'random',
    () => {
      seedField.value = String(Math.floor(Math.random() * 0x1_0000_0000));
    },
    open,
  );
  panel.append(open);

  const refresh = () => {
    const now = performance.now();
    if (now - marked > 400) {
      fps = ((world.frames - frames) * 1000) / (now - marked);
      frames = world.frames;
      marked = now;
    }
    for (const read of readings) read();
  };
  refresh();
  const timer = setInterval(refresh, 250);
  doc.body.append(panel);

  return {
    element: panel,
    refresh,
    dispose() {
      clearInterval(timer);
      panel.remove();
      style.remove();
    },
  };
}

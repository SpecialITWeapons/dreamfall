// Sound: everything synthesized, nothing loaded. Pink-noise wind that follows
// altitude, climb and gusts; water near the sea; a pentatonic chime now and
// then through a delay; the suit's flutter in a gust. Web Audio only exists
// in the browser, so the arithmetic lives in AmbienceModel and this file is
// the graph; it starts on Begin, the first user gesture, and never before.
// Ported from fly-with-me.
import { LAYERS, chimeNote, waterAmount, windParams, type Layer } from './AmbienceModel';

export interface AmbienceSample {
  altitude: number;
  vy: number;
  gust: number;
  /** Airspeed against the speed of level flight; 1 is level. */
  rush: number;
  t: number;
  x: number;
  z: number;
}

export interface AmbienceOptions {
  volume: number;
  muted: boolean;
  random?: () => number;
  /** For tests: how to make a context; null means sound is unavailable. */
  createContext?: () => AudioContext | null;
}

/** No biome asking for anything: what `update` hears when nobody hands it a mix. */
const EMPTY_LAYERS = Object.freeze(
  Object.fromEntries(LAYERS.map((layer) => [layer, 0])) as Record<Layer, number>,
);

export interface Ambience {
  readonly available: boolean;
  readonly started: boolean;
  readonly state: string;
  readonly gain: number;
  /** What the biomes under the flyer last asked for; zeros before the first step. */
  readonly layers: Readonly<Record<Layer, number>>;
  /**
   * The audio clock, in seconds. Every fade this graph schedules runs on it and
   * not on the wall clock, and on a machine with no output device it crawls --
   * a CI runner has been seen advancing it 0.48 s while eight seconds of ours
   * passed. Anything asking how far a fade has got has to ask this too, or it
   * is timing the runner rather than the sound.
   */
  readonly clock: number;
  readonly volume: number;
  readonly muted: boolean;
  /** Creates the context and the graph; call from a user gesture. */
  start(): void;
  /**
   * One step. `layers` is what the biomes under the flyer are asking for, as
   * `layerMix` worked it out; a call that leaves it out hears the world's own
   * wind and water and nothing of the country it is over.
   */
  update(
    dt: number,
    sample: AmbienceSample,
    groundAt: (x: number, z: number) => number,
    layers?: Readonly<Record<Layer, number>>,
  ): void;
  chime(count?: number): void;
  /** One bird: a few whistled notes. A biome's `birds` layer is how often. */
  bird(level?: number): void;
  /** One bell, long and low, through the chime's delay. */
  bell(level?: number): void;
  flutter(count?: number): void;
  toggleMute(): boolean;
  setVolume(v: number): void;
  suspend(hidden: boolean): void;
  dispose(): Promise<void>;
}

function pinkBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate,
    n = Math.floor(sr * seconds),
    buffer = ctx.createBuffer(1, n, sr),
    d = buffer.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    b3 = 0,
    b4 = 0,
    b5 = 0,
    b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buffer;
}

export function createAmbience(opts: AmbienceOptions): Ambience {
  const random = opts.random ?? Math.random;
  const createContext =
    opts.createContext ??
    (() => {
      const Context = globalThis.AudioContext;
      if (typeof Context !== 'function') return null;
      try {
        return new Context();
      } catch {
        return null;
      }
    });
  let ctx: AudioContext | null = null,
    master: GainNode | null = null,
    windFilter: BiquadFilterNode | null = null,
    windGain: GainNode | null = null,
    waterGain: GainNode | null = null,
    surfGain: GainNode | null = null,
    highGain: GainNode | null = null,
    cricketGain: GainNode | null = null,
    cricketTremolo: GainNode | null = null,
    delay: DelayNode | null = null,
    noise: AudioBuffer | null = null;
  let muted = opts.muted,
    volume = Math.max(0, Math.min(1, opts.volume)),
    started = false,
    available = typeof globalThis.AudioContext === 'function' || opts.createContext !== undefined;
  /** The last mix handed over, kept so a test can ask what the world sounds like. */
  let heard: Readonly<Record<Layer, number>> = EMPTY_LAYERS;
  /**
   * The last target each parameter was given. A target is an event on the
   * audio thread's timeline, and nine of them a frame at sixty frames is five
   * hundred messages a second for parameters that move on a time constant of
   * a second and a half: one that has not moved by a thousandth is not sent.
   */
  const targets = new Map<AudioParam, number>();
  const retarget = (param: AudioParam, value: number, timeConstant: number) => {
    if (!ctx) return;
    const last = targets.get(param);
    if (last !== undefined && Math.abs(last - value) < 1e-4) return;
    targets.set(param, value);
    param.setTargetAtTime(value, ctx.currentTime, timeConstant);
  };
  let chimeTimer = 25,
    birdTimer = 4,
    bellTimer = 50,
    gusting = false;
  const applyGain = (seconds: number) => {
    if (master && ctx && ctx.state !== 'closed') {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, seconds);
    }
  };
  const api: Ambience = {
    get available() {
      return available;
    },
    get started() {
      return started;
    },
    get state() {
      return ctx?.state ?? 'not-created';
    },
    get gain() {
      return master?.gain.value ?? 0;
    },
    get clock() {
      return ctx?.currentTime ?? 0;
    },
    get layers() {
      return heard;
    },
    get volume() {
      return volume;
    },
    get muted() {
      return muted;
    },
    start() {
      if (started) return;
      started = true;
      ctx = createContext();
      if (!ctx) {
        available = false;
        return;
      }
      ctx.resume().catch(() => {});
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      master.gain.linearRampToValueAtTime(muted ? 0 : volume, ctx.currentTime + 4);
      noise = pinkBuffer(ctx, 4);
      const wind = ctx.createBufferSource();
      wind.buffer = noise;
      wind.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      windFilter.frequency.value = 500;
      windFilter.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0.22;
      wind.connect(windFilter).connect(windGain).connect(master);
      wind.start();
      const water = ctx.createBufferSource();
      water.buffer = noise;
      water.loop = true;
      water.playbackRate.value = 0.7;
      const waterFilter = ctx.createBiquadFilter();
      waterFilter.type = 'lowpass';
      waterFilter.frequency.value = 220;
      waterFilter.Q.value = 0.9;
      waterGain = ctx.createGain();
      waterGain.gain.value = 0;
      water.connect(waterFilter).connect(waterGain).connect(master);
      water.start();
      // The biome layers. Three of them are textures rather than events and
      // are built here once: surf is the sea heard from a height, the high wind
      // is the air the ground sounds have been left behind by, and a field of
      // crickets is a band of noise with a tremolo on it -- not one chirp
      // repeated, which is what a cricket sounds like and what a *field* of
      // them does not.
      const surf = ctx.createBufferSource();
      surf.buffer = noise;
      surf.loop = true;
      surf.playbackRate.value = 0.55;
      const surfFilter = ctx.createBiquadFilter();
      surfFilter.type = 'lowpass';
      surfFilter.frequency.value = 480;
      surfFilter.Q.value = 0.7;
      surfGain = ctx.createGain();
      surfGain.gain.value = 0;
      surf.connect(surfFilter).connect(surfGain).connect(master);
      surf.start();
      // the swell, so a coast breathes instead of hissing: the cutoff wanders
      // by a couple of hundred hertz either side of its 480, once every nine
      // seconds. An AudioParam adds in its own units, so this is hertz -- the
      // first draft wrote 0.35 here and moved the filter by a third of one,
      // which nobody could hear.
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.11;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 220;
      swell.connect(swellDepth).connect(surfFilter.frequency);
      swell.start();

      const high = ctx.createBufferSource();
      high.buffer = noise;
      high.loop = true;
      high.playbackRate.value = 1.6;
      const highFilter = ctx.createBiquadFilter();
      highFilter.type = 'highpass';
      highFilter.frequency.value = 1400;
      highGain = ctx.createGain();
      highGain.gain.value = 0;
      high.connect(highFilter).connect(highGain).connect(master);
      high.start();

      const crickets = ctx.createBufferSource();
      crickets.buffer = noise;
      crickets.loop = true;
      crickets.playbackRate.value = 2.4;
      const cricketBand = ctx.createBiquadFilter();
      cricketBand.type = 'bandpass';
      cricketBand.frequency.value = 4600;
      cricketBand.Q.value = 14;
      cricketGain = ctx.createGain();
      cricketGain.gain.value = 0;
      crickets.connect(cricketBand).connect(cricketGain).connect(master);
      crickets.start();
      const tremolo = ctx.createOscillator();
      tremolo.type = 'sawtooth';
      tremolo.frequency.value = 13;
      cricketTremolo = ctx.createGain();
      cricketTremolo.gain.value = 0;
      tremolo.connect(cricketTremolo).connect(cricketGain.gain);
      tremolo.start();

      delay = ctx.createDelay(1.0);
      delay.delayTime.value = 0.42;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.38;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2400;
      delay.connect(tone).connect(feedback).connect(delay);
      delay.connect(master);
    },
    chime(count = 1) {
      if (!ctx || !master || !delay) return;
      for (let i = 0; i < count; i++) {
        const t = ctx.currentTime + i * (0.9 + random() * 0.6);
        const f = chimeNote(random(), random());
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const o2 = ctx.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2.01;
        const g2 = ctx.createGain();
        g2.gain.value = 0.18;
        o.connect(g);
        o2.connect(g2).connect(g);
        g.connect(master);
        g.connect(delay);
        o.start(t);
        o2.start(t);
        o.stop(t + 5);
        o2.stop(t + 5);
        o.onended = () => {
          o.disconnect();
          o2.disconnect();
          g2.disconnect();
          g.disconnect();
        };
      }
    },
    flutter(count = 3) {
      if (!ctx || !master || !noise) return;
      for (let i = 0; i < count; i++) {
        const t = ctx.currentTime + i * (0.09 + random() * 0.05);
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.value = 260 + random() * 80;
        band.Q.value = 1.1;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        src.connect(band).connect(g).connect(master);
        src.start(t, random() * 3);
        src.stop(t + 0.2);
        src.onended = () => {
          src.disconnect();
          band.disconnect();
          g.disconnect();
        };
      }
    },
    /** A bird: two or three whistled notes, each one sliding up and stopping. */
    bird(level = 1) {
      if (!ctx || !master || !(level > 0)) return;
      const at = ctx.currentTime;
      const notes = 2 + Math.floor(random() * 2);
      const base = 1900 + random() * 1400;
      for (let i = 0; i < notes; i++) {
        const t = at + i * (0.11 + random() * 0.09);
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f = base * (0.86 + random() * 0.3);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * (1.1 + random() * 0.35), t + 0.07);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.14);
        o.onended = () => {
          o.disconnect();
          g.disconnect();
        };
      }
    },
    /** A bell in a village: one low strike, long, through the same delay the chimes use. */
    bell(level = 1) {
      if (!ctx || !master || !delay || !(level > 0)) return;
      const t = ctx.currentTime;
      const f = 148 + random() * 36;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 * level, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      // the clang: a partial a little off the octave, which is what stops a
      // bell sounding like an organ
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2.76;
      const g2 = ctx.createGain();
      g2.gain.value = 0.25;
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(master);
      g.connect(delay);
      o.start(t);
      o2.start(t);
      o.stop(t + 6.5);
      o2.stop(t + 6.5);
      o.onended = () => {
        o.disconnect();
        o2.disconnect();
        g2.disconnect();
        g.disconnect();
      };
    },
    update(dt, sample, groundAt, layers) {
      // What the country asks for is known whether or not there is anything to
      // play it on: a runner with no output device still reads `layers`.
      const want = layers ?? EMPTY_LAYERS;
      heard = want;
      if (!ctx || !windFilter || !windGain || !waterGain) return;
      const wind = windParams(sample);
      retarget(windFilter.frequency, wind.frequency, 0.4);
      retarget(windGain.gain, wind.gain, 0.5);
      retarget(waterGain.gain, waterAmount(groundAt, sample.x, sample.z, sample.altitude) * 0.28, 1.2);
      // What the country under the flyer is asking for. Every layer is a
      // target the graph slides toward over a second and a half: a biome
      // border crossed at fifty metres a second is a fade, not a cut.
      if (surfGain) retarget(surfGain.gain, want.surf * 0.3, 1.5);
      if (highGain) retarget(highGain.gain, want['wind-high'] * 0.12, 1.5);
      if (cricketGain && cricketTremolo) {
        retarget(cricketGain.gain, want.crickets * 0.035, 1.5);
        retarget(cricketTremolo.gain, want.crickets * 0.03, 1.5);
      }
      // and the two that are events rather than textures: the more of the
      // biome is under the flyer the shorter the wait, and at zero they never
      // come round at all. The mix is the event's loudness as well as its
      // rate, or a bird at 440 m -- where the gate has it nearly gone -- is as
      // loud as one on the ground, only rarer. The square root keeps a
      // half-heard bird from being a whisper: the ear reads that as distance.
      birdTimer -= dt * want.birds;
      if (birdTimer <= 0) {
        api.bird(Math.sqrt(want.birds));
        birdTimer = 1.6 + random() * 5;
      }
      bellTimer -= dt * want.bells;
      if (bellTimer <= 0) {
        api.bell(Math.sqrt(want.bells));
        bellTimer = 45 + random() * 70;
      }

      // the suit flutters at the front of every gust
      const gust = sample.gust > 0.5;
      if (gust && !gusting) api.flutter(3 + Math.floor(random() * 3));
      gusting = gust;
      chimeTimer -= dt;
      if (chimeTimer <= 0) {
        api.chime(1 + (random() < 0.3 ? 1 : 0));
        chimeTimer = 22 + random() * 40;
      }
    },
    toggleMute() {
      muted = !muted;
      applyGain(0.3);
      return muted;
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      muted = false;
      applyGain(0.08);
    },
    suspend(hidden) {
      if (!ctx || ctx.state === 'closed') return;
      (hidden ? ctx.suspend() : ctx.resume()).catch(() => {});
    },
    dispose() {
      return ctx && ctx.state !== 'closed' ? ctx.close().catch(() => {}) : Promise.resolve();
    },
  };
  return api;
}

// Sound: everything synthesized, nothing loaded. Pink-noise wind that follows
// altitude, climb and gusts; water near the sea; a pentatonic chime now and
// then through a delay; the suit's flutter in a gust. Web Audio only exists
// in the browser, so the arithmetic lives in AmbienceModel and this file is
// the graph; it starts on Begin, the first user gesture, and never before.
// Ported from fly-with-me.
import { chimeNote, waterAmount, windParams } from './AmbienceModel';

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

export interface Ambience {
  readonly available: boolean;
  readonly started: boolean;
  readonly state: string;
  readonly gain: number;
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
  update(dt: number, sample: AmbienceSample, groundAt: (x: number, z: number) => number): void;
  chime(count?: number): void;
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
    delay: DelayNode | null = null,
    noise: AudioBuffer | null = null;
  let muted = opts.muted,
    volume = Math.max(0, Math.min(1, opts.volume)),
    started = false,
    available = typeof globalThis.AudioContext === 'function' || opts.createContext !== undefined;
  let chimeTimer = 25,
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
    update(dt, sample, groundAt) {
      if (!ctx || !windFilter || !windGain || !waterGain) return;
      const wind = windParams(sample);
      windFilter.frequency.setTargetAtTime(wind.frequency, ctx.currentTime, 0.4);
      windGain.gain.setTargetAtTime(wind.gain, ctx.currentTime, 0.5);
      waterGain.gain.setTargetAtTime(
        waterAmount(groundAt, sample.x, sample.z, sample.altitude) * 0.28,
        ctx.currentTime,
        1.2,
      );
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

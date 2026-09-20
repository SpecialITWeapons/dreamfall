// The controls pill in the corner: world link, sound, volume, pause,
// autopilot, view, backend, and the line at the top that says the flight is
// the pilot's now. Inert until Begin; it dims after a few seconds without the pointer
// and wakes on hover, press or focus. Every interface string lives here or
// in index.html.
import type { View } from '../engine/flight/Steering';

export const HUD_IDLE_MS = 2800;

export function createHud(doc: Document, opts: { idleMs?: number } = {}) {
  const hud = doc.getElementById('hud')!;
  const share = doc.getElementById('shareLink') as HTMLAnchorElement;
  const pause = doc.getElementById('pauseBtn') as HTMLButtonElement;
  const mute = doc.getElementById('muteBtn') as HTMLButtonElement;
  const volume = doc.getElementById('volume') as HTMLInputElement;
  const autopilot = doc.getElementById('autopilotBtn') as HTMLButtonElement;
  const manual = doc.getElementById('manual')!;
  const title = doc.getElementById('title')!;
  const view = doc.getElementById('viewBtn') as HTMLButtonElement;
  const backend = doc.getElementById('backendLabel')!;
  const idleMs = opts.idleMs ?? HUD_IDLE_MS;
  const pauseListeners: Array<() => void> = [];
  const muteListeners: Array<() => void> = [];
  const volumeListeners: Array<(v: number) => void> = [];
  const viewListeners: Array<() => void> = [];
  const autopilotListeners: Array<() => void> = [];
  pause.addEventListener('click', () => {
    for (const cb of pauseListeners) cb();
  });
  mute.addEventListener('click', () => {
    for (const cb of muteListeners) cb();
  });
  volume.addEventListener('input', () => {
    const v = Number(volume.value);
    for (const cb of volumeListeners) cb(v);
  });
  view.addEventListener('click', () => {
    for (const cb of viewListeners) cb();
  });
  autopilot.addEventListener('click', () => {
    for (const cb of autopilotListeners) cb();
  });
  // Dimming: the pill fades once the pointer has left it for a while, and comes back on touch or focus.
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const inert = () => hud.hasAttribute('inert');
  const armIdle = () => {
    clearTimeout(idleTimer);
    if (inert()) return;
    idleTimer = setTimeout(() => {
      hud.classList.add('is-idle');
      hud.classList.remove('is-awake');
    }, idleMs);
  };
  const wake = () => {
    if (inert()) return;
    hud.classList.remove('is-idle');
    hud.classList.add('is-awake');
    armIdle();
  };
  hud.addEventListener('pointerenter', wake);
  hud.addEventListener('pointerdown', wake, true);
  hud.addEventListener('focusin', wake);
  hud.addEventListener('pointerleave', () => {
    if (!hud.contains(doc.activeElement)) armIdle();
  });
  return {
    enable() {
      hud.removeAttribute('inert');
      pause.disabled = false;
      armIdle();
    },
    wake,
    setBackend(name: string) {
      backend.textContent = name;
    },
    setShare(href: string) {
      share.setAttribute('href', href);
    },
    setPaused(paused: boolean) {
      pause.textContent = paused ? 'resume' : 'pause';
      pause.title = paused ? 'Resume flight' : 'Pause flight';
      pause.setAttribute('aria-label', pause.title);
      pause.setAttribute('aria-pressed', String(paused));
    },
    onPause(cb: () => void) {
      pauseListeners.push(cb);
    },
    setMuted(muted: boolean, available = true) {
      mute.textContent = available ? (muted ? 'sound off' : 'sound on') : 'sound unavailable';
      mute.disabled = !available;
      mute.setAttribute('aria-pressed', String(muted));
      mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    },
    onMute(cb: () => void) {
      muteListeners.push(cb);
    },
    setVolume(v: number) {
      volume.value = String(v);
    },
    onVolume(cb: (v: number) => void) {
      volumeListeners.push(cb);
    },
    /** The pill says which it is; the line at the top only shows while the flight is by hand. */
    setAutopilot(on: boolean) {
      autopilot.textContent = on ? 'autopilot on' : 'resume autopilot';
      autopilot.title = on ? 'Autopilot (any arrow key takes it off)' : 'Hand the flight back';
      autopilot.setAttribute('aria-pressed', String(on));
      autopilot.setAttribute(
        'aria-label',
        on ? 'The flight flies itself; an arrow key takes it off' : 'Hand the flight back to the autopilot',
      );
      manual.toggleAttribute('hidden', on);
    },
    onAutopilot(cb: () => void) {
      autopilotListeners.push(cb);
    },
    setView(next: View) {
      view.textContent = next === 'tpp' ? 'view: behind' : 'view: eyes';
      view.setAttribute('aria-pressed', String(next === 'fpp'));
      view.setAttribute(
        'aria-label',
        next === 'tpp' ? 'Switch to the first-person view' : 'Switch to the view from behind',
      );
    },
    onView(cb: () => void) {
      viewListeners.push(cb);
    },
    /**
     * The opening is playing: the controls and the manual banner step out of
     * the picture. It is a class on the body rather than a `hidden` on each,
     * so neither fights the idle dimming or the `inert` the gate sets.
     */
    setOpening(on: boolean) {
      doc.body.classList.toggle('opening', on);
    },
    /**
     * The title card over the opening, at the opacity the script asks for. It
     * is hidden outright at zero rather than left at `opacity: 0`, so that a
     * card nobody is looking at is not a full-screen element over the canvas
     * for the rest of the flight.
     */
    setTitle(opacity: number) {
      const on = opacity > 0.002;
      title.toggleAttribute('hidden', !on);
      title.style.opacity = on ? String(Math.min(1, opacity)) : '0';
    },
  };
}
export type Hud = ReturnType<typeof createHud>;

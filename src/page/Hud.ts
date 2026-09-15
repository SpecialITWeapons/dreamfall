// The controls pill in the corner: world link, sound, volume, pause, view,
// backend. Inert until Begin; it dims after a few seconds without the pointer
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
  const view = doc.getElementById('viewBtn') as HTMLButtonElement;
  const backend = doc.getElementById('backendLabel')!;
  const idleMs = opts.idleMs ?? HUD_IDLE_MS;
  const pauseListeners: Array<() => void> = [];
  const muteListeners: Array<() => void> = [];
  const volumeListeners: Array<(v: number) => void> = [];
  const viewListeners: Array<() => void> = [];
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
  };
}
export type Hud = ReturnType<typeof createHud>;

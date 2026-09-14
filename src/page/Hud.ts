/** Controls pill in the corner: world link, pause, backend name. Inert until Begin. */
export function createHud(doc: Document) {
  const hud = doc.getElementById('hud')!;
  const share = doc.getElementById('shareLink') as HTMLAnchorElement;
  const pause = doc.getElementById('pauseBtn') as HTMLButtonElement;
  const backend = doc.getElementById('backendLabel')!;
  const pauseListeners: Array<() => void> = [];
  pause.addEventListener('click', () => {
    for (const cb of pauseListeners) cb();
  });
  return {
    enable() {
      hud.removeAttribute('inert');
      pause.disabled = false;
    },
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
  };
}
export type Hud = ReturnType<typeof createHud>;

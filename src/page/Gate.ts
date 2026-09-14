/** Begin gate: the world stands still behind it until the veil lifts and the user clicks. */
export function createGate(doc: Document) {
  const panel = doc.getElementById('begin')!;
  const button = doc.getElementById('beginBtn') as HTMLButtonElement;
  const listeners: Array<() => void> = [];
  let ready = false;
  let begun = false;
  button.addEventListener('click', () => {
    if (!ready || begun) return;
    begun = true;
    panel.classList.add('gone');
    panel.setAttribute('inert', '');
    for (const cb of listeners) cb();
  });
  return {
    enable() {
      ready = true;
      panel.classList.add('ready');
      button.disabled = false;
    },
    onBegin(cb: () => void) {
      listeners.push(cb);
    },
    get begun() {
      return begun;
    },
  };
}
export type Gate = ReturnType<typeof createGate>;

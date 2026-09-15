/**
 * White veil over the world: one line of text until the first frame is on
 * screen, then it fades out through a class so CSS owns the fade. Failures are
 * handled by the hook in index.html, which puts its own words here.
 *
 * The start is a handful of long, blocking steps -- the renderer, the window of
 * ground, the first frame's shaders -- and none of them yields on its own, so a
 * line written before one of them would not be painted until after it. `stage`
 * therefore waits for a frame before it returns: the words arrive before the
 * wait they explain, rather than all at once at the end.
 *
 * The words themselves live in index.html, with every other string the page
 * shows.
 */
export type VeilStage = 'graphics' | 'ground' | 'sky';

export function createVeil(doc: Document) {
  const veil = doc.getElementById('loading') as HTMLElement;
  const text = doc.getElementById('loadingText')!;
  const painted = () =>
    new Promise<void>((resolve) => {
      const frame = doc.defaultView?.requestAnimationFrame;
      if (!frame) return resolve();
      frame.call(doc.defaultView, () => setTimeout(resolve, 0));
    });
  return {
    /** Says what the start is doing now, and comes back once it is on screen. */
    async stage(name: VeilStage) {
      // a failure has already had the last word here; do not talk over it
      if (veil.classList.contains('failed') || veil.classList.contains('gone')) return;
      const line = veil.dataset[`stage${name[0]!.toUpperCase()}${name.slice(1)}`];
      if (!line) return;
      text.textContent = line;
      await painted();
    },
    lift() {
      veil.classList.add('gone');
    },
  };
}
export type Veil = ReturnType<typeof createVeil>;

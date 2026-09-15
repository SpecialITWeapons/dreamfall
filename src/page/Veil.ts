/** White veil over the world; lifts via a class so CSS can fade it out. Failures are handled by the hook in index.html. */
export function createVeil(doc: Document) {
  const veil = doc.getElementById('loading')!;
  return {
    lift() {
      veil.classList.add('gone');
    },
  };
}
export type Veil = ReturnType<typeof createVeil>;

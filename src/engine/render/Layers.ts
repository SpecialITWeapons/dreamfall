// Layer switches: what the scene is allowed to draw. The dev panel's toggles
// hang off this, and so does any question of the form "what is this costing
// me" -- turn the trees off and read the frame again.
//
// A switch may only take away. The engine keeps deciding what is visible frame
// by frame (the cloud sea is hidden under the deck, the grass over its ceiling,
// the figure in the first person), so `apply` runs after the world's own writes
// and hides what is switched off; turning a layer back on hands the object to
// the engine, which is free to hide it again for its own reasons.

/** Anything a switch can hide: a mesh, a group, a scene object. Structural on purpose, so this file is testable in Node. */
export interface Hideable {
  visible: boolean;
}

export interface Layers {
  /** The switches there are, in the order the panel should show them. */
  readonly names: string[];
  /** Whether the switch is on -- not whether the object is on screen, which is the engine's business. */
  visible(name: string): boolean;
  set(name: string, on: boolean): void;
  /** Returns the new state. */
  toggle(name: string): boolean;
  /** Hide what is switched off; called once a frame, after everything else has had its say. */
  apply(): void;
}

/**
 * A switch over a shader term rather than an object -- the high clouds, the
 * sea's fog, the deck's underside are a few lines of a shader that draws
 * other things too -- through a uniform the term is multiplied by: 1 on, 0 off.
 * Nothing but the switch may write the uniform, or `apply` and the engine
 * would fight over it every frame.
 */
export function uniformGate(u: { value: number }): Hideable {
  return {
    get visible() {
      return u.value > 0;
    },
    set visible(on: boolean) {
      u.value = on ? 1 : 0;
    },
  };
}

export function createLayers(groups: Record<string, readonly Hideable[]>): Layers {
  const names = Object.keys(groups);
  const on = new Map<string, boolean>(names.map((name) => [name, true]));
  const set = (name: string, value: boolean) => {
    if (!on.has(name)) return;
    on.set(name, value);
    // Turning one on writes `true` once: an object the engine never touches
    // (the terrain, a tree pool) would otherwise stay hidden for ever, and one
    // it does touch is corrected on the next update anyway. "Next update", not
    // "next draw": a redraw with no update between (`renderOnce` on a paused
    // loop) shows the cloud sea or the puffs forced on for that one frame,
    // which is why the panel redraws through `frame()`.
    for (const object of groups[name]!) object.visible = value;
  };
  return {
    names,
    visible: (name) => on.get(name) ?? false,
    set,
    toggle(name) {
      const next = !(on.get(name) ?? false);
      set(name, next);
      return next;
    },
    apply() {
      for (const [name, ok] of on) {
        if (ok) continue;
        for (const object of groups[name]!) object.visible = false;
      }
    },
  };
}

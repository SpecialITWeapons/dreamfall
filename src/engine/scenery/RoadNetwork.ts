// Which settlements a road joins: the relative neighbourhood graph. Two places
// are joined when no third is nearer to both of them than they are to each
// other, which is the graph a road network grows into -- no triangle whose
// long side runs beside its two short ones, and the shortest link between any
// two clusters kept. It is decided by the places within one edge of both ends
// and nothing else, so a flight that sees the same neighbourhood draws the
// same roads whichever way it arrived. Pure CPU: no three, no DOM.

/** The longest road, m: two and a half village cells, three minutes of flying. */
export const MAX_EDGE = 14000;

export interface NetworkSite {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface Edge<S extends NetworkSite = NetworkSite> {
  /** `a.id|b.id`, the ends in one order. */
  id: string;
  /** The end with the smaller id: a route is always walked from it. */
  a: S;
  b: S;
  length: number;
}

/**
 * The graph over `sites`. It is only complete for a pair whose every rival --
 * a place within `length` of both ends -- is in the list, so the caller hands
 * in the places around the pairs it asks about, one edge further out.
 */
export function relativeNeighbours<S extends NetworkSite>(
  sites: readonly S[],
  maxEdge = MAX_EDGE,
): Edge<S>[] {
  const edges: Edge<S>[] = [];
  for (let i = 0; i < sites.length; i++)
    for (let j = i + 1; j < sites.length; j++) {
      const p = sites[i]!,
        q = sites[j]!;
      const length = Math.hypot(p.x - q.x, p.z - q.z);
      if (length > maxEdge) continue;
      let blocked = false;
      for (let k = 0; k < sites.length && !blocked; k++) {
        if (k === i || k === j) continue;
        const c = sites[k]!;
        blocked = Math.max(Math.hypot(p.x - c.x, p.z - c.z), Math.hypot(q.x - c.x, q.z - c.z)) < length;
      }
      if (blocked) continue;
      const [a, b] = p.id < q.id ? [p, q] : [q, p];
      edges.push({ id: `${a.id}|${b.id}`, a, b, length });
    }
  return edges;
}

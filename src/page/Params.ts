export interface PageParams {
  seed: number;
  forceWebGL: boolean;
  profiling: boolean;
  dev: boolean;
}

/**
 * Seed and flags from the address. `?seed=<n>` always wins; without it
 * the remembered seed is used, and without that a random 32-bit one.
 */
export function resolveParams(
  search: string,
  random: () => number = Math.random,
  remembered: number | null = null,
): PageParams {
  const params = new URLSearchParams(search);
  let seed = parseInt(params.get('seed') ?? '', 10);
  if (!Number.isFinite(seed)) seed = remembered ?? Math.floor(random() * 0x1_0000_0000);
  return {
    seed: seed >>> 0,
    forceWebGL: params.get('webgl') === '1',
    profiling: params.has('profile'),
    dev: params.get('dev') === '1',
  };
}

/** The current address with the seed written in, so a copied URL opens the same world. */
export function addressWithSeed(href: string, seed: number): string {
  const url = new URL(href);
  url.searchParams.set('seed', String(seed));
  return url.toString();
}

/** Share link: origin, path, and the seed alone. */
export function shareAddress(href: string, seed: number): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('seed', String(seed));
  return url.toString();
}

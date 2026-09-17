// Baking the Milky Way's light atlas off the main thread. Two million texels,
// each one three fbm fields and a dust lookup: 3.5 s on this machine, which is
// three starts' worth of stall for something nobody can see until nightfall.
// The dust is grown again here rather than transferred, because it is 49 ms and
// deterministic -- the same seed gives the same field -- and a transfer would
// make the main thread hold 8 MB it has no use for.
import { DUST, makeDust, photographicMatter } from './GalaxyMatter';

export interface GalaxyBake {
  width: number;
  height: number;
  /** RGBA, linear light with a fixed 2x decode range; not an sRGB photograph. */
  data: Uint8Array;
  ms: number;
}

const bake = (): GalaxyBake => {
  const started = performance.now();
  const dust = makeDust();
  const { width, height, latitudeSpan } = DUST;
  const data = new Uint8Array(width * height * 4);
  for (let x = 0; x < width; x++) {
    const longitude = (x / width - 0.5) * Math.PI * 2;
    for (let y = 0; y < height; y++) {
      const latitude = (y / (height - 1) - 0.5) * latitudeSpan;
      const matter = photographicMatter(longitude, latitude, dust);
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(1, matter.color[c]! / 2) * 255);
      data[i + 3] = 255;
    }
  }
  return { width, height, data, ms: performance.now() - started };
};

self.addEventListener('message', () => {
  const result = bake();
  (self as unknown as Worker).postMessage(result, [result.data.buffer]);
});

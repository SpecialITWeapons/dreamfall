/**
 * The snow line: where the world turns white, in metres. It sits in the library
 * rather than in the engine because the first thing to read it is the standard
 * scatter hook, which draws the tree line sixty metres above it, and library/
 * never imports from src/. The world's snow reads the same function, so there
 * is one line and not two -- two snow lines in one world is the bug nobody
 * finds for six months.
 */

/**
 * The line at zero base temperature, and how far it climbs per unit of it, m.
 * Ported from fly-with-me.
 */
export const SNOW_LINE = { base: 200, slope: 380 };

/**
 * The snow line at a place's climate temperature. It takes `Fields.baseTemp` --
 * the temperature with the sampler's altitude cooling taken back off -- because
 * the line is drawn on the climate, not on the height that climate produced.
 * The original wound that cooling back on inside this function; `baseTemp`
 * exists so it does not have to.
 *
 * @param {number} baseTemp
 * @returns {number}
 */
export function snowLineAt(baseTemp) {
  return SNOW_LINE.base + SNOW_LINE.slope * baseTemp;
}

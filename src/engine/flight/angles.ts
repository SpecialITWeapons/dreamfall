// Angle helpers shared by the flight, the steering and the camera. Headings
// grow counter-clockwise seen from above: 0 flies along +z, pi / 2 along +x.

/** Wraps an angle into (-pi, pi]. */
export const wrapAngle = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

/** The heading that flies toward a horizontal direction. */
export const headingOf = (x: number, z: number): number => Math.atan2(x, z);

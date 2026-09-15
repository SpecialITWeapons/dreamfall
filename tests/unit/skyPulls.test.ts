import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { headingOf, wrapAngle } from '../../src/engine/flight/angles';
import {
  GALAXY_HEADING,
  NIGHTWARD,
  createSkyPulls,
  findSkyEvents,
  skyEventWeight,
} from '../../src/engine/flight/SkyPulls';
import { NIGHT_SHARE, createDayClock } from '../../src/engine/time/DayClock';

describe('angles', () => {
  it('wraps into (-pi, pi] and reads a heading from a direction', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2, 9);
    expect(wrapAngle(0.3)).toBe(0.3);
    expect(headingOf(0, 1)).toBe(0);
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('findSkyEvents', () => {
  it('finds sunrise and sunset on the day clock where the sun crosses the horizon', () => {
    const events = findSkyEvents(createDayClock());
    const sun = events.filter((e) => e.body === 'sun');
    expect(sun).toHaveLength(2);
    const sunrise = sun.find((e) => e.rising)!,
      sunset = sun.find((e) => !e.rising)!;
    // solar 0.25 and 0.75 sit at NIGHT_SHARE / 2 and 1 - NIGHT_SHARE / 2 on the day clock
    expect(sunrise.phase).toBeCloseTo(NIGHT_SHARE / 2, 3);
    expect(sunset.phase).toBeCloseTo(1 - NIGHT_SHARE / 2, 3);
    expect(sunrise.solar).toBeCloseTo(0.25, 3);
    expect(events.filter((e) => e.body === 'moon')).toHaveLength(2);
    expect(events.map((e) => e.phase)).toEqual([...events.map((e) => e.phase)].sort((a, b) => a - b));
  });
  it('weights an event fully at the crossing and not at all far from it', () => {
    const events = findSkyEvents(createDayClock());
    const sunrise = events.find((e) => e.body === 'sun' && e.rising)!;
    expect(skyEventWeight(sunrise, sunrise.phase)).toBe(1);
    expect(skyEventWeight(sunrise, sunrise.phase + 0.3)).toBe(0);
    expect(skyEventWeight(sunrise, sunrise.phase - 0.3)).toBe(0);
    expect(skyEventWeight(sunrise, sunrise.phase + 1)).toBe(1);
  });
});

describe('createSkyPulls', () => {
  it('pulls toward the sun at sunrise, lets go when steered, and re-arms on the next event', () => {
    const clock = createDayClock();
    const pulls = createSkyPulls(clock);
    pulls.update(0.5, 0, 0, 0.05);
    expect(pulls.pull).toBe(0);
    pulls.update(pulls.sunrise.phase, 10, 0, 0.05);
    expect(pulls.pull).toBe(1);
    expect(pulls.event).toBe(pulls.sunrise);
    // the pull's heading is the sun's bearing on that arc
    const sun = new Vector3(),
      moon = new Vector3();
    clock.skyBodies(pulls.sunrise.phase, sun, moon);
    expect(Math.abs(wrapAngle(pulls.heading - headingOf(sun.x, sun.z)))).toBeLessThan(1e-9);
    pulls.release();
    pulls.update(pulls.sunrise.phase + 0.001, 11, 0, 0.05);
    expect(pulls.released).toBe(true);
    expect(pulls.pull).toBe(0);
    pulls.update(pulls.sunset.phase, 300, 0, 0.05);
    expect(pulls.released).toBe(false);
    expect(pulls.pull).toBe(1);
    pulls.restore(true);
    expect(pulls.released).toBe(true);
  });
  it('knows night from the same crossings', () => {
    const pulls = createSkyPulls(createDayClock());
    expect(pulls.isNight(0)).toBe(true);
    expect(pulls.isNight(0.5)).toBe(false);
    expect(pulls.isNight(pulls.sunset.phase + 0.01)).toBe(true);
    expect(pulls.isNight(pulls.sunrise.phase + 0.01)).toBe(false);
  });
  it('turns once toward the galaxy after nightfall, and is done once facing it', () => {
    const pulls = createSkyPulls(createDayClock(), { galaxyHeading: 1 });
    pulls.update(0.5, 0, 0, 0.05); // day: reads where the day stands, arms nothing
    let t = 0;
    const night = 0.95; // well past the sunset event
    for (let i = 0; i < 60; i++) pulls.update(night, (t += 0.05), 0, 0.05);
    expect(pulls.pull).toBeCloseTo(1, 6);
    expect(pulls.heading).toBe(1);
    // facing the core ends the turn; the pull then fades out
    for (let i = 0; i < 60; i++) pulls.update(night, (t += 0.05), 1 - NIGHTWARD.aligned / 2, 0.05);
    expect(pulls.pull).toBe(0);
    // it happens once a night: a later update in the same night does not arm it again
    for (let i = 0; i < 20; i++) pulls.update(night, (t += 0.05), 0, 0.05);
    expect(pulls.pull).toBe(0);
    // a resumed flight that starts at night is left alone
    const resumed = createSkyPulls(createDayClock(), { galaxyHeading: 1 });
    for (let i = 0; i < 60; i++) resumed.update(night, i * 0.05, 0, 0.05);
    expect(resumed.pull).toBe(0);
    expect(GALAXY_HEADING).toBeCloseTo(0.95, 6);
  });
  it('gives up the turn after NIGHTWARD.give seconds', () => {
    const pulls = createSkyPulls(createDayClock(), { galaxyHeading: 1 });
    pulls.update(0.5, 0, 0, 0.05);
    let t = 0;
    for (let i = 0; i < (NIGHTWARD.give + 5) / 0.05; i++) pulls.update(0.95, (t += 0.05), 0, 0.05);
    expect(pulls.pull).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { cameraPoseFor } from '../../src/engine/sim/cameraPose';

describe('cameraPoseFor', () => {
  it('hangs behind and above the flyer and looks ahead of it', () => {
    const pose = cameraPoseFor({ t: 0, x: 100, y: 120, z: 200, heading: 0 }, { back: 12, up: 4, ahead: 30 });
    expect(pose.x).toBeCloseTo(100);
    expect(pose.y).toBeCloseTo(124);
    expect(pose.z).toBeCloseTo(188);
    expect(pose.lookX).toBeCloseTo(100);
    expect(pose.lookY).toBeCloseTo(120);
    expect(pose.lookZ).toBeCloseTo(230);
  });
  it('turns with the heading', () => {
    const pose = cameraPoseFor(
      { t: 0, x: 0, y: 0, z: 0, heading: Math.PI / 2 },
      { back: 10, up: 0, ahead: 10 },
    );
    expect(pose.x).toBeCloseTo(-10);
    expect(pose.z).toBeCloseTo(0);
    expect(pose.lookX).toBeCloseTo(10);
  });
});

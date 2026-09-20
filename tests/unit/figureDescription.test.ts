import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createProceduralHuman } from '../../src/engine/avatar/ProceduralHuman';

const lit = () => new MeshStandardNodeMaterial();

describe('describe', () => {
  it('hands over the figure the engine actually built, not a copy of it', () => {
    // What this pins: `tools/figure` bakes a second body out of this
    // description, in Blender, and the two are only the same figure for as long
    // as the description is read off the real one. A description written beside
    // the geometry would agree until the first time either was edited.
    const human = createProceduralHuman(lit);
    const description = human.describe();
    const root = human.object as Object3D;
    root.updateMatrixWorld(true);

    // every bone of the skeleton, with its parent, in the skeleton's own order
    expect(description.bones.map((b) => b.name)).toEqual([
      'body',
      'neck',
      'shoulderL',
      'elbowL',
      'wristL',
      'hipL',
      'kneeL',
      'ankleL',
      'toeL',
      'shoulderR',
      'elbowR',
      'wristR',
      'hipR',
      'kneeR',
      'ankleR',
      'toeR',
    ]);
    for (const bone of description.bones) {
      const at = root.getObjectByName(bone.name)!.getWorldPosition(new Vector3());
      expect(new Vector3(...bone.rest).distanceTo(at)).toBeLessThan(1e-6);
      if (bone.parent !== null) expect(root.getObjectByName(bone.parent)).toBeTruthy();
    }

    // A spine, two arms, two legs, two palms, ten fingers, two boots and a
    // head. The count is not pinned -- a figure gains parts -- but the bake
    // reads this list and a figure that suddenly has three of them is one that
    // lost its hands.
    expect(description.chains.length).toBeGreaterThanOrEqual(12);
    const swatches = new Set<string>();
    const box = new Box3();
    for (const chain of description.chains) {
      expect(chain.samples.length).toBeGreaterThan(10);
      expect(chain.samples[0]!.t).toBe(0);
      expect(chain.samples.at(-1)!.t).toBe(1);
      for (const [i, sample] of chain.samples.entries()) {
        if (i > 0) expect(sample.t).toBeGreaterThan(chain.samples[i - 1]!.t);
        expect(sample.radius).toBeGreaterThan(0);
        expect(sample.radius).toBeLessThan(0.3);
        expect(chain.bones[sample.bone]).toBeTruthy();
        swatches.add(sample.swatch);
        // A patched chain writes its colour at twelve bearings as well, because
        // a visor is a place on the head and not a belt round it: a baker given
        // the band alone would put a helmet on with no visor in it.
        if (sample.ring) {
          expect(sample.ring).toHaveLength(12);
          for (const name of sample.ring) swatches.add(name);
        }
        box.expandByPoint(new Vector3(...sample.at));
      }
      // Every chain's own bone list, so a baker can weight what it builds.
      for (const name of chain.bones) expect(root.getObjectByName(name)).toBeTruthy();
    }
    // The description walks the same body the meshes were cut from, so its
    // points sit inside them -- a description of a figure standing somewhere
    // else is the one fault this cannot otherwise catch.
    const drawn = new Box3();
    for (const name of ['skin', 'skull'])
      drawn.union(
        new Box3().setFromBufferAttribute(
          (root.getObjectByName(name) as Mesh).geometry.getAttribute('position') as never,
        ),
      );
    expect(drawn.containsBox(box)).toBe(true);
    // and it names every swatch the outfit does, because the bake paints from these
    // Six, and the goggles among them: they are the one swatch that lives
    // only in a patch, and until the ring bearings above were written down the
    // description quietly lacked it -- which is exactly the colour a baker
    // would have left off the head.
    expect(swatches).toEqual(new Set(['suit', 'gloves', 'boots', 'helmet', 'skin', 'goggles']));
    // the head is the one chain that wears a patch, and it says so
    expect(description.chains.filter((c) => c.samples.some((s) => s.ring))).toHaveLength(1);
  });
});

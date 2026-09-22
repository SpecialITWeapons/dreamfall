// Load a .glb through three's own loader, headless, and say whether the
// skinning arrives.
//
//     node tools/figure/load_glb.mjs FIGURE.glb
//
// `check_glb.py` reads the container and can say a skeleton is flat or a
// material is glass. It cannot say whether three accepts the file, and that is
// a different question with its own answers: an accessor a byte out of
// alignment, a skin whose joints load but never reach the scene. The first
// authored figure loaded without an error and drew nothing -- all 31 bones
// came back with `parent === null` and an identity `matrixWorld`, so
// `Skeleton.update()` handed the shader the inverse bind matrices and the
// figure collapsed into a 30 cm crumple. Nothing short of loading it says so.
//
// This reports, per skinned mesh: how many bones are orphaned, how many still
// carry an identity world matrix after the scene is updated, and how far the
// skinned vertices sit from the rest pose. A figure in its bind pose should
// not move at all, so anything but 0.000000 m is the fault.
import { readFileSync } from 'node:fs';
globalThis.self = /** @type {Window & typeof globalThis} */ (/** @type {unknown} */ (globalThis));
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
// three's ImageLoader hangs a listener on an <img> and then sets .src; with no
// browser here, the stub has to fire that listener itself or the parse never
// settles. No pixels are decoded and none are needed: this is about the
// container, the accessors and the skeleton.
/**
 * The one <img> three's ImageLoader thinks it is talking to. It hangs a
 * listener on the element and then sets `.src`; with no browser here, nothing
 * would ever fire it and the parse would never settle. No pixels are decoded
 * and none are needed: this is about the container, the accessors and the
 * skeleton.
 */
function stubImage() {
  /** @type {Record<string, Array<(event: unknown) => void>>} */
  const handlers = {};
  return {
    width: 1,
    height: 1,
    /**
     * @param {string} kind
     * @param {(event: unknown) => void} fn
     */
    addEventListener: (kind, fn) => void (handlers[kind] ??= []).push(fn),
    removeEventListener: () => {},
    /** @param {string} _url */
    set src(_url) {
      queueMicrotask(() => (handlers.load ?? []).forEach((fn) => fn({ target: this })));
    },
  };
}

globalThis.document = /** @type {Document} */ (
  /** @type {unknown} */ ({
    createElementNS: stubImage,
    createElement: () => ({ getContext: () => null }),
  })
);

const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { Matrix4, Vector3 } = await import('three');

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/figure/load_glb.mjs FIGURE.glb');
  process.exit(2);
}
const buf = readFileSync(file);
const ab = /** @type {ArrayBuffer} */ (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const gltf = await new Promise((ok, no) => new GLTFLoader().parse(ab, '', ok, no));

const scene = gltf.scene;
scene.updateMatrixWorld(true);
/** @type {import('three').SkinnedMesh[]} */
const skinned = [];
scene.traverse(
  /** @param {import('three').Object3D} o */ (o) => {
    if (/** @type {import('three').SkinnedMesh} */ (o).isSkinnedMesh) {
      skinned.push(/** @type {import('three').SkinnedMesh} */ (o));
    }
  },
);
console.log(`parsed: ${skinned.length} skinned meshes, ${gltf.animations.length} animations`);

for (const mesh of skinned) {
  const sk = mesh.skeleton;
  const orphan = sk.bones.filter((b) => b.parent === null).length;
  const identity = sk.bones.filter((b) => {
    const e = b.matrixWorld.elements;
    return e.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
  }).length;
  sk.update();
  // three's own skinning formula, on the CPU, for every seventh vertex. A mesh
  // missing any of these three is not skinned at all, which is its own answer.
  const { position: pos, skinIndex: si, skinWeight: sw } = mesh.geometry.attributes;
  if (!pos || !si || !sw || !sk.boneMatrices) {
    console.log(`  ${mesh.name}: NOT SKINNED -- position/skinIndex/skinWeight missing`);
    continue;
  }
  let maxMove = 0;
  const v = new Vector3(),
    acc = new Vector3(),
    tmp = new Vector3(),
    m = new Matrix4();
  for (let i = 0; i < pos.count; i += 7) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w === 0) continue;
      m.fromArray(sk.boneMatrices, si.getComponent(i, k) * 16);
      acc.add(tmp.copy(v).applyMatrix4(m).multiplyScalar(w));
    }
    acc.applyMatrix4(mesh.bindMatrixInverse);
    maxMove = Math.max(maxMove, acc.distanceTo(tmp.fromBufferAttribute(pos, i)));
  }
  console.log(
    `  ${mesh.name}: bones ${sk.bones.length}, orphaned ${orphan}, identity matrixWorld ${identity}, ` +
      `max |skinned - rest| = ${maxMove.toFixed(6)} m`,
  );
}

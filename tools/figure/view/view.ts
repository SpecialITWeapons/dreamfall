// A .glb on its own, lit and turned, with nothing of the engine's done to it:
//
//     npx vite    # then open /tools/figure/view/?file=/src/engine/avatar/figure.glb
//
// `yaw` and `pitch` in degrees and `dist` in metres place the camera round the
// body, `target` is the height it looks at, `hide=` takes a comma list of
// object names, and `raw=1` keeps the file's glass and blending, which are off
// by default because the engine turns them off. The page sets `window.ready`
// once it has drawn, for a browser that wants to photograph it.
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGPURenderer,
  type Material,
  type Mesh,
  type Object3D,
} from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const q = new URLSearchParams(location.search);
const renderer = new WebGPURenderer({ antialias: true, forceWebGL: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.add(new AmbientLight(0xffffff, 0.8));
const sun = new DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);
const gltf = await new GLTFLoader().loadAsync(q.get('file') ?? '/src/engine/avatar/figure.glb');
const body: Object3D = gltf.scene;
if (!q.has('raw')) {
  // What the engine would ask of the file: no glass, no blending.
  body.traverse((o) => {
    const m = (o as Mesh).material as (Material & { transmission?: number }) | undefined;
    if (!m) return;
    if ('transmission' in m) m.transmission = 0;
    m.transparent = false;
    m.opacity = 1;
    m.alphaTest = 0;
  });
}
for (const name of (q.get('hide') ?? '').split(',').filter(Boolean))
  body.getObjectByName(name)!.visible = false;
scene.add(body);
const box = new Box3().setFromObject(body);
const target = new Vector3(0, Number(q.get('target') ?? (box.min.y + box.max.y) / 2), 0);
const yaw = (Number(q.get('yaw') ?? 0) * Math.PI) / 180,
  pitch = (Number(q.get('pitch') ?? 10) * Math.PI) / 180;
const dist = Number(q.get('dist') ?? 2.6);
const camera = new PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
camera.position.set(
  Math.sin(yaw) * Math.cos(pitch) * dist,
  target.y + Math.sin(pitch) * dist,
  Math.cos(yaw) * Math.cos(pitch) * dist,
);
camera.lookAt(target);
await renderer.renderAsync(scene, camera);
(window as unknown as { ready: boolean }).ready = true;

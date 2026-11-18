import * as T from './vendor/three.module.js';
import { buildScholar, poseSchoolUniform } from './scholar-model.js';

const canvas = document.querySelector('canvas');
const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new T.Scene(),
  camera = new T.OrthographicCamera();

const model = await buildScholar(new URL('./scholar-face.jpg', import.meta.url).href);
const nodes = model.parts().map(([id, color, , , , tag]) => {
  const mat = model.tintedMaterial(id, color);
  const m = new T.Mesh(model.geometries[id], mat);
  scene.add(m);
  m.matrixAutoUpdate = false;
  return [m, tag.slice(8)];
});
const base = new T.Mesh(
  new T.CylinderGeometry(0.59, 0.61, 0.027, 96),
  new T.MeshStandardMaterial({ color: 0xd6cfc4 }),
);
scene.add(base);
base.position.y = -0.012;
scene.add(new T.HemisphereLight(0xfff1da, 0xd9cbde, 2));
const sunlight = new T.DirectionalLight(0xfff0dd, 2);
sunlight.position.set(-3, 5, 4);
scene.add(sunlight);
canvas.style.background = 'radial-gradient(ellipse at 48% 36%,#faf5e9 0%,#e8e2da 58%,#c9c5c1 100%)';
const views = {
  portrait: [-0.22, 0.09, 1.71, 1.25],
  grip: [3.05, 0.37, 1.43, 0.405, -0.116, 0.31],
  full: [0.22, 0.1, 1.1, 2.67],
  arena: [0.55, 0.82, 0.95, 4.4],
};
let yaw,
  pitch,
  target,
  targetX,
  targetZ,
  height,
  paused = false,
  elapsed = 1.74,
  last = 0;
function view(key) {
  [yaw, pitch, target, height, targetX = 0, targetZ = 0] = views[key];
  for (const [node, joint] of nodes)
    node.visible = key !== 'grip' || ['elbowR', 'handR', 'handL', 'page', 'elbowL'].includes(joint);
  base.visible = key !== 'grip';
  document
    .querySelectorAll('[data-view]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === key)));
}
view('portrait');
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => view(b.dataset.view)));
const pause = document.querySelector('#pause');
pause.onclick = () => {
  paused = !paused;
  pause.textContent = paused ? '播放' : '暂停';
};
let drag = null;
canvas.onpointerdown = (e) => {
  canvas.setPointerCapture(e.pointerId);
  drag = [e.clientX, e.clientY];
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.009;
  pitch = T.MathUtils.clamp(pitch + (e.clientY - drag[1]) * 0.006, -0.45, 1.25);
  drag = [e.clientX, e.clientY];
};
canvas.onlostpointercapture = () => (drag = null);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    height = T.MathUtils.clamp(height * Math.exp(e.deltaY * 0.001), 0.24, 5);
  },
  { passive: false },
);
function frame(ms) {
  if (!paused) elapsed += Math.min((ms - last) / 1000, 0.05);
  last = ms;
  const bones = poseSchoolUniform({ scholarIdle: elapsed }, elapsed);
  for (const [node, joint] of nodes) {
    node.matrix.copy(bones[joint]);
    node.matrixWorldNeedsUpdate = true;
  }
  const w = canvas.clientWidth,
    h = canvas.clientHeight,
    aspect = w / h;
  if (
    canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(h * renderer.getPixelRatio())
  )
    renderer.setSize(w, h, false);
  camera.left = (-height * aspect) / 2;
  camera.right = -camera.left;
  camera.top = height / 2;
  camera.bottom = -camera.top;
  camera.near = 0.05;
  camera.far = 30;
  camera.position.set(
    targetX + 5 * Math.sin(yaw) * Math.cos(pitch),
    target + 5 * Math.sin(pitch),
    targetZ + 5 * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(targetX, target, targetZ);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

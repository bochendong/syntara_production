import { originalShinoMaterials } from './scholar-original.js';
import * as T from './vendor/three.module.js';
import { scholarToon, poseScholar } from './scholar.js';
// The wrist pivot, fingers and pencil share one rest-space grip transform.
const bookRotation = new T.Euler(-1.93, 0.07, -0.1);
const writingLeafAngle = 0.12;
const gripScale = 1.45,
  lift = 0.057;
const tip = new T.Vector3(-0.033, 1.301, 0.311);
const grip = new T.Vector3(-0.074, 1.357, 0.298);
const axis = new T.Vector3(-0.5547, 0.6218, -0.5529).normalize();
const gripSlide = -0.019;
const fingerRoll = 0.43;
const wristAtRest = new T.Vector3(-0.144, 1.334, 0.274)
  .sub(grip)
  .applyAxisAngle(new T.Vector3(0, 0, 1), fingerRoll)
  .add(grip)
  .addScaledVector(axis, gripSlide)
  .sub(tip)
  .multiplyScalar(gripScale)
  .add(tip);
wristAtRest.y += 0.048 + lift;
const bookPosition = tip
  .clone()
  .add(new T.Vector3(0, 0.013 + lift, 0))
  .sub(
    new T.Vector3(-0.065, -0.092, 0.021)
      .applyAxisAngle(new T.Vector3(0, 1, 0), writingLeafAngle)
      .applyEuler(bookRotation),
  );
const supportOffset = new T.Vector3(0.224, -0.01, -0.036)
  .applyAxisAngle(new T.Vector3(0, 1, 0), -0.47)
  .applyEuler(bookRotation)
  .add(bookPosition)
  .sub(new T.Vector3(0.156, 1.216, 0.264));
export async function buildScholar() {
  const V = (x, y, z) => new T.Vector3(x, y, z);
  function group(parent) {
    const g = new T.Group();
    parent.add(g);
    return g;
  }
  const character = new T.Group();
  const colors = new Map();
  function material(color) {
    if (!colors.has(color)) colors.set(color, scholarToon(color));
    return colors.get(color);
  }
  function mesh(parent, geometry, color) {
    const m = new T.Mesh(geometry, color.isMaterial ? color : material(color));
    parent.add(m);
    return m;
  }
  function tube(parent, color, points, r, closed = false) {
    const path = new T.CatmullRomCurve3(
      points.map((p) => V(...p)),
      closed,
    );
    return mesh(
      parent,
      new T.TubeGeometry(path, Math.max(12, points.length * 3), r, 8, closed),
      color,
    );
  }
  function grid(parent, color, cols, rows, point) {
    const pos = [],
      uv = [],
      ids = [];
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const u = i / cols,
          v = j / rows;
        pos.push(...point(u, v));
        uv.push(u, v);
        if (i < cols && j < rows) {
          const k = j * (cols + 1) + i;
          ids.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
        }
      }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(ids);
    g.computeVertexNormals();
    return mesh(parent, g, color);
  }
  function limb(parent, color, a, b, r1, r2) {
    const start = V(...a),
      end = V(...b),
      axis = end.clone().sub(start);
    const m = mesh(parent, new T.CylinderGeometry(r2, r1, axis.length(), 24), color);
    m.position.copy(start).lerp(end, 0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), axis.normalize());
  }
  function block(parent, color, at, sz) {
    const m = mesh(parent, new T.BoxGeometry(...sz), color);
    m.position.set(...at);
    return m;
  }
  const book = group(character);
  book.userData.joint = 'handL';
  book.position.copy(bookPosition);
  book.rotation.copy(bookRotation);
  for (const sign of [-1, 1]) {
    const leaf = group(book);
    leaf.rotation.y = sign < 0 ? writingLeafAngle : -0.47;
    block(leaf, 0x315858, [sign * 0.098, 0, 0], [0.201, 0.237, 0.011]);
    block(leaf, 0xffefd7, [sign * 0.098, 0.001, 0.011], [0.194, 0.228, 0.017]);
    for (let i = 0; i < 7; i++)
      block(
        leaf,
        0xd7c3ab,
        [sign * 0.09, 0.086 - i * 0.025, 0.0201],
        [0.137 - (i % 3) * 0.014, 0.0014, 0.001],
      );
  }
  // A separate leaf shares the spine with the covers and travels with the supporting hand.
  const sheet = group(book);
  sheet.userData.joint = 'page';
  sheet.rotation.y = -0.47;
  grid(sheet, 0xfff0d8, 12, 4, (u, v) => [
    u * 0.189,
    (v - 0.5) * 0.221,
    0.023 + 0.006 * Math.sin(Math.PI * u),
  ]);
  const hand = group(character);
  hand.userData.joint = 'handR';
  hand.scale.setScalar(gripScale);
  hand.position.copy(tip).multiplyScalar(1 - gripScale);
  hand.position.y += 0.013 + lift;
  const pencilPoint = (t) => tip.clone().addScaledVector(axis, t).toArray();
  const barrel = 0.0049;
  for (const [from, to, near, far, color] of [
    [0, 0.007, 0.0003, 0.0017, 0x393140],
    [0.007, 0.022, 0.0017, barrel, 0xddbb87],
    [0.022, 0.183, barrel, barrel, 0xe5ae51],
    [0.183, 0.193, 0.0052, 0.0052, 0xc4ac91],
    [0.193, 0.202, 0.005, 0.0048, 0xb98082],
  ]) {
    limb(hand, color, pencilPoint(from), pencilPoint(to), near, far);
  }
  const head = group(character);
  head.userData.joint = 'head';
  const frame = 0x783e50;
  for (const side of [-1, 1]) {
    const rim = [];
    for (let i = 0; i < 32; i++) {
      const angle = (Math.PI * i) / 16;
      const x = side * (0.049 + 0.045 * Math.cos(angle));
      rim.push([x, 1.862 + 0.028 * Math.sin(angle), 0.124 - 0.3 * Math.abs(x)]);
    }
    tube(head, frame, rim, 0.0025, true);
    tube(
      head,
      frame,
      [
        [side * 0.092, 1.868, 0.097],
        [side * 0.113, 1.869, 0.049],
        [side * 0.116, 1.856, -0.018],
      ],
      0.0023,
    );
  }
  tube(
    head,
    frame,
    [
      [-0.006, 1.867, 0.122],
      [0, 1.873, 0.124],
      [0.006, 1.867, 0.122],
    ],
    0.0023,
  );
  character.updateMatrixWorld(true);
  const groups = new Map();
  character.traverse((node) => {
    if (!node.isMesh) return;
    let ancestor = node;
    while (ancestor.parent && !ancestor.userData.joint) ancestor = ancestor.parent;
    const joint = ancestor.userData.joint || 'torso';
    const color = node.material.color,
      key = 'fixed';
    const id = 'scholar_' + joint + '_' + key;
    if (!groups.has(id)) groups.set(id, { joint, key, p: [], n: [], uv: [], c: [], indices: [] });
    const batch = groups.get(id),
      g = node.geometry,
      normalMatrix = new T.Matrix3().getNormalMatrix(node.matrixWorld);
    const position = new T.Vector3(),
      normal = new T.Vector3(),
      vertexColor = new T.Color();
    const base = key === 'fixed' ? color : new T.Color(0xffffff);
    const offset = batch.p.length / 3;
    for (let k = 0; k < (g.index?.count ?? g.attributes.position.count); k++)
      batch.indices.push(offset + (g.index ? g.index.getX(k) : k));
    for (let i = 0; i < g.attributes.position.count; i++) {
      position
        .fromBufferAttribute(g.attributes.position, i)
        .applyMatrix4(node.matrixWorld)
        .sub(pivots[joint]);
      normal.fromBufferAttribute(g.attributes.normal, i).applyNormalMatrix(normalMatrix);
      batch.p.push(...position.toArray());
      batch.n.push(...normal.toArray());
      const u = g.attributes.uv?.getX(i) ?? 0,
        v = g.attributes.uv?.getY(i) ?? 0;
      batch.uv.push(u, v);
      vertexColor.copy(base);
      batch.c.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }
  });
  const geometries = {},
    materials = {},
    entries = [];
  const cloth = scholarToon(0xffffff);
  cloth.vertexColors = true;
  cloth.side = T.DoubleSide;
  for (const [id, b] of groups) {
    const g = new T.BufferGeometry();
    for (const [name, data, count] of [
      ['position', b.p, 3],
      ['normal', b.n, 3],
      ['color', b.c, 3],
      ['uv', b.uv, 2],
    ])
      g.setAttribute(name, new T.Float32BufferAttribute(data, count));
    g.setIndex(b.indices);
    g.computeBoundingSphere();
    geometries[id] = g;
    materials[id] = cloth;
    entries.push([id, b.joint, b.key]);
  }

  // VRoid Project, Sendagaya Shino / Welcome School Uniform 2019, model 648876553405728395.
  // Each batch stores xyz and UV followed by triangle indices, in model rest space.
  const asset = (name) => new URL('./scholar-shino/' + name, import.meta.url);
  const [batches, bytes] = await Promise.all([
    fetch(asset('parts.json')).then((r) => r.json()),
    fetch(asset('mesh.bin')).then((r) => r.arrayBuffer()),
  ]);
  const textured = await originalShinoMaterials();
  for (const [joint, material, offset, count, indexCount] of batches) {
    const id = 'scholar_shino_' + joint + '_' + material;
    const values = new T.InterleavedBuffer(new Float32Array(bytes, offset, count * 5), 5);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.InterleavedBufferAttribute(values, 3, 0));
    g.setAttribute('uv', new T.InterleavedBufferAttribute(values, 2, 3));
    g.setIndex(new T.BufferAttribute(new Uint32Array(bytes, offset + count * 20, indexCount), 1));
    const p = pivots[joint];
    g.translate(-p.x, -p.y, -p.z);
    geometries[id] = g;
    materials[id] = textured[material];
    entries.push([
      id,
      joint,
      {
        10: 'shirtDye',
        11: 'ribbonDye',
        12: 'skirtDye',
        14: 'strandDye',
        15: 'strandDye',
        16: 'strandDye',
      }[material] || 'fixed',
    ]);
  }
  function parts(skin = {}) {
    const palette = {
      fixed: 0xffffff,
      shirtDye: skin.top && skin.top !== 0xfaf8f2 ? skin.top : 0xffffff,
      skirtDye: skin.pants && skin.pants !== 0x2c3a6e ? skin.pants : 0xffffff,
      ribbonDye: skin.accent && skin.accent !== 0xe2453a ? skin.accent : 0xffffff,
      strandDye: skin.hair && skin.hair !== 0x1e1a2e ? skin.hair : 0xffffff,
    };
    return entries.map(([id, j, k]) => [
      id,
      palette[k],
      pivots[j].toArray(),
      [1, 1, 1],
      0,
      'scholar:' + j,
      0,
    ]);
  }
  function tintedMaterial(id, color) {
    const mat = materials[id].clone();
    mat.onBeforeCompile = materials[id].onBeforeCompile;
    mat.color.multiply(new T.Color(color));
    return mat;
  }
  return { geometries, materials, parts, tintedMaterial };
}
const pivots = {},
  parents = {},
  result = {},
  rotations = {};
function pivot(j, parent, x, y, z) {
  pivots[j] = new T.Vector3(x, y, z);
  parents[j] = parent;
  result[j] = new T.Matrix4();
  rotations[j] = new T.Quaternion();
}
pivot('torso', null, 0, 1.18, 0);
pivot('head', 'torso', 0, 1.696, 0);
pivot('hair', 'head', 0, 2.04, -0.12);
for (const s of [-1, 1]) {
  const j = s < 0 ? 'L' : 'R';
  pivot('leg' + j, null, s * 0.151 * 0.82, 0.463 * 1.86, 0);
  pivot('shin' + j, null, s * 0.151 * 0.82, 0.26 * 1.86, 0);
  pivot('foot' + j, null, s * 0.151 * 0.82, 0.095 * 1.86, 0);
  pivot('arm' + j, 'torso', -s * 0.137, 1.639, -0.0065);
  pivot('elbow' + j, 'arm' + j, -s * 0.212, 1.3735, j === 'R' ? -0.0017 : -0.0277);
  pivot(
    'hand' + j,
    'elbow' + j,
    j === 'R' ? wristAtRest.x : 0.156 + supportOffset.x,
    j === 'R' ? wristAtRest.y : 1.216 + supportOffset.y,
    j === 'R' ? wristAtRest.z : 0.264 + supportOffset.z,
  );
}
pivot('page', 'handL', ...bookPosition.toArray());
const spineAxis = new T.Vector3(0, 1, 0).applyEuler(bookRotation);
const pos = new T.Vector3(),
  q = new T.Quaternion(),
  scale = new T.Vector3(),
  neutral = new T.Quaternion(),
  identity = new T.Quaternion();
const legStretch = new T.Matrix4().makeScale(0.82, 1.86, 1);
const inverseLegStretch = legStretch.clone().invert();

const axisZ = new T.Vector3(0, 0, 1);
export function poseSchoolUniform(actor, time) {
  const source = poseScholar(actor, time);
  const activity = Math.max(
    T.MathUtils.smoothstep(actor.scholarGait ?? actor.moving ?? 0, 0.05, 0.7),
    1 - T.MathUtils.smoothstep(time - (actor.scholarShotAt ?? -100), 0.14, 0.45),
  );
  const t = (actor.scholarIdle ?? time) % 4.8;
  const look = T.MathUtils.smoothstep(t, 0.82, 1.5) - T.MathUtils.smoothstep(t, 3.6, 4.55);

  for (const j of Object.keys(pivots)) {
    const parent = parents[j],
      m = result[j];
    if (j === 'page') {
      const turn = T.MathUtils.smoothstep(t, 2.6, 3.18) - T.MathUtils.smoothstep(t, 3.3, 3.88);
      q.setFromAxisAngle(spineAxis, -1.95 * turn * (1 - activity));
      pos.copy(pivots.page).sub(pivots.handL);
      m.compose(pos, q, scale.set(1, 1, 1)).premultiply(result.handL);
      continue;
    }
    source[j].decompose(pos, rotations[j], scale);
    q.copy(rotations[j]);
    if (!parent && j !== 'torso') {
      m.multiplyMatrices(legStretch, source[j]).multiply(inverseLegStretch);
      continue;
    }
    if (!parent) {
      pos.y = 1.18 + (pos.y - 0.62) * 1.86;
      pos.x *= 0.82;
    } else {
      q.premultiply(neutral.copy(rotations[parent]).invert());
      pos.copy(pivots[j]).sub(pivots[parent]);
      // Arms start with the elbows already bent over the book.
      if (j.startsWith('elbow')) q.slerp(identity, 0.74);
      if (j.startsWith('arm') || j.startsWith('elbow') || j.startsWith('hand')) {
        q.y *= -1;
        q.z *= -1;
      }
    }
    if (parent) {
      const idle = neutral.identity();
      if (j === 'hair') idle.setFromAxisAngle(axisZ, 0.016 * Math.sin(time * 2.4));
      if (j === 'handR') idle.setFromAxisAngle(axisZ, (1 - look) * 0.034 * Math.sin(time * 12));
      q.slerp(idle, 1 - activity);
    }
    if (j === 'head') q.copy(neutral.setFromRotationMatrix(result.torso).invert());
    m.compose(pos, q, scale);
    if (parent) m.premultiply(result[parent]);
  }
  return result;
}

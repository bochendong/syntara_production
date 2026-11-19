// Build opaque, vertex-coloured solids. The reversed outer hull forms the ink
// silhouette, including holes between legs, handles and shelves.
import * as T from './vendor/three.module.js';

export const ink = 0x38172c;
const light = new T.Vector3(-0.55, 0.84, 0.36).normalize();
const inkColor = new T.Color(ink),
  cache = new WeakMap();

// Anime-background shading: cool blue-grey shade, soft mid tone, warm window light.
// Outlines are a thin neutral line so props read without the old storybook ink.
const shadowTone = new T.Color(0.66, 0.7, 0.82),
  halfTone = new T.Color(0.87, 0.89, 0.94),
  sunTone = new T.Color(1, 0.95, 0.86);
const lineColor = new T.Color(0x4a4a58),
  lineWeight = 0.28;

function prismGeometry() {
  const shape = new T.Shape();
  const corners = [
    [-0.44, -0.5],
    [0.44, -0.5],
    [0.5, -0.44],
    [0.5, 0.44],
    [0.44, 0.5],
    [-0.44, 0.5],
    [-0.5, 0.44],
    [-0.5, -0.44],
  ];
  corners.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return new T.ExtrudeGeometry(shape, {
    depth: 0.9,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.012,
    bevelSegments: 1,
  })
    .translate(0, 0, -0.45)
    .rotateX(-Math.PI / 2);
}

export const forms = {
  block: prismGeometry(),
  rail: new T.BoxGeometry(1, 1, 1),
  round: new T.SphereGeometry(0.5, 12, 8),
  leaf: new T.OctahedronGeometry(0.5),
  barrel: new T.CylinderGeometry(0.5, 0.5, 1, 12),
  taper: new T.CylinderGeometry(0.36, 0.49, 1, 10),
  cone: new T.ConeGeometry(0.5, 1, 10),
  hoop: new T.TorusGeometry(0.43, 0.07, 6, 20),
  magnet: new T.TorusGeometry(0.35, 0.13, 6, 12, Math.PI),
  jewel: new T.OctahedronGeometry(0.5),
};

function source(geometry) {
  if (cache.has(geometry)) return cache.get(geometry);
  const pos = geometry.attributes.position;
  const ids = geometry.index?.array ?? Array.from({ length: pos.count }, (_, i) => i);
  const points = Array.from({ length: pos.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(pos, i),
  );
  const keys = points.map((v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e5)).join('/'));
  const sums = new Map(),
    faces = [];
  for (let i = 0; i < ids.length; i += 3) {
    const tri = [ids[i], ids[i + 1], ids[i + 2]];
    const [a, b, c] = tri.map((j) => points[j]);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq() < 1e-14) continue;
    normal.normalize();
    faces.push({ tri, normal });
    for (const j of tri) {
      if (!sums.has(keys[j])) sums.set(keys[j], new T.Vector3());
      sums.get(keys[j]).add(normal);
    }
  }
  const data = {
    points,
    faces,
    normals: keys.map((k) => (sums.get(k) ?? new T.Vector3()).clone().normalize()),
  };
  cache.set(geometry, data);
  return data;
}

// Orthographic silhouette on the ground, used only for the cast shadow.
function footprint(points) {
  const sorted = points
    .map((v) => [v.x + v.y * 0.42, v.z - v.y * 0.2])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const chain = (arr) => {
    const out = [];
    for (const p of arr) {
      while (out.length > 1) {
        const a = out.at(-2),
          b = out.at(-1);
        if ((b[0] - a[0]) * (p[1] - a[1]) > (b[1] - a[1]) * (p[0] - a[0])) break;
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...chain(sorted), ...chain(sorted.reverse())];
}
export class InkMesh {
  constructor(castShadow = false) {
    this.position = [];
    this.colors = [];
    this.shadows = castShadow ? [] : null;
  }
  part(geometry, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, stroke = 0.045) {
    const data = source(geometry);
    const matrix = new T.Matrix4().compose(
      new T.Vector3(x, y, z),
      new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ')),
      new T.Vector3(w, h, d),
    );
    const normalMatrix = new T.Matrix3().getNormalMatrix(matrix);
    const points = data.points.map((v) => v.clone().applyMatrix4(matrix));
    if (this.shadows) this.shadows.push(footprint(points));
    const rotation = new T.Quaternion().setFromEuler(new T.Euler(rx, ry, rz, 'YXZ'));
    const hull = stroke
      ? points.map((v, i) =>
          v
            .clone()
            .addScaledVector(data.normals[i].clone().applyQuaternion(rotation), stroke * 1.38 * lineWeight),
        )
      : null;
    const base = new T.Color(color),
      tone = new T.Color(),
      n = new T.Vector3();
    const vertex = (v, c) => {
      this.position.push(v.x, v.y, v.z);
      this.colors.push(c.r, c.g, c.b);
    };
    for (const { tri, normal } of data.faces) {
      const dot = n.copy(normal).applyNormalMatrix(normalMatrix).dot(light);
      tone.copy(base);
      if (dot < 0.02) tone.multiply(shadowTone);
      else if (dot < 0.47) tone.multiply(halfTone);
      else if (dot > 0.83) tone.lerp(sunTone, 0.07);
      for (const j of tri) vertex(points[j], tone);
      if (hull) for (let j = 2; j >= 0; j--) vertex(hull[tri[j]], lineColor);
    }
  }
  box(color, x, y, z, w, h, d, ry = 0, stroke = 0.045) {
    this.part(forms.block, color, x, y, z, w, h, d, 0, ry, 0, stroke);
  }
  geometry() {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(this.position, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(this.colors, 3));
    geo.computeBoundingSphere();
    return geo;
  }
  mesh() {
    return new T.Mesh(this.geometry(), new T.MeshBasicMaterial({ vertexColors: true }));
  }
}

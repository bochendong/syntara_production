import * as T from './vendor/three.module.js';
import { gymBounds, gymScaleX, gymScaleZ } from './gym-projection.js';
import { forms as f, InkMesh, ink } from './campus-mesh.js';
import { addCampusProp, campusPanels, campusMurals } from './campus-props.js?v=painted-court';

const cream = 0xf4efe6,
  paper = 0xfbf8f1,
  rose = 0x9db3a6,
  wood = 0xa97b55,
  honey = 0xd8bb92;
const teal = 0x5d8c84,
  navy = 0x3f4a59,
  red = 0xc65e57,
  blue = 0x5f80a8,
  gold = 0xdcb35f;
const bookColors = [teal, red, cream, blue, gold, rose];
const halfPi = Math.PI / 2;
function rail(b, color, x, y, z, w, h, d, rz = 0, rx = 0) {
  b.part(f.rail, color, x, y, z, w, h, d, rx, 0, rz, 0.024);
}
function cylinder(b, c, x, y, z, w, h, d = w) {
  b.part(f.barrel, c, x, y, z, w, h, d, 0, 0, 0, 0.026);
}

// Small bas-reliefs are cut shapes, with thickness even when seen from the side.
function cutout(points) {
  const shape = new T.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return new T.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
}
function plant(b, x, y, z, s = 1) {
  b.part(f.taper, red, x, y + 0.35 * s, z, 0.77 * s, 0.7 * s, 0.77 * s, Math.PI);
  cylinder(b, honey, x, y + 0.68 * s, z, 0.83 * s, 0.15 * s);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    b.part(
      f.leaf,
      i % 2 ? 0x6fa272 : 0x348477,
      x + Math.sin(a) * 0.31 * s,
      y + (1.02 + (i % 3) * 0.11) * s,
      z + Math.cos(a) * 0.31 * s,
      0.43 * s,
      1.12 * s,
      0.37 * s,
      0.55,
      a,
      0,
      0.025,
    );
  }
}
function book(b, x, y, z, w, col, rot = 0) {
  b.box(col, x, y + 0.08, z, w, 0.14, w * 0.72, rot, 0.024);
  b.box(cream, x, y + 0.15, z, w * 0.93, 0.035, w * 0.65, rot, 0.008);
}
function shelf(b, w, d) {
  const h = 2.75;
  b.box(0x915e54, 0, h / 2, -d * 0.4, w, h, d * 0.15);
  for (const sign of [-1, 1]) b.box(honey, sign * (w / 2 - 0.12), h / 2, 0, 0.22, h, d);
  for (const y of [0.18, 1.36, h]) b.box(honey, 0, y, 0, w + 0.12, 0.18, d + 0.08);
  rail(b, wood, 0, 1.42, 0, 0.16, 2.66, d);
  for (let row = 0; row < 2; row++)
    for (let j = 0; j < Math.floor(w / 0.49) - 2; j++) {
      if (j % 8 === 5 || j % 8 === 6) continue;
      const ht = 0.62 + ((j * 7 + row * 3) % 5) * 0.095,
        x = -w / 2 + 0.47 + j * 0.49;
      const y = 0.29 + row * 1.18;
      const c = bookColors[(j * 7 + row * 3) % bookColors.length];
      rail(b, c, x, y + ht / 2, 0.05, 0.32, ht, d * 0.58, j % 8 === 4 ? -0.14 : 0);
      rail(b, cream, x, y + 0.18, d * 0.29 + 0.065, 0.235, 0.064, 0.025);
    }
  book(b, w * 0.25, h + 0.1, 0, 1.1, red, 0.07);
  book(b, w * 0.25, h + 0.26, 0.01, 0.91, teal, -0.13);
  plant(b, -w * 0.33, h + 0.09, -0.05, 0.71);
}
function table(b, w, d, h) {
  for (const side of [-1, 1])
    for (const end of [-1, 1]) {
      rail(b, navy, side * (w * 0.5 - 0.19), h * 0.47, end * (d * 0.5 - 0.16), 0.14, h * 0.9, 0.14);
    }
  b.box(wood, 0, h - 0.24, 0, w * 0.94, 0.29, d * 0.85);
  b.box(0x674351, 0, h - 0.055, 0, w + 0.015, 0.16, d + 0.018);
  b.box(honey, 0, h + 0.045, 0, w, 0.14, d);
  b.part(
    fold,
    0xffcd88,
    w * 0.27,
    h + 0.123,
    -d * 0.14,
    w * 0.32,
    d * 0.48,
    0.07,
    -halfPi,
    0,
    0,
    0,
  );
}
function desk(b, w, d, large) {
  table(b, w, d, large ? 1.82 : 1.48);
  const h = large ? 1.95 : 1.61;
  book(b, -w * 0.23, h, 0, Math.min(1.08, w * 0.35), large ? red : teal, -0.16);
  if (large) {
    plant(b, w * 0.32, h, 0, 0.75);
    book(b, 0, h, 0.02, 1.12, blue, 0.12);
  } else {
    const z = d * 0.35 + 0.19;
    b.box(teal, 0, 0.74, z, 0.96, 0.15, 0.69);
    for (const sign of [-1, 1]) {
      rail(b, navy, sign * 0.35, 0.65, z + 0.21, 0.093, 1.24, 0.1);
      rail(b, navy, sign * 0.35, 0.36, z - 0.22, 0.093, 0.68, 0.1);
    }
    b.box(teal, 0, 1.17, z + 0.26, 0.95, 0.34, 0.12);
    rail(b, gold, w * 0.2, h + 0.06, 0.14, 0.67, 0.065, 0.071, 0.01);
  }
}
// Trace the exposed edges of contiguous cabinet rectangles into a single worktop.
function countertop(b, rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x0 - 0.065, r.x1 + 0.065]))].sort((a, c) => a - c);
  const zs = [...new Set(rects.flatMap((r) => [r.z0 - 0.065, r.z1 + 0.065]))].sort((a, c) => a - c);
  const edges = new Map();
  function edge(a, c) {
    if (edges.has(c + ';' + a)) edges.delete(c + ';' + a);
    else edges.set(a + ';' + c, [a, c]);
  }
  for (let i = 1; i < xs.length; i++)
    for (let j = 1; j < zs.length; j++) {
      const x0 = xs[i - 1],
        x1 = xs[i],
        z0 = zs[j - 1],
        z1 = zs[j];
      if (
        !rects.some(
          (r) =>
            (x0 + x1) / 2 > r.x0 - 0.07 &&
            (x0 + x1) / 2 < r.x1 + 0.07 &&
            (z0 + z1) / 2 > r.z0 - 0.07 &&
            (z0 + z1) / 2 < r.z1 + 0.07,
        )
      )
        continue;
      const a = [x0, z0],
        c = [x1, z0],
        d = [x1, z1],
        e = [x0, z1];
      edge(a, c);
      edge(c, d);
      edge(d, e);
      edge(e, a);
    }
  const next = new Map([...edges.values()].map(([a, c]) => [a.toString(), c]));
  while (next.size) {
    const first = next.keys().next().value,
      path = [];
    let key = first;
    do {
      const p = next.get(key);
      next.delete(key);
      path.push(p);
      key = p.toString();
    } while (key !== first);
    const corners = path.filter((p, i) => {
      const a = path[(i + path.length - 1) % path.length],
        c = path[(i + 1) % path.length];
      return a[0] !== c[0] && a[1] !== c[1];
    });
    const points = [];
    for (let i = 0; i < corners.length; i++) {
      const p = corners[i];
      for (const j of [-1, 1]) {
        const q = corners[(i + j + corners.length) % corners.length],
          dx = q[0] - p[0],
          dz = q[1] - p[1],
          len = Math.hypot(dx, dz),
          k = Math.min(0.19, len * 0.23) / len;
        points.push([p[0] + dx * k, p[1] + dz * k]);
      }
    }
    const shape = new T.Shape(points.map(([x, z]) => new T.Vector2(x, -z)));
    const slab = new T.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).rotateX(-halfPi);
    b.part(slab, ink, 0, 1.58, 0, 1, 0.19, 1, 0, 0, 0, 0.025);
    b.part(slab, cream, 0, 1.73, 0, 1, 0.15, 1, 0, 0, 0, 0.03);
    slab.dispose();
  }
}
function lab(b, w, d, panels, cx, cz) {
  b.box(navy, 0, 0.14, 0, w * 0.95, 0.28, d * 0.9);
  b.box(teal, 0, 0.9, 0, w - 0.12, 1.48, d - 0.13);
  if (d > w)
    for (const sign of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const zz = ((i - 1) * d) / 3;
        b.box(0x6da796, sign * (w * 0.5 - 0.065), 0.91, zz, 0.095, 1.22, d / 3 - 0.18);
        b.box(cream, sign * w * 0.5, 1.25, zz, 0.1, 0.09, 0.42, 0, 0.014);
      }
  const n = Math.max(1, Math.round(w / 2.1)),
    seg = (w - 0.26) / n;
  for (let j = 0; j < n; j++) {
    const x = -w / 2 + 0.13 + (j + 0.5) * seg;
    panels.add('cabinet', cx + x, 0.94, cz + d * 0.5 + 0.02, seg - 0.08, 1.24);
  }

}
function labSupplies(group, materials, elevation, x, z, w, d) {
  // The continuous worktop is 1.88 units high. Pin the art at its contact point.
  const widths = { tubes: 1.02, flasks: 0.86, retort: 0.72, sink: 1.65 };
  const place = (kind, dx, dz) => addCampusProp(
    group, kind, materials[kind], x + dx, z + dz, widths[kind], elevation,
    { y: 1.91, cast: false },
  );
  if (w > 20) {
    for (const dx of [-w * 0.31, 0, w * 0.31]) place('sink', dx, 0.32);
    place('tubes', -w * 0.19, 0.26);
    place('flasks', w * 0.08, 0.26);
  } else if (d > w && x > 20) {
    // The single stand belongs to the vertical arm of the weighing station.
    place('retort', 0, d * 0.05);
  }
}
function wall(b, obstacle, h, paint) {
  const { x0, z0, x1, z1 } = obstacle;
  const w = x1 - x0, d = z1 - z0;
  rail(b, 0xf8f5ee, 0, h / 2, 0, w, h, d);
  rail(b, 0xb1bbb5, 0, 0.16, 0, w + 0.035, 0.32, d + 0.035);
  rail(b, 0xe8e3da, 0, h, 0, w + 0.04, 0.1, d + 0.04);
  for (const [name, t, width] of obstacle.marks) {
    // Fixtures on front-facing walls sit above the skirting. Edge-on walls
    // only show their ledge at this camera angle, so place the painting there.
    const alongX = w > d;
    if (alongX && z0 < 30) {
      const height = Math.min(h - 0.64, width * 2 / 3);
      paint.add(name, x0 + w*t, h * 0.55, z1 + 0.026, height * 1.5, height);
    } else {
      const x = x0 + w * (alongX ? t : 0.5), z = z0 + d * (alongX ? 0.5 : t);
      const height = Math.min(width * 2 / 3, (alongX ? d : w) * 0.84);
      paint.add(name, x, h + 0.065, z, height * 1.5, height,
        alongX ? 0 : halfPi, -halfPi);
    }
  }
}

function chalkboard(b, x, y, z, w) {
  b.box(honey, x, y, z, w, 2.65, 0.19);
  b.box(0x356a65, x, y, z + 0.14, w - 0.3, 2.36, 0.09);
  b.box(wood, x, y - 1.27, z + 0.2, w + 0.13, 0.14, 0.42);
  for (let i = 0; i < 4; i++) {
    const xx = x - w * 0.34 + i * 0.48;
    rail(b, cream, xx, y + 0.2 + (i % 2) * 0.12, z + 0.2, 0.3, 0.048, 0.033, i % 2 ? 0.63 : -0.32);
  }
  for (let i = 0; i < 3; i++)
    rail(b, paper, x + w * 0.2 + i * 0.28, y - 0.28 + i * 0.15, z + 0.2, 0.39, 0.055, 0.027, 0.54);
  rail(b, cream, x + 0.2, y - 1.14, z + 0.24, 0.45, 0.072, 0.075);
}
function windowFrame(b, x, y, z) {
  b.box(wood, x, y, z, 3.95, 2.2, 0.18);
  b.box(0xaedbd8, x, y, z + 0.12, 3.74, 2, 0.1);
  rail(b, cream, x, y, z + 0.2, 0.13, 2.04, 0.09);
  rail(b, cream, x, y, z + 0.2, 3.77, 0.12, 0.09);
  b.box(honey, x, y - 1.07, z + 0.1, 4.02, 0.13, 0.42);
}
const surface = new T.MeshBasicMaterial({ vertexColors: true });
function finish(group, b, name, x = 0, z = 0) {
  const m = new T.Mesh(b.geometry(), surface);
  m.name = name;
  m.position.set(x, 0, z);
  group.add(m);
  if (b.shadows) {
    const tris = group.userData.shadowTriangles;
    for (const poly of b.shadows)
      for (let i = 2; i < poly.length; i++) {
        for (const [px, pz] of [poly[0], poly[i], poly[i - 1]]) tris.push(x + px, 0.014, z + pz);
      }
  }
}
const furnitureHeights = { teacher: 2.77, bench: 1.85, ballRack: 2.59, mats: 1.44, vault: 2.13, basket: 5.5, easel: 3.1, paint: 1.26 };

// Shared structural walls extend across room boundaries. Render their exposed
// portion only: the illustration already supplies the gym side and its shadow.
function visibleCampusWall(piece) {
  if (piece.kind !== 'wall' || piece.x1 < gymBounds.x0 || piece.z1 < gymBounds.z0) return piece;
  if (piece.x0 >= gymBounds.x0 && piece.z0 >= gymBounds.z0) return null;
  const alongX = piece.x1 - piece.x0 > piece.z1 - piece.z0;
  const start = alongX ? piece.x0 : piece.z0;
  const end = alongX ? piece.x1 : piece.z1;
  const cutoff = alongX ? gymBounds.x0 : gymBounds.z0;
  if (cutoff <= start || cutoff >= end) return piece;
  const fraction = (cutoff - start) / (end - start);
  const marks = piece.marks.filter(([, t]) => t < fraction)
    .map(([name, t, width]) => [name, t / fraction, width]);
  return { ...piece, [alongX ? 'x1' : 'z1']: cutoff, marks };
}

export function buildCampusModels(walls, elevation = 0, propMaterials = {}) {
  const group = new T.Group();
  group.userData.shadowTriangles = [];
  const panels = campusPanels(propMaterials);
  const murals = campusMurals(propMaterials.murals);
  for (const piece of walls) {
    if (piece.paintedGym) continue;
    const obstacle = visibleCampusWall(piece);
    if (!obstacle) continue;
    const { kind, x0, x1, z0, z1 } = obstacle,
      w = x1 - x0,
      d = z1 - z0,
      x = (x0 + x1) / 2,
      z = (z0 + z1) / 2;
    if (kind === 'desk' || kind === 'locker' || kind === 'plant') {
      addCampusProp(group, kind, propMaterials[kind], x, obstacle.deskFront ?? z1, w, elevation);
      continue;
    }
    if (Object.hasOwn(furnitureHeights, kind)) {
      // The hoop's backboard extends beyond its narrow collision base.
      const width = kind === 'basket' ? w * 1.75 : w;
      let base = 0.025;
      if (kind === 'teacher') {
        // A shallow timber dais, one low step from the classroom floor.
        const dais = new InkMesh(true);
        dais.box(0x987155, 0, 0.13, 0, 8.25, 0.26, 2.55);
        dais.box(0xdab783, 0, 0.275, 0, 8.4, 0.07, 2.65);
        for (const joint of [-0.68, 0, 0.68])
          dais.box(0xc5a174, 0, 0.311, joint, 8.23, 0.006, 0.024);
        finish(group, dais, 'classroom teaching platform', x, z);
        base += 0.31;
      }
      addCampusProp(group, kind, propMaterials[kind], x, z1, width, elevation,
        { height: furnitureHeights[kind], y: base });
      continue;
    }
    const b = new InkMesh(true);
    switch (kind) {
      case 'wall': {
        const height = z1 < -30 && w > 60 ? 5.4 : Math.min(3.4, obstacle.height);
        wall(b, obstacle, height, murals);
        break;
      }
      case 'lab':
        lab(b, w, d, panels, x, z);
        labSupplies(group, propMaterials, elevation, x, z, w, d);
        break;
      default:
        throw Error('Unknown campus furniture ' + kind);
    }
    finish(group, b, kind, x, z);
  }
  panels.finish(group);
  murals.finish(group);
  const tops = new InkMesh();
  countertop(
    tops,
    walls.filter((w) => w.kind === 'lab'),
  );
  finish(group, tops, 'continuous laboratory worktops');
  const hang = (kind, x, y, z, width, height) => addCampusProp(
    group, kind, propMaterials[kind], x, z, width, 0, { y, height, cast: false },
  );
  hang('chalkboard', -20, 1.65, -30.58, 7.6, 3.5);
  for (const x of [-33, -9, 7, 18, 32]) hang('window', x, 1.7, -30.59, 2.7, 3.25);
  hang('classSign', -15.6, 1.40, -4.90, 2.28, 1.66);
  hang('labSign', 25.2, 1.40, -4.90, 2.28, 1.66);
  hang('artSign', -15.6, 1.40, 6.17, 2.28, 1.66);
  const shadowGeometry = new T.BufferGeometry();
  shadowGeometry.setAttribute(
    'position',
    new T.Float32BufferAttribute(group.userData.shadowTriangles, 3),
  );
  delete group.userData.shadowTriangles;
  const shadow = new T.Mesh(shadowGeometry);
  shadow.name = 'cast shadows';
  group.add(shadow);
  return group;
}
export function buildPortraitRoom() {
  const group = new T.Group(),
    b = new InkMesh();
  rail(b, 0xf1caba, 0, 3.3, -7.1, 45, 9, 0.5);
  rail(b, rose, 0, 0.65, -6.81, 45, 1.3, 0.12);
  b.box(honey, 0, -0.16, 0, 70, 0.29, 55);
  chalkboard(b, 0, 3.53, -6.74, 10);
  windowFrame(b, -8.5, 3.1, -6.72);
  windowFrame(b, 8.5, 3.1, -6.72);
  finish(group, b, 'classroom backdrop');
  for (const x of [-8, 8]) {
    const s = new InkMesh();
    shelf(s, 4.8, 1.54);
    finish(group, s, 'bookshelf', x, -5.4);
  }
  return group;
}

export function buildInkPortal(painted = false) {
  if (painted) {
    const map = new T.TextureLoader().load(new URL('./campus-props/gym-ink.webp', import.meta.url).href);
    map.colorSpace = T.SRGBColorSpace;
    const material = new T.MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    const phase = { value: 0 };
    material.onBeforeCompile = shader => {
      shader.uniforms.inkPhase = phase;
      shader.fragmentShader = 'uniform float inkPhase;\n' + shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec2 center = vec2(.50,.49);
         vec2 p = (vMapUv - center) / vec2(.188,.16);
         float angle = inkPhase * (1. - smoothstep(.62,1.,length(p)));
         mat2 spin = mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
         diffuseColor *= texture2D(map, center + vec2(.188,.16) * (spin * p));`
      );
    };
    const plane = new T.PlaneGeometry(240 * gymScaleX, 208 * gymScaleZ);
    plane.rotateX(-halfPi).translate(0, 0.05, -8 * gymScaleZ);
    const mesh = new T.Mesh(plane, material);
    mesh.userData.inkPhase = phase;
    mesh.renderOrder = 0;
    return { mesh, rim: new T.Group() };
  }
  const frame = new InkMesh(),
    rotor = new InkMesh();
  const profile = [
    [2.16, 0.065],
    [2.25, 0.19],
    [2.53, 0.24],
    [2.7, 0.12],
    [2.72, 0.045],
  ];
  const collar = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)).reverse(), 12);
  frame.part(collar, 0x805875, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0.035);
  cylinder(frame, 0x42304f, 0, 0.04, 0, 4.7, 0.06);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    cylinder(frame, honey, Math.sin(angle) * 2.41, 0.232, Math.cos(angle) * 2.41, 0.19, 0.067);
  }
  const vane = cutout([
    [0.2, 0.07],
    [0.5, 0.11],
    [0.96, 0.46],
    [1.22, 0.97],
    [1.26, 1.42],
    [1.08, 1.64],
    [0.96, 1.15],
    [0.76, 0.77],
    [0.52, 0.49],
  ]);
  for (let i = 0; i < 5; i++)
    rotor.part(
      vane,
      i % 2 ? 0xaf82b4 : 0x92779f,
      0,
      0.083,
      0,
      1,
      1,
      0.32,
      -halfPi,
      (i * 2 * Math.PI) / 5,
      0,
      0.012,
    );
  return { mesh: rotor.mesh(), rim: frame.mesh() };
}

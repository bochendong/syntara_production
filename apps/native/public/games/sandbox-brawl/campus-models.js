import * as T from './vendor/three.module.js';
import { forms as f, InkMesh, ink } from './campus-mesh.js';

const cream = 0xffead1,
  paper = 0xfff3dd,
  rose = 0xbe8093,
  wood = 0xc67e54,
  honey = 0xf6bd76;
const teal = 0x4b9689,
  navy = 0x35485b,
  orange = 0xf98631,
  red = 0xe35a56,
  blue = 0x5886bc,
  gold = 0xf6bb4f;
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
const wing = cutout([
  [-0.47, 0.08],
  [-0.21, -0.15],
  [0.04, -0.18],
  [0.4, 0.12],
  [0.08, 0.04],
  [0.21, 0.22],
  [-0.08, 0.14],
  [-0.03, 0.27],
]);
const goose = cutout([
  [-0.49, 0.06],
  [-0.37, 0.04],
  [-0.45, 0.23],
  [-0.18, 0.1],
  [0.02, 0.13],
  [-0.02, 0.36],
  [0.06, 0.54],
  [0.28, 0.6],
  [0.45, 0.53],
  [0.5, 0.39],
  [0.33, 0.32],
  [0.22, 0.38],
  [0.17, 0.31],
  [0.24, 0.05],
  [0.16, -0.17],
  [-0.02, -0.29],
  [-0.29, -0.25],
  [-0.42, -0.15],
]);
const bill = cutout([
  [0.34, 0.36],
  [0.47, 0.42],
  [0.64, 0.32],
  [0.43, 0.29],
]);
function gooseRelief(b, x, y, z, size, yaw = 0) {
  const sn = Math.sin(yaw),
    cs = Math.cos(yaw);
  function layer(g, c, dx, dy, dz, w, h, d, stroke) {
    b.part(g, c, x + dx * cs + dz * sn, y + dy, z - dx * sn + dz * cs, w, h, d, 0, yaw, 0, stroke);
  }
  layer(goose, paper, 0, 0, 0, size, size, 0.55, 0.028);
  layer(bill, orange, 0, 0, 0.05, size, size, 0.49, 0.014);
  layer(wing, cream, -0.1 * size, -0.04 * size, 0.065, size * 0.69, size * 0.68, 0.28, 0.016);
  layer(cutBrow, ink, 0, 0, 0.097, size, size, 0.33, 0.004);
}
const cutBrow = cutout([
  [0.245, 0.514],
  [0.425, 0.443],
  [0.407, 0.409],
  [0.253, 0.467],
]);
const mountain = cutout([
  [-0.5, -0.28],
  [-0.18, 0.28],
  [0.04, -0.03],
  [0.18, 0.14],
  [0.49, -0.28],
]);
const fold = cutout([
  [-0.5, -0.31],
  [-0.28, 0.26],
  [-0.13, 0.38],
  [-0.19, 0.04],
  [0.5, 0.23],
  [-0.1, -0.21],
]);
const flag = cutout([
  [-0.5, 0.5],
  [0.5, 0.5],
  [0.5, -0.5],
  [0, -0.29],
  [-0.5, -0.5],
]);
const chevron = cutout([
  [-0.42, 0.24],
  [0, 0.07],
  [0.42, 0.24],
  [0.42, 0.04],
  [0, -0.14],
  [-0.42, 0.04],
]);
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
function tubeRack(b, x, y, z) {
  const width = 1.56;
  b.box(honey, x, y + 0.1, z, width, 0.16, 0.66);
  for (const sign of [-1, 1]) rail(b, navy, x + sign * 0.7, y + 0.38, z, 0.11, 0.6, 0.42);
  b.box(wood, x, y + 0.46, z, width, 0.1, 0.39);
  for (let i = 0; i < 3; i++) {
    const xx = x + (i - 1) * 0.43,
      c = [0xbb56a3, orange, 0x40aeaa][i];
    cylinder(b, c, xx, y + 0.56, z, 0.27, 0.6);
    cylinder(b, 0xc9eae2, xx, y + 0.96, z, 0.27, 0.25);
    cylinder(b, cream, xx, y + 1.12, z, 0.35, 0.095);
    cylinder(b, navy, xx, y + 1.174, z, 0.19, 0.018);
    rail(b, paper, xx - 0.061, y + 0.62, z + 0.125, 0.034, 0.17, 0.018);
  }
}
function flask(b, x, y, z, s, c) {
  b.part(f.taper, c, x, y + 0.33 * s, z, 0.94 * s, 0.61 * s, 0.94 * s);
  b.part(f.cone, 0xcce4d6, x, y + 0.73 * s, z, 0.71 * s, 0.56 * s, 0.71 * s);
  cylinder(b, 0xcce4d6, x, y + 1.04 * s, z, 0.28 * s, 0.55 * s);
  cylinder(b, cream, x, y + 1.32 * s, z, 0.39 * s, 0.1 * s);
  cylinder(b, navy, x, y + 1.379 * s, z, 0.225 * s, 0.018 * s);
  b.part(
    f.leaf,
    paper,
    x - 0.19 * s,
    y + 0.41 * s,
    z + 0.32 * s,
    0.12 * s,
    0.21 * s,
    0.04 * s,
    0,
    0,
    -0.22,
    0.008,
  );
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
function retort(b, x, y, z) {
  b.box(navy, x, y + 0.05, z, 1.19, 0.1, 0.72);
  cylinder(b, navy, x - 0.38, y + 0.99, z, 0.094, 1.86);
  rail(b, honey, x - 0.1, y + 1.59, z, 0.66, 0.1, 0.14);
  cylinder(b, cream, x + 0.19, y + 1.22, z, 0.22, 0.89);
  cylinder(b, teal, x + 0.19, y + 0.99, z, 0.23, 0.31);
  cylinder(b, red, x + 0.19, y + 0.75, z, 0.12, 0.14);
  b.part(f.taper, 0x80c3b5, x + 0.19, y + 0.41, z, 0.46, 0.5, 0.46, Math.PI);
}
function lab(b, w, d) {
  const h = 1.76;
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
    b.box(0x72ad99, x, 0.93, d * 0.5 - 0.06, seg - 0.1, 1.18, 0.1);
    b.box(cream, x, 1.27, d * 0.5 + 0.045, Math.min(0.53, seg * 0.5), 0.095, 0.11, 0, 0.02);
  }

  const top = h + 0.122;
  if (w > 25) {
    for (const x of [-w * 0.31, 0, w * 0.31]) {
      b.box(navy, x, top + 0.015, 0, 2, 0.065, 1.06);
      b.box(0x82b9b7, x, top + 0.053, 0.02, 1.69, 0.026, 0.77, 0, 0.012);
      cylinder(b, navy, x + 0.75, top + 0.39, -0.4, 0.14, 0.72);
      rail(b, cream, x + 0.49, top + 0.73, -0.4, 0.64, 0.13, 0.16);
      tubeRack(b, x + 2.6, top, 0.04);
    }
  } else if (d > w) {
    retort(b, 0, top, -d * 0.2);
    book(b, 0, top, d * 0.2, 0.99, blue, 0.14);
  } else {
    b.box(0x80ad9a, -w * 0.24, top + 0.015, 0.02, 2.41, 0.031, 1.2, -0.04, 0.014);
    tubeRack(b, -w * 0.24, top + 0.045, 0.09);
    if (w > 9) retort(b, 0, top, -0.64);
    else if (w > 5) {
      book(b, w * 0.012, top, -0.25, 0.7, w > 7 ? rose : blue, -0.14);
    }
    flask(b, w * 0.22, top, -0.14, w > 9 ? 1.22 : 0.83, w > 9 ? 0x9959a5 : teal);
    if (w > 8) flask(b, w * 0.32, top, 0.42, 0.6, orange);
  }
}
const ballSeam = new T.TorusGeometry(0.495, 0.018, 5, 28);
function ball(b, x, y, z, r) {
  b.part(f.round, orange, x, y, z, 2 * r, 2 * r, 2 * r, 0, 0.2, 0, 0.038);
  for (const [rx, ry] of [
    [0, 0.25],
    [0, 1.82],
    [halfPi, 0],
  ]) {
    b.part(ballSeam, 0x68362e, x, y, z, 2 * r, 2 * r, 2 * r, rx, ry, 0, 0);
  }
}
function ballRack(b, w, d) {
  const spacing = Math.min(1.37, w * 0.24),
    r = 0.56;
  for (const x of [-w * 0.47, w * 0.47])
    for (const z of [-d * 0.38, d * 0.38]) {
      rail(b, navy, x, 1.16, z, 0.16, 2.17, 0.16);
      b.box(cream, x, 2.22, z, 0.2, 0.1, 0.2, 0, 0.012);
      cylinder(b, ink, x, 0.09, z, 0.24, 0.14);
    }
  for (const y of [0.32, 1.51]) {
    for (const side of [-1, 1]) {
      rail(b, teal, 0, y, side * d * 0.35, w, 0.14, 0.11);
      rail(b, navy, side * w * 0.46, y + 0.13, 0, 0.12, 0.21, d * 0.86);
    }
    for (const x of [-w * 0.47, w * 0.47]) rail(b, teal, x, y + 0.46, 0, 0.13, 0.14, d);
    for (const j of [-1, 0, 1]) ball(b, j * spacing, y + 0.45, 0, r);
  }
}
function pad(b, w, d, index) {
  const along = w > d,
    long = Math.max(w, d),
    n = Math.max(1, Math.round(long / 2.65)),
    seg = long / n;
  const colors = [red, red, gold, blue];
  for (let j = 0; j < n; j++) {
    const shift = -long * 0.5 + (j + 0.5) * seg,
      x = along ? shift : 0,
      z = along ? 0 : shift;
    const sw = along ? seg - 0.07 : w,
      sd = along ? d : seg - 0.07;
    b.box(navy, x, 0.17, z, sw, 0.29, sd);
    b.box(colors[(index + j) % 4], x, 0.88, z, sw, 1.42, sd);
    const accent = [0xff8a73, 0xfa897e, 0xffda7c, 0x8fb8dc][(index + j) % 4];
    b.box(accent, x, 1.52, z, sw * 0.96, 0.12, sd * 0.95);
    b.box(colors[(index + j) % 4], x, 1.59, z, sw * 0.91, 0.085, sd * 0.88);
    b.part(
      fold,
      accent,
      x - sw * 0.14,
      1.64,
      z - sd * 0.09,
      sw * 0.46,
      sd * 0.38,
      0.15,
      -halfPi,
      0,
      0,
      0,
    );
    // A woven carrying loop leaves a visible opening on the face of each pad.
    if (along) {
      rail(b, navy, x, 0.85, z + sd * 0.5, 0.58, 0.083, 0.12);
      for (const sign of [-1, 1])
        rail(b, cream, x + sign * 0.26, 0.94, z + sd * 0.51, 0.096, 0.25, 0.13);
    } else {
      rail(b, cream, x, 1.64, z - seg * 0.25, sw * 0.67, 0.03, 0.13);
    }
  }
}
function trimPad(p, pads) {
  if (p.x1 - p.x0 > p.z1 - p.z0) return p;
  const r = { ...p };
  for (const q of pads) {
    if (q.x1 - q.x0 < q.z1 - q.z0 || p.x1 <= q.x0 || p.x0 >= q.x1) continue;
    if (q.z0 <= p.z0 && q.z1 >= p.z0) r.z0 = q.z1 + 0.045;
    else if (q.z0 <= p.z1 && q.z1 >= p.z1) r.z1 = q.z0 - 0.045;
    else if (q.z0 > p.z0 && q.z1 < p.z1) {
      if (q.z0 - p.z0 < p.z1 - q.z1) r.z0 = q.z1 + 0.045;
      else r.z1 = q.z0 - 0.045;
    }
  }
  return r;
}
function gymProp(b, w, d, kind) {
  if (kind === 'ballRack') return ballRack(b, w, d);
  if (kind === 'basket') {
    b.box(navy, 0, 0.18, 0, w, 0.35, d);
    rail(b, teal, 0, 1.87, -0.31, 0.23, 3.52, 0.24);
    b.box(cream, 0, 3.62, -0.19, 2.3, 1.52, 0.17);
    b.box(red, 0, 3.44, -0.08, 0.87, 0.57, 0.065);
    b.box(paper, 0, 3.45, -0.032, 0.66, 0.36, 0.04);
    b.part(f.hoop, orange, 0, 3.23, 0.34, 0.98, 0.98, 0.83, halfPi);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      rail(b, cream, Math.cos(a) * 0.35, 2.95, 0.34 + Math.sin(a) * 0.35, 0.045, 0.54, 0.045);
    }
    b.part(f.hoop, cream, 0, 2.69, 0.34, 0.62, 0.62, 0.55, halfPi);
    return;
  }
  if (kind === 'vault') {
    for (let i = 0; i < 3; i++) {
      b.box(i === 2 ? red : honey, 0, 0.35 + i * 0.52, 0, w - i * 0.15, 0.52, d - i * 0.07);
      b.box(navy, 0, 0.35 + i * 0.52, (d - i * 0.07) * 0.5, 0.8, 0.13, 0.055);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      b.box([blue, teal, red][i], 0, 0.18 + i * 0.31, 0, w, 0.29, d, 0.018 * (i - 1));
      for (const x of [-w * 0.29, w * 0.29])
        b.box(cream, x, 0.17 + i * 0.31, d * 0.47, 0.18, 0.2, 0.08);
    }
  }
}
function easel(b, w) {
  for (const s of [-1, 1]) rail(b, wood, s * w * 0.27, 1.36, 0, 0.14, 2.75, 0.17, -s * 0.16);
  rail(b, wood, 0, 1.18, -0.34, 0.15, 2.44, 0.16, 0, 0.2);
  b.box(honey, 0, 2.03, 0, w * 0.88, 1.87, 0.16);
  b.box(paper, 0, 2.04, 0.1, w * 0.8, 1.66, 0.06);
  gooseRelief(b, 0, 1.87, 0.15, 1.38);
  b.box(wood, 0, 1.11, 0.14, w * 0.91, 0.14, 0.39);
}
function paints(b, w, d) {
  table(b, w, d, 1.52);
  for (let i = 0; i < 3; i++) {
    const x = w * (i - 1) * 0.27;
    cylinder(b, [teal, gold, red][i], x, 1.92, 0, 0.52, 0.61);
    cylinder(b, cream, x, 2.22, 0, 0.55, 0.09);
    if (i === 1)
      for (let j = 0; j < 3; j++) {
        rail(b, wood, x + 0.1 * (j - 1), 2.54, 0, 0.067, 0.74, 0.067, (j - 1) * 0.29);
        b.part(f.leaf, bookColors[j], x + 0.2 * (1 - j), 2.94, 0, 0.15, 0.3, 0.14);
      }
  }
}
function wall(b, w, d, h) {
  const along = w > d,
    seg = Math.max(w, d),
    n = Math.ceil(seg / 5.8);
  for (let j = 0; j < n; j++) {
    const len = seg / n,
      v = (j + 0.5) * len - seg / 2,
      x = along ? v : 0,
      z = along ? 0 : v;
    const sw = along ? len : w,
      sd = along ? d : len;
    rail(b, 0xf0cdbb, x, h * 0.5, z, sw, h, sd);
    rail(b, rose, x, 0.4, z, sw, 0.78, sd + 0.02);
    rail(b, honey, x, 0.88, z, sw + 0.025, 0.12, sd + 0.055);
    b.box(cream, x, h, z, sw + 0.045, 0.17, sd + 0.065);
    const px = along ? x - len * 0.5 : x,
      pz = along ? z : z - len * 0.5;
    rail(b, 0xddac9f, px, h * 0.52, pz, along ? 0.15 : w + 0.04, h * 0.9, along ? d + 0.04 : 0.15);
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
function locker(b, w, d) {
  const n = 4,
    sw = w / n;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * sw - w * 0.5;
    b.box(navy, x, 1.6, 0, sw - 0.03, 3.16, d);
    b.box(i % 2 ? teal : 0x72aa9e, x, 1.59, d * 0.49, sw - 0.14, 2.98, 0.09);
    for (const y of [2.62, 2.77]) rail(b, navy, x, y, d * 0.54, sw * 0.49, 0.048, 0.028);
    rail(b, cream, x - sw * 0.26, 1.57, d * 0.56, 0.09, 0.29, 0.09);
  }
}
function gallery(b, wall, index) {
  const c = wall.corners;
  const poly = new T.Shape();
  c.forEach(([x, z], i) => (i ? poly.lineTo(x, -z) : poly.moveTo(x, -z)));
  poly.closePath();
  const slab = new T.ExtrudeGeometry(poly, { depth: 1, bevelEnabled: false }).rotateX(-halfPi);
  b.part(slab, wood, 0, 0.03, 0, 1, 0.2, 1);
  b.part(slab, 0xf0bf9f, 0, 0.22, 0, 1, 2.37, 1, 0, 0, 0, 0.024);
  b.part(slab, cream, 0, 2.58, 0, 1, 0.15, 1);
  // Hang each painting flush with the edge closest to the centre of the ring.
  const edges = c
    .map(([x, z], i) => {
      const [xx, zz] = c[(i + 1) % c.length];
      return {
        x: (x + xx) / 2,
        z: (z + zz) / 2,
        dx: xx - x,
        dz: zz - z,
        len: Math.hypot(xx - x, zz - z),
      };
    })
    .sort((a, b) => b.len - a.len)
    .slice(0, 2);
  for (const e of edges) {
    const a = -Math.atan2(e.dz, e.dx),
      outX = e.dz / e.len,
      outZ = -e.dx / e.len;
    const x = e.x + outX * 0.07,
      z = e.z + outZ * 0.07,
      w = Math.min(1.95, e.len * 0.74);
    b.box(wood, x, 1.51, z, w, 1.38, 0.14, a);
    b.box(
      [teal, rose, blue][index % 3],
      x + outX * 0.08,
      1.52,
      z + outZ * 0.08,
      w - 0.16,
      1.18,
      0.045,
      a,
    );
    const yaw = Math.atan2(outX, outZ),
      xx = x + outX * 0.15,
      zz = z + outZ * 0.15;
    switch (index % 3) {
      case 0:
        gooseRelief(b, xx, 1.35, zz, Math.min(1.07, w * 0.7), yaw);
        break;
      case 1:
        b.part(mountain, 0x91c2a4, xx, 1.53, zz, w * 0.79, 1, 0.32, 0, yaw, 0, 0.011);
        b.part(
          f.round,
          gold,
          x + e.dx * 0.093 + outX * 0.15,
          1.82,
          z + e.dz * 0.093 + outZ * 0.15,
          0.29,
          0.29,
          0.065,
          0,
          yaw,
          0,
          0.014,
        );
        break;
      case 2:
        b.part(f.taper, cream, xx, 1.5, zz, 0.38, 0.46, 0.09, Math.PI, yaw, 0, 0.022);
        b.part(f.leaf, 0x77a686, xx, 1.86, zz, 0.36, 0.42, 0.08, 0, yaw, -0.42, 0.014);
        b.part(
          f.round,
          orange,
          x + e.dx * 0.09 + outX * 0.19,
          1.37,
          z + e.dz * 0.09 + outZ * 0.19,
          0.31,
          0.3,
          0.09,
          0,
          yaw,
          0,
          0.018,
        );
        break;
    }
  }
  slab.dispose();
}
function windowFrame(b, x, y, z) {
  b.box(wood, x, y, z, 3.95, 2.2, 0.18);
  b.box(0xaedbd8, x, y, z + 0.12, 3.74, 2, 0.1);
  rail(b, cream, x, y, z + 0.2, 0.13, 2.04, 0.09);
  rail(b, cream, x, y, z + 0.2, 3.77, 0.12, 0.09);
  b.box(honey, x, y - 1.07, z + 0.1, 4.02, 0.13, 0.42);
}
function pennant(b, x, z, c) {
  rail(b, honey, x, 2.66, z, 1.4, 0.1, 0.13);
  b.part(flag, c, x, 1.82, z + 0.05, 1.13, 1.62, 0.65, 0, 0, 0, 0.021);
  b.part(chevron, cream, x, 1.57, z + 0.116, 0.91, 0.81, 0.24, 0, 0, 0, 0.009);
  b.part(f.leaf, gold, x, 2.06, z + 0.12, 0.32, 0.46, 0.09);
}
function roomSign(b, x, z, kind) {
  b.box(wood, x, 2.06, z, 2.28, 1.33, 0.13);
  b.box(cream, x, 2.06, z + 0.085, 2.13, 1.18, 0.06);
  const front = z + 0.165;
  if (kind === 'class') {
    for (const s of [-1, 1])
      rail(b, s === 1 ? teal : blue, x + s * 0.23, 2.08, front, 0.47, 0.68, 0.1, s * 0.11);
    rail(b, gold, x + 0.2, 2.14, front + 0.07, 0.1, 0.53, 0.04);
  } else if (kind === 'lab') {
    b.part(f.taper, teal, x, 1.94, front, 0.72, 0.51, 0.16);
    rail(b, teal, x, 2.3, front, 0.19, 0.3, 0.12);
    rail(b, navy, x, 2.46, front, 0.31, 0.08, 0.12);
  } else if (kind === 'art') gooseRelief(b, x, 1.92, front, 0.94);
  else {
    b.part(f.round, orange, x, 2.06, front, 0.8, 0.8, 0.15);
    rail(b, navy, x, 2.06, front + 0.09, 0.71, 0.058, 0.036, -0.52);
    rail(b, navy, x, 2.06, front + 0.1, 0.065, 0.7, 0.036, -0.37);
  }
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
export function buildCampusModels(walls) {
  const group = new T.Group();
  group.userData.shadowTriangles = [];
  const pads = walls.filter((w) => w.kind === 'pad');
  let count = 0,
    art = 0;
  for (const obstacle of walls) {
    const { kind, x0, x1, z0, z1 } = obstacle.kind === 'pad' ? trimPad(obstacle, pads) : obstacle,
      w = x1 - x0,
      d = z1 - z0,
      x = (x0 + x1) / 2,
      z = (z0 + z1) / 2;
    const b = new InkMesh(true);
    switch (kind) {
      case 'gallery':
        gallery(b, obstacle, art++);
        finish(group, b, kind);
        continue;
      case 'wall':
        wall(b, w, d, Math.min(3.4, obstacle.height));
        break;
      case 'shelf':
        shelf(b, w, d);
        break;
      case 'desk':
      case 'teacher':
        desk(b, w, d, kind === 'teacher');
        break;
      case 'lab':
        lab(b, w, d);
        break;
      case 'plant':
        plant(b, 0, 0, 0, 1.68);
        break;
      case 'pad':
        pad(b, w, d, count++);
        break;
      case 'ballRack':
      case 'mats':
      case 'basket':
      case 'vault':
        gymProp(b, w, d, kind);
        break;
      case 'easel':
        easel(b, w);
        break;
      case 'paint':
        paints(b, w, d);
        break;
      case 'locker':
        locker(b, w, d);
        break;
      case 'bench':
        table(b, w, d, 0.87);
        b.box(teal, 0, 0.97, 0, w, 0.09, d);
        break;
      default:
        throw Error('Unknown campus furniture ' + kind);
    }
    finish(group, b, kind, x, z);
  }
  const tops = new InkMesh();
  countertop(
    tops,
    walls.filter((w) => w.kind === 'lab'),
  );
  finish(group, tops, 'continuous laboratory worktops');
  const decor = new InkMesh();
  chalkboard(decor, -20, 3.06, -30.92, 9);
  roomSign(decor, -15.6, -5.08, 'class');
  roomSign(decor, 25.2, -5.08, 'lab');
  roomSign(decor, -15.6, 5.99, 'art');
  roomSign(decor, 25.2, 5.99, 'gym');
  for (const [x, c] of [
    [29, red],
    [32, blue],
    [35, gold],
  ])
    pennant(decor, x, 5.99, c);
  for (const x of [-33, -9, 7, 18, 32]) windowFrame(decor, x, 3.06, -30.92);
  finish(group, decor, 'wall furnishings');
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

export function buildInkPortal() {
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

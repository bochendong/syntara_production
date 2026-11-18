// Model space faces +Z. Each batch is relative to a joint, so the pencil,
// glasses and clothing follow their wearer in the arena and the portrait camera.
import * as T from './vendor/three.module.js';

const tau = 2 * Math.PI;
const anchors = {
  head: [0, 0.962, 0.015],
  browL: [-0.205, 1.505, 0.42],
  browR: [0.205, 1.505, 0.42],
  gazeL: [-0.205, 1.338, 0.414],
  gazeR: [0.205, 1.338, 0.414],
  mouth: [0, 1.143, 0.434],
  mouthOpen: [0, 1.139, 0.437],
  elbowL: [-0.3, 0.694, 0.02],
  elbowR: [0.3, 0.694, 0.02],
  handL: [-0.341, 0.556, 0.096],
  handR: [0.341, 0.556, 0.096],
  shinL: [-0.151, 0.26, 0],
  shinR: [0.151, 0.26, 0],
  footL: [-0.151, 0.095, 0],
  footR: [0.151, 0.095, 0],
  eyeL: [-0.205, 1.338, 0.414],
  eyeR: [0.205, 1.338, 0.414],
  hair: [0, 1.45, -0.2],
  torso: [0, 0.62, 0],
  skirt: [0, 0.646, 0],
  armL: [-0.286, 0.833, 0.012],
  armR: [0.286, 0.833, 0.012],
  legL: [-0.151, 0.463, 0],
  legR: [0.151, 0.463, 0],
};
const bookCover = [-0.366, 0.598, 0.15],
  bookTurn = [-0.13, -0.53, -0.13];
const bookOrientation = new T.Euler(...bookTurn, 'YXZ');
function onBook(x, y, z) {
  return new T.Vector3(x, y, z)
    .applyEuler(bookOrientation)
    .add(new T.Vector3(...bookCover))
    .toArray();
}
anchors.cover = anchors.page = onBook(-0.099, 0, 0);
const spine = new T.Vector3(0, 1, 0).applyEuler(bookOrientation);
const hingeInHand = new T.Vector3(...anchors.cover).sub(new T.Vector3(...anchors.handL));
const unit = [1, 1, 1],
  origin = [0, 0, 0];
const sphere = new T.SphereGeometry(0.5, 16, 12);
const box = new T.BoxGeometry(1, 1, 1);
const hex = new T.CylinderGeometry(0.5, 0.5, 1, 6);
const tip = new T.ConeGeometry(0.5, 1, 6);

function buffer(points, indices) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
// Closed horizontal sections. Individual points can move to draw scalloped
// hems, tapered locks and convex cheeks instead of stacking separate blobs.
function loft(rings) {
  const n = rings[0].length,
    ids = [];
  for (let row = 1; row < rings.length; row++)
    for (let i = 0; i < n; i++) {
      const a = (row - 1) * n + i,
        b = (row - 1) * n + ((i + 1) % n);
      ids.push(a, b, b + n, a, b + n, a + n);
    }
  for (let i = 1; i < n - 1; i++)
    ids.push(0, i + 1, i, (rings.length - 1) * n, (rings.length - 1) * n + i, (rings.length - 1) * n + i + 1);
  return buffer(rings.flat(), ids);
}
function oval(rows, n = 18) {
  return loft(
    rows.map(([y, rx, rz, cx = 0, cz = 0]) =>
      Array.from({ length: n }, (_, i) => {
        const a = (tau * i) / n;
        return [cx + rx * Math.sin(a), y, cz + rz * Math.cos(a)];
      }),
    ),
  );
}
function plaque(points, thickness = 0.016) {
  const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  const g = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  return g.translate(0, 0, -thickness * 0.5);
}
function pipe(points, r, closed = false, sides = 7) {
  const path = new T.CatmullRomCurve3(
    points.map((p) => new T.Vector3(...p)),
    closed,
    'centripetal',
  );
  return new T.TubeGeometry(path, Math.max(4, points.length * 3), r, sides, closed);
}
function colorMix(a, b, t) {
  return new T.Color(a).lerp(new T.Color(b), t).getHex();
}

export function createScholarSculpt() {
  const batches = new Map();
  const p = new T.Vector3(),
    q = new T.Quaternion(),
    m = new T.Matrix4();
  function bucket(joint, color) {
    const key = joint + '_' + color;
    if (!batches.has(key)) batches.set(key, { joint, color, positions: [], normals: [] });
    return batches.get(key);
  }
  function add(joint, color, g, at = origin, scale = unit, rot = origin, edge = 0) {
    q.setFromEuler(new T.Euler(...rot, 'YXZ'));
    m.compose(new T.Vector3(...at), q, new T.Vector3(...scale));
    const center = anchors[joint];
    const pos = g.attributes.position,
      src = [],
      normals = [];
    const normalMatrix = new T.Matrix3().getNormalMatrix(m);
    const inputNormals = g.attributes.normal;
    for (let i = 0; i < pos.count; i++) src.push(p.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
    for (let i = 0; i < pos.count; i++)
      normals.push(new T.Vector3().fromBufferAttribute(inputNormals, i).applyNormalMatrix(normalMatrix));
    const ids = g.index?.array ?? Array.from({ length: pos.count }, (_, i) => i);
    const triangles = [],
      sums = new Map(),
      keys = src.map(({ x, y, z }) => [x, y, z].map((v) => Math.round(v * 100000)).join(','));
    for (let i = 0; i < ids.length; i += 3) {
      const a = ids[i],
        b = ids[i + 1],
        c = ids[i + 2],
        normal = src[b].clone().sub(src[a]).cross(src[c].clone().sub(src[a]));
      if (normal.lengthSq() < 1e-16) continue;
      normal.normalize();
      triangles.push([a, b, c]);
      if (edge)
        for (const j of [a, b, c]) {
          if (!sums.has(keys[j])) sums.set(keys[j], new T.Vector3());
          sums.get(keys[j]).add(normal);
        }
    }
    const fill = bucket(joint, color),
      outline = edge ? bucket(joint, 'ink') : null;
    const hull = edge
      ? src.map((v, i) =>
          v.clone().addScaledVector((sums.get(keys[i]) ?? new T.Vector3()).clone().normalize(), edge),
        )
      : null;
    function write(dst, v, n, sign = 1) {
      dst.positions.push(v.x - center[0], v.y - center[1], v.z - center[2]);
      dst.normals.push(n.x * sign, n.y * sign, n.z * sign);
    }
    for (const [a, b, c] of triangles) {
      for (const id of [a, b, c]) write(fill, src[id], normals[id]);
      if (edge) for (const id of [c, b, a]) write(outline, hull[id], normals[id], -1);
    }
  }
  const blob = (j, c, at, size, edge = 0, rot = origin) => add(j, c, sphere, at, size, rot, edge);
  const solid = (j, c, g, edge = 0) => add(j, c, g, origin, unit, origin, edge);
  const line = (j, c, points, r, closed = false) => solid(j, c, pipe(points, r, closed));
  const patch = (j, c, points, at, rot = origin, thickness = 0.016, edge = 0) =>
    add(j, c, plaque(points, thickness), at, unit, rot, edge);
  const side = (sign) => (sign < 0 ? 'L' : 'R');

  // The small chin, broad cheekbones and flatter forehead provide a seat for
  // the spectacles. Both eyes turn around the sides of the face.
  solid(
    'head',
    'skin',
    oval(
      [
        [0.968, 0.084, 0.1, 0, 0.11],
        [1.009, 0.248, 0.232, 0, 0.105],
        [1.112, 0.408, 0.328, 0, 0.083],
        [1.244, 0.493, 0.397, 0, 0.055],
        [1.406, 0.507, 0.434, 0, 0.027],
        [1.575, 0.465, 0.405],
        [1.718, 0.354, 0.32],
        [1.8, 0.11, 0.12],
      ],
      24,
    ),
    0.019,
  );
  blob('head', 'skin', [0, 1.255, 0.462], [0.09, 0.077, 0.089]);
  line(
    'mouth',
    'lip',
    [
      [-0.057, 1.143, 0.427],
      [-0.012, 1.135, 0.439],
      [0.032, 1.14, 0.437],
      [0.056, 1.154, 0.428],
    ],
    0.009,
  );
  blob('mouthOpen', 'lip', [0, 1.137, 0.44], [0.07, 0.064, 0.016]);
  for (const s of [-1, 1]) {
    blob('head', 'skin', [s * 0.477, 1.276, 0.008], [0.147, 0.188, 0.116], 0.009);
    blob('head', 'blush', [s * 0.496, 1.272, 0.058], [0.077, 0.104, 0.033]);
    blob('head', 'blush', [s * 0.307, 1.193, 0.363], [0.095, 0.032, 0.026], 0, [0, s * 0.55, s * 0.07]);
    const j = 'eye' + side(s),
      x = s * 0.205;
    const eyeZ = (dx, depth = 0) => 0.418 - s * 0.43 * dx + depth;
    const eyelid = [
      [-0.115, 0.007],
      [-0.086, 0.088],
      [-0.013, 0.115],
      [0.068, 0.104],
      [0.112, 0.06],
      [0.115, -0.009],
      [0.073, -0.085],
      [0.003, -0.111],
      [-0.072, -0.081],
    ];
    const r = [0, s * 0.39, 0];
    patch(
      j,
      'ink',
      eyelid.map(([dx, y]) => [s * dx, y]),
      [x, 1.338, 0.419],
      r,
      0.034,
    );
    blob(j, 'paper', [x, 1.333, 0.432], [0.207, 0.191, 0.061], 0, r);
    const gaze = 'gaze' + side(s);
    blob(gaze, 'irisDark', [x - 0.005, 1.332, 0.452], [0.153, 0.182, 0.045], 0, r);
    blob(gaze, 'iris', [x - 0.004, 1.315, 0.47], [0.126, 0.135, 0.023], 0, r);
    blob(gaze, 'ink', [x - 0.012, 1.35, 0.478], [0.082, 0.12, 0.023], 0, r);
    blob(gaze, 'sky', [x + 0.016, 1.286, 0.482], [0.047, 0.024, 0.012], 0, r);
    blob(gaze, 'paper', [x - 0.027, 1.371, eyeZ(-0.027, 0.067)], [0.044, 0.046, 0.021]);
    line(
      j,
      'ink',
      [
        [x - s * 0.098, 1.376, eyeZ(-s * 0.098, 0.017)],
        [x, 1.43, 0.446],
        [x + s * 0.077, 1.421, eyeZ(s * 0.077, 0.017)],
        [x + s * 0.127, 1.408, eyeZ(s * 0.127, 0.012)],
      ],
      0.011,
    );
    line(
      'brow' + side(s),
      'hair',
      [
        [x - s * 0.079, 1.495, eyeZ(-s * 0.079, -0.002)],
        [x, 1.513, 0.427],
        [x + s * 0.073, 1.507, eyeZ(s * 0.073)],
      ],
      0.015,
    );
    const ring = Array.from({ length: 20 }, (_, i) => {
      const a = (i * tau) / 20,
        dx = 0.183 * Math.cos(a),
        dy = 0.157 * Math.sin(a);
      return [x + dx, 1.349 + dy, 0.51 - s * 0.39 * dx - 0.04 * (dx / 0.183) ** 2 - 0.017 * (dy / 0.157) ** 2];
    });
    line('head', 'frame', ring, 0.019, true);
    line(
      'head',
      'lacquer',
      ring.slice(3, 8).map(([xx, y, z]) => [xx, y + 0.008, z + 0.009]),
      0.005,
    );
    line(
      'head',
      'frame',
      [
        [s * 0.381, 1.373, 0.404],
        [s * 0.433, 1.398, 0.316],
        [s * 0.482, 1.413, 0.148],
        [s * 0.496, 1.364, 0.016],
      ],
      0.014,
    );
    blob('head', 'brass', [s * 0.39, 1.376, 0.403], [0.043, 0.037, 0.037]);
  }
  line(
    'head',
    'frame',
    [
      [-0.045, 1.36, 0.52],
      [0, 1.385, 0.529],
      [0.045, 1.36, 0.52],
    ],
    0.016,
  );

  // The satin-black crown ends higher over the face and lower at the nape.
  const n = 30;
  const crownRows = [1, 0.84, 0.63, 0.39, 0.17, 0.014].map((f) =>
    Array.from({ length: n }, (_, i) => {
      const a = (tau * i) / n,
        angle = (1.78 - 0.4 * Math.cos(a) - 0.035 * Math.sin(2 * a)) * f;
      return [
        0.55 * Math.sin(angle) * Math.sin(a),
        1.493 + 0.443 * Math.cos(angle),
        -0.037 + 0.482 * Math.sin(angle) * Math.cos(a),
      ];
    }),
  );
  solid('head', 'hair', loft(crownRows), 0.021);
  // One flared curtain around the back with a carved hem and a front opening.
  const maneRows = [0, 0.23, 0.58, 0.84, 1].map((u) => {
    const outer = [],
      inner = [];
    for (let i = 0; i <= 22; i++) {
      const a = 1.02 + ((tau - 2.04) * i) / 22,
        edge = Math.abs(i - 11) / 11;
      const hem = 0.61 + 0.155 * edge + 0.064 * Math.cos(i * 0.9 + 0.55) + 0.024 * Math.sin(i * 1.7);
      const y = hem + (1.56 - hem) * u,
        rx = 0.528 + 0.061 * Math.sin(u * Math.PI) - 0.058 * (1 - u),
        rz = 0.472 + 0.045 * Math.sin(u * Math.PI);
      const x = rx * Math.sin(a) - 0.035 * (1 - u) ** 2,
        z = -0.068 + rz * Math.cos(a) - 0.045 * (1 - u);
      outer.push([x, y, z]);
      inner.unshift([x * 0.82, y + 0.015, -0.07 + (z + 0.07) * 0.81]);
    }
    return [...outer, ...inner];
  });
  solid('hair', 'hairLow', loft(maneRows), 0.014);
  // Sculpted overlapping locks share the crown and taper to separate tips.
  function lock(j, c, rows, edge = 0.007) {
    solid(j, c, oval(rows, 10), edge);
  }
  lock('head', 'hair', [
    [1.413, 0.007, 0.01, -0.367, 0.35],
    [1.496, 0.112, 0.057, -0.281, 0.383],
    [1.585, 0.173, 0.076, -0.161, 0.391],
    [1.668, 0.164, 0.08, -0.064, 0.341],
    [1.76, 0.115, 0.078, 0.003, 0.264],
    [1.83, 0.018, 0.02, 0.043, 0.194],
  ]);
  lock(
    'head',
    'hairMid',
    [
      [1.48, 0.007, 0.01, -0.146, 0.454],
      [1.533, 0.084, 0.047, -0.071, 0.427],
      [1.621, 0.143, 0.067, 0.012, 0.394],
      [1.714, 0.132, 0.062, 0.061, 0.321],
      [1.798, 0.055, 0.033, 0.076, 0.23],
    ],
    0.003,
  );
  lock('head', 'hair', [
    [1.421, 0.009, 0.014, 0.363, 0.331],
    [1.51, 0.09, 0.076, 0.309, 0.354],
    [1.604, 0.142, 0.089, 0.238, 0.365],
    [1.726, 0.146, 0.071, 0.17, 0.296],
    [1.812, 0.063, 0.055, 0.103, 0.213],
  ]);
  for (const s of [-1, 1]) {
    lock('hair', s === 1 ? 'hairMid' : 'hair', [
      [0.65 + 0.09 * (s === 1), 0.012, 0.012, s * 0.422, 0.103],
      [0.754 + 0.07 * (s === 1), 0.077, 0.071, s * 0.475, 0.126],
      [0.987, 0.092, 0.112, s * 0.515, 0.15],
      [1.292, 0.09, 0.117, s * 0.517, 0.149],
      [1.494, 0.104, 0.127, s * 0.467, 0.198],
      [1.634, 0.067, 0.074, s * 0.412, 0.187],
    ]);
    // Back locks catch a narrow plane of plum light from the game camera.
    lock(
      'hair',
      'hairMid',
      [
        [0.65, 0.01, 0.01, s * 0.205, -0.491],
        [0.8, 0.077, 0.052, s * 0.235, -0.526],
        [1.061, 0.1, 0.063, s * 0.25, -0.526],
        [1.329, 0.088, 0.06, s * 0.23, -0.51],
        [1.535, 0.04, 0.032, s * 0.2, -0.45],
      ],
      0.002,
    );
  }
  // Locks sweep towards a half-up ribbon, breaking the rear silhouette.
  for (const [start, end] of [
    [
      [-0.42, 1.53, -0.33],
      [0.24, 1.32, -0.55],
    ],
    [
      [-0.36, 1.59, -0.39],
      [0.25, 1.35, -0.55],
    ],
  ]) {
    const mid = [-0.12, (start[1] + end[1]) * 0.5, -0.548];
    line('hair', 'hairMid', [start, mid, [0.1, end[1] + 0.025, -0.55], end], 0.018);
  }
  lock(
    'hair',
    'hairMid',
    [
      [0.75, 0.008, 0.01, 0.409, -0.448],
      [0.816, 0.052, 0.034, 0.38, -0.479],
      [0.947, 0.082, 0.047, 0.305, -0.531],
      [1.113, 0.098, 0.054, 0.253, -0.557],
      [1.24, 0.074, 0.042, 0.245, -0.559],
      [1.348, 0.042, 0.028, 0.258, -0.54],
    ],
    0.007,
  );
  const rear = [0.258, 1.35, -0.575],
    rearRot = [0.06, 2.79, 0.18];
  // An oval ribbon loops away from the head, with a pinched waist
  // at the clasp and broad folded edges at the outer tips.
  for (const sign of [-1, 1]) {
    const vertices = [], indices = [];
    for (let i = 0; i < 20; i++) {
      const angle = tau * i / 20;
      const reach = (1 - Math.cos(angle)) / 2;
      const x = sign * (0.008 + reach * (sign < 0 ? 0.18 : 0.15));
      const y = reach * (sign < 0 ? 0.018 : 0.042);
      const z = 0.036 + 0.048 * Math.sin(angle);
      const width = 0.015 + 0.061 * reach;
      const nx = -sign * Math.cos(angle), nz = Math.sin(angle);
      for (const [height, depth] of [[-1, 0], [0, 0.013], [1, 0], [1, -0.008], [0, 0.005], [-1, -0.008]]) {
        vertices.push([x + nx * depth, y + width * height, z + nz * depth]);
      }
      for (let j = 0; j < 6; j++) {
        const next = ((i + 1) % 20) * 6;
        const k = (j + 1) % 6;
        indices.push(i * 6 + j, next + j, i * 6 + k, i * 6 + k, next + j, next + k);
      }
    }
    if (sign < 0) indices.reverse();
    add('hair', 'accent', buffer(vertices, indices), rear, unit, rearRot);
  }
  patch(
    'hair',
    'accent',
    [
      [-0.024, 0.01],
      [-0.087, -0.192],
      [-0.035, -0.166],
      [-0.01, -0.19],
      [0.022, -0.013],
      [0.078, -0.172],
      [0.106, -0.099],
      [0.033, 0.015],
    ],
    [0.276, 1.346, -0.595],
    rearRot,
    0.034,
    0.004,
  );
  blob('hair', 'brass', [0.281, 1.354, -0.626], [0.051, 0.051, 0.032]);
  function onCrown(a, phi, offset = 0.013) {
    return [
      (0.55 + offset) * Math.sin(phi) * Math.sin(a),
      1.493 + (0.443 + offset) * Math.cos(phi),
      -0.037 + (0.482 + offset) * Math.sin(phi) * Math.cos(a),
    ];
  }
  function ribbonOnCrown(c, pairs) {
    const vertices = pairs.flatMap(([a, phi, width]) => [onCrown(a, phi - width), onCrown(a, phi + width)]);
    const indices = [];
    for (let i = 2; i < vertices.length; i += 2) indices.push(i - 2, i, i - 1, i, i + 1, i - 1);
    // These thin inlaid planes are visible from outside the dome.
    const g = buffer(vertices, indices.reverse());
    solid('head', c, g);
  }
  ribbonOnCrown('hairShine', [
    [-1.71, 0.88, 0.008],
    [-1.42, 0.81, 0.064],
    [-1.18, 0.72, 0.109],
    [-0.99, 0.69, 0.132],
    [-0.92, 0.74, 0.048],
    [-0.77, 0.68, 0.092],
    [-0.54, 0.67, 0.013],
  ]);
  ribbonOnCrown('hairMid', [
    [1.5, 0.75, 0.008],
    [1.88, 0.68, 0.071],
    [2.17, 0.6, 0.089],
    [2.4, 0.63, 0.013],
  ]);
  // Raised, tapered sections follow the part and catch the overhead light.
  for (const [azimuth, sweep, breadth] of [
    [-1.75, 0.63, 0.14], [-1.13, 0.57, 0.12], [-0.57, 0.44, 0.1],
    [0.65, -0.48, 0.13], [1.35, -0.6, 0.15], [2.48, -0.5, 0.14],
  ]) {
    const vertices = [], indices = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, swell = Math.sin(Math.PI * t);
      const a = azimuth + sweep * (1 - t) ** 2, phi = 0.15 + t * 1.03;
      const width = breadth * (0.08 + swell);
      vertices.push(onCrown(a - width, phi, 0.005), onCrown(a, phi, 0.006 + 0.021 * swell),
        onCrown(a + width, phi, 0.005));
      if (i) {
        const k = i * 3;
        indices.push(k - 3, k, k - 2, k - 2, k, k + 1, k - 2, k + 1, k - 1, k - 1, k + 1, k + 2);
      }
    }
    solid('head', 'hairMid', buffer(vertices, indices));
  }
  // A narrow flyaway and the parting make the silhouette legible from above.
  lock(
    'head',
    'hairMid',
    [
      [1.906, 0.047, 0.028, -0.04, -0.049],
      [1.943, 0.048, 0.023, -0.064, -0.07],
      [1.963, 0.03, 0.018, -0.123, -0.081],
      [1.958, 0.007, 0.008, -0.182, -0.075],
    ],
    0.004,
  );
  // An enamel barrette straddles two locks; the two red prongs read in profile.
  const clipPos = [0.374, 1.705, 0.25],
    clipRot = [-0.42, 0.81, -0.31];
  patch(
    'head',
    'frame',
    [
      [-0.128, -0.046],
      [0.103, -0.048],
      [0.132, 0.025],
      [-0.097, 0.055],
    ],
    clipPos,
    clipRot,
    0.052,
    0.007,
  );
  patch(
    'head',
    'accent',
    [
      [-0.116, -0.032],
      [0.097, -0.036],
      [0.113, 0.017],
      [-0.092, 0.037],
    ],
    [0.39, 1.71, 0.264],
    clipRot,
    0.038,
  );
  patch(
    'head',
    'brass',
    [
      [-0.022, 0],
      [0, 0.022],
      [0.022, 0],
      [0, -0.022],
    ],
    [0.445, 1.701, 0.233],
    clipRot,
    0.019,
  );

  // Tailored shirt, a folded sailor collar, and individually folded skirt pleats.
  solid(
    'torso',
    'top',
    oval([
      [0.555, 0.212, 0.153],
      [0.6, 0.244, 0.172],
      [0.735, 0.256, 0.178],
      [0.828, 0.29, 0.165],
      [0.884, 0.233, 0.154],
      [0.916, 0.13, 0.115],
    ]),
    0.013,
  );
  blob('torso', 'skin', [0, 0.926, 0.022], [0.196, 0.19, 0.159]);
  for (const s of [-1, 1]) {
    // White piping sits on the actual folded lapel from shoulder to knot.
    patch(
      'torso',
      'pants',
      [
        [s * 0.004, 0.003],
        [s * 0.044, -0.005],
        [s * 0.244, 0.088],
        [s * 0.264, 0.131],
        [s * 0.176, 0.147],
        [s * 0.098, 0.102],
      ],
      [0, 0.752, 0.185],
      [-0.23, 0, 0],
      0.04,
      0.004,
    );
    line(
      'torso',
      'paper',
      [
        [s * 0.047, 0.768, 0.208],
        [s * 0.122, 0.813, 0.2],
        [s * 0.204, 0.854, 0.187],
        [s * 0.237, 0.878, 0.178],
      ],
      0.007,
    );
  }
  patch(
    'torso',
    'pants',
    [
      [-0.268, 0.086],
      [-0.211, -0.108],
      [0.206, -0.108],
      [0.267, 0.086],
    ],
    [0, 0.8, -0.153],
    [-0.12, 0, 0],
    0.044,
    0.009,
  );
  line(
    'torso',
    'paper',
    [
      [-0.21, 0.843, -0.186],
      [-0.177, 0.721, -0.187],
      [0.17, 0.721, -0.187],
      [0.209, 0.843, -0.186],
    ],
    0.008,
  );
  for (const s of [-1, 1]) {
    const top = [s * 0.126, 0.817, 0.239],
      bottom = [s * 0.112, 0.709, 0.249],
      middle = [s * 0.103, 0.764, 0.278];
    const fold = buffer(
      [[s * 0.014, 0.768, 0.234], top, middle, bottom, [s * 0.009, 0.743, 0.237], [s * 0.123, 0.766, 0.214]],
      s === 1
        ? [0, 2, 1, 0, 4, 2, 4, 3, 2, 1, 2, 5, 2, 3, 5, 0, 1, 5, 0, 5, 4, 4, 5, 3]
        : [0, 1, 2, 0, 2, 4, 4, 2, 3, 1, 5, 2, 2, 5, 3, 0, 5, 1, 0, 4, 5, 4, 3, 5],
    );
    solid('torso', 'accent', fold, 0.004);
  }
  blob('torso', 'accent', [0, 0.761, 0.248], [0.068, 0.078, 0.056]);
  patch(
    'torso',
    'accent',
    [
      [-0.026, 0],
      [-0.075, -0.127],
      [-0.018, -0.106],
      [0.018, -0.014],
      [0.061, -0.114],
      [0.082, -0.088],
      [0.033, 0.003],
    ],
    [0, 0.742, 0.213],
  );
  const pleatN = 36,
    skirtRing = (y, rx, rz, amp) =>
      Array.from({ length: pleatN }, (_, i) => {
        const a = (tau * i) / pleatN,
          fold = i % 3 === 1 ? 1 - amp : 1;
        return [rx * Math.sin(a) * fold, y + (i % 3 === 1 ? 0.01 : 0), rz * Math.cos(a) * fold];
      });
  solid(
    'skirt',
    'pants',
    loft([
      skirtRing(0.353, 0.346, 0.253, 0.14),
      skirtRing(0.398, 0.341, 0.25, 0.135),
      skirtRing(0.584, 0.254, 0.177, 0.079),
      skirtRing(0.638, 0.219, 0.158, 0.025),
    ]),
    0.011,
  );
  solid('skirt', 'trim', loft([skirtRing(0.389, 0.343, 0.252, 0.135), skirtRing(0.404, 0.34, 0.25, 0.135)]));
  for (const s of [-1, 1]) {
    const j = 'leg' + side(s),
      x = s * 0.147,
      shin = 'shin' + side(s),
      foot = 'foot' + side(s);
    solid(
      j,
      'skin',
      oval([
        [0.247, 0.073, 0.072, x],
        [0.255, 0.077, 0.076, x],
        [0.42, 0.084, 0.085, x],
      ]),
    );
    blob(shin, 'skin', [x, 0.26, 0], [0.151, 0.091, 0.145]);
    solid(
      shin,
      'paper',
      oval([
        [0.085, 0.063, 0.064, x],
        [0.201, 0.074, 0.075, x],
        [0.257, 0.08, 0.079, x],
      ]),
      0.005,
    );
    solid(
      shin,
      'trim',
      oval([
        [0.221, 0.076, 0.077, x],
        [0.234, 0.079, 0.079, x],
      ]),
    );
    solid(
      foot,
      'shoe',
      oval(
        [
          [0.025, 0.096, 0.144, x, 0.035],
          [0.055, 0.107, 0.155, x, 0.042],
          [0.101, 0.1, 0.142, x, 0.025],
          [0.134, 0.073, 0.078, x, -0.012],
        ],
        14,
      ),
      0.009,
    );
    blob(foot, 'shoeLight', [x - 0.011, 0.087, 0.158], [0.088, 0.02, 0.038], 0, [-0.55, 0, 0]);
    solid(
      foot,
      'sole',
      oval(
        [
          [0.011, 0.095, 0.145, x, 0.039],
          [0.039, 0.105, 0.154, x, 0.041],
        ],
        14,
      ),
    );
    line(
      foot,
      'shoeLight',
      [
        [x - 0.069, 0.106, 0.036],
        [x, 0.122, 0.071],
        [x + 0.073, 0.104, 0.036],
      ],
      0.013,
    );
    blob(foot, 'brass', [x + s * 0.066, 0.108, 0.045], [0.029, 0.025, 0.029]);
    const arm = 'arm' + side(s);
    blob(arm, 'top', [s * 0.284, 0.771, 0.002], [0.205, 0.248, 0.222], 0.009, [0, 0, s * 0.19]);
    solid(
      arm,
      'pants',
      oval(
        [
          [0.679, 0.084, 0.091, s * 0.301, 0.019],
          [0.716, 0.098, 0.103, s * 0.298, 0.014],
        ],
        14,
      ),
    );
    solid(
      'elbow' + side(s),
      'skin',
      oval(
        [
          [0.556, 0.065, 0.064, s * 0.342, 0.081],
          [0.61, 0.072, 0.073, s * 0.332, 0.054],
          [0.71, 0.069, 0.07, s * 0.3, 0.015],
        ],
        14,
      ),
      0.005,
    );
    if (s === 1) blob('handR', 'skin', [0.346, 0.548, 0.103], [0.121, 0.123, 0.124], 0.006);
  }
  // A thumb over the hexagonal pencil, with a crimped ferrule and graphite.
  const pencilA = new T.Vector3(0.286, 0.416, 0.014),
    pencilB = new T.Vector3(0.66, 0.842, 0.428);
  const axis = pencilB.clone().sub(pencilA),
    length = axis.length();
  const turn = new T.Euler().setFromQuaternion(
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), axis.clone().normalize()),
    'YXZ',
  );
  function pencilSegment(c, a, b, r, geometry = hex) {
    const at = pencilA.clone().addScaledVector(axis, (a + b) / 2);
    add('handR', c, geometry, at.toArray(), [r, (b - a) * length, r], [turn.x, turn.y, turn.z], 0.0035);
  }
  pencilSegment('coral', -0.055, 0.05, 0.092);
  pencilSegment('brass', 0.05, 0.15, 0.094);
  for (const t of [0.065, 0.122]) pencilSegment('brass', t, t + 0.014, 0.105);
  pencilSegment('yellow', 0.15, 0.83, 0.091);
  pencilSegment('wood', 0.83, 1.066, 0.092, tip);
  pencilSegment('ink', 0.999, 1.071, 0.03, tip);
  for (const [x, y, z, size] of [
    [0.412, 0.556, 0.153, 1], [0.401, 0.534, 0.14, 0.95], [0.384, 0.517, 0.128, 0.83],
  ]) {
    blob('handR', 'skin', [x, y, z], [0.068 * size, 0.039 * size, 0.085 * size], 0.002, [-0.42, 0.26, -0.38]);
  }
  blob('handR', 'skin', [0.392, 0.564, 0.163], [0.083, 0.059, 0.067], 0, [0, 0, -0.36]);
  // A pocket notebook tucked into the other elbow; the colored tab can be
  // read even when the heroine is running away from the camera.
  const notebook = [-0.347, 0.59, 0.105];
  add('handL', 'frame', box, notebook, [0.2, 0.292, 0.094], bookTurn, 0.006);
  add('handL', 'paper', box, [-0.35, 0.593, 0.118], [0.19, 0.267, 0.088], bookTurn);
  add('cover', 'notebook', box, bookCover, [0.202, 0.288, 0.022], bookTurn, 0.004);
  add('cover', 'brass', box, [-0.368, 0.622, 0.165], [0.094, 0.03, 0.024], bookTurn);
  // The fingers wrap the fore edge; the cover stays legible above them.
  add('handL', 'accent', box, [-0.383, 0.461, 0.116], [0.027, 0.05, 0.013], bookTurn);
  add('cover', 'paper', box, [-0.365, 0.65, 0.168], [0.102, 0.058, 0.014], bookTurn);
  add('cover', 'notebook', box, [-0.367, 0.65, 0.177], [0.069, 0.009, 0.008], bookTurn);
  // Tabs stay on the fixed page block when the cover opens.
  for (const [y, color] of [[0.097, 'coral'], [0.049, 'yellow']]) {
    add('handL', color, box, onBook(0.097, y, -0.027), [0.039, 0.031, 0.006], bookTurn);
  }
  add('page', 'paper', box, onBook(0, 0, -0.014), [0.186, 0.265, 0.006], bookTurn);
  for (const [y, w] of [
    [0.065, 0.112],
    [0.031, 0.14],
    [-0.001, 0.093],
    [-0.035, 0.121],
  ]) {
    for (const face of [-1, 1])
      add(
        'page',
        'notebook',
        box,
        onBook(-0.073 + w * 0.5, y, -0.014 + face * 0.004),
        [w, 0.007, 0.002],
        bookTurn,
      );
  }
  blob('handL', 'skin', [-0.307, 0.537, 0.187], [0.109, 0.084, 0.063], 0.003, [-0.1, -0.43, -0.42]);
  const geometries = {},
    parts = [];
  for (const [id, { joint, color, positions, normals }] of batches) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    g.computeBoundingSphere();
    const name = 'scholar_' + id;
    geometries[name] = g;
    parts.push({ name, joint, color });
  }
  return {
    geometries,
    parts(look) {
      const palette = {
        ...look,
        hair: colorMix(look.hair, 0x57324a, 0.16),
        skin: look.skin ?? 0xffdcc4,
        ink: 0x311728,
        paper: 0xfff2dd,
        hairLow: colorMix(look.hair, 0x503146, 0.19),
        hairMid: colorMix(look.hair, 0x7a5061, 0.22),
        hairShine: colorMix(look.hair, 0xb1859b, 0.31),
        frame: 0x904651,
        lacquer: 0xe59b99,
        blush: 0xe99a90,
        lip: 0x934d55,
        irisDark: colorMix(look.iris, 0x211b39, 0.66),
        sky: 0xa2d6ed,
        trim: colorMix(look.pants, 0xefdbb9, 0.49),
        shoe: 0x603848,
        sole: 0x382638,
        shoeLight: 0x9a6370,
        brass: 0xeab464,
        notebook: 0x4a8b89,
        coral: 0xe28683,
        yellow: 0xf4b441,
        wood: 0xf2ce91,
      };
      return parts.map(({ name, joint, color }) => [
        name,
        palette[color],
        anchors[joint],
        unit,
        0,
        'scholar:' + joint,
        0,
      ]);
    },
  };
}

// World travel drives cadence. Deceleration, collision and joystick speed
// affect the pose without changing velocity, damage or the collision radius.
const saturate = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => {
  const t = saturate(v);
  return t * t * (3 - 2 * t);
};
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const strideLength = (gait) => 1.38 + 1.3 * gait;
export function advanceScholar(p, distance, yaw, dt, referenceSpeed) {
  if (dt <= 0) return;
  const target = saturate(distance / (dt * referenceSpeed));
  const gait =
    (p.scholarGait ?? 0) + (target - (p.scholarGait ?? 0)) * -Math.expm1(-dt * (target > 0.1 ? 15 : 19));
  p.scholarGait = gait < 0.004 ? 0 : gait;
  p.scholarPhase = ((p.scholarPhase ?? 0) + (tau * distance) / strideLength(gait)) % tau;
  const turn = Math.max(-1, Math.min(1, angleDelta(yaw, p.scholarYaw ?? yaw) / (dt * 6)));
  p.scholarTurn = (p.scholarTurn ?? 0) + (turn - (p.scholarTurn ?? 0)) * -Math.expm1(-dt * 10);
  p.scholarYaw = yaw;
  // Let the idle gesture fade as the first foot steps out of it.
  if (gait >= 0.4) p.scholarIdle = 0;
  else if (target <= 0.07) p.scholarIdle = (p.scholarIdle ?? 0) + dt;
}

// Matrices map sculpt-local joint geometry into character space. Build the
// complete pose once for an instance, including the eyes behind the frames.
const bones = Object.fromEntries(Object.keys(anchors).map((j) => [j, new T.Matrix4()]));
const position = new T.Vector3(),
  rotation = new T.Euler(0, 0, 0, 'YXZ'),
  orientation = new T.Quaternion(),
  size = new T.Vector3();
function setBone(j, parent, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const a = anchors[j],
    base = parent ? anchors[parent] : origin;
  position.set(a[0] - base[0] + dx, a[1] - base[1] + dy, a[2] - base[2] + dz);
  orientation.setFromEuler(rotation.set(rx, ry, rz, 'YXZ'));
  size.set(sx, sy, sz);
  bones[j].compose(position, orientation, size);
  if (parent) bones[j].premultiply(bones[parent]);
}
function beat(t, start, peak, hold, end) {
  return ease((t - start) / (peak - start)) * (1 - ease((t - hold) / (end - hold)));
}
function placeLeg(side, phase, gait, shift, hipDrop) {
  const j = 'leg' + side,
    shin = 'shin' + side,
    foot = 'foot' + side;
  const cycle = phase - Math.floor(phase),
    contact = 0.56 - 0.18 * gait;
  const halfTravel = strideLength(gait) * contact * 0.25;
  let z, lift, pitch;
  if (cycle < contact) {
    const t = cycle / contact;
    z = halfTravel * (1 - 2 * t);
    lift = 0;
    pitch = -0.18 * (1 - ease(t / 0.25)) + 0.4 * ease((t - 0.66) / 0.34);
  } else {
    const t = (cycle - contact) / (1 - contact);
    // Match the planted foot's backward velocity at lift-off and touchdown.
    z = halfTravel * (2 * (ease(t) - (t * (1 - t) * (1 - 2 * t) * (1 - contact)) / contact) - 1);
    lift = (0.1 + 0.071 * gait) * Math.sin(t * Math.PI) ** 1.45;
    pitch = 0.4 * (1 - ease(t)) - 0.18 * ease(t) + 0.4 * Math.sin(t * tau);
  }
  const blend = ease(gait / 0.35);
  z *= blend;
  lift *= blend;
  pitch *= blend;
  const hip = anchors[j],
    ankle = anchors[foot];
  const ankleY =
    (ankle[1] - 0.011) * Math.cos(pitch) + Math.sin(pitch) * (pitch < 0 ? -0.108 : 0.195) + 0.011 + lift;
  const hipY = hip[1] + hipDrop,
    down = hipY - ankleY,
    reach = Math.hypot(down, z);
  const thighLength = hip[1] - anchors[shin][1],
    calfLength = anchors[shin][1] - ankle[1];
  const stretch = Math.max(1, (reach + 0.0001) / (thighLength + calfLength));
  const thigh = thighLength * stretch,
    calf = calfLength * stretch;
  const cosine = Math.min(1, Math.max(-1, (reach * reach + thigh * thigh - calf * calf) / (2 * reach * thigh)));
  const thighAngle = -Math.atan2(z, down) - Math.acos(cosine);
  const kneeY = hipY - thigh * Math.cos(thighAngle),
    kneeZ = -thigh * Math.sin(thighAngle);
  const calfAngle = -Math.atan2(z - kneeZ, kneeY - ankleY);
  setBone(j, null, shift, hipDrop, 0, thighAngle, 0, 0, 1, stretch);
  setBone(shin, null, shift, kneeY - anchors[shin][1], kneeZ, calfAngle, 0, 0, 1, stretch);
  setBone(foot, null, 0, ankleY - ankle[1], z, pitch);
}
export function poseScholar(p, clock) {
  const gait = saturate(p.scholarGait ?? p.moving ?? 0),
    phase = p.scholarPhase ?? p.ph ?? 0;
  const time = clock + (p.seed ?? 0) * 7;
  const idle = 1 - ease(gait / 0.4),
    idleClock = p.scholarIdle ?? time;
  const age = clock - (p.scholarShotAt ?? -99);
  const wind = beat(age, 0, 0.048, 0.059, 0.115);
  const flick = beat(age, 0.034, 0.12, 0.158, 0.33);
  const focus = beat(age, -0.001, 0.07, 0.21, 0.51);
  const hurt = ease((p.hit ?? 0) * 2.4);
  const interrupt = age >= 0 && age < 0.12;
  const quiet = idle * (interrupt ? 1 - ease(age / 0.12) : ease((age - 0.45) / 0.6)) * (1 - hurt);
  const t = (interrupt ? (p.scholarInterruptedIdle ?? idleClock) + age : idleClock) % 10.4;
  const read = quiet * beat(t, 0.85, 1.64, 3.08, 3.76);
  const look = quiet * beat(t, 4.3, 4.83, 5.6, 6.33);
  const think = quiet * beat(t, 6.94, 7.68, 8.62, 9.56);
  const turn = p.scholarTurn ?? 0;
  const aim = focus * Math.max(-1, Math.min(1, angleDelta(p.scholarAim ?? p.yaw ?? 0, p.yaw ?? 0)));
  const step = Math.sin(phase),
    twist = Math.cos(phase) * gait;
  const rise = Math.sin(phase * 2 - 0.82);
  const shift = -step * 0.022 * gait,
    hipDrop = (-0.053 + 0.028 * rise) * gait;
  const breath = 0.009 * Math.sin(time * 2.15);
  placeLeg('L', phase / tau, gait, shift * 0.18, hipDrop);
  placeLeg('R', phase / tau + 0.5, gait, shift * 0.18, hipDrop);
  setBone(
    'torso',
    null,
    shift,
    hipDrop + breath,
    0,
    0.13 * gait + 0.09 * read - 0.12 * hurt,
    -0.115 * twist + 0.15 * aim - 0.13 * read,
    step * 0.049 * gait - 0.085 * turn + 0.036 * think,
  );
  setBone(
    'skirt',
    null,
    shift,
    hipDrop,
    0,
    0.046 * gait + 0.035 * gait * Math.cos(phase * 2),
    0.13 * twist,
    gait * 0.055 * Math.sin(phase - 0.5) - 0.045 * turn,
  );
  setBone(
    'head',
    'torso',
    0,
    -0.01 * rise * gait,
    0,
    -0.1 - 0.093 * gait + 0.34 * read - 0.18 * think - 0.12 * hurt,
    0.065 * twist + 0.27 * turn - 0.34 * read + 0.42 * look + 0.27 * aim,
    0.055 * step * gait + 0.12 * think - 0.055 * look,
  );
  setBone(
    'hair',
    'head',
    0,
    0,
    0,
    -0.035 * Math.cos(time * 2) - (0.065 + 0.11 * Math.cos(phase * 2 - 0.65)) * gait + 0.07 * read + 0.085 * hurt,
    -0.14 * turn + 0.065 * twist,
    -0.085 * Math.sin(phase - 0.5) * gait - 0.04 * think,
  );
  for (const side of ['L', 'R']) {
    const left = side === 'L',
      s = left ? -1 : 1;
    const swing = twist * (left ? 0.48 : -0.56) * (1 - 0.6 * focus);
    const arm = 'arm' + side,
      elbow = 'elbow' + side,
      hand = 'hand' + side;
    setBone(
      arm,
      'torso',
      0,
      0,
      0,
      swing + (left ? -0.31 * read : -0.38 * think - 0.82 * flick + 0.12 * wind) - 0.11 * hurt,
      left ? 0.27 * read : 0.5 * aim - 0.16 * flick,
      s * (0.07 + 0.075 * gait) + (left ? 0.16 * read : 0.04 * think),
    );
    setBone(
      elbow,
      arm,
      0,
      0,
      0,
      -0.1 -
        (left ? 0.31 : 0.36) * gait +
        Math.min(0, swing) * 0.27 -
        (left ? 1.02 * read + 0.15 * think : 0.87 * think + 0.48 * wind + 0.13 * read),
    );
    setBone(
      hand,
      elbow,
      0,
      0,
      0,
      left ? 0.15 * read : 1.31 * flick - 0.36 * wind + 0.11 * Math.sin(time * 4) * think,
      left ? 0.22 * read : -0.15 * think - 0.41 * flick,
      s * 0.06 * gait * step + (left ? 0.16 * read : 0.19 * think - 0.19 * flick),
    );
  }
  const opened = beat(t, 1.14, 1.86, 2.96, 3.48) * quiet;
  const leaf = opened * (0.28 + 0.84 * beat(t, 1.94, 2.61, 3.04, 3.45));
  for (const [joint, angle] of [
    ['cover', -2.0 * opened],
    ['page', -leaf],
  ]) {
    position.copy(hingeInHand);
    bones[joint]
      .compose(position, orientation.setFromAxisAngle(spine, angle), size.set(1, 1, 1))
      .premultiply(bones.handL);
  }
  const blink = time % 4.37;
  const close = Math.max(
    beat(blink, 0.22, 0.276, 0.295, 0.412),
    0.88 * beat(blink, 0.55, 0.6, 0.61, 0.7) * Number(Math.floor(time / 4.37) % 3 === 1),
  );
  const eyeHeight = (1 - 0.94 * close) * (1 - 0.2 * focus + 0.13 * hurt - 0.12 * read);
  const quickLook = beat(t, 4.21, 4.38, 5.55, 6.02) * quiet;
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1,
      eye = 'eye' + side;
    setBone(eye, 'head', 0, 0, 0, 0, 0, 0, 1, eyeHeight);
    setBone(
      'gaze' + side,
      eye,
      0.026 * quickLook - 0.021 * read + 0.026 * aim + 0.015 * turn,
      -0.03 * read + 0.018 * think,
      0,
    );
    setBone(
      'brow' + side,
      'head',
      0,
      0.024 * hurt + 0.023 * think * (s === 1 ? 1 : 0.4) - 0.021 * focus,
      0,
      0,
      0,
      s * (0.19 * focus - 0.085 * hurt) + 0.11 * think,
    );
  }
  setBone(
    'mouth',
    'head',
    0,
    0.009 * think - 0.01 * hurt,
    0.001,
    0,
    0,
    0.13 * think,
    1 + 0.23 * think - 0.18 * hurt,
    0.9 - 0.42 * focus + 0.78 * hurt,
  );
  setBone('mouthOpen', 'head', 0, -0.009 * hurt, -0.016 * (1 - hurt), 0, 0, 0, 0.01 + 0.99 * hurt, 0.01 + hurt, 1);
  return bones;
}

export function scholarToon(color) {
  const mat = new T.MeshToonMaterial({ color });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float sun=dot(normalize(normal),normalize(mat3(viewMatrix)*vec3(-.55,.84,.36)));
      vec3 base=diffuseColor.rgb;
      vec3 shade=mix(base*vec3(.65,.43,.55),vec3(.055,.016,.039),.045);
      vec3 halfTone=base*vec3(.88,.73,.78);
      outgoingLight=mix(shade,halfTone,smoothstep(-.13,-.07,sun));
      outgoingLight=mix(outgoingLight,base,smoothstep(.39,.44,sun));
      outgoingLight=mix(outgoingLight,base*vec3(1.09,1.045,1.015)+vec3(.004,.002,.003),smoothstep(.81,.86,sun));
      #include <opaque_fragment>`,
    );
  };
  return mat;
}

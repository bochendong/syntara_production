import * as T from './vendor/three.module.js';
import { scholarToon, poseScholar } from './scholar.js';
export async function buildScholar(faceURL) {
  const V = (x, y, z) => new T.Vector3(x, y, z);
  function group(parent) {
    const g = new T.Group();
    parent.add(g);
    return g;
  }
  const character = new T.Group(),
    head = group(character),
    hair = group(head);
  head.position.y = 1.716;
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
  function ell(parent, color, pos, scale) {
    const m = mesh(parent, new T.SphereGeometry(1, 28, 20), color);
    m.position.set(...pos);
    m.scale.set(...scale);
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
  // Horizontal sections define chin, cheekbones, temples and forehead.
  // The front flattens near the eyes and projects continuously into the nose.
  const sections = [
    [0, 0.012, 0.026, 0.06],
    [0.025, 0.063, 0.063, 0.049],
    [0.067, 0.111, 0.099, 0.037],
    [0.124, 0.151, 0.126, 0.022],
    [0.19, 0.173, 0.151, 0.009],
    [0.255, 0.179, 0.16, 0],
    [0.323, 0.17, 0.149, -0.013],
    [0.39, 0.132, 0.119, -0.018],
    [0.431, 0.062, 0.071, -0.022],
    [0.447, 0.003, 0.005, -0.022],
  ];
  const profile = new T.CatmullRomCurve3(sections.map(([y, x, z]) => V(x, y, z)));
  function surface(u, v) {
    const row = profile.getPoint(v),
      angle = (u - 0.5) * Math.PI * 2,
      c = Math.cos(angle),
      x = row.x * Math.sin(angle);
    const idx = v * (sections.length - 1),
      k = Math.min(sections.length - 2, Math.floor(idx));
    const cz = T.MathUtils.lerp(sections[k][3], sections[k + 1][3], idx - k);
    const nose =
      0.037 * Math.exp(-((x / 0.024) ** 2) - ((row.y - 0.125) / 0.037) ** 2) +
      0.013 * Math.exp(-((x / 0.014) ** 2) - ((row.y - 0.17) / 0.05) ** 2);
    return [
      x,
      row.y + 0.032 * (1 - T.MathUtils.smoothstep(row.y, 0, 0.21)),
      cz + row.z * Math.sign(c) * Math.abs(c) ** 0.68 + Math.max(0, c) * nose,
    ];
  }

  const faceTexture = await new T.TextureLoader().loadAsync(faceURL);
  faceTexture.colorSpace = T.SRGBColorSpace;
  const face = grid(head, new T.MeshBasicMaterial({ map: faceTexture }), 80, 52, surface);
  const uv = face.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [x, y] = surface(uv.getX(i), uv.getY(i));
    const front = Math.cos((uv.getX(i) - 0.5) * 2 * Math.PI);
    uv.setXY(i, front > 0 ? 0.5 + x / 0.396 : 0.01, (y - 0.022) / 0.342);
  }
  for (const s of [-1, 1]) {
    ell(head, 0xffd9bf, [s * 0.167, 0.16, -0.004], [0.028, 0.047, 0.025]);
    const ring = Array.from({ length: 48 }, (_, i) => {
      const a = (i * Math.PI) / 24,
        x = 0.08 + 0.068 * Math.cos(a);
      return [s * x, 0.177 + 0.036 * Math.sin(a), 0.204 - 0.39 * x];
    });
    tube(head, 0x713c52, ring, 0.0026, true);
    tube(
      head,
      0xb37e58,
      [
        [s * 0.151, 0.18, 0.145],
        [s * 0.176, 0.201, 0.085],
        [s * 0.181, 0.193, 0.008],
        [s * 0.177, 0.17, -0.02],
      ],
      0.0035,
    );
  }
  tube(
    head,
    0x8b5860,
    [
      [-0.015, 0.181, 0.201],
      [0, 0.19, 0.207],
      [0.015, 0.181, 0.201],
    ],
    0.0036,
  );
  // Tapered ribbons with a convex cross-section and an under-surface.
  function lock(parent, points, widths, color, angle = 0) {
    const curve = new T.CatmullRomCurve3(points.map((p) => V(...p)));
    function sample(t) {
      const idx = t * (widths.length - 1),
        k = Math.min(widths.length - 2, Math.floor(idx));
      return [curve.getPoint(t), T.MathUtils.lerp(widths[k], widths[k + 1], idx - k)];
    }
    const geom = grid(parent, color, 12, 24, (u, v) => {
      const [p, w] = sample(v),
        phi = u * Math.PI * 2;
      const dx = w * Math.cos(phi),
        dz = w * 0.24 * Math.sin(phi);
      return [
        p.x + dx * Math.cos(angle) + dz * Math.sin(angle),
        p.y,
        p.z - dx * Math.sin(angle) + dz * Math.cos(angle),
      ];
    });
    geom.userData.strand = true;
    geom.material.side = T.DoubleSide;
    return geom;
  }
  const dark = 0x302535,
    mid = 0x513c55,
    gloss = 0x58445d;
  for (const color of [dark, mid, gloss]) {
    colors.set(
      color,
      new T.MeshPhongMaterial({ color, specular: 0x3d2d49, shininess: 30, side: T.DoubleSide }),
    );
  }
  grid(head, dark, 72, 30, (u, v) => {
    const a = u * Math.PI * 2,
      bottom = 2.09 - 0.86 * Math.cos(a),
      p = bottom * (1 - v) + 0.001;
    return [
      0.197 * Math.sin(p) * Math.sin(a),
      0.227 + 0.237 * Math.cos(p),
      -0.015 + 0.182 * Math.sin(p) * Math.cos(a),
    ];
  });
  // Overlapping bands follow the crown from the off-centre part into the gathered hair.
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const top = grid(head, i % 3 === 0 ? mid : dark, 8, 24, (u, v) => {
      const phi = 0.07 + v * (1.02 + 0.2 * (1 - Math.cos(a)));
      const angle =
        a + 0.59 * (1 - v) ** 1.3 + (u - 0.5) * (0.56 * Math.sin(Math.PI * v) ** 0.52 + 0.006);
      const bulge = 0.003 + 0.008 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
      return [
        (0.197 + bulge) * Math.sin(phi) * Math.sin(angle),
        0.227 + (0.237 + bulge) * Math.cos(phi),
        -0.015 + (0.182 + bulge) * Math.sin(phi) * Math.cos(angle),
      ];
    });
    top.userData.strand = true;
  }
  for (let i = 0; i < 13; i++) {
    const a = 1.34 + (i * (2 * Math.PI - 2.68)) / 12,
      s = Math.sin(a),
      c = Math.cos(a);
    const end = -0.4 + 0.115 * Math.sin(1.67 * i);
    lock(
      hair,
      [
        [s * 0.09, 0.423, c * 0.08 - 0.02],
        [s * 0.174, 0.31, c * 0.162 - 0.02],
        [s * 0.188, 0.115, c * 0.18 - 0.034],
        [s * 0.199 + 0.044 * Math.sin(i * 0.5), -0.105, c * 0.219 - 0.091],
        [
          s * (0.229 + 0.049 * Math.sin(i)) + 0.052 * Math.sin(i * 0.9),
          end + 0.11,
          c * 0.227 - 0.131,
        ],
        [s * 0.238 + 0.079 * Math.sin(i * 0.9), end, c * 0.191 - 0.12],
      ],
      [0.015, 0.064, 0.071, 0.058, 0.035, 0.0008],
      i % 3 === 1 ? mid : dark,
      a,
    );
  }
  // Temple sections gathered at the nape, with loose, curved ends below the knot.
  for (const sign of [-1, 1]) {
    for (let layer = 0; layer < 3; layer++) {
      const h = layer * 0.027;
      lock(
        hair,
        [
          [sign * 0.102, 0.418 - h, 0.062],
          [sign * 0.18, 0.355 - h, 0.049],
          [sign * 0.192, 0.303 - h, -0.04],
          [sign * 0.144, 0.29 - h, -0.153],
          [sign * 0.041, 0.301 - h * 0.45, -0.203],
        ],
        [0.012, 0.033, 0.043, 0.032, 0.009],
        layer === 1 ? mid : dark,
        sign * 1.38,
      );
    }
    lock(
      hair,
      [
        [sign * 0.045, 0.3, -0.201],
        [sign * 0.091, 0.167, -0.217],
        [sign * 0.132, 0.002, -0.226],
        [sign * 0.157, -0.161, -0.216],
        [sign * 0.116, -0.249, -0.239],
      ],
      [0.03, 0.062, 0.054, 0.037, 0.001],
      mid,
      sign * 2.55,
    );
  }
  for (const [x, end, y, w] of [
    [-0.035, -0.18, 0.19, 0.057],
    [-0.014, -0.141, 0.235, 0.058],
    [0.003, -0.087, 0.262, 0.052],
    [0.018, -0.032, 0.277, 0.044],
    [0.028, 0.075, 0.278, 0.05],
    [0.035, 0.145, 0.235, 0.059],
  ]) {
    lock(
      head,
      [
        [x, 0.446, 0.041],
        [x * 0.7 + end * 0.33, 0.408, 0.115],
        [end * 0.78, 0.333, 0.157],
        [end, y, 0.166 - Math.abs(end) * 0.33],
      ],
      [0.009, w * 0.7, w, 0.001],
      end < 0 ? mid : dark,
      end * 2,
    );
  }
  // Sweep the fringe diagonally across the forehead and split its tip.
  for (const [offset, depth] of [
    [0, 0],
    [0.048, -0.009],
  ]) {
    lock(
      head,
      [
        [0.046 + offset, 0.433, 0.065],
        [0.037 + offset, 0.395, 0.128],
        [-0.018 + offset, 0.336, 0.172],
        [-0.063 + offset, 0.283, 0.178],
        [-0.098 + offset, 0.237 + offset * 0.4, 0.16],
      ],
      [0.004, 0.025, 0.034, 0.024, 0.001],
      mid,
      -0.28,
    );
    lock(
      head,
      [
        [0.043 + offset, 0.422, 0.092 + depth],
        [0.019 + offset, 0.375, 0.167 + depth],
        [-0.034 + offset, 0.318, 0.186 + depth],
      ],
      [0.001, 0.005, 0.001],
      gloss,
      -0.25,
    );
  }
  for (const s of [-1, 1]) {
    if (s < 0) {
      // One temple is tucked above the ear; a single fine wisp frames the cheek.
      lock(
        hair,
        [
          [-0.095, 0.394, 0.108],
          [-0.153, 0.325, 0.125],
          [-0.181, 0.259, 0.091],
          [-0.182, 0.241, 0.016],
          [-0.16, 0.208, -0.064],
        ],
        [0.018, 0.039, 0.026, 0.018, 0.004],
        mid,
        -0.86,
      );
      lock(
        hair,
        [
          [-0.141, 0.312, 0.136],
          [-0.158, 0.244, 0.14],
          [-0.151, 0.169, 0.139],
          [-0.122, 0.112, 0.134],
          [-0.129, 0.092, 0.132],
        ],
        [0.015, 0.021, 0.015, 0.009, 0.0006],
        dark,
        -0.38,
      );
      ell(head, 0xf4cab7, [-0.179, 0.187, 0.054], [0.025, 0.044, 0.025]);
      ell(head, 0xe5ac9e, [-0.195, 0.19, 0.064], [0.009, 0.028, 0.015]);
      continue;
    }
    lock(
      hair,
      [
        [s * 0.11, 0.399, 0.09],
        [s * 0.158, 0.291, 0.115],
        [s * 0.172, 0.158, 0.103],
        [0.134, 0.067, 0.146],
        [0.13, -0.01, 0.142],
        [0.163, -0.065, 0.152],
        [0.179, -0.095, 0.165],
      ],
      [0.02, 0.043, 0.038, 0.027, 0.02, 0.012, 0.001],
      mid,
      s * 0.58,
    );
    lock(
      hair,
      [
        [s * 0.147, 0.332, 0.133],
        [s * 0.166, 0.245, 0.135],
        [s * 0.178, 0.132, 0.128],
      ],
      [0.001, 0.008, 0.001],
      gloss,
      s * 0.6,
    );
  }
  for (const s of [-1, 1]) {
    const wing = ell(hair, 0x873447, [-0.098 + s * 0.063, 0.354, -0.159], [0.072, 0.032, 0.022]);
    wing.rotation.z = s * 0.6;
  }
  ell(hair, 0xd4aa68, [-0.098, 0.354, -0.176], [0.013, 0.015, 0.013]);
  tube(
    head,
    0xd0a35c,
    [
      [0.113, 0.307, 0.183],
      [0.146, 0.321, 0.166],
      [0.168, 0.337, 0.139],
    ],
    0.008,
  );
  for (const sign of [-1, 1]) {
    lock(
      hair,
      [
        [-0.098 + sign * 0.021, 0.354, -0.176],
        [-0.098 + sign * 0.06, 0.27, -0.195],
        [-0.098 + sign * 0.081, 0.19, -0.217],
        [-0.098 + sign * 0.095, 0.133, -0.218],
      ],
      [0.012, 0.019, 0.017, 0.003],
      0x873447,
      sign * 0.35,
    );
  }
  tube(
    head,
    0x77374d,
    [
      [0.113, 0.307, 0.188],
      [0.146, 0.321, 0.171],
      [0.168, 0.337, 0.144],
    ],
    0.0053,
  );
  ell(head, 0xf3c882, [0.158, 0.325, 0.128], [0.006, 0.007, 0.005]);
  const skirtColor = 0x39364e;
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'L' : 'R';
    const thigh = group(character),
      shin = group(character),
      shoe = group(character);
    for (const [piece, joint] of [
      [thigh, 'leg'],
      [shin, 'shin'],
      [shoe, 'foot'],
    ]) {
      piece.position.x = sign * 0.124;
      piece.userData.joint = joint + side;
    }
    sectionsMesh(thigh, 0xf8dac9, [
      [0.467, 0.052, 0.053],
      [0.525, 0.058, 0.059],
      [0.72, 0.073, 0.071],
      [0.865, 0.072, 0.075],
    ]);
    ell(shin, 0xf8dac9, [0, 0.48, 0], [0.055, 0.045, 0.058]);
    sectionsMesh(shin, 0xf8dac9, [
      [0.165, 0.034, 0.039],
      [0.261, 0.038, 0.047],
      [0.368, 0.054, 0.058],
      [0.454, 0.055, 0.057],
      [0.484, 0.053, 0.055],
    ]);
    sectionsMesh(shin, 0xeee4d5, [
      [0.13, 0.035, 0.043],
      [0.23, 0.04, 0.047],
      [0.322, 0.052, 0.056],
      [0.35, 0.055, 0.058],
    ]);
    sectionsMesh(shin, 0xd7cad0, [
      [0.329, 0.054, 0.058],
      [0.335, 0.055, 0.059],
    ]);
    ell(shoe, 0x412e3c, [0, 0.061, 0.022], [0.06, 0.059, 0.113]);
    ell(shoe, 0x332935, [0, 0.025, 0.025], [0.062, 0.022, 0.119]);
    const strap = ell(shoe, 0x574154, [0, 0.094, 0.044], [0.058, 0.015, 0.029]);
    strap.rotation.x = -0.3;
    ell(shoe, 0xc29a69, [sign * 0.05, 0.096, 0.046], [0.012, 0.008, 0.011]);
  }
  // Cut the trim from the same pleated surface so the stripe follows every fold.
  function pleatedBand(bottom, top, color) {
    grid(character, color, 72, 4, (u, v) => {
      const y = T.MathUtils.lerp(bottom, top, v),
        t = (y - 0.65) / 0.56,
        a = u * 2 * Math.PI;
      const fold = 1 - (1 - t) * 0.13 * Math.pow(1 - Math.abs(((u * 12) % 1) * 2 - 1), 2);
      return [
        (0.292 - 0.092 * t) * fold * Math.sin(a),
        y,
        (0.216 - 0.062 * t) * fold * Math.cos(a),
      ];
    });
  }
  pleatedBand(0.65, 0.69, skirtColor);
  pleatedBand(0.69, 0.704, 0xd2bdad);
  pleatedBand(0.704, 1.21, skirtColor);
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

  function sectionsMesh(parent, color, rows) {
    const curve = new T.CatmullRomCurve3(rows.map(([y, x, z]) => V(x, y, z)));
    return grid(parent, color, 48, 32, (u, v) => {
      const p = curve.getPoint(v),
        a = u * Math.PI * 2;
      return [p.x * Math.sin(a), p.y, p.z * Math.cos(a)];
    });
  }
  const ivory = 0xf5e8d4,
    navy = 0x34314d,
    wine = 0x873447,
    skin = 0xf8dac9;
  sectionsMesh(character, skin, [
    [1.61, 0.072, 0.062],
    [1.69, 0.064, 0.062],
    [1.78, 0.059, 0.062],
    [1.82, 0.064, 0.069],
  ]);
  // Cut the blouse, sailor yoke and neckline from one ring profile. Their borders
  // meet exactly, including where the collar crosses from shoulder to back.
  const shirt = [
    [1.163, 0.194, 0.149],
    [1.203, 0.201, 0.15],
    [1.31, 0.179, 0.134],
    [1.436, 0.212, 0.165],
    [1.53, 0.223, 0.157],
    [1.576, 0.2, 0.135],
    [1.623, 0.145, 0.099],
    [1.66, 0.069, 0.065],
  ];
  function blousePoint(a, y) {
    let k = 0;
    while (k < shirt.length - 2 && shirt[k + 1][0] < y) k++;
    const first = shirt[k],
      next = shirt[k + 1],
      t = T.MathUtils.clamp((y - first[0]) / (next[0] - first[0]), 0, 1);
    const fold = 1 + 0.024 * Math.sin(7 * a + 3 * y) * Math.exp(-((y - 1.245) ** 2) / 0.009);
    return [
      T.MathUtils.lerp(first[1], next[1], t) * Math.sin(a) * fold,
      y,
      T.MathUtils.lerp(first[2], next[2], t) * Math.cos(a) * fold,
    ];
  }
  function collarBounds(a) {
    const cos = Math.cos(a),
      front = Math.max(cos, 0);
    const hem = 1.453 + 0.083 * (1 - Math.abs(cos)) - 0.065 * front ** 4;
    const inner = 1.584 - 0.183 * front ** 14 + 0.044 * (1 - Math.abs(cos));
    return [hem, inner];
  }
  function shirtBand(color, limits) {
    grid(character, color, 96, 18, (u, v) => {
      const a = u * 2 * Math.PI,
        [hem, inner] = collarBounds(a),
        [bottom, top] = limits(hem, inner);
      return blousePoint(a, T.MathUtils.lerp(bottom, top, v));
    });
  }
  shirtBand(ivory, (h) => [1.163, h]);
  for (const [start, end, color] of [
    [0, 0.07, navy],
    [0.07, 0.104, ivory],
    [0.104, 0.153, navy],
    [0.153, 0.184, ivory],
    [0.184, 1, navy],
  ])
    shirtBand(color, (h, n) => [T.MathUtils.lerp(h, n, start), T.MathUtils.lerp(h, n, end)]);
  shirtBand(ivory, (_, inner) => [inner, Math.max(inner, 1.537)]);
  shirtBand(skin, (_, inner) => [Math.max(inner, 1.537), 1.66]);
  for (const sign of [-1, 1]) {
    const loop = ell(character, wine, [sign * 0.035, 1.394, 0.18], [0.041, 0.019, 0.015]);
    loop.rotation.z = sign * 0.44;
    lock(
      character,
      [
        [sign * 0.005, 1.392, 0.182],
        [sign * 0.017, 1.344, 0.172],
        [sign * 0.037, 1.282, 0.163],
        [sign * 0.045, 1.243, 0.157],
      ],
      [0.008, 0.013, 0.014, 0.009],
      wine,
    );
  }
  ell(character, wine, [0, 1.393, 0.19], [0.014, 0.018, 0.013]);
  sectionsMesh(character, navy, [
    [1.168, 0.204, 0.155],
    [1.211, 0.202, 0.152],
  ]);
  // Sleeves, closed cuffs, palms and individual bent digits are modelled in the writing pose.
  const book = group(character);
  book.userData.joint = 'handL';
  book.position.set(0.021, 1.219, 0.277);
  book.rotation.set(-2.26, 0.07, -0.1);
  for (const sign of [-1, 1]) {
    const leaf = group(book);
    leaf.rotation.y = -sign * 0.47;
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
  function swept(parent, color, rows) {
    const curve = new T.CatmullRomCurve3(rows.map(([x, y, z]) => V(x, y, z)));
    return grid(parent, color, 18, 24, (u, v) => {
      const p = curve.getPoint(v),
        dir = curve.getTangent(v),
        a = V(0, 0, 1).cross(dir).normalize(),
        b = dir.clone().cross(a);
      const f = v * (rows.length - 1),
        k = Math.min(rows.length - 2, Math.floor(f)),
        r = T.MathUtils.lerp(rows[k][3], rows[k + 1][3], f - k);
      return p
        .addScaledVector(a, r * Math.cos(u * 2 * Math.PI))
        .addScaledVector(b, r * Math.sin(u * 2 * Math.PI))
        .toArray();
    });
  }
  const hand = group(character);
  hand.userData.joint = 'handR';
  hand.position.y = 0.013;
  for (const sign of [-1, 1]) {
    const writing = sign < 0,
      side = writing ? 'R' : 'L';
    const upper = group(character),
      fore = group(character);
    upper.userData.joint = 'arm' + side;
    fore.userData.joint = 'elbow' + side;
    const elbow = [sign * 0.257, 1.226, 0.038],
      wrist = writing ? [-0.137, 1.35, 0.274] : [0.156, 1.216, 0.264];
    swept(upper, ivory, [
      [sign * 0.18, 1.554, 0.006, 0.047],
      [sign * 0.207, 1.535, 0.009, 0.071],
      [sign * 0.247, 1.473, 0.012, 0.071],
      [sign * 0.245, 1.355, 0.023, 0.056],
      [...elbow, 0.06],
    ]);
    ell(upper, ivory, elbow, [0.059, 0.064, 0.061]);
    const path = [
      elbow,
      [sign * 0.234, 1.239, 0.111],
      [sign * 0.193, writing ? 1.292 : 1.22, 0.2],
      wrist,
    ];
    swept(
      fore,
      ivory,
      path.map((p, i) => [...p, [0.059, 0.065, 0.054, 0.041][i]]),
    );
    const a = V(...path[2]),
      b = V(...wrist);
    for (const [from, to, c] of [
      [0.55, 0.66, navy],
      [0.66, 0.71, ivory],
      [0.71, 0.8, navy],
      [0.8, 0.85, ivory],
      [0.85, 1.03, navy],
    ]) {
      limb(
        fore,
        c,
        a.clone().lerp(b, from).toArray(),
        a.clone().lerp(b, to).toArray(),
        0.044,
        0.043,
      );
    }
  }
  const support = group(character);
  support.userData.joint = 'handL';
  ell(support, skin, [0.138, 1.219, 0.283], [0.041, 0.026, 0.038]);
  const coverGrip = group(book);
  coverGrip.rotation.y = -0.47;
  for (let i = 0; i < 4; i++) {
    const y = 0.056 - i * 0.021;
    swept(coverGrip, skin, [
      [0.199, y + 0.008, 0.01, 0.009],
      [0.196, y, -0.006, 0.01],
      [0.172, y - 0.004, -0.014, 0.009],
      [0.134 + i * 0.009, y - 0.012, -0.014, 0.007],
      [0.12 + i * 0.009, y - 0.012, -0.011, 0.0015],
    ]);
  }
  swept(support, skin, [
    [0.153, 1.23, 0.273, 0.012],
    [0.151, 1.244, 0.288, 0.013],
    [0.135, 1.254, 0.294, 0.009],
    [0.124, 1.254, 0.295, 0.002],
  ]);
  const palm = ell(hand, skin, [-0.117, 1.351, 0.283], [0.043, 0.025, 0.031]);
  palm.rotation.z = 0.35;
  const point = [-0.033, 1.301, 0.311],
    wood = [-0.042, 1.315, 0.308],
    end = [-0.159, 1.483, 0.269];
  limb(hand, 0x423344, point, wood, 0.001, 0.005);
  limb(hand, 0xdcb683, wood, [-0.05, 1.326, 0.305], 0.005, 0.008);
  limb(hand, 0xe2ad4f, [-0.05, 1.326, 0.305], end, 0.008, 0.008);
  limb(hand, 0xbf9f80, end, [-0.163, 1.489, 0.268], 0.0085, 0.0085);
  ell(hand, 0xbe837e, [-0.164, 1.49, 0.268], [0.007, 0.008, 0.007]);
  for (const points of [
    [
      [-0.13, 1.356, 0.293, 0.011],
      [-0.105, 1.379, 0.297, 0.011],
      [-0.089, 1.382, 0.296, 0.009],
      [-0.072, 1.358, 0.296, 0.006],
    ],
    [
      [-0.124, 1.344, 0.3, 0.01],
      [-0.103, 1.352, 0.31, 0.009],
      [-0.085, 1.349, 0.307, 0.008],
      [-0.073, 1.351, 0.301, 0.005],
    ],
    [
      [-0.129, 1.34, 0.301, 0.009],
      [-0.111, 1.339, 0.315, 0.008],
      [-0.096, 1.329, 0.314, 0.007],
      [-0.102, 1.326, 0.301, 0.004],
    ],
    [
      [-0.136, 1.337, 0.296, 0.008],
      [-0.123, 1.33, 0.309, 0.007],
      [-0.116, 1.321, 0.308, 0.006],
      [-0.122, 1.32, 0.299, 0.003],
    ],
    [
      [-0.13, 1.359, 0.273, 0.013],
      [-0.111, 1.361, 0.271, 0.012],
      [-0.091, 1.356, 0.282, 0.011],
      [-0.076, 1.355, 0.29, 0.006],
    ],
  ])
    swept(hand, skin, points);
  // Batch fixed colours together while keeping each articulated joint and skin dye independent.
  head.userData.joint = 'head';
  hair.userData.joint = 'hair';
  character.updateMatrixWorld(true);
  const dye = new Map([
    [dark, 'hair'],
    [mid, 'hairMid'],
    [gloss, 'hairShine'],
    [ivory, 'top'],
    [navy, 'pants'],
    [skirtColor, 'pants'],
    [wine, 'accent'],
  ]);
  const groups = new Map();
  character.traverse((node) => {
    if (!node.isMesh) return;
    let ancestor = node;
    while (ancestor.parent && !ancestor.userData.joint) ancestor = ancestor.parent;
    const joint = ancestor.userData.joint || 'torso';
    const isFace = node === face;
    const color = node.material.color,
      key = dye.get(color.getHex()) || 'fixed';
    const id = 'scholar_' + joint + '_' + (isFace ? 'face' : key);
    if (!groups.has(id))
      groups.set(id, { joint, key, isFace, p: [], n: [], uv: [], c: [], indices: [] });
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
      if (node.userData.strand) {
        const stripe = Math.max(0, Math.cos((u - 0.23) * Math.PI * 2));
        const band = Math.exp(-((v - 0.36 - 0.07 * Math.cos(2 * Math.PI * u)) ** 2) / 0.007);
        const edge = Math.sin(Math.PI * u);
        vertexColor.multiplyScalar(0.74 + 0.31 * stripe + 0.14 * edge + 1.05 * stripe * band);
      }
      batch.c.push(vertexColor.r, vertexColor.g, vertexColor.b);
    }
  });
  const geometries = {},
    materials = {},
    entries = [];
  const cloth = scholarToon(0xffffff);
  cloth.vertexColors = true;
  cloth.side = T.DoubleSide;
  const complexion = new T.MeshBasicMaterial({ map: faceTexture });
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
    materials[id] = b.isFace ? complexion : cloth;
    entries.push([id, b.joint, b.key]);
  }
  function parts(skin = {}) {
    const palette = {
      hair: dark,
      hairMid: mid,
      hairShine: gloss,
      pants: navy,
      top: ivory,
      accent: wine,
      fixed: 0xffffff,
    };
    // The arena's default palette predates the approved character sheet.
    if (skin.hair != null && skin.hair !== 0x1e1a2e) {
      palette.hair = skin.hair;
      palette.hairMid = new T.Color(skin.hair).lerp(new T.Color(0xb1859b), 0.22).getHex();
      palette.hairShine = new T.Color(skin.hair).lerp(new T.Color(0xb1859b), 0.36).getHex();
    }
    for (const [key, original] of [
      ['top', 0xfaf8f2],
      ['pants', 0x2c3a6e],
      ['accent', 0xe2453a],
    ])
      if (skin[key] != null && skin[key] !== original) palette[key] = skin[key];
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
    mat.color.set(color);
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
pivot('head', 'torso', 0, 1.716, 0);
pivot('hair', 'head', 0, 2.04, -0.12);
for (const s of [-1, 1]) {
  const j = s < 0 ? 'L' : 'R';
  pivot('leg' + j, null, s * 0.151 * 0.82, 0.463 * 1.86, 0);
  pivot('shin' + j, null, s * 0.151 * 0.82, 0.26 * 1.86, 0);
  pivot('foot' + j, null, s * 0.151 * 0.82, 0.095 * 1.86, 0);
  pivot('arm' + j, 'torso', -s * 0.201, 1.55, 0.008);
  pivot('elbow' + j, 'arm' + j, -s * 0.257, 1.226, 0.038);
  pivot(
    'hand' + j,
    'elbow' + j,
    -s * (j === 'R' ? 0.137 : 0.156),
    j === 'R' ? 1.337 : 1.216,
    j === 'R' ? 0.274 : 0.264,
  );
}
pivot('page', 'handL', 0.021, 1.219, 0.277);
const spineAxis = new T.Vector3(0, 1, 0).applyEuler(new T.Euler(-2.26, 0.07, -0.1));
const pos = new T.Vector3(),
  q = new T.Quaternion(),
  scale = new T.Vector3(),
  neutral = new T.Quaternion(),
  identity = new T.Quaternion();
const legStretch = new T.Matrix4().makeScale(0.82, 1.86, 1);
const inverseLegStretch = legStretch.clone().invert();
const headAngles = new T.Euler();
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
      if (j === 'head')
        idle.setFromEuler(headAngles.set(0.17 - 0.21 * look, -0.08 + 0.24 * look, -0.075));
      if (j === 'hair') idle.setFromAxisAngle(axisZ, 0.016 * Math.sin(time * 2.4));
      if (j === 'handR') idle.setFromAxisAngle(axisZ, (1 - look) * 0.034 * Math.sin(time * 12));
      q.slerp(idle, 1 - activity);
    }
    m.compose(pos, q, scale);
    if (parent) m.premultiply(result[parent]);
  }
  return result;
}

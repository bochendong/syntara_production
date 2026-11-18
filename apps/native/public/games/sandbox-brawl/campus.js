import * as THREE from './vendor/three.module.js';

// Coordinates below are feet on the approved 1536 × 1024 painting. The same
// footprints drive physics, navigation and the foreground depth mesh.
const WIDTH = 1536,
  HEIGHT = 1024;
const SX = 18.25,
  SZ = 13.4,
  OX = 768,
  OZ = 510;
export const campusElevation = Math.asin(SZ / SX);
const SY = SX * Math.cos(campusElevation);
const worldX = (px) => (px - OX) / SX;
const worldZ = (py) => (py - OZ) / SZ;

export const taskSites = [
  [-6.5, -11],
  [19, -22.5],
  [-20, 20],
  [34.5, 25.5],
  [0, 0],
  [-15, 0],
  [15, 0],
].map(([x, z]) => ({ x, z }));
export const portalSites = [
  [-36, -26],
  [28.5, -19],
  [36, 27.5],
  [-36, 29],
];

export function campusLayout() {
  const walls = [],
    positions = [],
    uvs = [],
    indices = [];
  function vertex(px, py, height) {
    positions.push(worldX(px), height / SY, worldZ(py));
    uvs.push(px / WIDTH, 1 - (py - height) / HEIGHT);
  }
  function face(points, height) {
    const start = positions.length / 3,
      n = points.length;
    for (const [x, y] of points) vertex(x, y, 0);
    for (const [x, y] of points) vertex(x, y, height);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(start + i, start + j, start + n + i, start + j, start + n + j, start + n + i);
    }
    for (let i = 1; i < n - 1; i++) indices.push(start + n, start + n + i, start + n + i + 1);
    const corners = points.map(([x, y]) => [worldX(x), worldZ(y)]);
    // Normalize the winding for the outward normal when a body lands exactly on an edge.
    const area = corners.reduce((sum, [x, z], i) => {
      const [px, pz] = corners[(i + 1) % corners.length];
      return sum + x * pz - z * px;
    }, 0);
    if (area < 0) corners.reverse();
    const xs = corners.map((p) => p[0]),
      zs = corners.map((p) => p[1]);
    walls.push({
      corners,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      z0: Math.min(...zs),
      z1: Math.max(...zs),
    });
  }
  function box(left, back, right, front, height) {
    face(
      [
        [left, back],
        [right, back],
        [right, front],
        [left, front],
      ],
      height,
    );
  }
  // Perimeter, classroom dividers and the four open hallway thresholds.
  box(0, 52, 1536, 94, 51);
  box(0, 970, 1536, 1023, 24);
  box(0, 65, 45, 983, 42);
  box(1482, 65, 1535, 983, 42);
  box(736, 58, 786, 424, 40);
  box(740, 584, 784, 987, 35);
  for (const [left, right] of [
    [35, 349],
    [449, 1092],
    [1181, 1498],
  ]) {
    box(left, 425, right, 441, 43);
    box(left, 576, right, 589, 36);
  }
  // Classroom: staggered shelves, desks and teacher's station.
  for (const [x, y, w] of [
    [103, 237, 170],
    [183, 357, 187],
    [447, 302, 182],
  ])
    box(x, y - 29, x + w, y, 53);
  for (const [x, y] of [
    [343, 220],
    [421, 218],
    [62, 332],
    [433, 381],
    [520, 382],
    [666, 280],
  ])
    box(x, y - 18, x + 49, y, 41);
  box(578, 143, 721, 165, 62);
  box(88, 95, 134, 118, 38);
  // Two bent lab islands and a demonstration bench.
  box(833, 198, 884, 341, 31);
  box(857, 173, 1017, 215, 30);
  box(852, 331, 977, 366, 26);
  box(1349, 207, 1408, 330, 28);
  box(1217, 182, 1381, 214, 26);
  box(1294, 329, 1397, 365, 26);
  box(1020, 282, 1216, 336, 42);
  box(849, 91, 1408, 126, 32);
  // Three separate runs of curved display wall. Each quad is a slice of the
  // same arc on the painting. The gaps between runs remain completely open.
  function ribbon(edgeA, edgeB, height) {
    for (let i = 1; i < edgeA.length; i++)
      face([edgeA[i - 1], edgeA[i], edgeB[i], edgeB[i - 1]], height);
  }
  ribbon(
    [
      [336, 656],
      [297, 670],
      [252, 697],
      [218, 734],
      [198, 775],
      [182, 820],
    ],
    [
      [341, 670],
      [311, 682],
      [269, 707],
      [239, 741],
      [219, 780],
      [212, 809],
    ],
    64,
  );
  ribbon(
    [
      [452, 655],
      [499, 669],
      [548, 699],
      [581, 736],
      [601, 779],
      [599, 824],
    ],
    [
      [448, 671],
      [488, 682],
      [532, 709],
      [562, 741],
      [579, 779],
      [578, 810],
    ],
    65,
  );
  ribbon(
    [
      [215, 931],
      [256, 952],
      [317, 969],
      [384, 974],
      [456, 971],
      [520, 956],
      [561, 932],
    ],
    [
      [238, 917],
      [273, 933],
      [328, 947],
      [385, 952],
      [448, 950],
      [505, 936],
      [543, 918],
    ],
    68,
  );
  for (const [x, y] of [
    [106, 694],
    [618, 681],
    [90, 963],
    [620, 966],
  ])
    box(x, y - 18, x + 57, y, 69);
  box(55, 793, 110, 834, 49);
  box(651, 787, 724, 830, 48);
  // Gym: standing foam pads joined into angular runs with open lanes between them.
  const pads = [
    [838, 753, 860, 865],
    [850, 740, 944, 759],
    [925, 686, 944, 754],
    [933, 681, 1101, 703],
    [1081, 687, 1101, 763],
    [838, 920, 925, 942],
    [909, 821, 930, 937],
    [918, 821, 1009, 844],
    [990, 757, 1009, 838],
    [998, 749, 1046, 773],
    [1130, 741, 1150, 849],
    [1138, 737, 1262, 761],
    [1247, 686, 1266, 755],
    [1250, 679, 1364, 703],
    [1347, 686, 1366, 749],
    [1081, 837, 1139, 856],
    [1081, 846, 1101, 891],
    [970, 907, 1207, 929],
    [1193, 818, 1214, 919],
    [1202, 813, 1306, 837],
    [1289, 829, 1309, 943],
    [1297, 924, 1421, 944],
  ];
  for (const pad of pads) box(...pad, 23);
  box(802, 646, 907, 664, 36);
  box(1085, 642, 1190, 658, 39);
  box(1356, 637, 1433, 649, 29);
  box(1448, 778, 1479, 802, 77);
  // Hall furniture sits against the edges, leaving a continuous centre lane.
  box(48, 512, 145, 528, 68);
  box(1395, 511, 1490, 528, 67);
  for (const x of [292, 1124]) box(x, 510, x + 109, 527, 29);
  for (const x of [228, 1256]) box(x, 506, x + 39, 530, 44);

  // Narrow silhouettes above benches and shelves also cover actors walking
  // behind them. They sit on the existing furniture and add no floor obstacle.
  function cutout(foot, outline) {
    const start = positions.length / 3;
    for (const [x, y] of outline) vertex(x, foot, foot - y);
    const contour = outline.map(([x, y]) => new THREE.Vector2(x, y));
    for (const tri of THREE.ShapeUtils.triangulateShape(contour, [])) {
      indices.push(...tri.map((i) => start + i));
    }
  }
  cutout(304, [
    [1084, 169],
    [1107, 169],
    [1106, 187],
    [1122, 203],
    [1128, 223],
    [1123, 245],
    [1133, 256],
    [1129, 264],
    [1064, 264],
    [1061, 254],
    [1070, 241],
    [1066, 220],
    [1074, 201],
    [1087, 187],
  ]);
  cutout(296, [
    [535, 209],
    [554, 208],
    [559, 201],
    [579, 210],
    [598, 220],
    [591, 234],
    [600, 239],
    [586, 245],
    [573, 258],
    [554, 258],
    [547, 243],
    [532, 240],
    [538, 229],
    [525, 227],
  ]);
  cutout(233, [
    [137, 151],
    [151, 149],
    [161, 140],
    [181, 149],
    [194, 161],
    [191, 177],
    [177, 182],
    [171, 198],
    [147, 198],
    [143, 182],
    [125, 180],
    [133, 165],
    [122, 164],
  ]);
  cutout(527, [
    [223, 462],
    [240, 444],
    [255, 454],
    [265, 450],
    [284, 467],
    [274, 484],
    [261, 494],
    [242, 495],
    [230, 482],
    [217, 478],
  ]);
  cutout(525, [
    [1247, 463],
    [1262, 445],
    [1275, 452],
    [1284, 446],
    [1305, 462],
    [1298, 481],
    [1285, 492],
    [1265, 496],
    [1259, 483],
    [1243, 477],
  ]);
  return { walls, positions, uvs, indices };
}

export function createCampus(loader, markTexture, time, ripples) {
  const { walls, positions, uvs, indices } = campusLayout();
  const texture = loader.load(new URL('./campus.webp', import.meta.url).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const art = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, fog: false });
  group.add(new THREE.Mesh(geo, art));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH / SX, HEIGHT / SZ), art.clone());
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(worldX(WIDTH / 2), -0.002, worldZ(HEIGHT / 2));
  group.add(floor);
  // Only the ground receives footprints, paint and combat ripples.
  floor.material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      marks: { value: markTexture },
      now: time,
      ripples: { value: ripples },
    });
    shader.vertexShader =
      'varying vec2 groundXZ;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n groundXZ = (modelMatrix * vec4(transformed,1.)).xz;',
      );
    shader.fragmentShader =
      'varying vec2 groundXZ; uniform sampler2D marks; uniform float now; uniform vec4 ripples[8];\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
      #include <map_fragment>
      vec4 mark = texture2D(marks, vec2((groundXZ.x+48.)/96.,1.-(groundXZ.y+48.)/96.));
      diffuseColor.rgb = mix(diffuseColor.rgb, mark.rgb, mark.a);
      for(int i=0;i<8;i++){float age=now-ripples[i].z;
        if(age>=0. && age<1.){float d=(distance(groundXZ,ripples[i].xy)-age*9.)*1.3;
          diffuseColor.rgb+=vec3(.23,.14,.045)*exp(-d*d)*(1.-age)*ripples[i].w;}}
    `,
      );
  };
  return { group, walls, texture };
}

// A circle against a convex footprint. The broad phase also saves work when
// hundreds of ground enemies are moving on opposite sides of the campus.
function contact(wall, x, z, radius, body) {
  if (x < wall.x0 - radius || x > wall.x1 + radius || z < wall.z0 - radius || z > wall.z1 + radius)
    return false;
  let inside = false,
    nearest = Infinity,
    dx = 0,
    dz = 0,
    nx = 0,
    nz = 0;
  const pts = wall.corners;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, az] = pts[j],
      [bx, bz] = pts[i];
    const ex = bx - ax,
      ez = bz - az,
      len2 = ex * ex + ez * ez;
    if (az > z !== bz > z && x < ax + ((z - az) * ex) / ez) inside = !inside;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    const vx = x - ax - t * ex,
      vz = z - az - t * ez,
      dist2 = vx * vx + vz * vz;
    if (dist2 < nearest) {
      nearest = dist2;
      dx = vx;
      dz = vz;
      nx = ez / Math.sqrt(len2);
      nz = -ex / Math.sqrt(len2);
    }
  }
  if (!inside && nearest > radius * radius) return false;
  if (body) {
    const distance = Math.sqrt(nearest);
    const push = inside ? radius + distance : radius - distance;
    if (distance > 1e-7) {
      nx = (dx / distance) * (inside ? -1 : 1);
      nz = (dz / distance) * (inside ? -1 : 1);
    }
    body.x += nx * push;
    body.z += nz * push;
  }
  return true;
}
export function insideCampusObstacle(walls, x, z, clearance = 0) {
  return walls.some((wall) => contact(wall, x, z, clearance));
}
export function resolveCampusObstacles(walls, body, radius) {
  for (const wall of walls) contact(wall, body.x, body.z, radius, body);
}

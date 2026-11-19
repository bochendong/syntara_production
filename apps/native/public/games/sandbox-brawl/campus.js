import * as THREE from './vendor/three.module.js';
import { buildCampusModels } from './campus-models.js';

// The floor plan uses the approved 1536 × 1024 overview as its coordinate grid.
// Furniture placement and ground navigation share these footprints.
const WIDTH = 1536,
  HEIGHT = 1024;
const SX = 18.25,
  SZ = 13.4,
  OX = 768,
  OZ = 510;
// A student's shoulders span about half a desk. Ground clearance
// follows the feet, which are narrower than the chibi head.
export const campusStudentScale = 2;
export const campusStudentRadius = 0.34 * campusStudentScale;
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
  const walls = [];
  function face(kind, points, height) {
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
      kind,
      height: height / SY,
      corners,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      z0: Math.min(...zs),
      z1: Math.max(...zs),
    });
  }
  function box(kind, left, back, right, front, height) {
    face(
      kind,
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
  box('wall', 0, 52, 1536, 94, 51);
  box('wall', 0, 970, 1536, 1023, 24);
  box('wall', 0, 65, 45, 983, 42);
  box('wall', 1482, 65, 1535, 983, 42);
  box('wall', 736, 58, 786, 424, 40);
  box('wall', 740, 584, 784, 987, 35);
  for (const [left, right] of [
    [35, 349],
    [449, 1092],
    [1181, 1498],
  ]) {
    box('wall', left, 425, right, 441, 43);
    box('wall', left, 576, right, 589, 36);
  }
  // Classroom: staggered shelves, desks and teacher's station.
  for (const [x, y, w] of [
    [103, 237, 170],
    [183, 357, 187],
    [447, 302, 182],
  ])
    box('shelf', x, y - 29, x + w, y, 53);
  for (const [x, y] of [
    [343, 220],
    [421, 218],
    [62, 332],
    [433, 381],
    [520, 382],
    [666, 280],
  ])
    box('desk', x, y - 18, x + 49, y, 41);
  box('teacher', 578, 143, 721, 165, 62);
  box('plant', 88, 95, 134, 118, 38);
  // Two bent lab islands and a demonstration bench.
  box('lab', 833, 198, 884, 341, 31);
  box('lab', 857, 173, 1017, 215, 30);
  box('lab', 852, 331, 977, 366, 26);
  box('lab', 1349, 207, 1408, 330, 28);
  box('lab', 1217, 182, 1381, 214, 26);
  box('lab', 1294, 329, 1397, 365, 26);
  box('lab', 1020, 282, 1216, 336, 42);
  box('lab', 849, 91, 1408, 126, 32);
  // Three separate runs of curved display wall. Each quad is a slice of the
  // same arc in the plan. The gaps between runs remain completely open.
  function ribbon(edgeA, edgeB, height) {
    for (let i = 1; i < edgeA.length; i++)
      face('gallery', [edgeA[i - 1], edgeA[i], edgeB[i], edgeB[i - 1]], height);
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
    box('easel', x, y - 18, x + 57, y, 69);
  box('paint', 55, 793, 110, 834, 49);
  box('paint', 651, 787, 724, 830, 48);
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
  for (const pad of pads) box('pad', ...pad, 23);
  box('mats', 802, 646, 907, 664, 36);
  box('ballRack', 1085, 642, 1190, 658, 39);
  box('vault', 1356, 637, 1433, 649, 29);
  box('basket', 1448, 778, 1479, 802, 77);
  // Hall furniture sits against the edges, leaving a continuous centre lane.
  box('locker', 48, 512, 145, 528, 68);
  box('locker', 1395, 511, 1490, 528, 67);
  for (const x of [292, 1124]) box('bench', x, 510, x + 109, 527, 29);
  for (const x of [228, 1256]) box('plant', x, 506, x + 39, 530, 44);

  return { walls };
}

export function createCampus(markTexture, time, ripples) {
  const { walls } = campusLayout();
  const group = buildCampusModels(walls);
  const shadows = group.getObjectByName('cast shadows');
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH / SX, HEIGHT / SZ),
    new THREE.MeshBasicMaterial(),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(worldX(WIDTH / 2), -0.002, worldZ(HEIGHT / 2));
  group.add(floor);
  // Only the ground receives footprints, paint and combat ripples.
  function groundShader(shader, inShadow) {
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
      vec2 p=groundXZ;
      // Anime school floors: real-scale planks and tiles, soft colour noise, window light.
      float n1=fract(sin(dot(floor(p*3.1),vec2(12.99,78.23)))*43758.5);
      float n2=fract(sin(dot(floor(p*0.7),vec2(39.35,11.17)))*24634.6);
      float grain=.5+.5*sin(p.x*7.3+sin(p.y*23.)*1.7+n2*6.);
      vec3 paint;
      if(abs(p.y)<5.55){
        // Corridor: warm grey vinyl tiles, polished, darker skirting band along the walls.
        vec2 t=floor(p/1.5);
        float tv=fract(sin(dot(t,vec2(7.13,31.7)))*917.3);
        paint=mix(vec3(.76,.74,.69),vec3(.80,.78,.73),tv*.7+n2*.3);
        vec2 j=min(fract(p/1.5),1.-fract(p/1.5));
        paint*=1.-.07*(1.-smoothstep(.006,.02,min(j.x,j.y)));
        float edge=abs(p.y);
        paint=mix(paint,vec3(.55,.60,.58),smoothstep(4.55,4.62,edge));
        // centre sheen of a waxed floor
        paint*=1.+.05*(1.-smoothstep(0.,3.,edge));
      }else if(p.y < -5.7 && p.x<0.){
        // Classroom: narrow light-oak boards with staggered butt joints.
        float row=floor(p.y/.42);
        float off=fract(sin(row*17.13)*143.7)*4.;
        vec2 bd=vec2((p.x+off)/4.2,p.y/.42);
        float tone=fract(sin(dot(floor(bd),vec2(29.7,17.3)))*382.65);
        paint=mix(vec3(.76,.62,.47),vec3(.86,.74,.58),tone*.75+.1);
        paint*=.96+.05*grain;
        vec2 ed=min(fract(bd),1.-fract(bd))/max(fwidth(bd),vec2(.0001));
        paint*=.86+.14*smoothstep(.4,1.6,min(ed.x*3.,ed.y));
      }else if(p.y < -5.7){
        // Laboratory: grey-green vinyl tiles.
        vec2 t=floor(p/1.1);
        paint=mix(vec3(.84,.87,.86),vec3(.80,.84,.83),mod(t.x+t.y,2.)*.6+n1*.15);
        vec2 j=min(fract(p/1.1),1.-fract(p/1.1));
        paint*=1.-.08*(1.-smoothstep(.006,.02,min(j.x,j.y)));
      }else if(p.y>5.5 && p.x<0.){
        // Art room: sealed concrete with old paint drops.
        paint=mix(vec3(.80,.79,.76),vec3(.85,.84,.80),n2*.7+n1*.2);
        vec2 c=floor(p/2.6); vec2 o=fract(sin(vec2(dot(c,vec2(12.1,7.7)),dot(c,vec2(3.3,19.9))))*917.3);
        float splat=length((p-(c+.2+o*.6)*2.6)*vec2(1.,1.6));
        float pick=fract(o.x*13.1+o.y*7.);
        vec3 drop=pick<.33?vec3(.86,.55,.50):pick<.66?vec3(.55,.68,.83):vec3(.90,.80,.48);
        if(pick>.55) paint=mix(mix(drop,paint,.25),paint,smoothstep(.06+.06*o.y,.1+.06*o.y,splat));
      }
      else{
        // Gym: varnished maple boards with painted court lines.
        float row=floor(p.y/.32);
        float off=fract(sin(row*11.7)*91.3)*3.;
        vec2 bd=vec2((p.x+off)/3.,p.y/.32);
        float tone=fract(sin(dot(floor(bd),vec2(21.7,47.3)))*231.5);
        paint=mix(vec3(.85,.71,.52),vec3(.92,.80,.60),tone*.8);
        paint*=.97+.04*grain;
        vec2 ed=min(fract(bd),1.-fract(bd))/max(fwidth(bd),vec2(.0001));
        paint*=.9+.1*smoothstep(.4,1.6,min(ed.x*3.,ed.y));
        vec2 q=p-vec2(20.,20.);
        float border=abs(max(abs(q.x)-17.4,abs(q.y)-11.9));
        float line=min(border,abs(length(q)-3.2));
        if(abs(q.y)<11.9) line=min(line,abs(q.x));
        float key=1e3; if(abs(q.x)<17.4) key=abs(length(vec2(abs(q.x)-17.4,q.y))-6.1);
        paint=mix(vec3(.96,.95,.91),paint,smoothstep(.06,.1,line));
        paint=mix(vec3(.78,.32,.30),paint,smoothstep(.06,.1,key));
      }
      // Late-afternoon window light falling across the north rooms and the corridor.
      if(p.y<5.55){
        float sky=0.;
        for(int k=0;k<5;k++){
          float wx=k==0?-33.:k==1?-9.:k==2?7.:k==3?18.:32.;
          float sx=p.x-wx-(p.y+30.9)*.42;
          sky=max(sky,(1.-smoothstep(1.35,1.75,abs(sx)))*smoothstep(-31.,-27.,p.y)*(1.-smoothstep(-12.,-5.6,p.y)));
        }
        float hall=(1.-smoothstep(1.1,1.5,abs(fract((p.x-p.y*.42)/7.)-.5)*7.))*(1.-smoothstep(3.6,4.4,abs(p.y)));
        paint*=1.+.13*sky+.06*hall;
        paint=mix(paint,paint*vec3(1.04,1.,.92),sky*.6);
      }
      diffuseColor.rgb=pow(paint,vec3(2.2)) * ${inShadow ? 'vec3(.66,.69,.80)' : 'vec3(1.)'};
      vec4 mark = texture2D(marks, vec2((groundXZ.x+48.)/96.,1.-(groundXZ.y+48.)/96.));
      diffuseColor.rgb = mix(diffuseColor.rgb, mark.rgb, mark.a);
      for(int i=0;i<8;i++){float age=now-ripples[i].z;
        if(age>=0. && age<1.){float d=(distance(groundXZ,ripples[i].xy)-age*9.)*1.3;
          diffuseColor.rgb+=vec3(.23,.14,.045)*exp(-d*d)*(1.-age)*ripples[i].w;}}
    `,
      );
  }
  floor.material.onBeforeCompile = (shader) => groundShader(shader, false);
  shadows.material.onBeforeCompile = (shader) => groundShader(shader, true);
  return { group, walls };
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

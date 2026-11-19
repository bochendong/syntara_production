import * as THREE from './vendor/three.module.js';
import {
  architecture,
  campusElevation,
  floorPoint,
  plateWidth,
  plateHeight,
  mapHalfDepth,
} from './campus-map-plan.js?v=campus-doorways';
import { studioFixtures } from './campus-studio-fixtures.js?v=campus-doorways';
import { labFixtures } from './campus-lab-fixtures.js';
import { gymFixtures } from './campus-gym-fixtures.js';
import { addCampusDepth } from './campus-paint-depth.js';

export { campusElevation, floorPoint };
export const campusStudentScale = 1.5;
export const campusStudentRadius = 0.55;
export function campusStudentDrawScale() {
  return campusStudentScale;
}

const fixtures = [...architecture, ...studioFixtures, ...labFixtures, ...gymFixtures];
function site([u, v]) {
  const [x, z] = floorPoint(u, v);
  return { x, z };
}

// Floor plates and scattered dirt require a clear circle of radius 4.1.
// Encounters with a single target can also use the smaller rooms and corridor.
export const taskSites = [
  [121, 831],
  [1473, 899],
].map(site);
export const encounterSites = [
  ...taskSites,
  ...[
    [418, 172],
    [1175, 300],
    [412, 498],
    [800, 498],
    [1190, 498],
  ].map(site),
];
// One portal per room in each pass, in classroom, lab, gym and studio order.
export const portalSites = [
  [89, 355],
  [1175, 300],
  [1495, 922],
  [151, 932],
  [422, 171],
  [1495, 170],
  [1194, 816],
  [665, 827],
].map(([u, v]) => floorPoint(u, v));

export function campusLayout() {
  const walls = fixtures.map(({ kind, foot, silhouette }) => {
    const [left, back, right, front] = foot;
    const [x0, z0] = floorPoint(left, back);
    const [x1, z1] = floorPoint(right, front);
    const top = Math.min(...silhouette.map((p) => p[1]));
    const height = (z1 - floorPoint(left, top)[1]) * Math.tan(campusElevation);
    return {
      kind,
      x0,
      z0,
      x1,
      z1,
      height,
      corners: [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ],
    };
  });
  return { walls };
}

const detailPixels = {
  classroom: { 'pupil-chair': [229, 240], bookcase: [699, 152], 'pencil-cup': [263, 132] },
  lab: {
    microscope: [922, 206],
    balance: [1287, 206],
    molecule: [1362, 205],
    terrarium: [1445, 333],
    'specimen-jar': [1443, 333],
  },
  art: {
    'wash-cabinet': [293, 617],
    'drying-rack': [577, 627],
    'art-stool': [297, 782],
    'pottery-wheel': [736, 889],
    'clay-bucket': [759, 916],
    'still-life': [188, 736],
    'sketch-table': [331, 761],
    'watercolor-table': [555, 761],
    sunflower: [91, 706],
  },
  gym: { 'team-bench': [864, 961], 'blue-step': [992, 966], 'coral-step': [846, 879] },
};

// Keep furniture registration in original painting pixels at every texture resolution.
export function campusPaintURL(maxTextureSize, shortEdgePixels) {
  if (maxTextureSize >= plateWidth * 4 && shortEdgePixels > 1024) {
    return new URL('./campus-props/campus-paint-4x.webp?v=campus-doorways', import.meta.url).href;
  }
  if (maxTextureSize >= plateWidth * 2) {
    return new URL('./campus-props/campus-paint-2x.webp?v=campus-doorways', import.meta.url).href;
  }
  return new URL('./campus-props/campus-paint.webp?v=campus-doorways', import.meta.url).href;
}

export function createCampus(markTexture, time, ripples, renderer) {
  const group = new THREE.Group();
  // Use the short edge so rotating a small screen keeps the lower-memory atlas.
  const shortEdgePixels = Math.max(Math.min(screen.width, screen.height), Math.min(innerWidth, innerHeight)) *
    Math.min(devicePixelRatio, 2);
  const texture = new THREE.TextureLoader().load(
    campusPaintURL(renderer.capabilities.maxTextureSize, shortEdgePixels),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.userData.plateSize = [plateWidth, plateHeight];
  const { walls } = campusLayout();
  function groundShader(shader, inShadow) {
    Object.assign(shader.uniforms, {
      campusPaint: { value: texture },
      marks: { value: markTexture },
      now: time,
      ripples: { value: ripples },
    });
    shader.vertexShader =
      'varying vec2 groundXZ;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n#ifdef USE_INSTANCING\n groundXZ = (modelMatrix * instanceMatrix * vec4(transformed,1.)).xz;\n#else\n groundXZ = (modelMatrix * vec4(transformed,1.)).xz;\n#endif',
      );
    shader.fragmentShader =
      'varying vec2 groundXZ; uniform sampler2D campusPaint, marks; uniform float now; uniform vec4 ripples[8];\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
      #include <map_fragment>
      vec2 uv = vec2(.5 + groundXZ.x / 80., .5 - groundXZ.y / ${(2 * mapHalfDepth).toFixed(8)});
      diffuseColor.rgb = texture2D(campusPaint, uv).rgb * ${inShadow ? 'vec3(.66,.69,.80)' : 'vec3(1.)'};
      vec4 mark = texture2D(marks, vec2((groundXZ.x+48.)/96.,1.-(groundXZ.y+48.)/96.));
      diffuseColor.rgb = mix(diffuseColor.rgb, mark.rgb, mark.a);
      for(int i=0;i<8;i++){float age=now-ripples[i].z;
        if(age>=0. && age<1.){float d=(distance(groundXZ,ripples[i].xy)-age*9.)*1.3;
          diffuseColor.rgb+=vec3(.23,.14,.045)*exp(-d*d)*(1.-age)*ripples[i].w;}}
    `,
      );
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 2 * mapHalfDepth),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.material.onBeforeCompile = (shader) => groundShader(shader, false);
  floor.material.customProgramCacheKey = () => 'campus-ground';
  group.add(floor);
  addCampusDepth(group, texture, fixtures, floorPoint, campusElevation);

  function castShadowMaterial(map) {
    const material = new THREE.MeshBasicMaterial({
      map: map ?? null,
      alphaTest: map ? 0.32 : 0,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.onBeforeCompile = (shader) => groundShader(shader, true);
    material.customProgramCacheKey = () => 'campus-shadow';
    return material;
  }
  const furnishings = {};
  for (const [room, props] of Object.entries(detailPixels)) {
    furnishings[room] = {};
    for (const [slug, point] of Object.entries(props)) {
      const [x, z] = floorPoint(...point);
      furnishings[room][slug] = { x, z };
    }
  }
  return { group, walls, castShadowMaterial, furnishings };
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

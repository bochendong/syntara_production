import * as THREE from './vendor/three.module.js';

// Crop bounds and ground anchors measured against the original combat camera.
const MONSTERS = {
  sleepy: { crop: [112,32,307,261], height: 1.274, base: -0.124 },
  bat: { crop: [399,25,690,230], height: 0.86, base: 0.653 },
  bomber: { crop: [796,28,994,260], height: 2.562, base: -0.127 },
  chalk: { crop: [1113,34,1301,260], height: 1.472, base: -0.083 },
  cross: { crop: [104,307,323,505], height: 1.051, base: -0.063 },
  mole: { crop: [406,304,679,499], height: 1.192, base: -0.105 },
  clock: { crop: [786,293,979,496], height: 1.192, base: -0.067 },
  ink: { crop: [1120,301,1333,502], height: 1.136, base: -0.184 },
  ghost: { crop: [90,540,317,726], height: 1.31, base: 0.078 },
  phone: { crop: [443,535,622,744], height: 1.805, base: -0.094 },
  snail: { crop: [759,543,1009,738], height: 1.81, base: -0.37 },
  hourglass: { crop: [1112,531,1340,744], height: 2.253, base: -0.11 },
  boss: { crop: [41,768,363,1028], height: 5.534, base: -0.262 },
  dean: { crop: [429,776,637,1028], height: 5.353, base: -0.358 },
  coach: { crop: [739,778,1001,1028], height: 5.821, base: -0.383 },
  kraken: { crop: [1032,766,1409,1032], height: 6.881, base: -1.378 },
};

const atlasUrl = new URL('./monster-art.png', import.meta.url).href;
const atlasWidth = 1448;
const atlasHeight = 1086;
const capacity = 512;

export function monsterIllustration(id) {
  if (!Object.hasOwn(MONSTERS, id)) return null;
  const [left, top, right, bottom] = MONSTERS[id].crop;
  const width = right - left;
  const height = bottom - top;
  return `<svg class="item-illustration monster-illustration" viewBox="${left} ${top} ${width} ${height}" width="48" height="48" aria-hidden="true"><image href="${atlasUrl}" width="${atlasWidth}" height="${atlasHeight}"></image></svg>`;
}

function createBatch(scene, map, { crop: [left, top, right, bottom], height, base }) {
  const width = height * (right - left) / (bottom - top);
  const geometry = new THREE.PlaneGeometry(width, height).translate(0, base + height / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i,
      (left + uv.getX(i) * (right - left)) / atlasWidth,
      1 - (bottom - uv.getY(i) * (bottom - top)) / atlasHeight,
    );
  }
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  flash.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('monsterFlash', flash);
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.3, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float monsterFlash;\nvarying float vMonsterFlash;\n' +
      shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvMonsterFlash = monsterFlash;');
    shader.fragmentShader = 'varying float vMonsterFlash;\n' +
      shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vMonsterFlash);');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return { mesh, flash, width };
}

export function createMonsterArt(scene) {
  let atlas;
  const ready = new THREE.TextureLoader().loadAsync(atlasUrl).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    atlas = texture;
  }).catch(() => {
    // The original mesh is also used when the illustration has not loaded.
  });

  const batches = new Map();
  const transform = new THREE.Object3D();
  const tilt = new THREE.Quaternion();
  const rotation = new THREE.Euler();
  const normal = new THREE.Vector3();
  const axis = new THREE.Vector3();

  return {
    ready,
    begin(camera) {
      for (const { mesh } of batches.values()) mesh.count = 0;
      normal.set(0, 0, 1).applyQuaternion(camera.quaternion);
    },
    draw(id, camera, x, y, z, yaw, sx, sy, color, pitch, roll, whiteFlash) {
      if (!atlas || !Object.hasOwn(MONSTERS, id)) return false;
      const data = MONSTERS[id];
      let batch = batches.get(id);
      if (!batch) {
        batch = createBatch(scene, atlas, data);
        batches.set(id, batch);
      }
      const { mesh, flash, width } = batch;
      if (mesh.count === capacity) return false;
      const i = mesh.count++;
      transform.quaternion.copy(camera.quaternion);
      if (pitch || roll) {
        transform.quaternion.multiply(tilt.setFromEuler(rotation.set(pitch, 0, roll)));
      }
      const face = Math.sin(yaw) < -0.1 ? -1 : 1;
      // InstancedMesh does not support reflected matrices. Rotate the double-sided
      // billboard to mirror it without changing its projected size.
      if (face < 0) transform.rotateY(Math.PI);
      transform.scale.set(sx, sy, 1);
      const bottom = axis.set(0, 1, 0).applyQuaternion(transform.quaternion).y * sy;
      const edge = Math.abs(axis.set(1, 0, 0).applyQuaternion(transform.quaternion).y * sx) * width / 2;
      const low = Math.min(data.base * bottom, (data.base + data.height) * bottom) - edge;
      const clearance = Math.max(0, 0.04 - Math.max(y, 0) - low) / Math.max(0.1, normal.y);
      transform.position.set(x, y, z).addScaledVector(normal, clearance);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, color);
      flash.setX(i, Number(whiteFlash));
      return true;
    },
    end() {
      for (const { mesh, flash } of batches.values()) {
        if (!mesh.count) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        flash.needsUpdate = true;
      }
    },
  };
}

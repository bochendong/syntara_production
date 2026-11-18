import * as THREE from './vendor/three.module.js';
import { campusElevation } from './campus.js';

export const ITEM = {
  green: 0,
  blue: 1,
  gold: 2,
  satchel: 3,
  magnet: 4,
  altar: 5,
  coffee: 6,
  mushroom: 7,
};

// All pickups share one atlas and one draw call, including dense XP drops.
export function createCampusItems(scene, loader) {
  const atlas = loader.load(new URL('./campus-items.webp', import.meta.url).href);
  atlas.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: atlas, alphaTest: 0.32, fog: false });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float artCell;\n' +
      shader.vertexShader.replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      vMapUv = (vMapUv + vec2(mod(artCell, 4.), 1.-floor(artCell/4.))) / vec2(4., 2.);
    `,
      );
  };
  const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.46, 0);
  let capacity = 768;
  let batch, cells;
  const transform = new THREE.Object3D(),
    color = new THREE.Color();
  transform.rotation.x = -campusElevation;
  function allocate() {
    cells = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute('artCell', cells);
    batch = new THREE.InstancedMesh(geometry, material, capacity);
    batch.frustumCulled = false;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.count = 0;
    scene.add(batch);
  }
  allocate();
  return {
    begin() {
      batch.count = 0;
    },
    draw(cell, x, y, z, size, roll = 0, tint = null) {
      if (batch.count === capacity) {
        const old = batch,
          oldCells = cells;
        capacity *= 2;
        allocate();
        batch.instanceMatrix.array.set(old.instanceMatrix.array);
        batch.setColorAt(0, color.set(0xffffff));
        batch.instanceColor.array.set(old.instanceColor.array);
        cells.array.set(oldCells.array);
        batch.count = old.count;
        scene.remove(old);
        old.dispose();
      }
      const i = batch.count++;
      transform.position.set(x, y, z);
      transform.rotation.z = roll;
      transform.scale.setScalar(size);
      transform.updateMatrix();
      batch.setMatrixAt(i, transform.matrix);
      color.set(0xffffff);
      if (tint) color.lerp(tint, 0.48);
      batch.setColorAt(i, color);
      cells.setX(i, cell);
    },
    end() {
      batch.instanceMatrix.needsUpdate = cells.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    },
  };
}

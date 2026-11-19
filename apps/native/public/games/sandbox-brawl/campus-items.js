import * as T from './vendor/three.module.js';
import { InkMesh, forms as f } from './campus-mesh.js';

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
const cream = 0xffebce,
  gold = 0xffb641,
  teal = 0x4bad9a,
  red = 0xd85352,
  wine = 0x713b53;
const starShape = new T.Shape();
for (let i = 0; i < 10; i++) {
  const a = Math.PI / 2 + (i * Math.PI) / 5,
    r = i % 2 ? 0.23 : 0.49;
  if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  else starShape.moveTo(0, r);
}
starShape.closePath();
const star = new T.ExtrudeGeometry(starShape, {
  depth: 0.12,
  bevelSize: 0.031,
  bevelThickness: 0.027,
  bevelSegments: 1,
}).translate(0, 0, -0.06);

function collectible(cell) {
  const b = new InkMesh();
  function part(form, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, stroke = 0.027) {
    b.part(form, color, x, y, z, w, h, d, rx, ry, rz, stroke);
  }
  if (cell === ITEM.green || cell === ITEM.blue) {
    part(
      f.jewel,
      cell === ITEM.green ? 0x30c982 : 0x558eea,
      0,
      0.51,
      0,
      0.78,
      1,
      0.75,
      0,
      0.42,
      -0.09,
    );
    part(f.jewel, cream, -0.13, 0.64, 0.24, 0.13, 0.26, 0.12, 0, 0, -0.18, 0.006);
  } else if (cell === ITEM.gold) {
    part(star, gold, 0, 0.53, 0, 0.95, 0.95, 1);
    part(f.leaf, cream, -0.13, 0.6, 0.11, 0.2, 0.23, 0.05, 0, 0, -0.5, 0.006);
  } else if (cell === ITEM.satchel) {
    b.box(wine, 0, 0.35, 0, 0.84, 0.66, 0.55);
    b.box(red, 0, 0.54, 0.09, 0.91, 0.37, 0.54, -0.035, 0.028);
    part(f.hoop, wine, 0, 0.78, -0.03, 0.45, 0.38, 0.5);
    for (const x of [-0.24, 0.24]) {
      b.box(0xa96442, x, 0.35, 0.284, 0.14, 0.42, 0.13, 0, 0.017);
      b.box(gold, x, 0.31, 0.352, 0.17, 0.13, 0.06, 0, 0.012);
    }
    b.box(cream, 0, 0.55, 0.371, 0.2, 0.11, 0.05, 0, 0.011);
  } else if (cell === ITEM.magnet) {
    part(f.magnet, red, 0, 0.52, 0, 1, 1, 0.77, 0, 0.08, -0.2);
    for (const s of [-1, 1]) {
      const x = s * 0.345;
      b.box(red, x, 0.39, 0, 0.25, 0.34, 0.23, 0, 0.018);
      b.box(cream, x, 0.17, 0, 0.25, 0.16, 0.23, 0, 0.018);
    }
  } else if (cell === ITEM.altar) {
    b.box(wine, 0, 0.12, 0, 0.95, 0.22, 0.8);
    b.box(gold, 0, 0.25, 0, 0.81, 0.13, 0.69);
    part(f.taper, teal, 0, 0.47, 0, 0.55, 0.39, 0.53, Math.PI);
    b.box(cream, 0, 0.65, 0, 0.78, 0.12, 0.61);
    part(star, gold, 0, 0.9, 0, 0.52, 0.52, 1, 0, -0.15);
  } else if (cell === ITEM.coffee) {
    part(f.taper, red, 0, 0.42, 0, 0.76, 0.73, 0.76, Math.PI);
    part(f.taper, 0xe8af74, 0, 0.42, 0, 0.71, 0.24, 0.71, Math.PI);
    part(f.barrel, cream, 0, 0.83, 0, 0.78, 0.13, 0.78);
    part(f.barrel, wine, 0, 0.93, 0, 0.62, 0.095, 0.62);
  } else {
    part(f.taper, cream, 0, 0.3, 0, 0.44, 0.52, 0.42);
    part(f.round, red, 0, 0.65, 0, 0.99, 0.58, 0.96);
    for (const [x, y, z] of [
      [-0.2, 0.84, 0.18],
      [0.25, 0.76, 0.25],
      [0.06, 0.91, -0.06],
    ]) {
      part(f.round, cream, x, y, z, 0.2, 0.1, 0.18, 0, 0, 0, 0.007);
    }
  }
  return b.geometry();
}

// One instanced batch per silhouette keeps large XP fields inexpensive.
export function createCampusItems(scene) {
  const material = new T.MeshBasicMaterial({ vertexColors: true });
  const pose = new T.Object3D(),
    color = new T.Color();
  const batches = Object.values(ITEM).map((cell) => {
    const geom = collectible(cell);
    return allocate(geom, cell < 2 ? 256 : 16);
  });
  function allocate(geom, count) {
    const mesh = new T.InstancedMesh(geom, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, color.set(0xffffff));
    mesh.instanceColor.setUsage(T.DynamicDrawUsage);
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
  }
  return {
    begin() {
      for (const mesh of batches) mesh.count = 0;
    },
    draw(cell, x, y, z, size, roll = 0, tint = null) {
      let mesh = batches[cell];
      if (mesh.count === mesh.instanceMatrix.count) {
        const old = mesh;
        mesh = allocate(old.geometry, old.count * 2);
        mesh.instanceMatrix.array.set(old.instanceMatrix.array);
        mesh.instanceColor.array.set(old.instanceColor.array);
        mesh.count = old.count;
        batches[cell] = mesh;
        scene.remove(old);
        old.dispose();
      }
      pose.position.set(x, y, z);
      pose.scale.setScalar(size);
      pose.rotation.set(0, -0.26, roll, 'YXZ');
      pose.updateMatrix();
      mesh.setMatrixAt(mesh.count, pose.matrix);
      color.set(0xffffff);
      if (tint) color.lerp(tint, 0.48);
      mesh.setColorAt(mesh.count++, color);
    },
    end() {
      for (const mesh of batches) {
        mesh.visible = mesh.count > 0;
        if (mesh.count) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.needsUpdate = true;
        }
      }
    },
  };
}

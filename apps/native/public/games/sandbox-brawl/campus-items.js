import * as T from './vendor/three.module.js';
import { campusElevation } from './campus-map-plan.js';
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

function cutout(points) {
  const face = new T.Shape();
  points.forEach(([x, y], index) => index ? face.lineTo(x, y) : face.moveTo(x, y));
  face.closePath();
  return new T.ExtrudeGeometry(face, { depth: 0.14, bevelEnabled: false }).translate(0, 0, -0.07);
}

const ticket = cutout([
  [-0.5, -0.22], [-0.39, -0.33], [0.32, -0.33], [0.5, -0.15],
  [0.5, 0.22], [0.39, 0.33], [-0.39, 0.33], [-0.5, 0.22],
]);
const checkmark = cutout([
  [-0.34, -0.03], [-0.21, 0.08], [-0.08, -0.04],
  [0.23, 0.23], [0.35, 0.12], [-0.08, -0.24],
]);
const northPole = cutout([
  [-0.13, -0.18], [-0.06, -0.18], [-0.06, 0.048], [0.064, -0.18],
  [0.14, -0.18], [0.14, 0.18], [0.068, 0.18], [0.068, -0.045],
  [-0.057, 0.18], [-0.13, 0.18],
]);
const southPole = cutout([
  [-0.13, -0.11], [0.054, -0.11], [0.065, -0.094], [0.065, -0.045],
  [-0.078, -0.027], [-0.134, 0.025], [-0.134, 0.126], [-0.078, 0.18],
  [0.13, 0.18], [0.13, 0.11], [-0.047, 0.11], [-0.059, 0.095],
  [-0.059, 0.044], [0.082, 0.026], [0.14, -0.025], [0.14, -0.126],
  [0.084, -0.18], [-0.13, -0.18],
]);

function collectible(cell) {
  const b = new InkMesh();
  function part(form, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, stroke = 0.027) {
    b.part(form, color, x, y, z, w, h, d, rx, ry, rz, stroke);
  }
  if (cell === ITEM.green || cell === ITEM.blue) {
    const blue = cell === ITEM.blue;
    if (blue) part(ticket, 0x274768, -0.11, 0.55, -0.09, 1.03, 1, 1, 0, 0, 0.24);
    part(ticket, blue ? 0x233f76 : 0x204b4e, 0, 0.47, 0, 1, 1, 1);
    part(ticket, blue ? 0x6cbcf8 : 0x81e1b2, 0, 0.48, 0.076, 0.87, 0.79, 0.24, 0, 0, 0, 0);
    part(checkmark, 0xfff9df, -0.01, 0.48, 0.097, 0.68, 0.68, 0.21, 0, 0, 0, 0);
  } else if (cell === ITEM.gold) {
    part(star, 0x643747, 0, 0.55, 0, 1.13, 1.13, 1.1);
    part(star, 0xffca64, 0, 0.56, 0.09, 0.93, 0.93, 0.38);
    part(star, 0xfff3bf, 0, 0.57, 0.126, 0.45, 0.45, 0.16, 0, 0, 0, 0);
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
    b.box(0x402836, 0, 0.53, 0, 1.66, 0.66, 0.43, 0, 0.06);
    b.box(0xf17161, -0.397, 0.55, 0.069, 0.766, 0.56, 0.36, 0, 0.018);
    b.box(0x548fc9, 0.397, 0.55, 0.069, 0.766, 0.56, 0.36, 0, 0.018);
    b.box(0xffa38b, -0.39, 0.753, 0.251, 0.49, 0.044, 0.026, 0, 0);
    b.box(0xa0d6f4, 0.39, 0.753, 0.251, 0.49, 0.044, 0.026, 0, 0);
    part(northPole, 0xfff4d8, -0.397, 0.55, 0.272, 1, 0.89, 0.16, 0, 0, 0, 0);
    part(southPole, 0xfff4d8, 0.397, 0.55, 0.272, 1, 0.89, 0.16, 0, 0, 0, 0);
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
      const facesCamera = cell <= ITEM.gold || cell === ITEM.magnet;
      pose.rotation.set(facesCamera ? 0.13 - campusElevation : 0, facesCamera ? 0 : -0.26, roll, 'YXZ');
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

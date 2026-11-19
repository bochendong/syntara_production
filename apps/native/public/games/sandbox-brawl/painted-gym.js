import * as THREE from './vendor/three.module.js';
import { gymFloorPoint, gymScaleZ } from './gym-projection.js';

const width = 1774;
const height = 887;

// The painting and the world use the same orthographic projection. Lifting a
// painted point must also bring it toward the camera to preserve its pixel.
export function addPaintedGym(group, elevation, runs) {
  const loader = new THREE.TextureLoader();
  const paint = loader.load(new URL('./campus-props/gym-maze-paint.webp', import.meta.url).href);
  paint.colorSpace = THREE.SRGBColorSpace;
  const mask = loader.load(new URL('./campus-props/gym-maze-mask.webp', import.meta.url).href);
  const scaleY = gymScaleZ * Math.tan(elevation);

  function surface(name, alphaMap) {
    const positions = [], uvs = [];
    function vertex([u, v, rise]) {
      const [x, z] = gymFloorPoint(u, v + rise);
      positions.push(x, rise * scaleY, z);
      uvs.push(u / width, 1 - v / height);
    }
    return {
      quad(a, b, c, d) {
        for (const point of [a, b, d, b, c, d]) vertex(point);
      },
      finish() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        const material = new THREE.MeshBasicMaterial({
          map: paint, alphaMap, alphaTest: alphaMap ? 0.5 : 0,
          side: THREE.DoubleSide, toneMapped: false,
        });
        // Students face the camera, so their depth is the depth at their shoes.
        // Give a painted surface the same convention at its ground contact.
        // The projection still uses its full three-dimensional silhouette.
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            gl_Position.z = (projectionMatrix * modelViewMatrix * vec4(position.x, 0.0, position.z, 1.0)).z;`,
          );
        };
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = name;
        group.add(mesh);
      },
    };
  }

  const equipment = surface('painted gym equipment', mask);
  const walls = surface('painted gym architecture', null);
  function strip(surface, left, right, back, front, backRise, frontRise) {
    surface.quad([left, back, backRise], [right, back, backRise],
      [right, front, frontRise], [left, front, frontRise]);
  }
  function boxFaces(left, top, right, foot, facePixels) {
    const shoulder = foot - facePixels;
    // A constant-height lid, followed by a vertical face at the front contact line.
    strip(equipment, left, right, top, shoulder, facePixels, facePixels);
    strip(equipment, left, right, shoulder, foot, facePixels, 0);
  }
  for (const [left, top, right, front] of runs) {
    // The mask retains the ink fringe and rounded seams outside the solid footprint.
    boxFaces(left - 5, top - 5, right + 5, Math.min(height, front + 4), 45);
  }
  boxFaces(61, 775, 280, 862, 57); // benches, including the open space underneath
  boxFaces(278, 738, 329, 862, 107); // water cooler
  boxFaces(328, 799, 365, 862, 47); // bin

  // The rim projects into the court from a suspended side-on backboard.
  // Set their contact depths below their visible bottoms, as neither touches the floor.
  strip(equipment, 1644, 1765, 256, 460, 363, 159);
  strip(equipment, 1608, 1674, 351, 422, 267, 196);

  // Wall panels flank two open doorways. A lintel can hide the top of a
  // character in the hall while the passage beneath it remains visible.
  function backWall(left, right, top, bottom, base) {
    strip(walls, left, right, top, bottom, base - top, base - bottom);
  }
  backWall(58, 377, 0, 150, 151);
  backWall(535, 818, 0, 149, 151);
  backWall(971, 1282, 0, 150, 151);
  // The bay's wooden surround stands forward of its rear panel.
  backWall(1282, 1664, 0, 45, 155);
  backWall(1282, 1302, 45, 155, 155);
  backWall(1645, 1664, 45, 155, 155);
  backWall(1302, 1645, 45, 115, 116);
  backWall(1664, 1711, 0, 152, 153);
  function doorway(left, right) {
    backWall(left, right, 0, 58, 151);
    walls.quad([left, 58, 96], [left + 40, 58, 78],
      [left + 40, 137, 0], [left, 156, 0]);
    walls.quad([right - 40, 58, 78], [right, 58, 96],
      [right, 156, 0], [right - 40, 137, 0]);
  }
  doorway(377, 535);
  doorway(818, 971);
  // The pillars and sports equipment stand slightly in front of the rear wall.
  for (const [left, right, foot] of [[65, 95, 172], [1237, 1268, 172], [1681, 1709, 170]]) {
    backWall(left, right, 0, foot, foot);
  }
  boxFaces(1306, 55, 1440, 151, 84); // basketball rack, including its open frame
  boxFaces(1475, 58, 1602, 152, 68); // vaulting box

  // The long window walls recede toward the smaller, distant pillars.
  const leftEdge = [[0, 96], [150, 95], [173, 77], [668, 40], [687, 38], [887, 39]];
  const rightEdge = [[0, 1680], [150, 1681], [172, 1704], [668, 1737], [687, 1736], [887, 1736]];
  for (const [edge, outside] of [[leftEdge, 0], [rightEdge, width]]) {
    for (let i = 1; i < edge.length; i++) {
      const [v0, inner0] = edge[i - 1], [v1, inner1] = edge[i];
      walls.quad([outside, v0, 139], [inner0, v0, 0],
        [inner1, v1, 0], [outside, v1, 139]);
    }
  }
  walls.finish();
  equipment.finish();
  return paint;
}

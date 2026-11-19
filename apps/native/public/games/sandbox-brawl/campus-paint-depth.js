import * as THREE from './vendor/three.module.js';

// Clip after triangulation so concave furniture and the spaces between legs
// stay intact even where the flat top meets the front face.
function clipTriangle(polygon, line, keepTop) {
  const clipped = [];
  let previous = polygon.at(-1);
  for (const current of polygon) {
    const a = previous.y - line;
    const b = current.y - line;
    if (a * b < 0) {
      clipped.push(new THREE.Vector2(previous.x + (current.x - previous.x) * a / (a - b), line));
    }
    if (keepTop ? b <= 0 : b >= 0) clipped.push(current);
    previous = current;
  }
  return clipped;
}

export function addCampusDepth(group, texture, fixtures, floorPoint, elevation) {
  const [width, height] = texture.userData.plateSize;
  const positions = [], uvs = [];
  const slope = Math.tan(elevation);
  for (const { foot, silhouette, holes = [], top } of fixtures) {
    if (!silhouette?.length) continue;
    const contour = silhouette.map(([x, y]) => new THREE.Vector2(x, y));
    const cutouts = holes.map((ring) => ring.map(([x, y]) => new THREE.Vector2(x, y)));
    const triangles = THREE.ShapeUtils.triangulateShape(contour, cutouts);
    const points = contour.concat(...cutouts);
    const back = foot[1], front = foot[3];
    const lid = top ?? Math.min(...contour.map((p) => p.y));
    const rise = Math.max(0, back - lid);
    const shoulder = front - rise;
    function vertex({ x: u, y: v }) {
      const ground = Math.max(v, Math.min(front, Math.max(back, v + rise)));
      const [x, z] = floorPoint(u, ground);
      const [, projectedZ] = floorPoint(u, v);
      positions.push(x, (z - projectedZ) * slope, z);
      uvs.push(u / width, 1 - v / height);
    }
    for (const triangle of triangles) {
      let pieces = [triangle.map((i) => points[i])];
      for (const line of [lid, shoulder, front]) {
        const divided = [];
        for (const polygon of pieces) {
          if (polygon.some((p) => p.y < line) && polygon.some((p) => p.y > line)) {
            divided.push(clipTriangle(polygon, line, true), clipTriangle(polygon, line, false));
          } else divided.push(polygon);
        }
        pieces = divided;
      }
      for (const polygon of pieces) {
        for (let i = 1; i < polygon.length - 1; i++) {
          vertex(polygon[0]);
          vertex(polygon[i]);
          vertex(polygon[i + 1]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  // Character cards face the camera and use the depth at their feet. Keep the
  // full projected shape but sort each furniture fragment by its ground contact.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      gl_Position.z = (projectionMatrix * modelViewMatrix * vec4(position.x, 0.0, position.z, 1.0)).z;`,
    );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'painted campus fixtures';
  group.add(mesh);
  return mesh;
}

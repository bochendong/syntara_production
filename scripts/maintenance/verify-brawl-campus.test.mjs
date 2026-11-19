import assert from 'node:assert/strict';
import test from 'node:test';
import {
  campusLayout,
  campusStudentRadius,
  insideCampusObstacle,
  portalSites,
  resolveCampusObstacles,
  taskSites,
} from '../../apps/native/public/games/sandbox-brawl/campus.js';

const { walls } = campusLayout();
const radius = campusStudentRadius;
const blocked = (x, z, r = radius) => insideCampusObstacle(walls, x, z, r);

// Walk using the match collision resolver at a normal simulation step.
function walk(from, to) {
  const body = { x: from[0], z: from[1] };
  const dx = to[0] - from[0],
    dz = to[1] - from[1];
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.12);
  for (let i = 0; i < steps; i++) {
    body.x += dx / steps;
    body.z += dz / steps;
    resolveCampusObstacles(walls, body, radius);
  }
  return Math.hypot(body.x - to[0], body.z - to[1]);
}

test('the gallery has three walk-through gaps and solid panels between them', () => {
  for (const [from, to] of [
    [
      [-20.5, 8],
      [-20.5, 20],
    ],
    [
      [-35, 26.5],
      [-23.5, 20.5],
    ],
    [
      [-6.5, 27],
      [-17, 21],
    ],
  ]) {
    assert.ok(walk(from, to) < 0.02);
    assert.ok(walk(to, from) < 0.02);
  }
  assert.ok(walk([-21, 23], [-21, 34]) > 1);
});

test('ground navigation connects the corridor, all free floor cells and all four portals', () => {
  const cells = new Set();
  for (let x = -40; x < 40; x++) {
    for (let z = -34; z < 34; z++) {
      if (!blocked(x + 0.5, z + 0.5, 0.4)) cells.add(x + ',' + z);
    }
  }
  const queue = [[0, 0]];
  cells.delete('0,0');
  for (const [x, z] of queue) {
    for (const [dx, dz] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const nx = x + dx,
        nz = z + dz;
      if (cells.delete(nx + ',' + nz)) queue.push([nx, nz]);
    }
  }
  assert.equal(cells.size, 0);
  for (const [x, z] of portalSites) assert.equal(blocked(x, z, 3), false);
});

test('task sites fit mop scatter and all nine multiplayer floor plates', () => {
  assert.equal(taskSites.length, 7);
  for (const { x, z } of taskSites) {
    assert.equal(blocked(x, z, 4.1), false);
    for (const dx of [-2.2, 0, 2.2]) {
      for (const dz of [-2.2, 0, 2.2]) assert.equal(blocked(x + dx, z + dz, 0.8), false);
    }
  }
});

test('the ball rack, desk legs and laboratory tubes have open sightlines', async () => {
  const { buildCampusModels } =
    await import('../../apps/native/public/games/sandbox-brawl/campus-models.js');
  const { Raycaster, Vector3 } =
    await import('../../apps/native/public/games/sandbox-brawl/vendor/three.module.js');
  const lab = walls.find((w) => w.kind === 'lab' && w.x1 - w.x0 > 6 && w.z1 - w.z0 < 4);
  const models = buildCampusModels([
    ...walls.filter((w) => ['desk', 'ballRack'].includes(w.kind)),
    lab,
  ]);
  models.updateMatrixWorld(true);
  function hits(name, x, y) {
    const mesh = models.getObjectByName(name);
    const ray = new Raycaster(
      new Vector3(mesh.position.x + x, y, mesh.position.z + 3),
      new Vector3(0, 0, -1),
    );
    return ray.intersectObject(mesh).length > 0;
  }
  assert.equal(hits('ballRack', 0, 1.96), true);
  assert.equal(hits('ballRack', 0.69, 1.96), false);
  assert.equal(hits('ballRack', 0.49, 1.32), false);
  assert.equal(hits('desk', 0.81, 0.57), false);
  assert.equal(hits('desk', 0.81, 1.5), true);
  const middleTube = -(lab.x1 - lab.x0) * 0.24;
  assert.equal(hits('lab', middleTube, 2.89), true);
  assert.equal(hits('lab', middleTube + 0.215, 2.89), false);
});

test('modeled pickups retain all instances when a dense XP field exceeds capacity', async () => {
  const { createCampusItems, ITEM } =
    await import('../../apps/native/public/games/sandbox-brawl/campus-items.js');
  const { Scene, Matrix4 } =
    await import('../../apps/native/public/games/sandbox-brawl/vendor/three.module.js');
  const scene = new Scene(),
    art = createCampusItems(scene);
  art.begin();
  for (let i = 0; i < 300; i++) art.draw(ITEM.green, i, 0, -i, 0.6);
  art.draw(ITEM.satchel, 1, 0, 3, 1.4);
  art.end();
  const gems = scene.children.find((m) => m.count === 300);
  assert.ok(gems?.visible);
  assert.equal(scene.children.filter((m) => m.visible).length, 2);
  const matrix = new Matrix4();
  for (const i of [0, 200, 299]) {
    gems.getMatrixAt(i, matrix);
    assert.equal(matrix.elements[12], i);
    assert.equal(matrix.elements[14] + i, 0);
  }
  for (const m of scene.children) {
    m.geometry.computeBoundingBox();
    assert.ok(m.geometry.boundingBox.max.z - m.geometry.boundingBox.min.z > 0.1);
  }
  art.begin();
  art.end();
  assert.equal(scene.children.filter((m) => m.visible).length, 0);
});

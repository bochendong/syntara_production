import assert from 'node:assert/strict';
import test from 'node:test';
import { access } from 'node:fs/promises';
import {
  campusLayout,
  campusPaintURL,
  campusStudentRadius,
  insideCampusObstacle,
  portalSites,
  resolveCampusObstacles,
  taskSites,
} from '../../apps/native/public/games/sandbox-brawl/campus.js';
import {
  architecture, campusElevation, floorPoint, plateHeight, plateWidth, roomViews,
} from '../../apps/native/public/games/sandbox-brawl/campus-map-plan.js';

const { walls } = campusLayout();
const radius = campusStudentRadius;
const blocked = (x, z, r = radius) => insideCampusObstacle(walls, x, z, r);

// Walk using the match collision resolver at a normal simulation step.
function walk(obstacles, from, to) {
  const body = { x: from[0], z: from[1] };
  const dx = to[0] - from[0],
    dz = to[1] - from[1];
  const steps = Math.ceil(Math.hypot(dx, dz) / 0.12);
  for (let i = 0; i < steps; i++) {
    body.x += dx / steps;
    body.z += dz / steps;
    resolveCampusObstacles(obstacles, body, radius);
  }
  return Math.hypot(body.x - to[0], body.z - to[1]);
}

function walkPaintedRoute(points) {
  for (let i = 1; i < points.length; i++) {
    const from = floorPoint(...points[i - 1]), to = floorPoint(...points[i]);
    assert.equal(blocked(...from), false, `blocked at painted pixel ${points[i - 1]}`);
    assert.equal(blocked(...to), false, `blocked at painted pixel ${points[i]}`);
    assert.ok(walk(walls, from, to) < 0.02, `blocked passage ${points[i - 1]} to ${points[i]}`);
    assert.ok(walk(walls, to, from) < 0.02, `blocked return ${points[i]} to ${points[i - 1]}`);
  }
}

test('paint detail fits the display and GPU texture limit', async () => {
  const tiers = [
    [2048, 1600, 'campus-paint.webp'],
    [4096, 1600, 'campus-paint-2x.webp'],
    [8192, 780, 'campus-paint-2x.webp'],
    [8192, 1600, 'campus-paint-4x.webp'],
  ];
  for (const [maxTextureSize, shortEdgePixels, expected] of tiers) {
    const url = new URL(campusPaintURL(maxTextureSize, shortEdgePixels));
    assert.equal(url.pathname.split('/').at(-1), expected);
    await access(url);
  }
});

test('all rooms share the painted proportions and an aligned central partition', () => {
  const [left, back] = floorPoint(0, 0);
  const [right, front] = floorPoint(plateWidth, plateHeight);
  const ratio = (right - left) / ((front - back) * Math.sin(campusElevation));
  assert.ok(Math.abs(ratio - plateWidth / plateHeight) < 1e-8);
  assert.equal(roomViews.art.bounds[2], roomViews.gym.bounds[0]);
  assert.equal(roomViews.art.bounds[2], roomViews.classroom.bounds[2]);
  assert.equal(roomViews.gym.bounds[0], plateWidth / 2);
  for (const room of Object.values(roomViews)) assert.equal(blocked(...floorPoint(...room.feet)), false);
});

test('two gym doors open onto the corridor and the other three furnished rooms', () => {
  walkPaintedRoute([[1038, 736], [948, 736], [948, 679], [978, 679], [978, 500]]);
  walkPaintedRoute([[1190, 804], [1190, 734], [1186, 734], [1186, 677], [1204, 677], [1204, 500]]);
  walkPaintedRoute([[978, 500], [1204, 500], [413, 500]]);
  walkPaintedRoute([[413, 500], [413, 240]]);
  walkPaintedRoute([[418, 500], [418, 172]]);
  walkPaintedRoute([[1180, 500], [1180, 300], [1175, 300]]);
  walkPaintedRoute([[412, 500], [412, 680], [423, 680], [423, 780]]);
  // These are the visible wall panels immediately to the sides of the door sills.
  for (const pixel of [[355, 449], [1238, 449], [362, 546], [941, 552], [1172, 552]]) {
    assert.ok(blocked(...floorPoint(...pixel), 0), `wall gap at ${pixel}`);
  }
});

test('both studio entrances and the classroom-to-lab passage are open between solid jambs', () => {
  // Walk three lines through each opening, including the near edges of the usable width.
  for (const u of [194, 212, 234, 387, 412, 436]) {
    walkPaintedRoute([[u, 505], [u, 682]]);
  }
  for (const v of [272, 291, 311]) {
    walkPaintedRoute([[750, v], [842, v]]);
  }

  const structuralWalls = walls.filter((wall) => wall.kind === 'wall');
  const blockedCrossings = [
    ...[168, 274, 352, 471].map((u) => [[u, 505], [u, 682]]),
    ...[242, 339].map((v) => [[750, v], [842, v]]),
  ];
  for (const [a, b] of blockedCrossings) {
    const from = floorPoint(...a), to = floorPoint(...b);
    assert.ok(walk(structuralWalls, from, to) > 1, `missing wall from ${a} to ${b}`);
    assert.ok(walk(structuralWalls, to, from) > 1, `missing wall from ${b} to ${a}`);
  }
});

test('the three studio wall panels line up with the adjacent gym panel', () => {
  // Read one section on either side of each studio door and the shared room boundary.
  for (const u of [100, 315, 610, 875]) {
    const panel = architecture.find(({ foot: [left, back, right, front] }) =>
      left < u && u < right && back < 570 && 570 < front);
    assert.ok(panel, `missing corridor panel at u=${u}`);
    const heights = panel.silhouette.map(([, v]) => v);
    assert.deepEqual([Math.min(...heights), Math.max(...heights)], [534, 613], `painted panel at u=${u}`);
    assert.deepEqual([panel.foot[1], panel.foot[3]], [534, 613], `physical panel at u=${u}`);
  }
});

test('the eight painted gym regions have solid mats, accessible equipment and a continuous circuit', () => {
  walkPaintedRoute([[978, 679], [865, 679], [865, 854], [897, 854], [897, 912], [874, 912]]);
  walkPaintedRoute([[1190, 804], [1190, 734], [1318, 734], [1318, 861], [1460, 861], [1473, 899], [1495, 922]]);
  walkPaintedRoute([[1318, 734], [1318, 676], [1466, 676], [1466, 792], [1396, 792], [1396, 739]]);
  walkPaintedRoute([[1038, 736], [922, 736], [922, 794], [998, 794], [998, 945], [1382, 945],
    [1382, 860], [1318, 860], [1318, 734], [1186, 734], [1186, 679], [1091, 679],
    [1091, 736], [1038, 736]]);
  for (const pixel of [[836, 714], [1007, 702], [1235, 668], [1497, 738],
    [1026, 858], [1141, 865], [1341, 916], [1428, 970]]) {
    const [x, z] = floorPoint(...pixel);
    assert.ok(walls.some((w) => w.kind === 'pad' && insideCampusObstacle([w], x, z)),
      `missing mat at painted pixel ${pixel}`);
  }
  const cart = walls.find((w) => w.kind === 'ballRack');
  assert.ok(cart && insideCampusObstacle([cart], ...floorPoint(1415, 616)));
  assert.equal(blocked(...floorPoint(1536, 762)), false);
});

test('ground navigation connects the corridor, all free floor cells and all eight portals', () => {
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
  assert.equal(portalSites.length, 8);
  assert.equal(new Set(portalSites.map((point) => point.join(','))).size, 8);
  const roomAt = ([x, z]) => [Math.sign(x), Math.sign(z)].join(',');
  const roomOrder = portalSites.slice(0, 4).map(roomAt);
  assert.equal(new Set(roomOrder).size, 4);
  assert.deepEqual(portalSites.slice(4).map(roomAt), roomOrder);
  for (const [index, [x, z]] of portalSites.entries()) {
    // The court centre has a narrower passage between the padded walls.
    const clearance = index === 6 ? 2.75 : 3;
    assert.equal(blocked(x, z, clearance), false);
    assert.ok(queue.some(([i, j]) => i === Math.floor(x) && j === Math.floor(z)));
  }
});

test('task sites fit mop scatter and all nine multiplayer floor plates', () => {
  assert.ok(taskSites.length > 0);
  for (const { x, z } of taskSites) {
    assert.equal(blocked(x, z, 4.1), false);
    for (const dx of [-2.2, 0, 2.2]) {
      for (const dz of [-2.2, 0, 2.2]) assert.equal(blocked(x + dx, z + dz, 0.8), false);
    }
  }
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

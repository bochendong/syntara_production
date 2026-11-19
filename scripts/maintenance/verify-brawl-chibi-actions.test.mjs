import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../../apps/native/public/games/sandbox-brawl/vendor/three.module.js';
import { CHIBI_CELL, poseChibi } from '../../apps/native/public/games/sandbox-brawl/student-chibi.js';

const camera = new THREE.PerspectiveCamera();
const world = new THREE.Matrix4().makeTranslation(2, 0, 3);
function pose(actor, now) {
  const cell = [];
  const cells = { setXYZ: (_i, x, y, mirror) => cell.push(x, y, mirror) };
  const matrix = new THREE.Matrix4();
  poseChibi(matrix, cells, 0, world, camera, actor, now);
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { cell, position, roll: new THREE.Euler().setFromQuaternion(rotation).z, scale };
}
const cellOf = (name) => [CHIBI_CELL[name][0] / 8, -CHIBI_CELL[name][1] / 4];

test('an attack winds up, strikes and recovers while facing the target', () => {
  const actor = { atkAt: 10, atkFaceLeft: true, scholarFacingLeft: false };
  assert.deepEqual(pose(actor, 10.02).cell, [...cellOf('windup'), 1]);
  assert.deepEqual(pose(actor, 10.1).cell, [...cellOf('strike'), 1]);
  assert.deepEqual(pose(actor, 10.2).cell, [...cellOf('follow'), 1]);
  assert.equal(pose(actor, 11).cell[2], 0, 'walking direction returns after the attack');
});

test('a knocked-down hero topples onto the floor and stays there', () => {
  const actor = { downAt: 5 };
  const early = pose(actor, 5.05), lying = pose(actor, 7);
  assert.deepEqual(early.cell.slice(0, 2), cellOf('hurt'));
  assert.deepEqual(lying.cell.slice(0, 2), cellOf('down'));
  assert.ok(Math.abs(Math.abs(lying.roll) - Math.PI / 2) < 1e-3);
  assert.ok(Math.abs(lying.position.y) < 1e-3);
});

test('getting up returns upright, and title acts finish back at idle', () => {
  assert.ok(Math.abs(pose({ riseAt: 1 }, 2).roll) < 1e-6);
  const jump = pose({ act: 'cheer', actAt: 0 }, 0.4);
  assert.ok(jump.position.y > 0.3, 'the cheer leaves the ground');
  assert.deepEqual(pose({ act: 'cheer', actAt: 0 }, 3).cell.slice(0, 2), [0, -0]);
});

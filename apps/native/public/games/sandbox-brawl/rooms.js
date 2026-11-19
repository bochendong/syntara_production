import * as THREE from './vendor/three.module.js';
import {
  createCampus, floorPoint, campusElevation, campusStudentDrawScale, campusStudentRadius,
  insideCampusObstacle, resolveCampusObstacles, portalSites,
} from './campus.js?v=eight-portals';
import { roomViews, plateWidth, plateHeight, mapHalfDepth, hallNorth, hallSouth } from './campus-map-plan.js?v=campus-doorways';
import { buildInkPortal } from './campus-models.js?v=continuous-campus';
import { castShadowMatrix } from './campus-mesh.js';
import { scholarLook, studentCardGeometry, studentTexture } from './student-chibi.js?v=continuous-campus';
import { campusDetails, detailURL } from './campus-details.js?v=continuous-campus';

const names = { classroom: '教室', lab: '实验室', art: '美术室', gym: '体育馆' };
const grid = document.querySelector('#rooms');
const canvas = document.querySelector('#campus');
const back = document.querySelector('#back');
const hint = document.querySelector('#hint');
const place = document.querySelector('#location');
const catalog = document.querySelector('#catalog');
const status = document.querySelector('#status');
const halfMap = floorPoint(plateWidth, 0)[0];
const sine = Math.sin(campusElevation);

function setup() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0xe5dfd0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-halfMap, halfMap, 25, -25, 0.1, 180);
  let pending = false, loaded = false, failed = false;
  let selected, body, center, lastStep = 0, frame = 0, distance = 0, pose = 0, facingLeft = false;
  const buttons = new Map();
  const refresh = () => {
    if (!pending) { pending = true; requestAnimationFrame(draw); }
  };
  THREE.DefaultLoadingManager.onLoad = () => { loaded = true; refresh(); };
  THREE.DefaultLoadingManager.onError = () => {
    failed = true;
    status.hidden = false;
    status.textContent = '部分贴图加载失败，请刷新重试。';
  };
  const marks = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  marks.needsUpdate = true;
  const ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
  const campus = createCampus(marks, { value: 0 }, ripples, renderer);
  scene.add(campus.group);
  for (const [x, z] of portalSites) {
    const { mesh, rim } = buildInkPortal(true);
    mesh.position.set(x, 0, z);
    rim.position.copy(mesh.position);
    scene.add(mesh, rim);
  }
  const map = studentTexture(scholarLook);
  const student = new THREE.Mesh(studentCardGeometry(), new THREE.MeshBasicMaterial({ map, alphaTest: 0.35 }));
  const shadow = new THREE.Mesh(student.geometry, campus.castShadowMaterial(map));
  shadow.matrixAutoUpdate = false;
  shadow.renderOrder = -1;
  scene.add(student, shadow);

  function draw() {
    pending = false;
    const size = canvas.getBoundingClientRect();
    const density = Math.min(devicePixelRatio, 2);
    const width = Math.max(1, Math.round(size.width * density));
    const height = Math.max(1, Math.round(size.height * density));
    if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false);
    const halfWidth = selected ? Math.min(15, 12.5 * width / height) : halfMap;
    const halfHeight = selected ? halfWidth * height / width : mapHalfDepth * sine;
    Object.assign(camera, { left: -halfWidth, right: halfWidth, top: halfHeight, bottom: -halfHeight });
    camera.updateProjectionMatrix();
    const limitX = Math.max(0, halfMap - halfWidth);
    const limitZ = Math.max(0, mapHalfDepth - halfHeight / sine);
    const x = selected ? THREE.MathUtils.clamp(center[0], -limitX, limitX) : 0;
    const z = selected ? THREE.MathUtils.clamp(center[1], -limitZ, limitZ) : 0;
    if (selected) center = [x, z];
    camera.position.set(x, 80 * sine, z + 80 * Math.cos(campusElevation));
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
    student.visible = shadow.visible = !!selected;
    if (selected) {
      student.position.set(body.x, 0, body.z);
      map.offset.x = pose * map.repeat.x;
      student.quaternion.copy(camera.quaternion);
      student.scale.setScalar(campusStudentDrawScale(body.x, body.z));
      if (facingLeft) student.scale.x *= -1;
      student.updateMatrix();
      shadow.matrix.multiplyMatrices(castShadowMatrix, student.matrix);
      shadow.matrixWorldNeedsUpdate = true;
      place.textContent = body.z >= hallNorth && body.z <= hallSouth ? '走廊'
        : names[body.z < hallNorth ? (body.x < 0 ? 'classroom' : 'lab') : (body.x < 0 ? 'art' : 'gym')];
    }
    renderer.render(scene, camera);
    if (loaded && !failed) status.hidden = true;
  }

  const keys = new Map([
    ['ArrowLeft', [-1, 0]], ['KeyA', [-1, 0]], ['ArrowRight', [1, 0]], ['KeyD', [1, 0]],
    ['ArrowUp', [0, -1]], ['KeyW', [0, -1]], ['ArrowDown', [0, 1]], ['KeyS', [0, 1]],
  ]);
  const held = new Set();
  function stop() {
    held.clear();
    cancelAnimationFrame(frame);
    frame = 0;
    if (pose) { pose = 0; refresh(); }
  }
  function walk(now) {
    frame = 0;
    if (!selected || !held.size) return;
    let dx = 0, dz = 0;
    for (const key of held) {
      const [x, z] = keys.get(key);
      dx += x; dz += z;
    }
    const length = Math.hypot(dx, dz);
    const stride = Math.min(0.16, (now - lastStep) / 1000) * 8;
    lastStep = now;
    if (length && stride > 0) {
      const steps = Math.ceil(stride / 0.15);
      const startX = body.x, startZ = body.z;
      for (let i = 0; i < steps; i++) {
        body.x = THREE.MathUtils.clamp(body.x + dx * stride / (length * steps), -halfMap, halfMap);
        body.z = THREE.MathUtils.clamp(body.z + dz * stride / (length * steps), -mapHalfDepth, mapHalfDepth);
        resolveCampusObstacles(campus.walls, body, campusStudentRadius);
      }
      const travel = Math.hypot(body.x - startX, body.z - startZ);
      distance += travel;
      pose = travel > .001 ? 2 + Math.floor(distance / .6) % 4 : 0;
      if (dx) facingLeft = dx < 0;
      center[0] = THREE.MathUtils.clamp(center[0], body.x - camera.right * .45, body.x + camera.right * .45);
      center[1] = THREE.MathUtils.clamp(center[1], body.z - camera.top * .4 / sine, body.z + camera.top * .4 / sine);
      refresh();
    }
    frame = requestAnimationFrame(walk);
  }
  function press(code) {
    held.add(code);
    if (!frame) { lastStep = performance.now(); frame = requestAnimationFrame(walk); }
  }
  function release(code) { held.delete(code); if (!held.size) stop(); }
  addEventListener('keydown', event => {
    if (!selected || !keys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey || catalog.contains(event.target)) return;
    event.preventDefault();
    press(event.code);
  });
  addEventListener('keyup', event => release(event.code));
  addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  for (const button of document.querySelectorAll('#pad button')) {
    button.onpointerdown = event => {
      if (!selected) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      press(button.dataset.key);
    };
    button.onlostpointercapture = () => release(button.dataset.key);
  }

  for (const [id, view] of Object.entries(roomViews)) {
    const button = document.createElement('button');
    button.className = 'room';
    button.dataset.room = id;
    const [x0,y0,x1,y1] = view.bounds;
    Object.assign(button.style, {
      left: x0 / plateWidth * 100 + '%', top: y0 / plateHeight * 100 + '%',
      width: (x1-x0) / plateWidth * 100 + '%', height: (y1-y0) / plateHeight * 100 + '%',
    });
    const label = document.createElement('span');
    label.textContent = names[id];
    button.append(label);
    button.onclick = () => { location.hash = id; };
    grid.append(button);
    buttons.set(id, button);
  }
  function select() {
    stop();
    const id = location.hash.slice(1);
    selected = Object.hasOwn(roomViews, id) ? id : null;
    grid.classList.toggle('focused', !!selected);
    for (const button of buttons.values()) button.hidden = !!selected;
    back.hidden = place.hidden = !selected;
    if (selected) {
      const [x, z] = floorPoint(...(selected === 'art' ? [411, 506] : roomViews[selected].feet));
      body = { x, z };
      center = [x, z];
      facingLeft = false;
      distance = 0;
      canvas.focus({ preventScroll: true });
      hint.textContent = matchMedia('(pointer: coarse)').matches
        ? '按方向键行走，轻点地面定位，拖动查看校园。'
        : '方向键或 WASD 行走，点地面定位，拖动查看校园。';
    } else {
      hint.textContent = '点选房间，进入校园试走。';
    }
    refresh();
  }
  let drag;
  canvas.onpointerdown = event => {
    if (!selected || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, start: [...center], moved: false };
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const units = 2 * camera.right / canvas.clientWidth;
    center = [drag.start[0] - dx * units, drag.start[1] - dy * units / sine];
    refresh();
  };
  const ray = new THREE.Raycaster(), floor = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  canvas.onpointerup = event => {
    if (!drag || !selected || drag.moved) return;
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(2 * (event.clientX - rect.left) / rect.width - 1,
      1 - 2 * (event.clientY - rect.top) / rect.height), camera);
    const p = ray.ray.intersectPlane(floor, new THREE.Vector3());
    if (!p || Math.abs(p.x) >= halfMap || Math.abs(p.z) >= mapHalfDepth ||
        insideCampusObstacle(campus.walls, p.x, p.z, campusStudentRadius)) return;
    body = { x: p.x, z: p.z };
    refresh();
  };
  canvas.onlostpointercapture = () => { drag = null; };

  for (const [id, entries] of Object.entries(campusDetails)) {
    const section = document.createElement('section');
    const title = document.createElement('h2');
    title.textContent = names[id];
    const cards = document.createElement('div');
    cards.className = 'props';
    for (const [slug, name] of entries) {
      const anchor = campus.furnishings[id]?.[slug];
      const card = document.createElement(anchor ? 'button' : 'div');
      const image = document.createElement('img');
      image.src = detailURL(id, slug);
      image.alt = '';
      image.loading = 'lazy';
      card.append(image, name);
      cards.append(card);
      if (!anchor) continue;
      card.title = '在场景中查看' + name;
      card.onclick = () => {
        history.replaceState(null, '', location.pathname + location.search + '#' + id);
        select();
        center = [anchor.x, anchor.z];
        for (const [dx, dz] of [[0,3], [2.8,3], [-2.8,3], [3.5,0], [-3.5,0]]) {
          const x = center[0] + dx, z = center[1] + dz;
          if (!insideCampusObstacle(campus.walls, x, z, campusStudentRadius)) {
            body = { x, z };
            break;
          }
        }
        catalog.open = false;
        canvas.focus({ preventScroll: true });
        window.scrollTo(0, 0);
        refresh();
      };
    }
    section.append(title, cards);
    document.querySelector('#collections').append(section);
  }
  const overview = () => {
    const previous = selected;
    history.replaceState(null, '', location.pathname + location.search);
    select();
    buttons.get(previous)?.focus({ preventScroll: true });
  };
  back.onclick = overview;
  addEventListener('keydown', event => { if (event.key === 'Escape' && selected) overview(); });
  addEventListener('hashchange', select);
  new ResizeObserver(refresh).observe(grid);
  select();
}
try { setup(); } catch (error) {
  console.error(error);
  status.textContent = '场景未能载入，请检查浏览器是否启用了 WebGL，然后刷新。';
}

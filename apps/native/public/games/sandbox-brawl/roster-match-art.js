import * as THREE from './vendor/three.module.js';

// Original 2a8f947a rig heights and ground anchors, projected by the match camera.
export const ROSTER_MONSTERS = {
  sleepy: {"name":"瞌睡团子","crop":[112,32,307,261],"height":1.274,"base":-0.124},
  bat: {"name":"问号蝙蝠","crop":[399,25,690,230],"height":0.86,"base":0.653},
  bomber: {"name":"自爆闹钟","crop":[796,28,994,260],"height":2.562,"base":-0.127},
  chalk: {"name":"粉笔射手","crop":[1113,34,1301,260],"height":1.472,"base":-0.083},
  cross: {"name":"小红叉","crop":[104,307,323,505],"height":1.051,"base":-0.063},
  mole: {"name":"钻地鼹鼠","crop":[406,304,679,499],"height":1.192,"base":-0.105},
  clock: {"name":"闹钟仔","crop":[786,293,979,496],"height":1.192,"base":-0.067},
  ink: {"name":"墨水史莱姆","crop":[1120,301,1333,502],"height":1.136,"base":-0.184},
  ghost: {"name":"纸团幽灵","crop":[90,540,317,726],"height":1.31,"base":0.078},
  phone: {"name":"手机精","crop":[443,535,622,744],"height":1.805,"base":-0.094},
  snail: {"name":"拖延蜗牛","crop":[759,543,1009,738],"height":1.81,"base":-0.37},
  hourglass: {"name":"DDL 沙漏人","crop":[1112,531,1340,744],"height":2.253,"base":-0.11},
  boss: {"name":"期末大魔王","crop":[41,768,363,1028],"height":5.534,"base":-0.262},
  dean: {"name":"教导主任","crop":[429,776,637,1028],"height":5.353,"base":-0.358},
  coach: {"name":"体育老师","crop":[739,778,1001,1028],"height":5.821,"base":-0.383},
  kraken: {"name":"墨水巨怪","crop":[1032,766,1409,1032],"height":6.881,"base":-1.378},
};

export const TARGET = { width: 1.68, height: 2.22 };

export function paintRosterTarget(canvas) {
  canvas.width = 160;
  canvas.height = 212;
  const g = canvas.getContext('2d');
  g.lineCap = 'round';
  g.strokeStyle = '#47343e';
  g.lineWidth = 27;
  g.beginPath();
  g.moveTo(80, 98);
  g.lineTo(80, 174);
  g.moveTo(39, 194);
  g.lineTo(121, 194);
  g.stroke();
  g.strokeStyle = '#a87447';
  g.lineWidth = 19;
  g.stroke();
  for (const [radius, color] of [[70, '#47343e'], [65, '#bd905a'], [58, '#faf0d4'], [44, '#ce6259'],
    [32, '#faf0d4'], [20, '#ce6259'], [9, '#f6c969']]) {
    g.beginPath();
    g.arc(80, 75, radius, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
}

export function rosterArtWidth({ crop: [x0, y0, x1, y1], height }) {
  return height * (x1 - x0) / (y1 - y0);
}

function makeCard(width, height, base, map) {
  const geometry = new THREE.PlaneGeometry(width, height).translate(0, base + height / 2, 0);
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.3, side: THREE.DoubleSide });
  const flash = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rosterWhiteFlash = flash;
    shader.fragmentShader = 'uniform float rosterWhiteFlash;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), rosterWhiteFlash);',
    );
  };
  const card = new THREE.Mesh(geometry, material);
  card.userData = { width, height, base, flash };
  return card;
}

export async function loadRosterMatchArt(scene) {
  const atlas = await new THREE.TextureLoader().loadAsync(
    new URL('./monster-art.png', import.meta.url).href,
  );
  atlas.colorSpace = THREE.SRGBColorSpace;
  const canvas = document.createElement('canvas');
  paintRosterTarget(canvas);
  const target = new THREE.CanvasTexture(canvas);
  target.colorSpace = THREE.SRGBColorSpace;
  const pools = new Map();
  const normal = new THREE.Vector3();
  const tint = new THREE.Color();
  const tilt = new THREE.Quaternion();
  const angles = new THREE.Euler();
  const axis = new THREE.Vector3();
  function create(id, data) {
    if (id === 'target') {
      const card = makeCard(TARGET.width, TARGET.height, 0, target);
      // Keep the training prop readable when the original AI makes contact.
      card.material.depthTest = card.material.depthWrite = false;
      card.renderOrder = 2;
      return card;
    }
    const card = makeCard(rosterArtWidth(data), data.height, data.base, atlas);
    const [left, top, right, bottom] = data.crop;
    const uv = card.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (left + uv.getX(i) * (right - left)) / atlas.image.width,
        1 - (bottom - uv.getY(i) * (bottom - top)) / atlas.image.height);
    }
    return card;
  }
  return {
    begin() {
      for (const pool of pools.values()) {
        for (let i = 0; i < pool.used; i++) pool.cards[i].visible = false;
        pool.used = 0;
      }
    },
    draw(id, camera, x, y, z, yaw, sx, sy, color, pitch, roll, whiteFlash) {
      const data = ROSTER_MONSTERS[id];
      if (!data && id !== 'target') return false;
      let pool = pools.get(id);
      if (!pool) {
        pool = { used: 0, cards: [] };
        pools.set(id, pool);
      }
      let card = pool.cards[pool.used++];
      if (!card) {
        card = create(id, data);
        pool.cards.push(card);
        scene.add(card);
      }
      const face = Math.sin(yaw) < -0.1 ? -1 : 1;
      card.visible = true;
      card.quaternion.copy(camera.quaternion);
      if (pitch || roll) card.quaternion.multiply(tilt.setFromEuler(angles.set(pitch, 0, roll)));
      card.scale.set(sx * face, sy, 1);
      card.material.color.copy(tint.setRGB(1, 1, 1).lerp(color, 0.8));
      const { width, height, base, flash } = card.userData;
      flash.value = Number(whiteFlash);
      // Preserve the original projected foot position even where the cutout
      // extends below it or rotates during a hit. Move along the view axis.
      normal.set(0, 0, 1).applyQuaternion(camera.quaternion);
      const bottom = axis.set(0, 1, 0).applyQuaternion(card.quaternion).y * sy;
      const edge = Math.abs(axis.set(1, 0, 0).applyQuaternion(card.quaternion).y * sx) * width / 2;
      const low = Math.min(base * bottom, (base + height) * bottom) - edge;
      const clearance = Math.max(0, 0.04 - Math.max(y, 0) - low) / Math.max(0.1, normal.y);
      card.position.set(x, y, z).addScaledVector(normal, clearance);
      return true;
    },
  };
}

export function makeRosterGround(markTexture) {
  const group = new THREE.Group();
  const floor = new THREE.PlaneGeometry(96, 96).rotateX(-Math.PI / 2);
  group.add(new THREE.Mesh(floor, new THREE.MeshBasicMaterial({ color: 0xe9ddc9 })));
  const marks = new THREE.Mesh(floor, new THREE.MeshBasicMaterial({
    map: markTexture, transparent: true, depthWrite: false,
  }));
  marks.position.y = 0.005;
  group.add(marks);
  return {
    group,
    walls: [],
    castShadowMaterial(map) {
      const material = new THREE.MeshBasicMaterial({
        map, side: THREE.DoubleSide, transparent: true, opacity: 0.26, alphaTest: 0.09,
        color: 0x3a2539, depthWrite: false,
      });
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          'diffuseColor.a *= texture2D(map, vMapUv).a;',
        );
      };
      return material;
    },
  };
}

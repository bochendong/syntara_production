import * as THREE from './vendor/three.module.js';

// The first row holds the game poses. The second row raises
// the pencil in small increments for the character-selection podium.
const columns = 8, rows = 2;
export const scholarLook = { style: 'long', outfit: 'sailor', girl: true, hair: 0x1e1a2e, top: 0xfaf8f2, pants: 0x2c3a6e, iris: 0x3a6ad8, accent: 0xe2453a, item: 'pencil', glasses: true };
export const studentCardGeometry = () => new THREE.PlaneGeometry(2.12, 2.12).translate(0, 2.12 * (232 / 256 - 0.5), 0);
const textures = new Map();
const ink = '#342638';
const css = (color) => '#' + color.toString(16).padStart(6, '0');

function paintStudent(ctx, look, frame, lift = 0) {
  const hair = css(look.hair), navy = css(look.pants), bow = css(look.accent ?? 0xffd25a);
  const skin = css(look.skin ?? 0xffdfbe), cream = css(look.top);
  const scholar = look.item === 'pencil';
  const skirt = ['sailor', 'cardigan', 'cheer', 'apron'].includes(look.outfit);
  const stride = [0, 0, -1, -0.36, 1, 0.36, 0, 0][frame];
  const jab = frame === 6, reading = frame === 7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  function shape(path, fill, width = 3.6) {
    const contour = new Path2D(path);
    ctx.fillStyle = fill;
    ctx.fill(contour);
    if (width) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = width;
      ctx.stroke(contour);
    }
  }
  function oval(x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  function pivot(x, y, angle, paint) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.translate(-x, -y);
    paint();
    ctx.restore();
  }
  function leg(x, swing) {
    ctx.save();
    ctx.translate(x, 197);
    ctx.rotate(swing);
    shape('M-9 0 Q0 -4 10 0 L9 24 Q2 28 -7 24 Z', skirt ? '#fff0d7' : navy);
    shape('M-9 22 Q-1 25 8 21 Q18 21 19 29 Q18 36 -9 34 Q-13 31 -9 22Z', look.big ? '#fff4dc' : '#664051');
    ctx.restore();
  }
  leg(108, stride * 0.40);
  leg(145, -stride * 0.42);
  ctx.save();
  ctx.translate(0, -Math.abs(stride) * 3);
  // The pencil, sleeve and mitten rotate about the same shoulder.
  function itemArm() {
    pivot(154, 152, jab ? 0.72 : stride * 0.075 - lift * 0.27, () => {
      shape('M155 147 Q169 146 179 158 L172 171 Q157 169 150 161Z', cream);
      if (scholar) pivot(176, 159, 0.37 + lift * 0.39, () => {
        shape('M170 108 L182 108 L182 194 Q176 198 170 194Z', '#f4b73f');
        shape('M170 108 L176 91 L182 108Z', '#ffd7a2', 2.7);
        shape('M173.5 98 L176 91 L178.5 98Z', ink, 1);
        shape('M170 185 L182 185 L182 194 Q176 198 170 194Z', '#ea8072', 2.5);
      });
      else pivot(176, 159, lift * 0.12, () => drawItem(look.item, shape, oval, bow));
      shape('M168 157 Q172 151 177 155 Q185 155 183 164 Q181 171 172 169 Q166 168 168 157Z', skin, 2.8);
    });
  }
  if (skirt) shape('M100 173 Q123 167 149 174 L161 197 Q135 211 89 200Z', navy);
  else shape('M100 172 L152 172 L156 198 L133 201 L127 195 L122 201 L96 201Z', navy);
  shape('M107 135 Q127 128 145 137 Q157 146 156 180 Q134 189 96 179 Q95 151 107 135Z', look.outfit === 'labcoat' ? '#fff8e9' : cream);
  if (look.outfit === 'sailor') {
    shape('M103 139 Q126 132 151 139 L133 158Z', navy, 2.8);
    shape('M125 153 L135 155 L144 173 L134 169 L128 177 L124 161Z', bow, 2.5);
  } else drawUniform(look, shape, oval, cream, bow);
  itemArm();
  pivot(104, 154, reading ? 0.28 : -stride * 0.055, () => {
    if (scholar) shape('M93 154 L113 149 L124 178 L102 185Z', '#4c9990');
    if (scholar) shape('M96 155 L112 151 L113 155 L97 159Z', '#ffedcb', 1.3);
    shape('M94 152 Q86 152 86 164 Q86 171 95 172 L102 167Z', cream);
    if (look.armband) shape('M89 155 L97 151 L101 159 L91 164Z', css(look.armband), 2);
    shape('M94 162 Q100 158 105 163 Q109 169 102 173 Q94 178 91 171Z', skin, 2.8);
  });

  pivot(125, 132, jab ? -0.055 : reading ? 0.065 : stride * 0.025 + lift * 0.035, () => {
    // A single rounded bob with a blunt hem and two broad swept fringe shapes.
    drawBackHair(look, shape, hair);
    if (look.style === 'long' || look.style === 'bob') shape('M59 93 Q54 50 83 31 Q100 18 131 20 Q171 17 187 51 Q198 73 191 101 L193 125 Q182 140 161 143 Q116 157 68 138 Q55 133 53 123Z', hair, 4.5);
    else shape('M65 97 Q53 60 79 37 Q99 16 135 21 Q183 22 191 61 Q197 86 186 113 Q146 141 83 123Z', hair, 4.5);
    shape('M80 73 Q110 49 157 61 Q186 64 188 93 Q191 123 166 135 Q143 147 112 139 Q85 135 78 116 Q62 117 64 102 Q64 92 76 94Z', skin, 3.5);
    // The part sits off centre; neither fringe crosses the glasses.
    if (scholar) {
      shape('M66 89 Q61 56 91 36 Q110 23 143 28 Q149 54 121 69 Q107 79 86 81 L76 101 Q68 103 66 89Z', hair, 3.3);
      shape('M140 29 Q179 28 187 61 Q191 71 188 85 Q167 80 154 65 Q144 52 140 40Z', hair, 2.7);
    } else drawFringe(look, shape, hair);
    oval(108, 118, 9, 4, '#f1ab95');
    oval(174, 113, 7, 3.5, '#f1ab95');
    const blink = frame === 1 || reading;
    oval(121, 99, 5, blink ? 1.5 : look.tired ? 3 : 8, ink);
    oval(165, 95, 4.4, blink ? 1.5 : look.tired ? 3 : 7, ink);
    if (!blink && !look.tired) { oval(122, 96, 1.6, 2, '#fff6da'); oval(166, 92, 1.4, 1.7, '#fff6da'); }
    if (look.glasses) {
      ctx.strokeStyle = '#513748'; ctx.lineWidth = 4.6;
      ctx.beginPath(); ctx.ellipse(119, 99, 19, 17, -0.08, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(165, 95, 16, 15.5, -0.08, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(138, 96); ctx.quadraticCurveTo(145, 91, 149, 94);
      ctx.moveTo(100, 98); ctx.lineTo(78, 94); ctx.stroke();
    }
    ctx.strokeStyle = ink;
    ctx.beginPath(); ctx.moveTo(139, 120); ctx.quadraticCurveTo(145, 124, 151, 116);
    ctx.lineWidth = 2.8; ctx.stroke();
    if (scholar) shape('M74 62 L89 51 L93 57 L78 69Z', bow, 2.3);
    else drawHeadwear(look, shape, oval, bow);
  });
  ctx.restore();
}

export function studentTexture(look) {
  const key = JSON.stringify(look);
  if (textures.has(key)) return textures.get(key);
  const tile = look.item === 'pencil' ? 384 : 224;
  const canvas = document.createElement('canvas');
  canvas.width = tile * columns;
  canvas.height = tile * rows;
  const ctx = canvas.getContext('2d');
  for (let row = 0; row < rows; row++) {
    for (let frame = 0; frame < columns; frame++) {
      ctx.save();
      ctx.translate(tile * frame, tile * row);
      ctx.scale(tile / 256, tile / 256);
      if (row === 1) paintStudent(ctx, look, 0, frame / (columns - 1));
      else paintStudent(ctx, look, frame);
      ctx.restore();
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.repeat.set(1 / columns, 1 / rows);
  map.offset.y = (rows - 1) / rows;
  textures.set(key, map);
  return map;
}

export function studentIcon(look) {
  const texture = studentTexture(look);
  if (!texture.userData.icon) {
    const tile = texture.image.height / rows;
    const icon = document.createElement('canvas');
    icon.width = icon.height = 96;
    icon.getContext('2d').drawImage(texture.image, tile * 0.15, tile * 0.04, tile * 0.69, tile * 0.69, 0, 0, 96, 96);
    texture.userData.icon = icon.toDataURL();
  }
  return texture.userData.icon;
}

// The portrait uses the atlas's default cell. Actors sharing an instanced mesh
// need independent cells for their action, including their shadows.
export function useStudentCells(material) {
  const original = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    original.call(this, shader, renderer);
    shader.vertexShader = 'attribute vec3 studentCell;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>', '#include <uv_vertex>\nif (studentCell.z > 0.5) vMapUv.x = mapTransform[0][0] - vMapUv.x;\nvMapUv += studentCell.xy;',
    );
  };
  material.customProgramCacheKey = () => baseKey + '-student-mirror-cells';
}

const position = new THREE.Vector3(), scale = new THREE.Vector3();
export function poseChibi(matrix, cells, index, world, camera, actor, now) {
  position.setFromMatrixPosition(world);
  scale.setFromMatrixScale(world);
  const shot = now - (actor.scholarShotAt ?? -99) < 0.18;
  const moving = actor.scholarGait ?? actor.moving ?? 0;
  let frame = 0;
  if (shot) frame = 6;
  else if (moving > 0.12) {
    const phase = actor.scholarPhase ?? actor.ph ?? 0;
    frame = 2 + (Math.floor(phase * 2 / Math.PI) % 4);
  } else if ((actor.scholarIdle ?? 0) % 6 > 4.6) frame = 7;
  else if ((now + (actor.seed || 0)) % 3.8 < 0.13) frame = 1;
  let row = 0;
  if (actor.podiumIdle) {
    const breath = Math.sin(now * Math.PI * 2 / 3.2);
    scale.y *= 1 + 0.009 * breath;
    scale.x *= 1 - 0.003 * breath;
    // Ease up and settle within one second, with a quiet pause between lifts.
    const beat = now % 4.8;
    if (beat < 1.2) {
      const lift = Math.sin(Math.PI * beat / 1.2) ** 2;
      frame = Math.round(lift * (columns - 1));
      row = 1;
    }
  }
  cells.setXYZ(index, frame / columns, -row / rows, actor.scholarFacingLeft ? 1 : 0);
  matrix.compose(position, camera.quaternion, scale);
}

// Props share a grip at (176,159). Their silhouettes extend beyond the hand
// so a ruler, flag or coffee cup stays recognizable at arena scale.
function drawItem(item, shape, oval, accent) {
  switch (item) {
    case 'bat':
      shape('M164 185 L203 88 L217 94 L178 191Z', '#ffc955');
      shape('M201 97 l7 3 m-11 7 l5 2 m-9 7 l7 3 m-11 7 l5 2 m-9 8 l7 3', '#ffc955', 2.6);
      break;
    case 'tri':
      shape('M164 167 L187 109 Q189 105 192 110 L222 164Z', '#7ed7ca');
      shape('M180 153 L190 129 L203 152Z', '#fff4d8', 2.8);
      break;
    case 'mop':
      shape('M164 181 L200 87 L207 90 L172 184Z', '#d89251');
      shape('M190 94 Q187 84 193 70 Q195 65 197 73 L201 68 L204 72 L211 66 L214 72 L221 71 L216 95 Q204 102 190 94Z', '#d1e8e3');
      shape('M190 92 L216 90 L213 101 L188 103Z', '#67a7ac', 2.6);
      break;
    case 'plane':
      shape('M164 145 L227 121 L207 163 L192 154 L182 169 L180 154Z', '#fcf8e8');
      shape('M180 154 L226 121 L191 155 L182 168Z', '#aacddd', 2.4);
      break;
    case 'slipper':
      shape('M165 164 Q162 148 191 126 Q201 117 211 126 Q224 140 207 153 L180 174 Q170 178 165 164Z', '#f88a77');
      shape('M178 139 Q199 129 207 146 L196 156 Q189 145 173 149Z', '#fff0cf', 2.5);
      break;
    case 'gun':
      shape('M162 153 L168 143 L211 142 L216 151 L209 157 L178 158 L176 169 L165 169Z', '#53687c');
      shape('M165 142 Q164 134 173 134 L211 130 Q221 131 220 141 L216 145 L167 150Z', '#64b7ab');
      shape('M180 150 L211 146 L212 150 L181 154Z', '#fff1cf', 1.6);
      break;
    case 'blaster':
      shape('M169 143 L204 134 L219 142 L217 155 L182 163 L178 175 L168 172Z', '#db6995');
      shape('M171 141 L198 134 L207 142 L181 150Z', '#f9e7c6', 2);
      shape('M200 135 L213 132 L224 140 L220 153 L210 155 L212 144Z', '#78b9d8', 2.5);
      break;
    case 'wand':
      shape('M164 179 L194 112 L208 118 L179 184Z', '#eac1fa');
      shape('M191 120 L198 103 L210 101 L212 106 L205 125Z', '#ffdf57');
      shape('M168 169 L181 175 L177 185 L163 179Z', accent, 2);
      break;
    case 'mug':
      shape('M198 143 Q218 137 214 154 Q212 164 198 161 L199 155 Q210 155 207 148 L200 150Z', '#dfa96e');
      shape('M166 140 Q182 134 201 139 L199 163 Q195 174 176 172 Q166 170 166 162Z', '#f4d6a4');
      oval(183, 141, 15, 4, '#613b33');
      shape('M179 155 Q183 149 188 153 Q192 158 186 163 Q179 165 179 155Z', '#997058', 1.8);
      break;
    case 'sock':
      shape('M182 125 L203 130 L193 153 Q191 162 179 166 L167 172 Q154 177 151 167 Q150 161 167 154 L173 150Z', '#fff5d8');
      shape('M181 124 L206 129 L202 139 L177 134Z', '#7fb451', 2.8);
      shape('M154 162 Q159 162 163 171 Q153 178 151 170Z', '#7fb451', 1.5);
      break;
    case 'book':
      shape('M163 135 L196 128 L207 165 L174 175Z', '#b64c52');
      shape('M167 137 L195 132 L196 137 L169 143Z', '#fff1d5', 1.8);
      shape('M174 146 L191 142 L193 149 L176 153Z', '#f6d478', 1.5);
      break;
    case 'flag':
      shape('M167 183 L199 87 L205 89 L174 186Z', '#d6a065');
      shape('M200 91 Q215 87 229 94 L236 107 Q222 101 203 116 L194 112Z', accent);
      shape('M208 97 L222 96 L224 101 L206 105Z', '#fff3c8', 0);
      break;
    case 'lamp':
      shape('M170 161 L193 150 L200 155 L178 169Z', '#568679');
      shape('M181 154 L193 139 L184 125 L190 120 L201 139 L187 159Z', '#91ac9c');
      shape('M182 128 Q184 112 198 111 L211 128 L208 134Z', '#75b7a0');
      shape('M184 128 L209 132 Q199 142 184 128Z', '#ffdf77', 2);
      break;
    case 'duck':
      shape('M163 155 Q160 151 158 145 Q165 146 171 150 Q179 146 185 146 Q181 132 194 129 Q206 126 208 139 Q210 147 204 152 Q204 165 188 169 Q169 174 163 155Z', '#ffd45e');
      shape('M203 140 L216 139 Q217 146 205 147Z', '#f19345', 2);
      oval(200, 137, 2.3, 2.7, ink);
      break;
  }
}

function drawUniform(look, shape, oval, top, accent) {
  switch (look.outfit) {
    case 'track':
      shape('M109 139 L125 149 L145 137 L136 145 L127 153Z', '#fff1da', 2);
      shape('M126 151 L129 151 L130 180 L127 181Z', '#ffedcf', 1);
      oval(144, 156, 4, 4, '#ffce55');
      break;
    case 'vest':
      shape('M102 141 L114 136 L128 149 L140 135 L150 140 L153 178 L97 179Z', accent);
      shape('M118 138 L127 146 L137 136 L130 156Z', '#fff4db', 2.3);
      break;
    case 'apron':
      shape('M104 141 L111 138 L116 153 L137 151 L142 137 L148 141 L145 156 L153 188 L99 187 L107 155Z', accent, 2.8);
      shape('M113 164 L137 163 L136 174 Q124 181 114 174Z', top, 2.3);
      break;
    case 'hoodie':
      shape('M99 141 Q97 130 109 134 Q130 149 146 134 Q157 131 154 144 L137 154 L128 148 L116 155Z', top);
      shape('M111 169 Q125 173 140 167 L137 178 L112 180Z', accent, 2.1);
      break;
    case 'pajama':
      shape('M106 140 L120 135 L129 147 L138 135 L146 139 L138 154 L128 149 L117 155Z', '#fff2dd', 2.3);
      oval(129, 158, 2.4, 2.4, accent); oval(130, 169, 2.4, 2.4, accent);
      break;
    case 'labcoat':
      shape('M114 138 L144 137 L133 182 L122 181Z', top, 2.5);
      shape('M111 139 L119 137 L126 174 L108 155 L114 151Z', '#fffae8', 2.3);
      shape('M141 138 L150 139 L145 150 L149 154 L132 173Z', '#fffae8', 2.3);
      break;
    case 'cardigan':
      shape('M109 140 L124 146 L139 137 L131 161Z', '#fff1db', 2.4);
      shape('M123 147 L135 149 L131 163 L125 155 L119 158Z', accent, 2);
      oval(129, 169, 2.5, 2.5, '#ffdd81');
      break;
    case 'jersey':
      shape('M110 138 Q127 153 145 137 Q138 158 125 154Z', '#fff4df', 2.3);
      shape('M120 158 L137 155 L137 160 L130 174 L124 174 L131 160 L120 163Z', '#fff7e6', 1.5);
      break;
    case 'cheer':
      shape('M101 145 L125 155 L151 142 L152 151 L125 165 L99 154Z', '#fff9e6', 2.1);
      shape('M119 163 L126 165 L133 161 L131 171 L121 172Z', accent, 2);
      break;
  }
}

function drawBackHair(look, shape, hair) {
  if (look.style === 'pony' && !look.swimcap)
    shape('M82 62 Q48 45 42 69 Q39 82 50 91 Q49 112 35 121 Q55 131 72 108 Q88 90 82 62Z', hair, 4);
  if (look.style === 'wavy')
    shape('M83 55 Q117 20 163 46 Q193 58 187 105 Q182 127 197 136 Q186 150 169 141 Q160 156 144 143 Q116 152 91 142 Q76 152 62 138 Q48 140 47 125 Q61 117 59 96 Q57 71 83 55Z', hair, 4);
  if (look.style === 'twin') {
    shape('M79 60 Q55 39 34 55 Q23 68 33 77 Q38 93 22 112 Q44 124 62 104 Q78 83 79 60Z', hair, 4.2);
    shape('M166 55 Q187 38 204 50 Q218 61 212 78 Q210 92 226 103 Q209 116 193 103 Q175 90 166 55Z', hair, 4.2);
  }
  if (look.style === 'bun' || look.style === 'bun2')
    shape('M66 55 Q43 54 45 35 Q44 18 61 16 Q80 12 86 29 Q94 45 80 54Z', hair, 4);
  if (look.style === 'bun2')
    shape('M158 32 Q162 12 180 14 Q201 15 201 34 Q200 50 179 52Z', hair, 4);
}

const fringes = {
  spiky: 'M65 98 Q51 75 62 58 L54 55 L70 45 L66 30 L87 34 L94 14 L111 26 L130 10 L139 25 L162 16 L163 29 Q187 31 193 57 L187 80 L170 66 L166 78 L149 65 L138 76 L122 63 L110 77 L91 75 L77 99Z',
  buzz: 'M64 97 Q52 67 71 42 Q91 20 124 21 Q168 17 185 45 Q192 55 189 74 Q165 66 141 66 Q107 59 85 77 L78 96Z',
  bob: 'M63 100 Q53 73 65 54 Q79 22 117 22 Q167 15 186 48 L191 77 L167 72 L162 65 L158 74 L129 75 L120 66 L116 77 L88 81 L80 102Z',
  messy: 'M64 97 Q54 83 58 71 L49 72 L61 54 L56 46 L76 40 Q91 24 110 25 L104 14 Q124 16 133 27 L148 15 L149 26 Q180 25 190 51 L194 71 L178 65 L166 79 L157 71 L136 84 L132 72 L105 83 L88 80 L79 101Z',
  pony: 'M65 99 Q53 74 66 52 Q81 20 125 21 Q169 17 186 49 L191 76 Q167 76 154 53 Q145 71 121 79 Q100 87 84 82 L77 100Z',
  wavy: 'M65 100 Q52 77 63 55 Q77 22 120 20 Q168 14 187 48 Q197 68 185 79 Q162 76 153 56 Q147 74 128 78 Q110 88 98 79 Q90 96 79 91 L77 103Z',
  bun: 'M65 101 Q52 72 67 50 Q85 20 124 22 Q168 18 187 49 L189 77 Q154 74 135 48 Q119 78 86 83 L78 102Z',
  bun2: 'M65 100 Q50 68 70 46 Q88 19 130 22 Q165 17 183 44 L191 75 Q172 79 155 69 Q141 84 127 74 Q108 90 91 80 L78 101Z',
  twin: 'M65 99 Q51 75 66 50 Q88 19 124 22 Q164 16 184 44 Q191 58 191 76 L170 68 L160 77 L147 62 L126 78 L121 66 L103 82 L88 79 L78 100Z',
};
function drawFringe(look, shape, hair) {
  shape(fringes[look.style], hair, 3.8);
}

function drawHeadwear(look, shape, oval, accent) {
  if (look.band || look.band2)
    shape('M59 73 Q115 45 188 58 L190 68 Q115 56 59 84Z', css(look.band ?? look.band2), 2.8);
  if (look.cap) {
    shape('M60 63 Q61 23 104 15 Q152 3 177 39 L181 52 Q121 47 64 70Z', css(look.cap), 4);
    shape('M132 47 Q177 36 205 47 Q215 52 199 59 Q181 68 148 63Z', accent, 3.2);
  }
  if (look.beret) {
    shape('M58 58 Q47 42 65 27 Q83 11 127 11 Q159 9 173 25 Q189 41 174 51 Q116 46 66 66Z', css(look.beret), 4);
    shape('M109 16 L110 7 Q114 3 119 8 L118 16Z', css(look.beret), 2.8);
  }
  if (look.scarf)
    shape('M56 66 Q94 44 158 48 L191 58 L189 68 Q115 51 62 79 L50 86 L49 75 L38 72 L53 65Z', css(look.scarf), 2.9);
  if (look.phones) {
    shape('M61 90 Q47 45 83 26 Q119 4 158 22 Q184 32 192 64 L184 67 Q177 41 153 31 Q115 18 88 37 Q65 52 69 88Z', css(look.phones), 3);
    shape('M54 81 Q62 74 72 78 L78 108 Q70 119 58 112Z', css(look.phones), 3.5);
    shape('M59 86 L67 83 L72 105 L64 108Z', accent === '#3a3f4a' ? '#77cdd5' : accent, 1.6);
  }
  if (look.swimcap)
    shape('M60 86 Q48 53 77 32 Q105 10 146 18 Q182 21 193 55 L193 72 Q118 53 67 92Z', css(look.swimcap), 4);
  if (look.goggles || look.goggles2 || look.mask) {
    const fill = look.mask ? css(look.mask) : '#81cbd8';
    shape('M63 64 Q123 51 188 55 L188 63 Q120 59 64 73Z', ink, 1.8);
    shape('M90 57 Q106 49 128 51 L137 57 L145 53 Q166 47 183 53 L181 66 Q164 76 148 67 L142 63 L136 66 Q115 80 95 74Z', fill, 3.2);
    if (look.mask) {
      shape('M103 64 Q112 70 122 63 M153 61 Q162 67 171 60', fill, 2.2);
    } else {
      shape('M103 59 L116 56 L107 66 L100 67Z M154 57 L166 54 L158 63 L151 64Z', '#e4fff5', 0);
    }
  }
  if (look.style === 'twin') {
    shape('M62 52 L49 45 L45 58 L55 63 L46 73 L59 77 L68 61Z', accent, 2.7);
    shape('M179 47 L186 36 L192 46 L199 42 L202 54 L187 59Z', accent, 2.7);
  }
  if (look.flower) {
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      oval(79 + Math.cos(angle) * 6, 48 + Math.sin(angle) * 6, 5.5, 5.5, accent);
    }
    oval(79, 48, 4, 4, '#ffdd78');
  }
  if (look.paint) {
    oval(172, 110, 5, 3, '#eb816d'); oval(178, 114, 3, 2, '#5bb4c3');
  }
}

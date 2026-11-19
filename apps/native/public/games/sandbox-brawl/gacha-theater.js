// All distances are in the illustrated stage's design coordinates. The tail and the
// card use the same button contact point even when the viewport changes.
const SPIN_START = .18, SPIN_END = 2.78, FULL_TURN = 2 * Math.PI;
export const CAST_TIME = SPIN_END + .27;
export const CONTACT_TIME = CAST_TIME + .50;
export const CARD_TIME = CONTACT_TIME + .48;
export function spinTurns(t) {
  const p = Math.max(0, Math.min(1, (t - SPIN_START) / (SPIN_END - SPIN_START)));
  return 3 * (.42 * p + .58 * p * p);
}
const floor = 790;
const buttonX = 1264;
const ease = (a, b, t) => {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// Both drawings use the same longitudinal coordinates: the bite is at 0 and the
// tip is at 1. Rotating the texture once keeps the pose change attached to the bill.
const spinePixels = 560, gripX = 112, gripY = 140;
function alignPlush(img, grip, tip) {
  const atlas = document.createElement('canvas');
  atlas.width = 704; atlas.height = 330;
  const paint = atlas.getContext('2d');
  const x = grip[0] * img.width, y = grip[1] * img.height;
  const dx = tip[0] * img.width - x, dy = tip[1] * img.height - y;
  const zoom = spinePixels / Math.hypot(dx, dy);
  paint.translate(gripX, gripY);
  paint.scale(zoom, zoom);
  paint.rotate(-Math.atan2(dy, dx));
  paint.drawImage(img, -x, -y);
  return atlas;
}

// Integrate local tangents from the scruff outward. A cast reaches the tail
// 370 ms after the neck; after contact a smaller wave runs back toward the grip.
function plushSpine(t, x, y, length, aim, rest, orbit) {
  const step = 1 / 32, points = [];
  function angle(u) {
    const local = t - .37 * u;
    const gather = ease(SPIN_END - .3, CAST_TIME - .05, t - .18 * u);
    const phase = Math.max(0, Math.min(1, (local - CAST_TIME) / (CONTACT_TIME - .37 - CAST_TIME)));
    const cast = ease(0, 1, phase) * (1 - u) + phase * phase * u;
    const release = ease(CONTACT_TIME + .16, CONTACT_TIME + .67, t - .12 * u);
    const lifted = rest - 3.68 * gather;
    const follow = .65 * Math.sin(Math.PI * cast) * (1 - u);
    const kick = ease(0, .09, t - CONTACT_TIME - .055 - .16 * (1 - u))
      * (1 - ease(.11, .32, t - CONTACT_TIME - .055 - .16 * (1 - u)));
    return (lifted + (aim - lifted) * cast + follow - .65 * kick * u) * (1 - release) + rest * release;
  }
  // Project a horizontal orbit onto the stage. The tail follows a fraction of
  // a turn behind the bill. Carry its last tangent into the downward lash.
  function direction(u) {
    const lash = angle(u);
    if (!orbit) return { angle: lash, foreshortening: 1 };
    const yaw = FULL_TURN * spinTurns(t - .13 * u);
    const ox = Math.cos(yaw), oy = .54 * Math.sin(yaw) + .10 * u;
    const circle = Math.atan2(oy, ox);
    const delta = Math.atan2(Math.sin(circle - lash), Math.cos(circle - lash));
    return { angle: lash + orbit * delta, foreshortening: 1 + orbit * (Math.hypot(ox, oy) - 1) };
  }
  for (let i = 0; i <= 32; i++) {
    const u = i * step;
    points.push({ x, y, a: direction(u).angle });
    const mid = direction(u + step * .5);
    x += Math.cos(mid.angle) * mid.foreshortening * length * step;
    y += Math.sin(mid.angle) * mid.foreshortening * length * step;
  }
  return points;
}

// Skin the illustration onto a continuous ribbon. Adjacent sections share both
// edge vertices so the stripes and stitching stay connected around tight bends.
function paintPlush(ctx, atlas, points, length, thickness) {
  if (!atlas) return;
  const along = length / spinePixels, across = thickness / spinePixels;
  if (points.every(point => Math.abs(point.a - points[0].a) < .001)) {
    ctx.save();
    ctx.translate(points[0].x, points[0].y);
    ctx.rotate(points[0].a);
    ctx.scale(along, across);
    ctx.drawImage(atlas, -gripX, -gripY);
    ctx.restore();
    return;
  }
  function edge(point, distance, sourceX) {
    const cos = Math.cos(point.a), sin = Math.sin(point.a);
    const x = point.x + distance * cos, y = point.y + distance * sin;
    return {
      sourceX,
      top: { x: x + gripY * across * sin, y: y - gripY * across * cos },
      bottom: { x: x - (atlas.height - gripY) * across * sin, y: y + (atlas.height - gripY) * across * cos },
    };
  }
  // Map the three source corners to their actual screen positions. A small
  // clip overlap covers the fractional edge coverage of Canvas2D antialiasing.
  function triangle(origin, acrossEdge, downEdge, sx, sy, sw, sh) {
    const centerX = (origin.x + acrossEdge.x + downEdge.x) / 3;
    const centerY = (origin.y + acrossEdge.y + downEdge.y) / 3;
    ctx.save(); ctx.beginPath();
    for (const v of [origin, acrossEdge, downEdge]) {
      const dx = v.x - centerX, dy = v.y - centerY;
      const factor = 1 + .85 / (Math.hypot(dx, dy) || 1);
      const x = centerX + dx * factor, y = centerY + dy * factor;
      if (v === origin) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.clip();
    const ax = (acrossEdge.x - origin.x) / sw, ay = (acrossEdge.y - origin.y) / sw;
    const bx = (downEdge.x - origin.x) / sh, by = (downEdge.y - origin.y) / sh;
    ctx.transform(ax, ay, bx, by, origin.x - ax * sx - bx * sy, origin.y - ay * sx - by * sy);
    ctx.drawImage(atlas, 0, 0);
    ctx.restore();
  }
  const last = points.length - 1;
  const edges = [
    edge(points[0], -gripX * along, 0),
    ...points.map((point, i) => edge(point, 0, gripX + spinePixels * i / last)),
    edge(points[last], (atlas.width - gripX - spinePixels) * along, atlas.width),
  ];
  for (let i = edges.length - 1; i > 0; i--) {
    const a = edges[i - 1], b = edges[i], span = b.sourceX - a.sourceX;
    triangle(a.top, b.top, a.bottom, a.sourceX, 0, span, atlas.height);
    triangle(b.bottom, a.bottom, b.top, b.sourceX, atlas.height, -span, -atlas.height);
  }
}

export function createGachaTheater() {
  const canvas = document.createElement('canvas');
  canvas.className = 'gTheater';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  const images = {};
  const tipTrail = [];
  let ready = false;
  Promise.all(['goose', 'goose-front', 'goose-back', 'weasel', 'weasel-strike', 'pillar'].map(async (name) => {
    const img = new Image();
    img.src = new URL('./gacha-art/' + name + '.webp', import.meta.url).href;
    await img.decode();
    if (name === 'weasel') images[name] = alignPlush(img, [.36, .044], [.16, .99]);
    else if (name === 'weasel-strike') images[name] = alignPlush(img, [.13, .18], [.99, .61]);
    else images[name] = img;
  })).catch(() => {}).finally(() => { ready = true; });

  function drawImage(name, x, y, w, h) {
    if (images[name]) ctx.drawImage(images[name], x, y, w, h);
  }

  function shadow(x, y, radius, height) {
    ctx.fillStyle = 'rgba(67,26,47,.34)';
    ctx.beginPath();
    ctx.ellipse(x, y, radius, height, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Blend the neck into the planted body. Upper rows follow the bill, lower rows
  // remain anchored at the feet. The same displacement anchors the plush's scruff.
  function goose(left, width, height, neck, view = 'goose') {
    const img = images[view];
    if (!img) return;
    const rows = 55;
    const strip = img.height / rows;
    for (let i = 0; i < rows; i++) {
      const shift = neck * (1 - ease(.34, .78, i / rows));
      const next = neck * (1 - ease(.34, .78, (i + 1) / rows));
      const band = height / rows;
      ctx.save();
      ctx.transform(1, 0, (next - shift) / band, 1, left + shift, floor - height + i * band);
      ctx.drawImage(img, 0, i * strip, img.width, strip, 0, 0, width, band + .55);
      ctx.restore();
    }
  }

  function draw(canvasTime, idleTime, reduced, settled, tierColor) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const t = reduced ? (settled ? CARD_TIME + 1 : 0) : canvasTime;
    const close = settled ? 1 : ease(CARD_TIME, CARD_TIME + .65, t);
    const orbit = ease(.02, .48, t) * (1 - ease(SPIN_END, CAST_TIME, t));
    const yaw = FULL_TURN * spinTurns(t), facing = Math.cos(yaw), depth = Math.sin(yaw);
    const recoilTime = t - CONTACT_TIME;
    const jolt = recoilTime >= 0 ? Math.exp(-recoilTime * 19) * Math.sin(recoilTime * 82) : 0;
    const pushIn = 1 + .085 * ease(CAST_TIME - .1, CONTACT_TIME, t) * (1 - ease(CONTACT_TIME + .12, CARD_TIME + .2, t));
    const scale = Math.min(w / 1510, h / 1000) * pushIn * (1 - .065 * orbit);
    const originX = w / 2 - (800 - 14 * jolt) * scale;
    const originY = h * .825 - (floor + 6 * jolt) * scale;
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    const recoil = ease(0, .045, recoilTime) * (1 - ease(.105, .27, recoilTime));
    const spring = Math.sin(Math.max(0, recoilTime - .18) * 33)
      * Math.exp(-Math.max(0, recoilTime - .18) * 12);
    const crouch = ease(SPIN_END - .17, CAST_TIME, t) * (1 - ease(CAST_TIME, CAST_TIME + .15, t));
    const reach = ease(CAST_TIME, CAST_TIME + .15, t) * (1 - ease(CONTACT_TIME + .14, CARD_TIME + .25, t));
    const breath = reduced ? 0 : Math.sin(idleTime * 2.9) * 3;
    const actorScale = (1 - close * .50) * (1 - orbit * .20);
    const width = (642 + 23 * crouch) * actorScale;
    const height = (515 - 86 * crouch + 50 * reach + breath + orbit * 18 * depth) * actorScale;
    const pivot = 112 - 30 * close + .36 * width + orbit * 335;
    const neck = (-145 * crouch + 155 * reach) * actorScale;
    const billX = pivot + ((.955 - .36) * width + neck) * facing;
    const billY = floor - height * .698 + orbit * 54 * depth;
    const postFoot = buttonX + 105 * close;
    const postH = (390 - 99 * recoil + 22 * spring) * (1 - close * .33);
    const postW = 390 * .582 * (1 + .19 * recoil) * (1 - close * .33);
    const tilt = .095 * recoil - .038 * spring;
    const postX = postFoot + (postH - 9) * Math.sin(tilt);
    const capY = floor - (postH - 9) * Math.cos(tilt);

    shadow(pivot, floor, width * (.30 + .11 * Math.abs(facing)), 16 * actorScale);
    shadow(postFoot, floor, postW * .56, 13);
    ctx.save();
    ctx.translate(postFoot, floor); ctx.rotate(tilt);
    drawImage('pillar', -postW / 2, -postH, postW, postH);
    ctx.restore();

    function drawGoose() {
      if (Math.abs(facing) < .58 && orbit > .5) {
        const front = depth >= 0, headFraction = front ? .30 : .16;
        const viewHeight = (floor - billY) / (1 - headFraction);
        const viewWidth = viewHeight * (front ? .69 : .72);
        goose(pivot - viewWidth / 2, viewWidth, viewHeight, billX - pivot, front ? 'goose-front' : 'goose-back');
      } else {
        const sideWidth = width * Math.abs(facing);
        ctx.save();
        ctx.translate(pivot, 0); ctx.scale(Math.sign(facing), 1);
        goose(-sideWidth * .36, sideWidth, (floor - billY) / .698, neck * Math.abs(facing));
        ctx.restore();
      }
    }

    const dx = postX - billX, dy = capY - billY;
    const extended = ease(CAST_TIME, CONTACT_TIME - .10, t) * (1 - ease(CONTACT_TIME + .18, CARD_TIME + .25, t));
    const length = (345 + 8 * orbit) * actorScale * (1 - extended) + Math.hypot(dx, dy) * extended;
    const rest = Math.PI * .53 + (reduced ? 0 : Math.sin(idleTime * 2.4) * .045);
    const points = plushSpine(t, billX, billY, length, Math.atan2(dy, dx), rest, orbit);
    const tip = points[points.length - 1];
    if (t > SPIN_START && t < CONTACT_TIME + .14) {
      tipTrail.push({ x: tip.x, y: tip.y, t });
      while (tipTrail.length && tipTrail[0].t < t - .11) tipTrail.shift();
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < tipTrail.length; i++) {
        const fraction = i / tipTrail.length;
        ctx.globalAlpha = .74 * fraction;
        ctx.strokeStyle = '#ffe490'; ctx.lineWidth = 2 + fraction * 8;
        ctx.beginPath();
        ctx.moveTo(tipTrail[i - 1].x, tipTrail[i - 1].y);
        ctx.lineTo(tipTrail[i].x, tipTrail[i].y); ctx.stroke();
      }
      ctx.restore();
    } else tipTrail.length = 0;
    const inFront = orbit > .5 && depth > .2;
    if (inFront) drawGoose();
    const profile = ease(.10, .25, t) * (1 - ease(CONTACT_TIME + .43, CONTACT_TIME + .60, t));
    if (profile < 1) {
      ctx.globalAlpha = 1 - profile;
      paintPlush(ctx, images.weasel, points, length, 345 * actorScale);
    }
    if (profile > 0) {
      ctx.globalAlpha = profile;
      const side = orbit > .8 && facing < 0 ? -1 : 1;
      paintPlush(ctx, images['weasel-strike'], points, length, 395 * actorScale * side * (1 - .28 * orbit * Math.abs(depth)));
    }
    ctx.globalAlpha = 1;
    if (!inFront) drawGoose();

    if (crouch > 0) {
      ctx.save();
      ctx.globalAlpha = crouch;
      ctx.translate(billX + 12, billY - 115);
      ctx.fillStyle = '#ffec9d';
      for (const direction of [-.25, .27, .79]) {
        ctx.save();
        ctx.rotate(direction);
        ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-7, -61); ctx.lineTo(11, -57); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
    if (t >= CONTACT_TIME && t < CARD_TIME + .15) {
      const flash = 1 - ease(CONTACT_TIME + .09, CARD_TIME + .15, t);
      ctx.save();
      ctx.translate(postX, capY);
      const ring = ease(0, .24, recoilTime);
      ctx.strokeStyle = '#fff1ad'; ctx.lineWidth = 6 * (1 - ring);
      if (ring < 1) {
        ctx.beginPath(); ctx.ellipse(0, 4, 26 + ring * 125, 8 + ring * 35, tilt, 0, FULL_TURN); ctx.stroke();
      }
      ctx.fillStyle = tierColor;
      ctx.strokeStyle = '#502c37';
      ctx.lineWidth = 3;
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate(-1.17 + i * .54);
        ctx.beginPath();
        ctx.moveTo(-5, -29);
        ctx.lineTo(-12, -40 - flash * (i % 2 ? 41 : 63));
        ctx.lineTo(8, -38);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    return { x: originX + postX * scale - w / 2, y: originY + capY * scale - h / 2 };
  }
  return { canvas, draw, get ready() { return ready; } };
}

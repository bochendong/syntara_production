import * as THREE from 'three';

import {
  AGENTS,
  AGENTS_END,
  AGENTS_START,
  CHAPTERS,
  CLOSING_START,
  COURSES,
  DIVE_END,
  DIVE_MIX_START,
  DIVE_START,
  ease,
  FEATURE_COUNT,
  FEATURE_LEN,
  FEATURE_START,
  featureStart,
  KIND_ORDER,
  MEMORY_FEATURE,
  win,
  type WorldColor,
} from './world-timeline';

/**
 * The landing page's single WebGL world.
 *
 * Two scenes render into textures every frame they are visible:
 *   A: the course galaxy (chapter orbs + small memory marbles + stars)
 *   B: the inside of one chapter marble (a swirling nebula + memories)
 * A final composite pass blends them through a marble-shaped lens, adds the
 * pointer's fluid trail, chromatic split, glow, grain and the ripple that
 * marks each chapter change. Everything is a pure function of the smoothed
 * scroll position, so scrolling back plays the story in reverse.
 */

export type WorldFrame = {
  /** Smoothed scroll position in u. */
  u: number;
  /** Hovered course orb in the sky, -1 = none. */
  hoverCourse: number;
  /** Hovered CSC108 chapter, -1 = none. */
  hoverChapter: number;
  /** Screen positions of the course orbs. */
  courses: ({ x: number; y: number } | null)[];
  /** Screen positions of the helper comets. */
  agents: ({ x: number; y: number } | null)[];
  /** Hovered memory marble inside the chapter, -1 = none. */
  hoverMemory: number;
  /** Screen positions of the labelled memories (null when behind the camera). */
  labels: ({ x: number; y: number } | null)[];
};

export type WorldEngineOptions = {
  compact: boolean;
  onFrame: (frame: WorldFrame) => void;
  onContextLost: () => void;
};

export type WorldEngine = {
  /** Target scroll position in u; the engine eases toward it. */
  setTarget(u: number, immediate?: boolean): void;
  /** Click / tap at a client position (revives fogged memories). */
  tap(x: number, y: number): void;
  dispose(): void;
};

/** The chapter the camera dives into (递归). */
const DIVE_CHAPTER = 3;

const PAL: Record<WorldColor | 'orb', [string, string, string]> = {
  pink: ['#f58fb0', '#ffd3e1', '#b44a72'],
  amber: ['#f5b94a', '#ffe6ad', '#b5791a'],
  blue: ['#6fa8ff', '#cfe2ff', '#2f5fc0'],
  green: ['#6fd59a', '#cff5df', '#2b8f58'],
  purple: ['#a58bff', '#e0d6ff', '#5d43c4'],
  orb: ['#7a62e6', '#d9ccff', '#2c1f7a'],
};

/** Nebula colors inside the marble, per feature (deep, base, light). */
const SKY: Record<WorldColor, [string, string, string]> = {
  pink: ['#210a1f', '#6b2a55', '#b873a6'],
  amber: ['#22150a', '#6e4a1c', '#bf9254'],
  blue: ['#0a1327', '#23427a', '#6f95cf'],
  green: ['#08201a', '#1f5a47', '#64b08f'],
  purple: ['#130b29', '#3f2a7c', '#8f78d6'],
};

export const FEATURE_COLORS: WorldColor[] = ['blue', 'purple', 'amber', 'pink', 'green'];

type MarbleItem = {
  p: THREE.Vector3;
  s: number;
  c: WorldColor | 'orb';
  g?: THREE.Vector3;
  rank?: number;
};

const MARBLE_VERT = /* glsl */ `
attribute vec3 aBase; attribute vec3 aLight; attribute vec3 aDeep; attribute vec3 aGather;
attribute float aSeed; attribute float aId; attribute float aRank; attribute float aRevive; attribute float aKind;
uniform float uTime, uHover, uGather, uBob, uFogT, uFocus, uFocusAmt;
varying vec3 vN, vView, vObj, vBase, vLight, vDeep; varying float vSeed, vFog, vHov, vFlash, vFocus;
void main(){
  vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  vec3 center = mix(c, aGather, uGather);
  center.y += sin(uTime * 0.9 + aSeed * 6.283) * uBob;
  float hov = 1.0 - step(0.5, abs(aId - uHover));
  float focus = (1.0 - step(0.5, abs(aKind - uFocus))) * uFocusAmt;
  vHov = hov; vFocus = focus;
  vec4 world = modelMatrix * vec4(center + position * s * (1.0 + 0.35 * hov + 0.18 * focus), 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vN = normalize(normalMatrix * normal); vView = -mv.xyz; vObj = position;
  vBase = aBase; vLight = aLight; vDeep = aDeep; vSeed = aSeed;
  float fog = clamp(uFogT * 1.35 - aRank, 0.0, 1.0);
  vFog = fog * (1.0 - smoothstep(0.0, 1.0, aRevive));
  vFlash = aRevive * (1.0 - aRevive) * 4.0;
}`;

const MARBLE_FRAG = /* glsl */ `
uniform float uTime, uDim;
varying vec3 vN, vView, vObj, vBase, vLight, vDeep; varying float vSeed, vFog, vHov, vFlash, vFocus;
void main(){
  vec3 N = normalize(vN); vec3 V = normalize(vView);
  float fr = 1.0 - max(dot(N, V), 0.0);
  vec3 p = vObj; float a = uTime * 0.22 + vSeed * 6.283;
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  float sw = sin(p.x * 3.1 + sin(p.y * 4.0 + vSeed * 9.0) * 1.7 + p.z * 2.2 + vSeed * 3.0) * 0.5 + 0.5;
  vec3 c = sw < 0.34 ? vDeep : (sw < 0.72 ? vBase : vLight);
  vec3 g = mix(vec3(0.16, 0.17, 0.3), c, 0.82 - fr * 0.35);
  float hl = pow(max(dot(N, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 26.0);
  g += smoothstep(0.35, 0.6, hl) * 0.95;
  float hl2 = pow(max(dot(N, normalize(vec3(0.5, -0.45, 0.74))), 0.0), 60.0);
  g += smoothstep(0.3, 0.6, hl2) * 0.35;
  g += vec3(0.78, 0.84, 1.0) * pow(fr, 3.0) * 0.75;
  g = mix(g, vec3(0.05, 0.04, 0.11), smoothstep(0.9, 0.97, fr) * 0.85);
  float l = dot(g, vec3(0.3, 0.59, 0.11));
  g = mix(g, mix(vec3(l), vec3(0.55, 0.58, 0.7), 0.55), vFog * 0.88);
  g *= mix(1.0, 0.55, uDim * (1.0 - vFocus));
  g += vFlash * 0.5 + vHov * 0.12 + vFocus * 0.08;
  gl_FragColor = vec4(g, 1.0);
}`;

const NOISE_GLSL = /* glsl */ `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createWorldEngine(
  canvas: HTMLCanvasElement,
  opts: WorldEngineOptions,
): WorldEngine {
  const { compact } = opts;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 1);

  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => {
    disposables.push(x);
    return x;
  };

  const time = { value: 0 };
  const aspect = { value: 1 };

  function makeMarbles(items: MarbleItem[], uniforms: Record<string, THREE.IUniform>) {
    const geo = track(new THREE.SphereGeometry(1, compact ? 28 : 40, compact ? 20 : 28));
    const mat = track(
      new THREE.ShaderMaterial({
        vertexShader: MARBLE_VERT,
        fragmentShader: MARBLE_FRAG,
        uniforms,
      }),
    );
    const n = items.length;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const base = new Float32Array(n * 3);
    const light = new Float32Array(n * 3);
    const deep = new Float32Array(n * 3);
    const gather = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    const ids = new Float32Array(n);
    const ranks = new Float32Array(n);
    const kinds = new Float32Array(n);
    const revive = new Float32Array(n);
    const m = new THREE.Matrix4();
    items.forEach((it, i) => {
      m.makeScale(it.s, it.s, it.s);
      m.setPosition(it.p);
      mesh.setMatrixAt(i, m);
      const [b, l, d] = PAL[it.c].map((h) => new THREE.Color(h));
      b.toArray(base, i * 3);
      l.toArray(light, i * 3);
      d.toArray(deep, i * 3);
      (it.g ?? it.p).toArray(gather, i * 3);
      seeds[i] = rnd();
      ids[i] = i;
      ranks[i] = it.rank ?? 99;
      kinds[i] = it.c === 'orb' ? -9 : KIND_ORDER.indexOf(it.c);
    });
    const attr = (arr: Float32Array, size: number) => new THREE.InstancedBufferAttribute(arr, size);
    geo.setAttribute('aBase', attr(base, 3));
    geo.setAttribute('aLight', attr(light, 3));
    geo.setAttribute('aDeep', attr(deep, 3));
    geo.setAttribute('aGather', attr(gather, 3));
    geo.setAttribute('aSeed', attr(seeds, 1));
    geo.setAttribute('aId', attr(ids, 1));
    geo.setAttribute('aRank', attr(ranks, 1));
    geo.setAttribute('aKind', attr(kinds, 1));
    const reviveAttr = attr(revive, 1);
    geo.setAttribute('aRevive', reviveAttr);
    mesh.frustumCulled = false;
    return { mesh, reviveAttr };
  }

  function backgroundQuad(body: string, uniforms: Record<string, THREE.IUniform>) {
    const geo = track(new THREE.PlaneGeometry(2, 2));
    const mat = track(
      new THREE.ShaderMaterial({
        depthWrite: false,
        depthTest: false,
        uniforms: { uTime: time, uAsp: aspect, ...uniforms },
        vertexShader: /* glsl */ `varying vec2 vq; void main(){ vq = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.999, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec2 vq; uniform float uTime, uAsp; uniform vec3 uDeep, uBase, uLight;
          ${NOISE_GLSL}
          void main(){ vec2 uv = vq; ${body} }`,
      }),
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  function makeStars(n: number, spread: number) {
    const geo = track(new THREE.BufferGeometry());
    const pos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(gauss(), gauss() * 0.5, gauss())
        .normalize()
        .multiplyScalar(spread * (0.4 + rnd()))
        .toArray(pos, i * 3);
      sizes[i] = rnd();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(sizes, 1));
    const mat = track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: time },
        vertexShader: /* glsl */ `attribute float aS; uniform float uTime; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = (1.0 + aS * 2.6) * (60.0 / -mv.z); vA = 0.45 + 0.55 * sin(uTime * 1.5 + aS * 40.0); }`,
        fragmentShader: /* glsl */ `varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d);
          float cr = max(0.0, 1.0 - abs(d.x) * 14.0) * max(0.0, 1.0 - abs(d.y) * 2.2) + max(0.0, 1.0 - abs(d.y) * 14.0) * max(0.0, 1.0 - abs(d.x) * 2.2);
          float a = (smoothstep(0.5, 0.0, r) * 0.6 + cr * 0.6) * vA; gl_FragColor = vec4(vec3(0.85, 0.88, 1.0) * a, a); }`,
      }),
    );
    return new THREE.Points(geo, mat);
  }

  // ---------- scene A: the course sky ----------
  const sceneA = new THREE.Scene();
  const camA = new THREE.PerspectiveCamera(50, 1, 0.05, 260);
  const galaxy = new THREE.Group();
  sceneA.add(galaxy);
  const uA = {
    uTime: time,
    uHover: { value: -1 },
    uGather: { value: 0 },
    uBob: { value: 0.04 },
    uFogT: { value: 0 },
    uFocus: { value: -1 },
    uFocusAmt: { value: 0 },
    uDim: { value: 0 },
  };
  // CSC108 sits at the origin; the other courses spread out around it.
  const coursePos = COURSES.map((_, i) => {
    if (i === 0) return new THREE.Vector3();
    const a = (i / (COURSES.length - 1)) * Math.PI * 2 + 0.6 + gauss() * 0.2;
    const r = 17 + (i % 3) * 7 + rnd() * 4;
    return new THREE.Vector3(Math.cos(a) * r * 1.25, gauss() * 3, Math.sin(a) * r - 6);
  });
  const chapterPos = CHAPTERS.map((_, i) => {
    const a = (i / CHAPTERS.length) * Math.PI * 2 + 0.3;
    const r = 4.2 + (i % 2) * 2.6;
    return new THREE.Vector3(Math.cos(a) * r, gauss() * 0.3, Math.sin(a) * r);
  });
  // Instance order: [course orbs..., CSC108 chapters..., everything else]
  const itemsA: MarbleItem[] = COURSES.map((c, i) => ({
    p: coursePos[i],
    s: i === 0 ? 1.25 : 1.35 + rnd() * 0.5,
    c: i === 0 ? 'orb' : c.color,
  }));
  const CHAPTER_BASE = COURSES.length;
  chapterPos.forEach((p, i) =>
    itemsA.push({ p, s: 0.48, c: i === DIVE_CHAPTER ? 'pink' : KIND_ORDER[(i + 2) % 5] }),
  );
  const smallCount = compact ? 260 : 520;
  for (let i = 0; i < smallCount; i++) {
    const c = KIND_ORDER[(rnd() * 5) | 0];
    if (rnd() < 0.55) {
      const ch = chapterPos[(rnd() * chapterPos.length) | 0];
      const a = rnd() * Math.PI * 2;
      const r = 0.7 + rnd() * 1.4;
      itemsA.push({
        p: new THREE.Vector3(ch.x + Math.cos(a) * r, ch.y + gauss() * 0.35, ch.z + Math.sin(a) * r),
        s: 0.05 + rnd() * 0.1,
        c,
      });
    } else {
      const arm = i % 3;
      const r = Math.pow(rnd(), 0.7) * 11 + 1.2;
      const a = arm * 2.094 + r * 0.42 + gauss() * 0.35;
      itemsA.push({
        p: new THREE.Vector3(Math.cos(a) * r, gauss() * 0.5 * (1 - r / 14), Math.sin(a) * r),
        s: 0.03 + rnd() * 0.07,
        c,
      });
    }
  }
  // Every other course: a ring of chapter marbles and a cloud of memories.
  const perCourse = compact ? 34 : 70;
  for (let ci = 1; ci < COURSES.length; ci++) {
    const center = coursePos[ci];
    const tilt = gauss() * 0.5;
    const chapters = 5 + ((rnd() * 3) | 0);
    for (let k = 0; k < chapters; k++) {
      const a = (k / chapters) * Math.PI * 2 + rnd();
      const r = 2.2 + rnd() * 1.6;
      itemsA.push({
        p: new THREE.Vector3(
          center.x + Math.cos(a) * r,
          center.y + Math.sin(a) * r * tilt,
          center.z + Math.sin(a) * r,
        ),
        s: 0.26 + rnd() * 0.12,
        c: KIND_ORDER[(ci + k) % 5],
      });
    }
    for (let k = 0; k < perCourse; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.2 + Math.pow(rnd(), 0.8) * 4.2;
      itemsA.push({
        p: new THREE.Vector3(
          center.x + Math.cos(a) * r,
          center.y + gauss() * 0.6 + Math.sin(a) * r * tilt,
          center.z + Math.sin(a) * r,
        ),
        s: 0.03 + rnd() * 0.07,
        c: rnd() < 0.5 ? COURSES[ci].color : KIND_ORDER[(rnd() * 5) | 0],
      });
    }
  }
  const marblesA = makeMarbles(itemsA, uA);
  galaxy.add(marblesA.mesh);
  sceneA.add(makeStars(compact ? 2200 : 4500, 110));
  galaxy.add(makeStars(compact ? 400 : 800, 12));
  sceneA.add(
    backgroundQuad(
      /* glsl */ `
      vec3 c = mix(vec3(0.035, 0.03, 0.09), vec3(0.09, 0.06, 0.2), smoothstep(1.2, 0.0, length((uv - vec2(0.5, 0.45)) * vec2(1.6, 1.0))));
      float n = fbm(uv * 3.0 + vec2(uTime * 0.01, 0.0));
      c += vec3(0.18, 0.08, 0.3) * smoothstep(0.55, 0.85, n) * 0.5 + vec3(0.05, 0.1, 0.25) * smoothstep(0.6, 0.9, fbm(uv * 5.0 - 3.0)) * 0.5;
      gl_FragColor = vec4(c, 1.0);`,
      {},
    ),
  );

  // A soft nebula glow behind each course so the sky reads as many galaxies.
  const haloGeo = track(new THREE.BufferGeometry());
  const haloPos = new Float32Array(COURSES.length * 3);
  const haloCol = new Float32Array(COURSES.length * 3);
  COURSES.forEach((c, i) => {
    coursePos[i].toArray(haloPos, i * 3);
    new THREE.Color(PAL[c.color][0]).toArray(haloCol, i * 3);
  });
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
  haloGeo.setAttribute('aColor', new THREE.BufferAttribute(haloCol, 3));
  const haloPr = { value: 1 };
  const halos = new THREE.Points(
    haloGeo,
    track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uPr: haloPr, uTime: time },
        vertexShader: /* glsl */ `attribute vec3 aColor; uniform float uPr, uTime; varying vec3 vC;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            gl_PointSize = uPr * 900.0 / -mv.z * (1.0 + 0.06 * sin(uTime * 0.7 + position.x)); vC = aColor; }`,
        fragmentShader: /* glsl */ `varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.2) * 0.32; gl_FragColor = vec4(vC * a, a); }`,
      }),
    ),
  );
  halos.frustumCulled = false;
  halos.renderOrder = -0.5;
  galaxy.add(halos);

  // ---------- helper comets flying between courses ----------
  const TRAIL = 56;
  const agentCurves = AGENTS.map((_, ai) => {
    const stops: THREE.Vector3[] = [];
    const count = 4 + (ai % 2);
    for (let k = 0; k < count; k++) {
      const ci = (ai * 3 + k * (ai + 2)) % COURSES.length;
      const p = coursePos[ci].clone();
      p.y += 2.5 + rnd() * 2;
      stops.push(p);
    }
    return new THREE.CatmullRomCurve3(stops, true, 'catmullrom', 0.5);
  });
  const agentSpeed = AGENTS.map((_, i) => 1 / (34 + i * 7));
  const agentTrail = AGENTS.map(() => [] as THREE.Vector3[]);
  const agentGeo = track(new THREE.BufferGeometry());
  const agentPositions = new Float32Array(AGENTS.length * TRAIL * 3);
  const agentAge = new Float32Array(AGENTS.length * TRAIL);
  const agentColor = new Float32Array(AGENTS.length * TRAIL * 3);
  AGENTS.forEach((a, ai) => {
    const c = new THREE.Color(PAL[a.color][1]);
    for (let k = 0; k < TRAIL; k++) {
      c.toArray(agentColor, (ai * TRAIL + k) * 3);
      agentAge[ai * TRAIL + k] = k / (TRAIL - 1);
    }
  });
  agentGeo.setAttribute('position', new THREE.BufferAttribute(agentPositions, 3));
  agentGeo.setAttribute('aAge', new THREE.BufferAttribute(agentAge, 1));
  agentGeo.setAttribute('aColor', new THREE.BufferAttribute(agentColor, 3));
  const agentBoost = { value: 0.4 };
  const agentPr = { value: 1 };
  const agentPoints = new THREE.Points(
    agentGeo,
    track(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uBoost: agentBoost, uPr: agentPr },
        vertexShader: /* glsl */ `attribute float aAge; attribute vec3 aColor; uniform float uBoost, uPr; varying float vA; varying vec3 vC;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            float head = 1.0 - smoothstep(0.0, 0.04, aAge);
            gl_PointSize = uPr * (mix(10.0, 2.0, aAge) + head * 26.0 * (0.6 + uBoost)) * (50.0 / -mv.z);
            vA = (1.0 - aAge) * (0.35 + uBoost) + head * 0.6; vC = aColor; }`,
        fragmentShader: /* glsl */ `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r); a = a * a * vA; gl_FragColor = vec4(mix(vC, vec3(1.0), a * 0.6) * a, a); }`,
      }),
    ),
  );
  agentPoints.frustumCulled = false;
  galaxy.add(agentPoints);

  // ---------- scene B: inside the chapter marble ----------
  const sceneB = new THREE.Scene();
  const camB = new THREE.PerspectiveCamera(55, 1, 0.05, 100);
  const uB = {
    uTime: time,
    uHover: { value: -1 },
    uGather: { value: 0 },
    uBob: { value: 0.12 },
    uFogT: { value: 0 },
    uFocus: { value: -1 },
    uFocusAmt: { value: 0 },
    uDim: { value: 0 },
  };
  const kindMix: WorldColor[] = [
    'pink',
    'pink',
    'amber',
    'blue',
    'pink',
    'amber',
    'green',
    'purple',
    'blue',
    'green',
    'purple',
  ];
  const countB = compact ? 48 : 66;
  const itemsB: MarbleItem[] = [];
  for (let i = 0; i < countB; i++) {
    const a = (i / countB) * Math.PI * 6 + rnd() * 0.6;
    const r = 1.9 + rnd() * 2.4;
    const g = new THREE.Vector3(gauss(), gauss(), gauss())
      .normalize()
      .multiplyScalar(0.25 + Math.cbrt(rnd()) * 1.25);
    itemsB.push({
      p: new THREE.Vector3(Math.cos(a) * r, gauss() * 1.3, Math.sin(a) * r),
      s: 0.16 + rnd() * 0.26,
      c: kindMix[i % kindMix.length],
      g,
      rank: rnd(),
    });
  }
  // Three labelled memories, kept clear of the fog until late.
  Object.assign(itemsB[0], { c: 'pink', s: 0.42, rank: 0.05 });
  itemsB[0].p.set(2.4, 0.5, 1.6);
  Object.assign(itemsB[1], { c: 'amber', s: 0.38, rank: 0.15 });
  itemsB[1].p.set(-2.8, -0.4, 1.4);
  Object.assign(itemsB[2], { c: 'blue', s: 0.36, rank: 0.55 });
  itemsB[2].p.set(0.4, 1.4, -2.6);
  const marblesB = makeMarbles(itemsB, uB);
  sceneB.add(marblesB.mesh);
  const revive = new Float32Array(countB);
  const reviveTarget = new Float32Array(countB);
  const skyU = {
    uDeep: { value: new THREE.Color(SKY.pink[0]) },
    uBase: { value: new THREE.Color(SKY.pink[1]) },
    uLight: { value: new THREE.Color(SKY.pink[2]) },
  };
  sceneB.add(
    backgroundQuad(
      /* glsl */ `
      vec2 q = (uv - 0.5) * vec2(uAsp, 1.0);
      float r = length(q); float ang = atan(q.y, q.x);
      float sw = fbm(vec2(ang * 1.2 + r * 3.0 - uTime * 0.04, r * 2.0 - uTime * 0.02) * 1.6);
      vec3 c = sw < 0.42 ? uDeep : (sw < 0.62 ? uBase : uLight);
      c = mix(c, uDeep * 0.5, smoothstep(0.2, 1.1, r) * 0.75);
      gl_FragColor = vec4(c * 0.6, 1.0);`,
      skyU,
    ),
  );
  const skyTarget = SKY.pink.map((h) => new THREE.Color(h));

  // ---------- render targets, fluid trail, composite ----------
  const rtA = track(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
  const rtB = track(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
  let bloomOn = true;
  for (const rt of [rtA, rtB]) {
    rt.texture.generateMipmaps = true;
    rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }
  const trail = [0, 1].map(() =>
    track(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false })),
  );
  let trailIdx = 0;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = track(new THREE.PlaneGeometry(2, 2));
  const trailMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null as THREE.Texture | null },
        uMouse: { value: new THREE.Vector2(-1, -1) },
        uVel: { value: new THREE.Vector2() },
        uAsp: aspect,
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `varying vec2 vUv; uniform sampler2D tPrev; uniform vec2 uMouse, uVel; uniform float uAsp;
        void main(){
          vec4 here = texture2D(tPrev, vUv);
          vec4 prev = texture2D(tPrev, vUv - here.rg * 0.012);
          vec2 vel = prev.rg * 0.955; float inten = prev.b * 0.962;
          vec2 d = (vUv - uMouse) * vec2(uAsp, 1.0); float g = exp(-dot(d, d) / 0.0035);
          vel += uVel * g; inten += min(length(uVel) * 3.0, 1.0) * g;
          gl_FragColor = vec4(clamp(vel, -1.5, 1.5), clamp(inten, 0.0, 1.0), 1.0);
        }`,
    }),
  );
  const trailScene = new THREE.Scene();
  trailScene.add(new THREE.Mesh(quadGeo, trailMat));
  const compMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: rtA.texture },
        tB: { value: rtB.texture },
        tTrail: { value: null as THREE.Texture | null },
        uMix: { value: 0 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uAsp: aspect,
        uTime: time,
        uBloom: { value: 1 },
        uKick: { value: 0 },
        uKickPhase: { value: 0 },
        uReveal: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: /* glsl */ `varying vec2 vUv; uniform sampler2D tA, tB, tTrail;
        uniform float uMix, uAsp, uTime, uBloom, uKick, uKickPhase, uReveal; uniform vec2 uCenter;
        vec3 rgb(sampler2D t, vec2 uv, vec2 dir){ return vec3(texture2D(t, uv + dir).r, texture2D(t, uv).g, texture2D(t, uv - dir).b); }
        vec3 bloom(sampler2D t, vec2 uv){ vec3 b = texture2D(t, uv, 3.5).rgb * 0.5 + texture2D(t, uv, 5.5).rgb * 0.8; return max(b - 0.12, 0.0) * 0.9 * uBloom; }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec4 tr = texture2D(tTrail, vUv);
          vec2 vel = tr.rg; float inten = tr.b;
          vec2 uv = vUv - vel * 0.035 * inten;
          // chapter-change ripple from the screen center
          vec2 kq = (uv - 0.5) * vec2(uAsp, 1.0); float kd = length(kq);
          vec2 kdir = kd > 0.0001 ? kq / kd : vec2(0.0);
          float wave = sin(kd * 22.0 - uKickPhase) * exp(-pow(kd - uKickPhase * 0.06, 2.0) * 6.0);
          uv += kdir / vec2(uAsp, 1.0) * wave * uKick * 0.018;
          // lens dive from scene A into scene B
          vec2 d = (uv - uCenter) * vec2(uAsp, 1.0); float dist = length(d);
          vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);
          float R = uMix * 2.6;
          float inside = smoothstep(R + 0.01, R - 0.05, dist);
          float actv = step(0.001, uMix) * step(uMix, 0.999);
          float ring = exp(-pow((dist - R) / 0.06, 2.0)) * actv;
          float k = clamp(dist / max(R, 0.001), 0.0, 1.0);
          float magB = mix(0.35 + 0.65 * k * k, 1.0, smoothstep(0.55, 1.0, uMix));
          vec2 uvB = uCenter + (uv - uCenter) * magB;
          vec2 uvA = uv - dir / vec2(uAsp, 1.0) * ring * 0.05;
          vec2 ca = (dir / vec2(uAsp, 1.0)) * (0.006 * inten + 0.012 * ring) + vel * 0.004 * inten + kdir * abs(wave) * uKick * 0.004;
          vec3 a = uMix < 0.999 ? rgb(tA, uvA, ca) + bloom(tA, uvA) : vec3(0.0);
          vec3 b = uMix > 0.001 ? rgb(tB, uvB, ca) + bloom(tB, uvB) : vec3(0.0);
          vec3 c = mix(a, b, inside);
          c += ring * vec3(1.0, 0.85, 1.0) * 0.5;
          c += inten * 0.05 * vec3(0.7, 0.6, 1.0);
          vec2 v = vUv - 0.5; c *= 1.0 - dot(v, v) * 0.9;
          c += (hash(vUv * 1000.0 + fract(uTime)) - 0.5) * 0.03;
          c *= uReveal;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  const compScene = new THREE.Scene();
  compScene.add(new THREE.Mesh(quadGeo, compMat));

  const clearTrail = () => {
    for (const t of trail) {
      renderer.setRenderTarget(t);
      renderer.clear();
    }
    renderer.setRenderTarget(null);
  };

  let vw = 1;
  let vh = 1;
  const resize = () => {
    vw = window.innerWidth;
    vh = window.innerHeight;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(vw, vh, false);
    agentPr.value = pixelRatio;
    haloPr.value = pixelRatio;
    aspect.value = vw / vh;
    camA.aspect = camB.aspect = vw / vh;
    // Narrow screens: pull the cameras back so the galaxy still fits.
    camA.fov = vw < vh ? 68 : 50;
    camB.fov = vw < vh ? 70 : 55;
    camA.updateProjectionMatrix();
    camB.updateProjectionMatrix();
    rtA.setSize(vw * pixelRatio, vh * pixelRatio);
    rtB.setSize(vw * pixelRatio, vh * pixelRatio);
    for (const t of trail) t.setSize(Math.max(64, (vw / 4) | 0), Math.max(64, (vh / 4) | 0));
    clearTrail();
  };
  window.addEventListener('resize', resize);
  resize();

  // ---------- input ----------
  const pointer = { x: vw / 2, y: vh / 2, nx: 0.5, ny: 0.5, px: 0.5, py: 0.5, active: false };
  const onMove = (e: PointerEvent) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = e.clientX / vw;
    pointer.ny = 1 - e.clientY / vh;
    pointer.active = e.pointerType === 'mouse';
  };
  const onDown = (e: PointerEvent) => {
    onMove(e);
    // Touch: start the trail where the finger lands, without a jump.
    pointer.px = pointer.nx;
    pointer.py = pointer.ny;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });

  const onLost = (e: Event) => {
    e.preventDefault();
    opts.onContextLost();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  // ---------- helpers ----------
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();
  // Camera stops in scene A (u, position, look-at); eased between neighbours.
  const KEYS: [number, THREE.Vector3, THREE.Vector3][] = [
    [0, new THREE.Vector3(0, 20, 70), new THREE.Vector3(0, -2, -6)],
    [0.6, new THREE.Vector3(0, 20, 70), new THREE.Vector3(0, -2, -6)],
    [2.6, new THREE.Vector3(-26, 11, 38), new THREE.Vector3(6, 0, -10)],
    [4.4, new THREE.Vector3(18, 9, 30), new THREE.Vector3(-2, 0, -4)],
    [DIVE_START + 0.5, new THREE.Vector3(-9, 3.2, 9), new THREE.Vector3(0, 0, 0)],
  ];
  const keyframe = (x: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    let k = 0;
    while (k < KEYS.length - 2 && x > KEYS[k + 1][0]) k++;
    const [ua, pa, la] = KEYS[k];
    const [ub, pb, lb] = KEYS[k + 1];
    const e = ease(win(x, ua, ub));
    pos.lerpVectors(pa, pb, e);
    look.lerpVectors(la, lb, e);
  };
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const toward = new THREE.Vector3();
  const project = (v: THREE.Vector3, cam: THREE.Camera) => {
    v3b.copy(v).project(cam);
    return { x: (v3b.x * 0.5 + 0.5) * vw, y: (-v3b.y * 0.5 + 0.5) * vh, z: v3b.z };
  };
  // Narrow screens push the galaxy higher so copy below stays readable.
  const heroLift = () => (vw < vh ? 4 : 0);

  let target = 0;
  let u = 0;
  let raf = 0;
  let disposed = false;
  let last = performance.now();
  let start = last;
  let slowFrames = 0;
  let measured = 0;
  let wasMemory = false;
  const featureSky = (i: number) =>
    SKY[FEATURE_COLORS[Math.max(0, Math.min(FEATURE_COUNT - 1, i))]];

  renderer.compile(sceneA, camA);
  renderer.compile(sceneB, camB);

  const frame = (now: number) => {
    raf = 0;
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // rAF timestamps can sit slightly before `start`.
    const t = Math.max(0, (now - start) / 1000);
    time.value = t;
    u += (target - u) * (1 - Math.pow(0.02, dt));
    if (Math.abs(target - u) < 0.0004) u = target;

    // Quality: if the first second and a half runs slowly, drop resolution, then glow.
    if (t > 0.5 && measured < 90) {
      measured++;
      if (dt > 1 / 38) slowFrames++;
      if (measured === 90 && slowFrames > 45) {
        if (pixelRatio > 1) {
          pixelRatio = 1;
          resize();
          measured = 0;
          slowFrames = 0;
        } else if (bloomOn) {
          bloomOn = false;
          for (const rt of [rtA, rtB]) {
            rt.texture.generateMipmaps = false;
            rt.texture.minFilter = THREE.LinearFilter;
            rt.texture.needsUpdate = true;
          }
          compMat.uniforms.uBloom.value = 0;
        }
      }
    }

    // fluid trail
    const dx = pointer.nx - pointer.px;
    const dy = pointer.ny - pointer.py;
    pointer.px = pointer.nx;
    pointer.py = pointer.ny;
    trailMat.uniforms.uMouse.value.set(pointer.nx, pointer.ny);
    trailMat.uniforms.uVel.value.set(dx * 30, dy * 30);
    trailMat.uniforms.tPrev.value = trail[trailIdx].texture;
    renderer.setRenderTarget(trail[1 - trailIdx]);
    renderer.render(trailScene, quadCam);
    trailIdx = 1 - trailIdx;

    // ----- scene A camera: the whole sky -> drift across courses -> helpers -> CSC108 -> dive -----
    galaxy.rotation.y = t * 0.006 + u * 0.03;
    galaxy.updateMatrixWorld();
    const diveWorld = galaxy.localToWorld(v3.copy(itemsA[CHAPTER_BASE + DIVE_CHAPTER].p));
    keyframe(u, camPos, lookAt);
    const k2 = ease(win(u, DIVE_START + 0.2, DIVE_END - 0.4));
    camPos.y += heroLift() * (1 - win(u, AGENTS_END - 0.6, DIVE_START + 0.3));
    toward.subVectors(camPos, diveWorld).normalize().multiplyScalar(0.9).add(diveWorld);
    camPos.lerp(toward, k2);
    lookAt.lerp(diveWorld, k2);
    const sway = 1 - k2;
    camPos.x += (pointer.nx - 0.5) * 2.2 * sway;
    camPos.y += (pointer.ny - 0.5) * 1.4 * sway;
    camA.position.copy(camPos);
    camA.lookAt(lookAt);

    // helper comets
    agentBoost.value +=
      ((u > AGENTS_START - 0.2 && u < AGENTS_END + 0.3 ? 1.4 : 0.45) - agentBoost.value) *
      Math.min(1, dt * 2);
    const agentLabels: ({ x: number; y: number } | null)[] = [];
    AGENTS.forEach((_, ai) => {
      const head = agentCurves[ai].getPointAt(
        (((t * agentSpeed[ai] + ai / AGENTS.length) % 1) + 1) % 1,
      );
      const trailPts = agentTrail[ai];
      if (!trailPts.length || trailPts[0].distanceToSquared(head) > 0.02) {
        trailPts.unshift(head.clone());
        if (trailPts.length > TRAIL) trailPts.pop();
      } else trailPts[0].copy(head);
      for (let k = 0; k < TRAIL; k++) {
        const pt = trailPts[Math.min(k, trailPts.length - 1)];
        pt.toArray(agentPositions, (ai * TRAIL + k) * 3);
      }
      const sp = project(galaxy.localToWorld(v3b.copy(head)), camA);
      agentLabels.push(sp.z < 1 ? { x: sp.x, y: sp.y } : null);
    });
    agentGeo.attributes.position.needsUpdate = true;
    const courseLabels = COURSES.map((_, ci) => {
      const sp = project(galaxy.localToWorld(v3b.copy(coursePos[ci])), camA);
      return sp.z < 1 ? { x: sp.x, y: sp.y } : null;
    });

    let hoverChapter = -1;
    let hoverCourse = -1;
    if (pointer.active && u < DIVE_START + 0.2) {
      let best = 46 * 46;
      const near = u > AGENTS_END - 0.5;
      for (let i = 0; i < COURSES.length + (near ? CHAPTERS.length : 0); i++) {
        const s2 = project(galaxy.localToWorld(v3b.copy(itemsA[i].p)), camA);
        const dd = (s2.x - pointer.x) ** 2 + (s2.y - pointer.y) ** 2;
        if (s2.z < 1 && dd < best) {
          best = dd;
          if (i < COURSES.length) {
            hoverCourse = i;
            hoverChapter = -1;
          } else {
            hoverChapter = i - COURSES.length;
            hoverCourse = -1;
          }
        }
      }
    }
    uA.uHover.value =
      hoverCourse >= 0 ? hoverCourse : hoverChapter >= 0 ? CHAPTER_BASE + hoverChapter : -1;

    // ----- lens dive -----
    const mix = ease(win(u, DIVE_MIX_START, DIVE_END));
    const sc = project(diveWorld, camA);
    compMat.uniforms.uCenter.value.set(sc.x / vw, 1 - sc.y / vh);
    compMat.uniforms.uMix.value = mix;

    // ----- scene B: one stop per feature, then gather -----
    const f = (u - FEATURE_START) / FEATURE_LEN;
    const fi = Math.max(0, Math.min(FEATURE_COUNT - 1, Math.floor(f)));
    // The camera turns to the next stop during the first 40% of each feature, then holds.
    let turn: number;
    if (f < 0) turn = f * 0.6;
    else if (f >= FEATURE_COUNT) turn = FEATURE_COUNT - 1 + (f - FEATURE_COUNT) * 0.3;
    else turn = fi === 0 ? 0 : fi - 1 + ease(Math.min(1, (f - fi) / 0.55));
    const ang = turn * 1.15 + t * 0.03;
    const dist =
      11 -
      2.4 * ease(win(u, DIVE_MIX_START, FEATURE_START + 0.4)) -
      1.4 * ease(win(u, CLOSING_START, CLOSING_START + 1));
    const sideShift = vw > vh && u < CLOSING_START ? 1 : 0; // keep marbles clear of the copy column
    camB.position.set(
      Math.sin(ang) * dist + (pointer.nx - 0.5) * 0.8,
      0.8 + (pointer.ny - 0.5) * 0.6,
      Math.cos(ang) * dist,
    );
    v3.set(Math.cos(ang), 0, -Math.sin(ang)).multiplyScalar(-3.4 * sideShift);
    const closingK = ease(win(u, CLOSING_START, CLOSING_START + 1));
    // Portrait: copy sits on top during features (push the world down), at the bottom at the end.
    v3.y = -0.9 * closingK + (vw < vh ? 1.3 * (1 - closingK) - 1.4 * closingK : 0);
    camB.lookAt(v3);

    const inFeatures = u >= FEATURE_START - 0.2 && u < CLOSING_START;
    const focusIdx = inFeatures ? KIND_ORDER.indexOf(FEATURE_COLORS[fi]) : -1;
    uB.uFocus.value = focusIdx;
    uB.uFocusAmt.value += ((inFeatures ? 1 : 0) - uB.uFocusAmt.value) * Math.min(1, dt * 3);
    uB.uDim.value = uB.uFocusAmt.value * 0.6;
    const sky = u < FEATURE_START - 0.2 ? SKY.pink : featureSky(fi);
    for (let i = 0; i < 3; i++) skyTarget[i].set(sky[i]);
    skyU.uDeep.value.lerp(skyTarget[0], Math.min(1, dt * 2.2));
    skyU.uBase.value.lerp(skyTarget[1], Math.min(1, dt * 2.2));
    skyU.uLight.value.lerp(skyTarget[2], Math.min(1, dt * 2.2));

    // memory feature: memories fog over, a tap brings one back
    const memStart = featureStart(MEMORY_FEATURE);
    const inMemory = u >= memStart && u < memStart + FEATURE_LEN;
    uB.uFogT.value =
      win(u, memStart + 0.5, memStart + 1.1) *
      (1 - win(u, memStart + FEATURE_LEN - 0.1, memStart + FEATURE_LEN + 0.3));
    if (wasMemory && !inMemory) reviveTarget.fill(0);
    wasMemory = inMemory;
    let changed = false;
    for (let i = 0; i < countB; i++) {
      const nv = revive[i] + (reviveTarget[i] - revive[i]) * Math.min(1, dt * 2.5);
      if (Math.abs(nv - revive[i]) > 1e-4) {
        revive[i] = nv;
        marblesB.reviveAttr.array[i] = nv;
        changed = true;
      }
    }
    if (changed) marblesB.reviveAttr.needsUpdate = true;
    let hoverMemory = -1;
    if (pointer.active && inMemory) hoverMemory = nearestMemory(pointer.x, pointer.y);
    uB.uHover.value = hoverMemory;
    uB.uGather.value = ease(win(u, CLOSING_START + 0.1, CLOSING_START + 0.9));

    const labels = [0, 1, 2].map((i) => {
      const s = project(itemsB[i].p, camB);
      return s.z < 1 ? { x: s.x, y: s.y } : null;
    });

    // ----- chapter ripple -----
    let kick = 0;
    let phase = 0;
    for (let i = 1; i <= FEATURE_COUNT; i++) {
      const b = featureStart(i);
      const local = (u - b) / 0.6;
      if (Math.abs(local) < 1.2) {
        kick = Math.max(kick, Math.exp(-local * local * 2.5));
        phase = (u - b + 0.6) * 13;
      }
    }
    compMat.uniforms.uKick.value = kick;
    compMat.uniforms.uKickPhase.value = phase;
    compMat.uniforms.uReveal.value = Math.min(1, compMat.uniforms.uReveal.value + dt * 1.6);

    // ----- render -----
    if (mix < 0.999) {
      renderer.setRenderTarget(rtA);
      renderer.render(sceneA, camA);
    }
    if (mix > 0.001) {
      renderer.setRenderTarget(rtB);
      renderer.render(sceneB, camB);
    }
    compMat.uniforms.tTrail.value = trail[trailIdx].texture;
    renderer.setRenderTarget(null);
    renderer.render(compScene, quadCam);

    opts.onFrame({
      u,
      hoverCourse,
      hoverChapter,
      hoverMemory,
      labels,
      agents: agentLabels,
      courses: courseLabels,
    });
    raf = requestAnimationFrame(frame);
  };

  function nearestMemory(x: number, y: number) {
    let best = 50 * 50;
    let hit = -1;
    itemsB.forEach((it, i) => {
      const s = project(it.p, camB);
      const dd = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (s.z < 1 && dd < best) {
        best = dd;
        hit = i;
      }
    });
    return hit;
  }

  const onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf && !disposed) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  start = performance.now();
  last = start;
  raf = requestAnimationFrame(frame);

  return {
    setTarget(next, immediate) {
      target = next;
      if (immediate) u = next;
    },
    tap(x, y) {
      const memStart = featureStart(MEMORY_FEATURE);
      if (u < memStart || u >= memStart + FEATURE_LEN) return;
      const hit = nearestMemory(x, y);
      if (hit >= 0) reviveTarget[hit] = 1;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('webglcontextlost', onLost);
      document.removeEventListener('visibilitychange', onVisibility);
      marblesA.mesh.dispose();
      marblesB.mesh.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
  };
}

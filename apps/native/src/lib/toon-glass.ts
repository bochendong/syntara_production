import * as THREE from 'three';

import type { MarbleColor } from './learning-action-marbles';
import type { MarbleRarity } from './memory-galaxy';

/**
 * 和头像同一套画风的玻璃珠：浅色透亮的玻璃里卷着一个大漩涡，漩涡分成浅、中、深三层颜色，
 * 层与层之间是干净的边（像赛璐璐上色），左上角两块白色高光，边缘一圈细细的深色描边。
 * 高级的珠子里面还会飘白云（云彩珠），或者是一整片带星星的银河（星云珠）。
 * 不靠光照和透射，全在着色器里画，所以在透明画布上也不会发白，手机上也便宜。 */

/** 代码画的三种花纹：漩涡、云彩、星云。 */
const MARBLE_TIERS = ['swirl', 'cloud', 'nebula'] as const;
type MarbleTier = (typeof MARBLE_TIERS)[number];

/** light：玻璃本身的浅色；mid：漩涡；deep：漩涡最浓的那一层，也用来描边。 */
type Palette = { light: string; mid: string; deep: string };

const PALETTES: Record<MarbleColor | 'silver', Palette> = {
  blue: { light: '#d3efff', mid: '#5ab4ff', deep: '#1d4ed8' },
  green: { light: '#d8fbe8', mid: '#5fdc9f', deep: '#0f8f5a' },
  amber: { light: '#ffeab0', mid: '#ffae1f', deep: '#e3540b' },
  pink: { light: '#ffe2ee', mid: '#ff8db7', deep: '#d92e6c' },
  purple: { light: '#e8e0ff', mid: '#a68aff', deep: '#5634e6' },
  silver: { light: '#f8fafc', mid: '#c2cad6', deep: '#434b59' },
};

const vertexShader = /* glsl */ `
  varying vec3 vObject;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;
  void main() {
    vObject = position;
    vNormalView = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uLight;
  uniform vec3 uMid;
  uniform vec3 uDeep;
  uniform float uFresh;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uTier;
  varying vec3 vObject;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(-vViewPosition);
    float facing = clamp(dot(n, v), 0.0, 1.0);
    float rim = 1.0 - facing;

    // 往里看得越深，花纹越靠近球心：像透过厚玻璃看到里面的东西。
    vec3 p = vObject * (0.55 + 0.45 * facing);
    float drift = uTime * 0.05;
    // 漩涡：沿着斜对角卷起来的一条 S 形大螺旋，分成浅、中、深三层。
    float angle = atan(p.z, p.x);
    float along = dot(p, vec3(0.62, 0.68, 0.38));
    float curl = sin(p.y * 2.1 + p.z * 1.4 + drift) * 0.4 + (fbm(p * 1.3 + drift) - 0.5) * 0.5;
    float swirl = sin((along + curl) * 2.6 + angle - uTime * 0.1);
    float midLayer = smoothstep(-0.14, -0.08, swirl);
    float deepLayer = smoothstep(0.5, 0.56, swirl);
    vec3 color;

    if (uTier > 1.5) {
      // 星云珠：深色的太空，漩涡变成一条发光的银河，再撒星星。
      vec3 space = uDeep * 0.28;
      float galaxy = exp(-abs(swirl - 0.25) * 1.1) * (0.6 + 0.6 * fbm(p * 2.0 + drift));
      float dust = fbm(p * 3.4 - vec3(drift * 2.0, 0.0, 0.0));
      color = mix(space, uDeep, smoothstep(0.2, 0.9, galaxy));
      color = mix(color, uMid, smoothstep(0.55, 0.95, galaxy) * (0.5 + dust * 0.6));
      color += uLight * pow(galaxy, 6.0) * 0.5;
      vec3 cell = floor(p * 16.0);
      float starSeed = hash(cell);
      float star = step(0.86, starSeed) * smoothstep(0.32, 0.0, length(fract(p * 16.0) - 0.5));
      float twinkle = 0.55 + 0.45 * sin(uTime * 2.2 + hash(cell + 5.0) * 40.0);
      color += vec3(1.0) * star * twinkle * 1.5;
      // 星云珠的玻璃边是亮的，像被里面的光照透。
      color = mix(color, uMid, smoothstep(0.62, 0.9, rim) * 0.55);
    } else {
      color = mix(uLight, uMid, midLayer);
      color = mix(color, mix(uMid, uDeep, 0.6 + 0.4 * swirl), deepLayer * 0.85);
      // 层与层之间一道细细的亮线。
      color += vec3(1.0) * (smoothstep(-0.22, -0.15, swirl) - smoothstep(-0.15, -0.1, swirl)) * 0.45;
      if (uTier > 0.5) {
        // 云彩珠：顺着漩涡飘着一团团白云，云的边缘带一点薄荷青。
        vec3 cp = p + vec3(drift * 1.5, 0.0, 0.0);
        float cloud = noise(cp * 2.4) * 0.62 + noise(cp * 5.0) * 0.3 + swirl * 0.2;
        float puff = smoothstep(0.62, 0.65, cloud);
        float core = smoothstep(0.67, 0.75, cloud);
        vec3 cloudColor = mix(vec3(0.66, 0.93, 0.86), vec3(1.0), core);
        color = mix(color, cloudColor, puff * 0.95);
      }
      // 中间透亮，越到边缘玻璃越厚、颜色越浓。
      color = mix(color, uLight, pow(facing, 3.0) * 0.22);
      color = mix(color, mix(uMid, uDeep, 0.4), smoothstep(0.6, 0.92, rim) * 0.4);
    }

    // 起雾：颜色变淡、变灰，像磨砂玻璃。
    float fog = 1.0 - uFresh;
    color = mix(color, vec3(0.86, 0.88, 0.93), fog * 0.6);

    // 高光：左上一大块椭圆、旁边一个小圆点，左上边缘一道弧光，右下一小点反光。
    vec2 q = n.xy;
    vec2 d = q - vec2(-0.36, 0.42);
    d = mat2(0.8, -0.6, 0.6, 0.8) * d;
    float spot = 1.0 - smoothstep(0.0, 0.025, length(d * vec2(1.0, 1.7)) - 0.25);
    float dot2 = 1.0 - smoothstep(0.0, 0.025, length(q - vec2(-0.02, 0.66)) - 0.07);
    float arc = smoothstep(0.78, 0.84, rim) * (1.0 - smoothstep(0.86, 0.9, rim)) * smoothstep(0.1, 0.6, -q.x + q.y);
    float back = 1.0 - smoothstep(0.0, 0.05, length((q - vec2(0.42, -0.52)) * vec2(1.6, 1.0)) - 0.09);
    float shine = max(max(spot, dot2), max(arc * 0.8, back * 0.4)) * (0.45 + 0.55 * uFresh);
    color = mix(color, vec3(1.0), shine * 0.95);

    // 细描边。
    float outline = smoothstep(0.93, 0.97, rim);
    color = mix(color, uDeep * 0.45, outline * 0.9);

    float alpha = uOpacity * mix(0.9, 1.0, rim);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export class ToonGlassMaterials {
  private cache = new Map<string, THREE.ShaderMaterial>();
  private time = { value: 0 };

  get(
    color: MarbleColor | 'silver',
    rarity: MarbleRarity,
    freshness = 1,
    opacity = 1,
  ): THREE.ShaderMaterial {
    // 新鲜度只分 5 档，材质够用就好。
    const fresh = Math.round(Math.max(0, Math.min(1, freshness)) * 4) / 4;
    // 没有画好的珠子图时，代码画的珠子：R 是漩涡，SR 带白云，SSR 和 EX 是星云。
    const tier: MarbleTier = rarity === 'R' ? 'swirl' : rarity === 'SR' ? 'cloud' : 'nebula';
    const key = `${color}:${tier}:${fresh}:${opacity}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const palette = PALETTES[color];
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: opacity >= 1,
      uniforms: {
        uLight: { value: new THREE.Color(palette.light) },
        uMid: { value: new THREE.Color(palette.mid) },
        uDeep: { value: new THREE.Color(palette.deep) },
        uFresh: { value: fresh },
        uTime: this.time,
        uOpacity: { value: opacity },
        uTier: { value: MARBLE_TIERS.indexOf(tier) },
      },
    });
    this.cache.set(key, material);
    return material;
  }

  /** 让珠子里的漩涡慢慢转。 */
  tick(dt: number) {
    this.time.value += dt;
  }

  dispose() {
    this.cache.forEach((material) => material.dispose());
    this.cache.clear();
  }
}

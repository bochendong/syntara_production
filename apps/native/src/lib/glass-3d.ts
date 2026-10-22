import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { MarbleColor } from './learning-action-marbles';

/** 罐子、玻璃管、弹珠共用的一套玻璃材质和渲染设置。 */

export const MARBLE_TINTS: Record<MarbleColor, string> = {
  blue: '#5b9dff',
  purple: '#9f7bff',
  pink: '#ff7fb6',
  green: '#43cf8f',
  amber: '#ffaa2b',
};

export function createGlassRenderer(canvas: HTMLCanvasElement, preserveDrawingBuffer = false) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

export function addStudioLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(-2, 3, 2.5);
  scene.add(key, new THREE.AmbientLight('#ffffff', 0.25));
}

export function shadowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(30,41,70,0.42)');
    gradient.addColorStop(0.6, 'rgba(30,41,70,0.12)');
    gradient.addColorStop(1, 'rgba(30,41,70,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 木塞的底色加一层小斑点；不同课程用不同颜色的塞子。 */
export function corkTexture(base: string, speckle: [number, number, number]): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = base;
    context.fillRect(0, 0, 256, 256);
    // 固定种子，每次打开同一个塞子长得一样。
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let index = 0; index < 1400; index += 1) {
      const shade = 0.75 + random() * 0.5;
      context.fillStyle = `rgba(${Math.round(speckle[0] * shade)}, ${Math.round(speckle[1] * shade)}, ${Math.round(speckle[2] * shade)}, ${0.2 + random() * 0.4})`;
      const size = 1 + random() * 3;
      context.beginPath();
      context.ellipse(
        random() * 256,
        random() * 256,
        size,
        size * 0.7,
        random() * 3,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

/** 玻璃：中间几乎透明，越靠边缘越亮（菲涅尔），看起来才像有厚度的玻璃。 */
export function glassMaterial(): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.8,
    specularIntensity: 1,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
      float glassFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
      float glassFresnel = pow(1.0 - glassFacing, 2.2);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), glassFresnel * 0.25);
      gl_FragColor.a = clamp(0.015 + glassFresnel * 0.7, 0.0, 0.85);`,
    );
  };
  return material;
}

/** 新鲜度分 4 档：3 是刚存的，0 是很久没复习、雾蒙蒙的。 */
export const FRESHNESS_LEVELS = 4;

export function freshnessLevel(freshness: number): number {
  return Math.max(
    0,
    Math.min(FRESHNESS_LEVELS - 1, Math.round(freshness * (FRESHNESS_LEVELS - 1))),
  );
}

export class MarbleMaterials {
  private cache = new Map<string, [THREE.Material, THREE.Material]>();
  readonly shell = new THREE.SphereGeometry(1, 40, 28);
  readonly core = new THREE.SphereGeometry(0.5, 24, 16);

  get(color: MarbleColor, level = FRESHNESS_LEVELS - 1): [THREE.Material, THREE.Material] {
    const key = `${color}:${level}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const fresh = level / (FRESHNESS_LEVELS - 1);
    // 越久没复习，颜色越灰、玻璃越磨砂、越不透光。
    const tint = new THREE.Color(MARBLE_TINTS[color]).lerp(
      new THREE.Color('#8b93a3'),
      (1 - fresh) * 0.5,
    );
    const shell = new THREE.MeshPhysicalMaterial({
      // 画布是透明的，three 的透射会采样到一层白底；所以玻璃本身的颜色要够浓，弹珠才是彩色玻璃而不是白片。
      color: tint.clone().lerp(new THREE.Color('#ffffff'), 0.25 + (1 - fresh) * 0.1),
      metalness: 0,
      roughness: 0.42 * (1 - fresh),
      transmission: 0.35 + fresh * 0.65,
      thickness: 0.22,
      ior: 1.45,
      attenuationColor: tint,
      attenuationDistance: 0.4,
      clearcoat: fresh,
      clearcoatRoughness: 0,
      specularIntensity: 0.4 + fresh * 0.6,
      envMapIntensity: 0.7 + fresh * 0.9,
      iridescence: 0.25 * fresh,
      iridescenceIOR: 1.3,
    });
    // 弹珠中心一团颜色更深的芯，透过玻璃折射出来；新鲜的会微微发光。
    const core = new THREE.MeshPhysicalMaterial({
      color: tint,
      emissive: tint,
      emissiveIntensity: 0.04 + fresh * 0.22,
      roughness: 0.35,
      metalness: 0,
    });
    const pair: [THREE.Material, THREE.Material] = [shell, core];
    this.cache.set(key, pair);
    return pair;
  }

  /** 一颗弹珠：外壳 + 压扁的芯。 */
  build(color: MarbleColor, level: number, radius: number): THREE.Group {
    const [shell, core] = this.get(color, level);
    const group = new THREE.Group();
    const coreMesh = new THREE.Mesh(this.core, core);
    coreMesh.scale.set(radius, radius * 0.18, radius);
    coreMesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const shellMesh = new THREE.Mesh(this.shell, shell);
    shellMesh.scale.setScalar(radius);
    group.add(coreMesh, shellMesh);
    group.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    return group;
  }

  /** 换新鲜度时只换材质，弹珠的位置和转动不变。 */
  restyle(group: THREE.Group, color: MarbleColor, level: number) {
    const [shell, core] = this.get(color, level);
    const [coreMesh, shellMesh] = group.children as THREE.Mesh[];
    coreMesh.material = core;
    shellMesh.material = shell;
  }

  dispose() {
    this.cache.forEach(([shell, core]) => {
      shell.dispose();
      core.dispose();
    });
    this.shell.dispose();
    this.core.dispose();
  }
}

export function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const material = object.material as THREE.Material | THREE.Material[];
      (Array.isArray(material) ? material : [material]).forEach((item) => {
        (item as THREE.MeshStandardMaterial).map?.dispose();
        item.dispose();
      });
    }
  });
  scene.environment?.dispose();
}

// ---- 晃手机：用陀螺仪的倾斜方向当重力方向 ----

type TiltListener = (x: number, z: number) => void;
const tiltListeners = new Set<TiltListener>();
let tiltBaseline: number | null = null;
let tiltAttached = false;

function onOrientation(event: DeviceOrientationEvent) {
  if (event.beta === null || event.gamma === null) return;
  const beta = (event.beta * Math.PI) / 180;
  const gamma = (event.gamma * Math.PI) / 180;
  // 第一次读到的前后角度当作“端平”，之后只看相对它的变化。
  if (tiltBaseline === null) tiltBaseline = beta;
  const x = Math.sin(gamma) * Math.cos(beta);
  const z = Math.sin(beta - tiltBaseline) * 0.8;
  tiltListeners.forEach((listener) => listener(x, z));
}

function attachTilt() {
  if (tiltAttached || typeof window === 'undefined') return;
  tiltAttached = true;
  window.addEventListener('deviceorientation', onOrientation);
}

/** iOS 要在用户点击时申请一次陀螺仪权限；其他平台直接开始听。 */
export function requestTiltPermission() {
  const permission = (
    DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  ).requestPermission;
  if (typeof permission === 'function') {
    void permission()
      .then((state) => {
        if (state === 'granted') attachTilt();
      })
      .catch(() => undefined);
    return;
  }
  attachTilt();
}

export function subscribeTilt(listener: TiltListener): () => void {
  tiltListeners.add(listener);
  // 安卓和桌面不需要申请，直接听。
  const permission =
    typeof DeviceOrientationEvent === 'undefined'
      ? undefined
      : (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission;
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof permission !== 'function') {
    attachTilt();
  }
  return () => {
    tiltListeners.delete(listener);
  };
}

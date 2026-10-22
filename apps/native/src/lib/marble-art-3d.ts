import * as THREE from 'three';

import { marbleArtFor } from './marble-art';
import type { GalaxyNode } from './memory-galaxy';

// ---- 贴图：所有星图共用，只加载一次 ----

const textures = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<THREE.Texture | null>>();
/** 每张贴图等着它的回调；同一个回调只记一次，否则珠子一多，每次重画又登记一遍，回调会成倍增长卡死页面。 */
const listeners = new Map<string, Set<() => void>>();

/** 已经加载好的贴图；还没好就开始加载，好了以后 onReady 会被叫一次。 */
export function marbleTexture(url: string, onReady?: () => void): THREE.Texture | null {
  const ready = textures.get(url);
  if (ready) return ready;
  let waiting = listeners.get(url);
  if (!waiting) {
    waiting = new Set();
    listeners.set(url, waiting);
    void loadTexture(url).then((texture) => {
      const callbacks = listeners.get(url);
      listeners.delete(url);
      if (texture) callbacks?.forEach((callback) => callback());
    });
  }
  if (onReady) waiting.add(onReady);
  return null;
}

function loadTexture(url: string): Promise<THREE.Texture | null> {
  let task = pending.get(url);
  if (!task) {
    task = new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const texture = new THREE.Texture(image);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        textures.set(url, texture);
        resolve(texture);
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
    pending.set(url, task);
  }
  return task;
}

/** 「我的」页离屏画静态星图前，先把要用到的图都加载好。 */
export async function preloadMarbleArt(nodes: GalaxyNode[]): Promise<void> {
  const urls = new Set(nodes.map(marbleArtFor).filter((url): url is string => url !== null));
  await Promise.all([...urls].map(loadTexture));
}

/**
 * 珠子图的材质：永远正对镜头。起雾时颜色变淡、变灰，像蒙了一层水汽；变暗时变得很透。 */
export class MarbleArtMaterials {
  private cache = new Map<string, THREE.SpriteMaterial>();

  get(texture: THREE.Texture, freshness: number, opacity: number): THREE.SpriteMaterial {
    const fresh = Math.round(Math.max(0, Math.min(1, freshness)) * 4) / 4;
    const key = `${texture.uuid}:${fresh}:${opacity}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      opacity,
      alphaTest: 0.02,
      depthWrite: opacity >= 1,
      toneMapped: false,
    });
    const fog = { value: 1 - fresh };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFog = fog;
      shader.fragmentShader = `uniform float uFog;\n${shader.fragmentShader}`.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(grey * 0.35 + 0.6), uFog * 0.6);`,
      );
    };
    this.cache.set(key, material);
    return material;
  }

  dispose() {
    // 贴图大家共用，这里只丢材质。
    this.cache.forEach((material) => material.dispose());
    this.cache.clear();
  }
}

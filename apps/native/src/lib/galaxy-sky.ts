import * as THREE from 'three';
import nightSkyUrl from '../assets/memory-night-sky-v2.webp?url';

/** Share decoded artwork, while bounding memory as courses/themes change. */
const SKY_CACHE_LIMIT = 6;
const skyImages = new Map<string, HTMLImageElement>();
const skyLoading = new Map<string, Promise<HTMLImageElement | null>>();

export function preloadGalaxySky(url = nightSkyUrl): Promise<HTMLImageElement | null> {
  const cached = skyImages.get(url);
  if (cached) {
    skyImages.delete(url);
    skyImages.set(url, cached);
    return Promise.resolve(cached);
  }
  let loading = skyLoading.get(url);
  if (!loading) {
    loading = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        skyImages.set(url, image);
        while (skyImages.size > SKY_CACHE_LIMIT) {
          const oldest = skyImages.keys().next().value;
          if (oldest === undefined) break;
          skyImages.delete(oldest);
        }
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = url;
    }).finally(() => skyLoading.delete(url));
    skyLoading.set(url, loading);
  }
  return loading;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.999, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uArtwork;
  uniform float uReady;
  uniform float uAspect;
  uniform vec2 uOffset;
  varying vec2 vUv;

  void main() {
    // Cover a square painting without stretching it; reserve a little for parallax.
    vec2 cover = vec2(min(uAspect, 1.0), min(1.0 / uAspect, 1.0));
    vec2 uv = (vUv - 0.5) * cover / 1.04 + 0.5 + uOffset;
    gl_FragColor = vec4(texture2D(uArtwork, uv).rgb, uReady);
    #include <colorspace_fragment>
  }
`;

/** Painted sky behind the marbles, with a restrained camera parallax. */
export class GalaxySky {
  readonly mesh: THREE.Mesh;
  private texture = new THREE.Texture();
  private material: THREE.ShaderMaterial;
  private disposed = false;
  private artworkUrl: string | null = null;
  private artworkRequest = 0;

  constructor(private onReady?: () => void) {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
      uniforms: {
        uArtwork: { value: this.texture },
        uReady: { value: 0 },
        uAspect: { value: 1 },
        uOffset: { value: new THREE.Vector2() },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  /** A late image from the previous course must never replace the current theme. */
  setArtwork(url = nightSkyUrl, preloadedImage?: HTMLImageElement) {
    if (this.disposed || (!preloadedImage && this.artworkUrl === url)) return;
    this.artworkUrl = url;
    const request = ++this.artworkRequest;
    this.material.uniforms.uReady.value = 0;
    const cached = preloadedImage ?? skyImages.get(url);
    if (cached) {
      this.setImage(cached);
      this.onReady?.();
      return;
    }
    void preloadGalaxySky(url).then(async (image) => {
      if (this.disposed || request !== this.artworkRequest) return;
      const artwork = image ?? (url !== nightSkyUrl ? await preloadGalaxySky() : null);
      if (!artwork || this.disposed || request !== this.artworkRequest) return;
      this.setImage(artwork);
      this.onReady?.();
    });
  }

  private setImage(image: HTMLImageElement) {
    this.texture.image = image;
    this.texture.needsUpdate = true;
    this.material.uniforms.uReady.value = 1;
  }

  update(aspect: number, x: number, y: number) {
    this.material.uniforms.uAspect.value = aspect;
    (this.material.uniforms.uOffset.value as THREE.Vector2).set(
      Math.tanh(x * 0.08) * 0.015,
      Math.tanh(y * 0.08) * 0.015,
    );
  }

  dispose() {
    this.disposed = true;
    this.texture.dispose();
  }
}

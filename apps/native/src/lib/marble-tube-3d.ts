import * as THREE from 'three';

import { createGlassRenderer } from './glass-3d';
import { marbleImages, type MarbleColor } from './learning-action-marbles';
import { marbleTexture } from './marble-art-3d';

const R = 0.1; // 弹珠半径
const GAP = R * 2.12; // 相邻两颗的间距

type TubeMarble = {
  mesh: THREE.Sprite;
  x: number;
  target: number;
  leaving: boolean;
  hop: number;
};

/**
 * 学习进度的玻璃管：每学完一本笔记，就有一颗弹珠从右边滚进来停在自己的位置；
 * 进度往回调时，多出来的弹珠滚出去。点一下管子，弹珠依次跳一下。
 */
export class MarbleTubeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private tube = new THREE.Group();
  private marbles: TubeMarble[] = [];
  private total = 0;
  private length = 1;
  private frame = 0;
  private running = false;
  private lastTime = 0;
  private disposed = false;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private colors: MarbleColor[],
  ) {
    this.renderer = createGlassRenderer(canvas);
    this.camera.position.set(0, 0, 3);
    this.scene.add(this.tube);

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    this.cleanup.push(() => observer.disconnect());
    const onTap = () => this.wave();
    canvas.addEventListener('click', onTap);
    this.cleanup.push(() => canvas.removeEventListener('click', onTap));
  }

  setProgress(completed: number, total: number) {
    if (total !== this.total) this.buildTube(total);
    const count = Math.max(0, Math.min(completed, total));
    const staying = this.marbles.filter((marble) => !marble.leaving);
    // 新学完的：从管子右端滚进来。
    for (let index = staying.length; index < count; index += 1) {
      const color = this.colors[index % this.colors.length] ?? 'blue';
      const mesh = this.buildMarble(color);
      const startX = this.length / 2 + R * 2 + (index - staying.length) * GAP;
      mesh.position.set(startX, 0, 0);
      this.tube.add(mesh);
      this.marbles.push({ mesh, x: startX, target: this.slotX(index), leaving: false, hop: 1 });
    }
    // 进度调回去：多出来的弹珠往右滚出去。
    staying.slice(count).forEach((marble) => {
      marble.leaving = true;
      marble.target = this.length / 2 + R * 6;
    });
    this.wake();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((fn) => fn());
    this.marbles.forEach((marble) => {
      this.tube.remove(marble.mesh);
      marble.mesh.material.dispose();
    });
    this.renderer.dispose();
  }

  private buildMarble(color: MarbleColor): THREE.Sprite {
    // 和笔记列表共用原图；避免透射材质在透明画布上把珠子洗成白色。
    const material = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
      toneMapped: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(R * 2.1);
    const url = marbleImages[color];
    const texture = marbleTexture(url, () => {
      if (this.disposed || !this.marbles.some((marble) => marble.mesh === sprite)) return;
      material.map = marbleTexture(url);
      material.needsUpdate = true;
      sprite.visible = true;
      this.wake();
    });
    material.map = texture;
    sprite.visible = Boolean(texture);
    return sprite;
  }

  private slotX(index: number) {
    return -this.length / 2 + R * 1.25 + index * GAP;
  }

  private buildTube(total: number) {
    this.total = total;
    this.length = Math.max(1, total) * GAP + R * 0.5;
    this.marbles.forEach((marble, index) => {
      if (!marble.leaving) marble.target = this.slotX(index);
    });
    this.resize();
  }

  private resize() {
    const width = this.canvas.clientWidth || 320;
    const height = this.canvas.clientHeight || 64;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    // 同时容纳横向全部位置和纵向球径；宽屏下也不会放大到裁掉上下边缘。
    const viewHeight = Math.max(R * 3.6, (this.length + R * 0.8) / aspect);
    const viewWidth = viewHeight * aspect;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.wake();
  }

  /** 点一下：弹珠从左到右依次跳一下。 */
  private wave() {
    this.marbles.forEach((marble, index) => {
      marble.hop = -index * 0.06;
    });
    this.wake();
  }

  private wake() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  private tick(time: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    let moving = false;
    this.marbles = this.marbles.filter((marble) => {
      const distance = marble.target - marble.x;
      if (Math.abs(distance) > 0.001) {
        // 先快后慢地滚到位，按移动距离转动玻璃珠图案。
        const step = distance * Math.min(1, dt * 5);
        marble.x += step;
        marble.mesh.material.rotation -= step / R;
        moving = true;
      }
      let y = 0;
      if (marble.hop < 0.45) {
        marble.hop += dt;
        if (marble.hop > 0) y = Math.sin((marble.hop / 0.45) * Math.PI) * R * 0.12;
        moving = true;
      }
      marble.mesh.position.set(marble.x, y, 0);
      if (marble.leaving && Math.abs(distance) < 0.02) {
        this.tube.remove(marble.mesh);
        marble.mesh.material.dispose();
        return false;
      }
      return true;
    });
    this.renderer.render(this.scene, this.camera);
    if (!moving) {
      this.running = false;
      return;
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }
}

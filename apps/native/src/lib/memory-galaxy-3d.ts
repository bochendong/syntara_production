import * as THREE from 'three';

import {
  MARBLE_TINTS,
  addStudioLighting,
  createGlassRenderer,
  disposeScene,
  freshnessLevel,
  requestTiltPermission,
  shadowTexture,
  subscribeTilt,
} from './glass-3d';
import { marbleArtFor } from './marble-art';
import { GalaxySky, preloadGalaxySky } from './galaxy-sky';
import { MarbleArtMaterials, marbleTexture, preloadMarbleArt } from './marble-art-3d';
import { ToonGlassMaterials } from './toon-glass';
import {
  GALAXY_RADIUS,
  GalaxyLayout,
  galaxyNeighbors,
  type GalaxyNode,
  type MemoryGalaxy,
} from './memory-galaxy';

/**
 * 立体的玻璃星图：课程是中间的大玻璃球，章节是外圈的玻璃球，记忆是彩色玻璃珠。
 * 连线是细玻璃丝，里面有光点慢慢流动。拖空白处平移、双指或滚轮缩放、拖珠子会带着相连的一起动；
 * 点珠子看记忆，点章节飞过去，点课程球所有珠子被弹开再弹回来。
 */

export type GalaxySceneOptions = {
  /** 小号：聊天空白页、「记住」时右下角那个。不显示文字，整团慢慢自转，点哪里都算点它。 */
  mini?: boolean;
  /** 只拍一张静态图（「我的」页的收藏架）。 */
  still?: boolean;
  reducedMotion?: boolean;
  /** 晃手机时视角跟着轻轻偏一点。 */
  tilt?: boolean;
  /** 章节名字和珠子标题画在这层 DOM 上。 */
  labelLayer?: HTMLElement | null;
  onNodeTap?: (node: GalaxyNode) => void;
  onBackgroundTap?: () => void;
};

type Body = {
  node: GalaxyNode;
  group: THREE.Group;
  /** 记忆珠的新鲜度档位；换档时才换材质。 */
  level: number;
  /** 出现时从 0 长到 1。 */
  grow: number;
  dimmed: boolean;
  label: HTMLElement | null;
  /** 珠子底下一团软影子，看起来是放在一块玻璃板上。 */
  shadow: THREE.Mesh;
  /** 画好的珠子图，正对镜头；没有图时藏起来，用代码画的球。 */
  art: THREE.Sprite;
};

const FOV = 32;
const TILT_FULL = -0.48;
const TILT_MINI = -0.7;
const STEP = 1 / 60;

function seeded(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function glowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const LINK_GREY = new THREE.Color('#c7d2fe');
const CORE_TINT = new THREE.Color('#8b9cff');

export class MemoryGalaxyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private world = new THREE.Group();
  private layout = new GalaxyLayout();
  private galaxy: MemoryGalaxy = { nodes: [], links: [] };
  private bodies = new Map<string, Body>();
  private glass = new ToonGlassMaterials();
  private artMaterials = new MarbleArtMaterials();
  /** 章节和课程：透明的大玻璃珠（像真弹珠那样，透明外壳里夹一片彩色的芯）。 */
  private shadowGeometry = new THREE.PlaneGeometry(1, 1);
  private shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    depthWrite: false,
  });
  private sphere = new THREE.SphereGeometry(1, 40, 28);
  private glow = glowTexture();
  private sky = new GalaxySky(() => this.wake());
  private halo: THREE.Sprite;
  private lines: THREE.LineSegments;
  private sparks: THREE.Points;
  private sparkPhase: number[] = [];
  /** 没画成珠子的记忆：章节周围的一圈星尘，跟着章节一起转。 */
  private dust: THREE.Points;
  private dustOffsets: { parent: string; x: number; y: number }[] = [];
  private highlight: Set<string> | null = null;
  private filter: Set<string> | null = null;
  private activeId: string | null = null;
  private hoverId: string | null = null;
  private view = { x: 0, y: 0, distance: 10 };
  private goal = { x: 0, y: 0, distance: 10 };
  private fitDistance = 10;
  private userMoved = false;
  private parallax = { x: 0, y: 0, goalX: 0, goalY: 0 };
  private spin = 0;
  private corePulse = 0;
  private time = 0;
  private frame = 0;
  private lastTime = 0;
  private running = false;
  private visible = true;
  private disposed = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: {
    startX: number;
    startY: number;
    moved: boolean;
    nodeId: string | null;
    pinch: number | null;
  } | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private options: GalaxySceneOptions = {},
  ) {
    this.renderer = createGlassRenderer(canvas, options.still === true);
    addStudioLighting(this.renderer, this.scene);
    this.layout.orbit = options.reducedMotion || options.still ? 0 : 1;
    this.world.rotation.x = options.mini || options.still ? TILT_MINI : TILT_FULL;
    this.scene.add(this.sky.mesh, this.world);

    this.halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: CORE_TINT,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      }),
    );
    this.halo.scale.setScalar(2.4);
    this.halo.renderOrder = -1;
    this.world.add(this.halo);

    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.lines.renderOrder = 0;
    this.lines.frustumCulled = false;
    this.world.add(this.lines);

    this.sparks = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: options.mini ? 0.12 : 0.085,
        map: this.glow,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 1;
    this.world.add(this.sparks);

    this.dust = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: options.mini ? 0.08 : 0.06,
        map: this.glow,
        vertexColors: true,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 1;
    this.world.add(this.dust);

    this.resize();
    if (options.still) return;

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    this.cleanup.push(() => observer.disconnect());

    const intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? true;
      if (this.visible) this.wake();
    });
    intersection.observe(canvas);
    this.cleanup.push(() => intersection.disconnect());

    const onDown = (event: PointerEvent) => this.pointerDown(event);
    const onMove = (event: PointerEvent) => this.pointerMove(event);
    const onUp = (event: PointerEvent) => this.pointerUp(event);
    const onLeave = () => this.setHover(null);
    const onWheel = (event: WheelEvent) => this.wheel(event);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    if (!options.mini) canvas.addEventListener('wheel', onWheel, { passive: false });
    this.cleanup.push(() => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    });

    if (options.tilt && !options.reducedMotion) {
      this.cleanup.push(
        subscribeTilt((x, z) => {
          this.parallax.goalX = Math.max(-1, Math.min(1, x)) * 0.5;
          this.parallax.goalY = Math.max(-1, Math.min(1, z)) * 0.5;
          this.wake();
        }),
      );
    }
    this.wake();
  }

  /** 换一份星图：新出现的珠子长出来，删掉的拿走，新鲜度变了换材质。spawnId 那颗从课程球里蹦出来。 */
  setGalaxy(
    galaxy: MemoryGalaxy,
    spawnId: string | null = null,
    backgroundImage?: HTMLImageElement,
  ) {
    this.sky.setArtwork(galaxy.backgroundUrl, backgroundImage);
    const first = this.bodies.size === 0;
    this.galaxy = galaxy;
    this.layout.setGalaxy(galaxy);
    const keep = new Set(galaxy.nodes.map((node) => node.id));
    this.bodies.forEach((body, id) => {
      if (keep.has(id)) return;
      this.world.remove(body.group, body.shadow);
      body.label?.remove();
      this.bodies.delete(id);
    });
    for (const node of galaxy.nodes) {
      const existing = this.bodies.get(node.id);
      if (existing) {
        // 升级成云彩珠、星云珠：珠子蹦一下。
        if (node.tier !== existing.node.tier) existing.grow = 0.3;
        existing.node = node;
        const level = freshnessLevel(node.freshness);
        // 复习过的珠子亮起来，还会弹一下。
        if (node.kind === 'memory' && level > existing.level) existing.grow = 0.6;
        existing.level = level;
        this.paint(existing);
        if (existing.label && node.kind === 'chapter') existing.label.textContent = node.label;
        continue;
      }
      this.bodies.set(node.id, this.createBody(node, first || this.options.still === true));
    }
    if (spawnId) {
      this.layout.spawnAtCore(spawnId);
      const body = this.bodies.get(spawnId);
      if (body) body.grow = 0;
      this.corePulse = 1;
    }
    if (first || this.options.still) this.layout.settle(this.options.still ? 420 : 260);
    this.rebuildLinks();
    this.rebuildDust();
    this.applyDimming();
    if (first || !this.userMoved) this.fit(first);
    this.wake();
  }

  /** 选中一颗：它和相连的亮着，其余变暗。 */
  setActive(id: string | null) {
    this.activeId = id;
    this.highlight = galaxyNeighbors(this.galaxy, id);
    const body = id ? this.bodies.get(id) : null;
    if (body && body.node.kind === 'memory') body.grow = 0.7;
    this.applyDimming();
    this.wake();
  }

  /** 按类型筛：只亮这些 id。 */
  setFilter(ids: Set<string> | null) {
    this.filter = ids;
    this.applyDimming();
    this.wake();
  }

  /** 飞到某颗球（章节或珠子）旁边；null 回到全景。 */
  flyTo(id: string | null) {
    const point = id ? this.layout.points.get(id) : null;
    const node = id ? this.bodies.get(id)?.node : null;
    if (!point || !node || node.kind === 'core') {
      this.userMoved = false;
      this.fit(false);
      return;
    }
    const world = this.toWorld(point.x, point.y, 0);
    this.goal.x = world.x;
    this.goal.y = world.y;
    this.goal.distance = this.fitDistance * (node.kind === 'chapter' ? 0.5 : 0.42);
    this.userMoved = true;
    this.wake();
  }

  /** 课程球在页面上的位置，「记住」时飞来的珠子瞄准这里。 */
  coreOnScreen(): { x: number; y: number } {
    const point = this.screenOf(new THREE.Vector3(0, 0, 0));
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + point.x, y: rect.top + point.y };
  }

  /** 珠子飞进来时课程球亮一下。 */
  pulse() {
    this.corePulse = 1;
    this.wake();
  }

  snapshot(): string {
    this.sync(0);
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  dispose(releaseContext = false) {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.cleanup.forEach((fn) => fn());
    this.bodies.forEach((body) => body.label?.remove());
    this.bodies.forEach((body) => this.world.remove(body.group, body.shadow));
    this.sky.dispose();
    disposeScene(this.scene);
    this.glass.dispose();
    this.artMaterials.dispose();
    this.shadowGeometry.dispose();
    this.shadowMaterial.map?.dispose();
    this.shadowMaterial.dispose();
    this.sphere.dispose();
    this.glow.dispose();
    this.renderer.dispose();
    if (releaseContext) this.renderer.forceContextLoss();
  }

  // ---- 搭场景 ----

  private createBody(node: GalaxyNode, settled: boolean): Body {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.sphere);
    mesh.scale.setScalar(GALAXY_RADIUS[node.kind]);
    group.add(mesh);
    const art = new THREE.Sprite();
    // 贴图四周各留 5% 透明边距；补偿后可见球体仍与布局、点击半径一致。
    art.scale.setScalar((GALAXY_RADIUS[node.kind] * 2) / 0.9);
    art.visible = false;
    group.add(art);
    // 每颗珠子转个随机角度，里面的彩带和星云就各不一样。
    group.rotation.set(seeded(node.id) * 6, seeded(`${node.id}:y`) * 6, seeded(`${node.id}:z`) * 6);
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.renderOrder = -1;
    this.world.add(shadow);
    const body: Body = {
      node,
      group,
      level: freshnessLevel(node.freshness),
      grow: settled ? 1 : 0,
      dimmed: false,
      label: null,
      shadow,
      art,
    };
    this.paint(body);
    group.scale.setScalar(body.grow);
    this.world.add(group);

    const layer = this.options.labelLayer;
    if (layer && !this.options.mini && node.kind !== 'core') {
      const label = document.createElement('span');
      label.className = `galaxy-label is-${node.kind}`;
      label.textContent = node.label;
      layer.appendChild(label);
      body.label = label;
    }
    return body;
  }

  /** 记忆珠和章节按颜色卷着漩涡（还没有记忆的章节是银色），课程是紫色星云珠；变暗时变得很透。 */
  private paint(body: Body) {
    const node = body.node;
    const color = node.kind === 'core' ? 'purple' : (node.color ?? 'silver');
    const opacity = body.dimmed ? 0.22 : 1;
    const mesh = body.group.children[0] as THREE.Mesh;
    const url = marbleArtFor(node);
    const texture = url ? marbleTexture(url, this.onTextureReady) : null;
    if (texture) {
      body.art.material = this.artMaterials.get(texture, node.freshness, opacity);
      body.art.visible = true;
      mesh.visible = false;
      return;
    }
    body.art.visible = false;
    mesh.visible = true;
    mesh.material = this.glass.get(color, node.tier, node.freshness, opacity);
  }

  /** 同一个函数给所有贴图回调用：几张图同时加载好，也只在下一帧重画一次。 */
  private repaintQueued = false;
  private onTextureReady = () => {
    if (this.repaintQueued) return;
    this.repaintQueued = true;
    requestAnimationFrame(() => {
      this.repaintQueued = false;
      this.repaint();
    });
  };

  /** 珠子图加载好了：换上图再画一帧。 */
  private repaint() {
    if (this.disposed) return;
    this.bodies.forEach((body) => this.paint(body));
    this.wake();
  }

  private lit(id: string): boolean {
    if (this.highlight && !this.highlight.has(id)) return false;
    if (this.filter && !this.filter.has(id)) {
      const node = this.bodies.get(id)?.node;
      // 筛选时章节和课程留着当骨架。
      return node ? node.kind !== 'memory' && !this.highlight : false;
    }
    return true;
  }

  private applyDimming() {
    this.bodies.forEach((body, id) => {
      if (body.node.kind !== 'memory') return;
      const dim = !this.lit(id);
      if (dim === body.dimmed) return;
      body.dimmed = dim;
      this.paint(body);
    });
    this.bodies.forEach((body) => body.label?.classList.toggle('is-dim', !this.lit(body.node.id)));
    this.colorLinks();
  }

  private rebuildLinks() {
    const count = this.galaxy.links.length;
    const geometry = this.lines.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 8), 4));
    const sparks = this.sparks.geometry;
    sparks.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    sparks.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4), 4));
    this.sparkPhase = this.galaxy.links.map((link) => seeded(link.source + link.target));
    this.colorLinks();
  }

  private rebuildDust() {
    const dust = this.galaxy.dust ?? [];
    const positions = new Float32Array(dust.length * 3);
    const colors = new Float32Array(dust.length * 4);
    this.dustOffsets = dust.map((item, index) => {
      const tint = new THREE.Color(MARBLE_TINTS[item.color]);
      colors.set([tint.r, tint.g, tint.b, 0.7], index * 4);
      // 绕着章节散成一圈，离球心 0.5 到 1.3 个单位，每粒的位置由记忆 id 决定、不会乱跳。
      const angle = item.seed * Math.PI * 2 * 7.3;
      const radius = 0.5 + ((item.seed * 13.7) % 1) * 0.8;
      return { parent: item.parent, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    const geometry = this.dust.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }

  private linkTint(index: number): THREE.Color {
    const link = this.galaxy.links[index];
    const target = this.bodies.get(link.target)?.node;
    const source = this.bodies.get(link.source)?.node;
    const color = target?.kind === 'memory' ? target.color : source?.color;
    return color ? new THREE.Color(MARBLE_TINTS[color]) : LINK_GREY;
  }

  private colorLinks() {
    const lineColors = this.lines.geometry.getAttribute('color') as
      | THREE.BufferAttribute
      | undefined;
    const sparkColors = this.sparks.geometry.getAttribute('color') as
      | THREE.BufferAttribute
      | undefined;
    if (!lineColors || !sparkColors) return;
    this.galaxy.links.forEach((link, index) => {
      const tint = this.linkTint(index);
      const on = this.lit(link.source) && this.lit(link.target);
      const strong = Boolean(this.highlight) && on;
      const base = link.kind === 'related' ? 0.22 : 0.34;
      const alpha = strong ? 0.85 : on ? base : 0.05;
      const target = this.bodies.get(link.target)?.node;
      // 起雾的珠子，连线也淡。
      const fog = target?.kind === 'memory' ? 0.45 + target.freshness * 0.55 : 1;
      for (let end = 0; end < 2; end += 1) {
        lineColors.setXYZW(index * 2 + end, tint.r, tint.g, tint.b, alpha * fog);
      }
      sparkColors.setXYZW(index, tint.r, tint.g, tint.b, (strong ? 1 : on ? 0.7 : 0) * fog);
    });
    lineColors.needsUpdate = true;
    sparkColors.needsUpdate = true;
  }

  // ---- 每一帧 ----

  private toWorld(x: number, y: number, z: number): THREE.Vector3 {
    return this.world.localToWorld(new THREE.Vector3(x, y, z));
  }

  private screenOf(local: THREE.Vector3): { x: number; y: number; depth: number } {
    const world = this.world.localToWorld(local.clone());
    const depth = world.distanceTo(this.camera.position);
    const projected = world.project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - projected.y) / 2) * this.canvas.clientHeight,
      depth,
    };
  }

  private fit(immediate: boolean) {
    const box = this.layout.bounds();
    const width = box.maxX - box.minX;
    const height = (box.maxY - box.minY) * Math.cos(this.world.rotation.x);
    const aspect = this.camera.aspect || 1;
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const padding = this.options.mini || this.options.still ? 1.2 : 1.12;
    const distance = (Math.max(height / 2, width / 2 / aspect) / Math.tan(half)) * padding + 0.6;
    this.fitDistance = distance;
    const center = this.toWorld((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, 0);
    this.goal = { x: center.x, y: center.y, distance };
    if (immediate) this.view = { ...this.goal };
  }

  private resize() {
    const width = this.canvas.clientWidth || this.canvas.width || 320;
    const height = this.canvas.clientHeight || this.canvas.height || 320;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.bodies.size && !this.userMoved) this.fit(true);
    if (!this.options.still) this.wake();
  }

  private wake() {
    if (this.running || this.disposed || this.options.still) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  private tick(time: number) {
    if (this.disposed) return;
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastTime = time;
    // 悬停在一颗球上时，整个星图停一下，好看清楚。
    const paused = this.hoverId !== null || this.gesture?.nodeId != null;
    this.layout.orbit = this.options.reducedMotion ? 0 : paused ? 0.15 : 1;
    let energy = 0;
    let steps = Math.max(1, Math.round(dt / STEP));
    while (steps-- > 0) energy = this.layout.step(STEP);
    this.sync(dt);
    if (this.visible) this.renderer.render(this.scene, this.camera);

    const settling =
      energy > 0.02 ||
      this.gesture !== null ||
      Math.abs(this.view.distance - this.goal.distance) > 0.01 ||
      Math.abs(this.view.x - this.goal.x) > 0.005 ||
      Math.abs(this.view.y - this.goal.y) > 0.005 ||
      this.corePulse > 0.01 ||
      [...this.bodies.values()].some((body) => body.grow < 0.999);
    // 有在转就一直画；减少动态效果时，停下来就不画了。
    if (!this.visible || (this.options.reducedMotion && !settling)) {
      this.running = false;
      return;
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private sync(dt: number) {
    this.time += dt;
    this.glass.tick(dt);
    if (this.options.mini && !this.options.reducedMotion) this.spin += dt * 0.12;
    this.world.rotation.z = this.spin;

    const ease = Math.min(1, dt * 7);
    this.view.x += (this.goal.x - this.view.x) * (dt ? ease : 1);
    this.view.y += (this.goal.y - this.view.y) * (dt ? ease : 1);
    this.view.distance += (this.goal.distance - this.view.distance) * (dt ? ease : 1);
    this.parallax.x += (this.parallax.goalX - this.parallax.x) * Math.min(1, dt * 4);
    this.parallax.y += (this.parallax.goalY - this.parallax.y) * Math.min(1, dt * 4);
    this.camera.position.set(
      this.view.x + this.parallax.x,
      this.view.y - this.parallax.y,
      this.view.distance,
    );
    this.camera.lookAt(this.view.x, this.view.y, 0);
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera.aspect, this.view.x, this.view.y);

    this.corePulse = Math.max(0, this.corePulse - dt * 1.6);
    this.halo.scale.setScalar(2.2 + Math.sin(this.time * 1.4) * 0.08 + this.corePulse * 1.2);
    (this.halo.material as THREE.SpriteMaterial).opacity = 0.28 + this.corePulse * 0.4;

    const points = this.layout.points;
    this.bodies.forEach((body) => {
      const point = points.get(body.node.id);
      if (!point) return;
      if (body.grow < 1) body.grow = Math.min(1, body.grow + dt * 2.6);
      // 长出来时先略大一点再回弹。
      const pop = body.grow < 1 ? 1 + Math.sin(body.grow * Math.PI) * 0.35 : 1;
      const active = body.node.id === this.activeId || body.node.id === this.hoverId;
      const pulse = body.node.kind === 'core' ? 1 + this.corePulse * 0.18 : 1;
      // 小号和收藏架上珠子放大一些，不然缩小后只剩一堆点。
      const small = this.options.mini || this.options.still ? 1.35 : 1;
      const scale = Math.max(0.001, body.grow * pop * (active ? 1.25 : 1) * pulse * small);
      const radius = GALAXY_RADIUS[body.node.kind] * scale;
      // 珠子“放”在板上：球心抬起一个半径，选中的再浮起来一点，影子留在下面变淡。
      const lift = active ? radius * 0.6 : 0;
      body.group.position.set(point.x, point.y, radius + lift);
      body.group.scale.setScalar(scale);
      body.shadow.position.set(point.x + radius * 0.25, point.y - radius * 0.35, 0.002);
      body.shadow.scale.setScalar(radius * (2.6 + (active ? 0.8 : 0)));
      body.shadow.visible = !body.dimmed;
      // 珠子慢慢滚，里面的芯跟着转。
      body.group.rotation.y += dt * (body.node.kind === 'memory' ? 0.5 : 0.18);
    });

    const linePositions = this.lines.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    const sparkPositions = this.sparks.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (linePositions && sparkPositions) {
      this.galaxy.links.forEach((link, index) => {
        const a = this.bodies.get(link.source);
        const b = this.bodies.get(link.target);
        if (!a || !b) return;
        const ap = a.group.position;
        const bp = b.group.position;
        linePositions.setXYZ(index * 2, ap.x, ap.y, ap.z);
        linePositions.setXYZ(index * 2 + 1, bp.x, bp.y, bp.z);
        // 光点从中心往外流；选中的流得快。
        const fast = this.highlight?.has(link.source) && this.highlight.has(link.target);
        const t = (this.sparkPhase[index] + this.time * (fast ? 0.45 : 0.14)) % 1;
        sparkPositions.setXYZ(
          index,
          ap.x + (bp.x - ap.x) * t,
          ap.y + (bp.y - ap.y) * t,
          ap.z + (bp.z - ap.z) * t,
        );
      });
      linePositions.needsUpdate = true;
      sparkPositions.needsUpdate = true;
    }

    const dustPositions = this.dust.geometry.getAttribute('position') as
      | THREE.BufferAttribute
      | undefined;
    if (dustPositions && this.dustOffsets.length) {
      this.dustOffsets.forEach((offset, index) => {
        const parent = this.bodies.get(offset.parent)?.group.position;
        if (parent) dustPositions.setXYZ(index, parent.x + offset.x, parent.y + offset.y, 0.02);
      });
      dustPositions.needsUpdate = true;
    }

    this.syncLabels();
  }

  private syncLabels() {
    if (!this.options.labelLayer || this.options.mini) return;
    const zoomedIn = this.view.distance < this.fitDistance * 0.75;
    const chapters = [...this.bodies.values()].filter((body) => body.node.kind === 'chapter');
    // 手机上地方小，章节名只在放大或点亮时出来。
    const fewChapters = chapters.length <= (this.canvas.clientWidth < 520 ? 5 : 12);
    const lift = this.canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    this.bodies.forEach((body) => {
      const label = body.label;
      if (!label) return;
      const id = body.node.id;
      const show =
        body.node.kind === 'chapter'
          ? fewChapters || zoomedIn || Boolean(this.highlight?.has(id))
          : id === this.activeId || id === this.hoverId;
      label.classList.toggle('is-shown', show);
      if (!show) return;
      const screen = this.screenOf(body.group.position);
      const offset = (GALAXY_RADIUS[body.node.kind] * lift) / screen.depth + 6;
      label.style.transform = `translate(${screen.x.toFixed(1)}px, ${(screen.y + offset).toFixed(1)}px) translate(-50%, 0)`;
    });
  }

  // ---- 手势 ----

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const lift = this.canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    let best: string | null = null;
    let bestScore = Infinity;
    this.bodies.forEach((body, id) => {
      const screen = this.screenOf(body.group.position);
      const radius = (GALAXY_RADIUS[body.node.kind] * lift) / screen.depth;
      const distance = Math.hypot(screen.x - x, screen.y - y);
      // 手指比珠子粗：小珠子也给 14px 的余量。
      if (distance > radius + 14) return;
      const score = distance - radius - (body.node.kind === 'memory' ? 6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    });
    return best;
  }

  /** 屏幕上一点落在星图平面的哪里（星图本身是斜着放的）。 */
  private planePoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.world.quaternion);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      this.world.getWorldPosition(new THREE.Vector3()),
    );
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? this.world.worldToLocal(hit) : null;
  }

  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (!this.activeId) {
      this.highlight = galaxyNeighbors(this.galaxy, id);
      this.applyDimming();
    }
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.wake();
  }

  private pointerDown(event: PointerEvent) {
    this.canvas.setPointerCapture?.(event.pointerId);
    if (this.options.tilt) requestTiltPermission();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      if (this.gesture) {
        this.releaseDrag();
        this.gesture.moved = true;
        this.gesture.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      return;
    }
    const nodeId = this.options.mini ? null : this.pick(event.clientX, event.clientY);
    this.gesture = {
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      nodeId: nodeId && this.bodies.get(nodeId)?.node.kind !== 'core' ? nodeId : null,
      pinch: null,
    };
    this.wake();
  }

  private pointerMove(event: PointerEvent) {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse' && !this.options.mini) {
        this.setHover(this.pick(event.clientX, event.clientY));
      }
      return;
    }
    const gesture = this.gesture;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
      gesture.moved = true;
    }
    if (this.options.mini) return;

    if (this.pointers.size >= 2 && gesture.pinch) {
      const [a, b] = [...this.pointers.values()];
      const spread = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomBy(gesture.pinch / Math.max(1, spread));
      gesture.pinch = spread;
      return;
    }
    if (!gesture.moved) return;
    if (gesture.nodeId) {
      // 拖珠子：被拖的跟着手指，相连的被弹簧拽着走。
      const point = this.layout.points.get(gesture.nodeId);
      const local = this.planePoint(event.clientX, event.clientY);
      if (point && local) {
        point.pinned = true;
        point.x = local.x;
        point.y = local.y;
      }
      return;
    }
    // 拖空白处：平移。
    const scale =
      (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * this.view.distance) /
      Math.max(1, this.canvas.clientHeight);
    this.goal.x -= (event.clientX - previous.x) * scale;
    this.goal.y += (event.clientY - previous.y) * scale;
    this.view.x = this.goal.x;
    this.view.y = this.goal.y;
    this.userMoved = true;
  }

  private pointerUp(event: PointerEvent) {
    this.pointers.delete(event.pointerId);
    const gesture = this.gesture;
    if (this.pointers.size > 0) return;
    this.gesture = null;
    this.releaseDrag(gesture?.nodeId ?? null);
    if (!gesture || gesture.moved) return;
    if (this.options.mini) {
      this.pulse();
      this.options.onBackgroundTap?.();
      return;
    }
    const id = this.pick(event.clientX, event.clientY);
    const body = id ? this.bodies.get(id) : null;
    if (!body) {
      this.options.onBackgroundTap?.();
      return;
    }
    if (body.node.kind === 'core') this.burst();
    this.options.onNodeTap?.(body.node);
  }

  private releaseDrag(id: string | null = this.gesture?.nodeId ?? null) {
    const point = id ? this.layout.points.get(id) : null;
    if (point) point.pinned = false;
  }

  private wheel(event: WheelEvent) {
    event.preventDefault();
    this.zoomBy(Math.exp(event.deltaY * 0.0015));
  }

  private zoomBy(factor: number) {
    this.goal.distance = Math.max(
      this.fitDistance * 0.22,
      Math.min(this.fitDistance * 1.8, this.goal.distance * factor),
    );
    this.view.distance = this.goal.distance;
    this.userMoved = true;
    this.wake();
  }

  /** 点课程球：所有珠子被弹开，再被玻璃丝拉回来。 */
  private burst() {
    this.corePulse = 1;
    this.layout.points.forEach((point, id) => {
      const node = this.bodies.get(id)?.node;
      if (!node || node.kind === 'core') return;
      const distance = Math.max(0.2, Math.hypot(point.x, point.y));
      const kick = node.kind === 'memory' ? 3.2 : 1.4;
      point.vx += (point.x / distance) * kick;
      point.vy += (point.y / distance) * kick;
    });
    this.wake();
  }
}

/** 「我的」页收藏架：离屏画一张静态的小星图。 */
export async function renderGalaxySnapshot(
  galaxy: MemoryGalaxy,
  width: number,
  height: number,
): Promise<string | null> {
  const [, sky] = await Promise.all([
    preloadMarbleArt(galaxy.nodes),
    preloadGalaxySky(galaxy.backgroundUrl),
  ]);
  const snapshotGalaxy = sky ? galaxy : { ...galaxy, backgroundUrl: undefined };
  const snapshotSky = sky ?? (galaxy.backgroundUrl ? await preloadGalaxySky() : null);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let scene: MemoryGalaxyScene | null = null;
  try {
    scene = new MemoryGalaxyScene(canvas, { still: true });
    // Retain the awaited image: other courses may have evicted it from the shared cache.
    scene.setGalaxy(snapshotGalaxy, null, snapshotSky ?? undefined);
    return scene.snapshot();
  } catch {
    return null;
  } finally {
    scene?.dispose(true);
  }
}

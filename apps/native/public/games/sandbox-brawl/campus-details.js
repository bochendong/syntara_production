import { gymFloorPoint } from './gym-projection.js';
import * as THREE from './vendor/three.module.js';

// Width is in campus units (a pupil desk is 1.97 wide);
// aspect is measured from the trimmed artwork, independent of its resolution.
export const campusDetails = {
  classroom: [
    ['clock', '木框挂钟', 1.12, 0.852],
    ['bookcase', '开放书架', 2.85, 1.155],
    ['globe', '地球仪', 1.02, 0.7886],
    ['pencil-case', '拉链笔袋', 0.47, 1.7879],
    ['backpack', '双肩书包', 0.99, 0.9652],

    ['noticeboard', '软木留言板', 2.15, 0.9693],
    ['lost-property', '失物箱', 1.76, 1.2253],
    ['handbell', '教学手铃', 0.38, 0.569],
    ['pencil-cup', '文具笔筒', 0.37, 0.7252],
    ['umbrella-stand', '雨伞架', 0.79, 0.4246],

    ['calendar', '挂历', 0.93, 0.9621],
    ['filing-cabinet', '双屉文件柜', 2, 0.9717],
    ['desk-calendar', '桌面台历', 0.57, 1.2295],
    ['abacus', '算盘', 0.76, 1.2128],
    ['bin', '废纸篓', 0.83, 0.9366],

    ['portrait', '班级合影', 1.85, 1.0625],
    ['cubbies', '分类储物柜', 3.7, 1.17],
    ['thermos', '保温杯', 0.34, 0.5887],
    ['lunchbox', '午餐盒', 0.55, 1.5133],
    ['satchel', '手提书包', 1.05, 1.0529],

    ['speaker', '壁挂广播', 1.14, 1.3148],
    ['book-cart', '木制图书车', 2.26, 1.3056],
    ['lamp', '阅读台灯', 0.92, 0.97],
    ['sharpener', '手摇卷笔刀', 0.34, 1.1755],
    ['watering-can', '小浇水壶', 0.96, 1.4464],
    ['pupil-chair', '学生靠背椅', 1.13, 0.631],
    ['bag-rail', '入门书包挂架', 4.5, 1.4511],
    ['storage-run', '后排连体储物柜', 8.4, 3.4674],
  ],
  lab: [
    ['goggles', '护目镜挂架', 0.86, 1.1106],
    ['microscope', '显微镜', 1.18, 0.6784],
    ['prism', '三棱镜', 0.79, 1.2294],
    ['specimen-jar', '松果标本瓶', 0.66, 0.7349],
    ['trolley', '实验推车', 2.0, 0.9873],

    ['solar-chart', '太阳系挂图', 1.98, 1.0727],
    ['balance', '托盘天平', 1.54, 1.4873],
    ['magnifier', '支架放大镜', 0.74, 0.8249],
    ['compass', '指南针', 0.4, 0.8297],
    ['eyewash', '洗眼器', 1.31, 0.9152],

    ['thermometer', '壁挂温度计', 0.5, 0.4219],
    ['earth-model', '地球剖面模型', 1.32, 0.8428],
    ['hourglass', '沙漏', 0.62, 0.6982],
    ['minerals', '矿石标本盘', 0.97, 1.3558],
    ['recycling-bin', '回收桶', 1.04, 0.8922],

    ['barometer', '气压计', 1.01, 0.8908],
    ['plasma-globe', '等离子球', 1.06, 0.8628],
    ['molecule', '分子模型', 1.06, 0.9315],
    ['multimeter', '万用表', 0.43, 0.7652],
    ['stool', '实验方凳', 1.08, 1.0099],

    ['leaf-chart', '叶片结构图', 2.16, 1.0367],
    ['telescope', '桌面望远镜', 1.25, 1.009],
    ['magnet', '蹄形磁铁', 0.56, 1.0099],
    ['leaf-press', '植物压叶器', 1.02, 1.266],
    ['terrarium', '植物生态缸', 1.37, 0.9083],
  ],
  art: [
    ['color-wheel', '色相环', 1.55, 0.8805],
    ['paper-rack', '画纸卷架', 2.62, 1.3275],
    ['brushes', '青花画笔筒', 0.72, 0.728],
    ['yarn', '毛线篮', 0.97, 1.2088],
    ['art-stool', '木圆凳', 1.03, 0.9227],

    ['leaf-print', '银杏拓印', 1.35, 0.8933],
    ['pottery-wheel', '陶艺拉坯机', 1.72, 1.0561],
    ['sunflower', '向日葵花瓶', 0.94, 0.8809],
    ['chalk', '彩粉笔盒', 0.72, 1.5704],
    ['clay-bucket', '陶泥桶', 0.92, 1],

    ['papercut', '小鸟剪纸', 1.43, 0.8914],
    ['flat-files', '画稿平柜', 2.61, 1.2474],
    ['poster-tubes', '画筒收纳罐', 1.05, 0.7149],
    ['stamps', '版画印章篮', 0.82, 1.2727],
    ['steps', '折叠踏凳', 1.21, 1.1256],

    ['mosaic', '太阳马赛克', 1.4, 0.8805],
    ['drying-rack', '夹画晾架', 2.64, 1.3514],
    ['mannequin', '木制关节人偶', 0.59, 0.5593],
    ['sponges', '海绵托盘', 0.75, 1.5556],
    ['fabric', '碎布箱', 1.36, 1.2692],

    ['collage', '几何拼贴画', 1.66, 0.9099],
    ['paint-cart', '颜料推车', 2.08, 0.991],
    ['pitcher', '陶壶静物', 0.67, 0.9],
    ['tools', '雕塑工具箱', 0.95, 1.3077],
    ['sculpture', '陶蜗牛展台', 1.3, 1.2983],
    ['sketch-table', '双人蜡笔画桌', 5.05, 1.9851],
    ['watercolor-table', '双人水彩桌', 5.05, 2.126],
    ['clay-table', '双人陶艺桌', 4.55, 2.2813],
    ['wash-cabinet', '洗笔水槽柜', 4.9, 2.1282],
    ['art-screen', '学生作品三折展板', 7.2, 2.8766],
    ['still-life', '向日葵写生示范台', 6.15, 1.9555],
  ],
  gym: [
    ['scoreboard', '翻页记分牌', 1.85, 1.171],
    ['hurdle', '训练跨栏', 2.13, 1.5306],
    ['rope', '跳绳', 1.07, 0.9289],
    ['cone', '标志锥', 0.78, 0.96],
    ['volleyballs', '排球网袋', 1.52, 0.9694],

    ['plaque', '荣誉盾牌', 1.1, 0.8541],
    ['beam', '矮平衡木', 2.91, 2],
    ['rackets', '羽毛球拍', 1.48, 1.0228],
    ['discs', '标志碟', 0.87, 1.1512],
    ['duffel', '运动包', 1.31, 1.2857],

    ['pinnies', '分队背心', 1.66, 1.0918],
    ['step', '踏步台', 1.96, 2.0248],
    ['batons', '接力棒架', 0.84, 1.1087],
    ['pump', '手动气筒', 0.67, 0.8233],
    ['tennis-balls', '网球筐', 1.61, 1.3279],

    ['timer', '训练计时钟', 1.28, 1.1366],
    ['starting-blocks', '起跑器', 1.32, 1.874],
    ['paddles', '乒乓球拍', 0.85, 1.2353],
    ['mat', '卷垫', 1.48, 1.5247],
    ['towels', '毛巾篮', 1.24, 1.2316],

    ['trophy', '壁架奖杯', 1.15, 0.8905],
    ['poles', '绕杆标志柱', 1.66, 0.8565],
    ['weights', '软哑铃', 0.91, 1.3132],
    ['hoops', '呼啦圈', 1.89, 1.7029],
    ['cooler', '饮水桶', 2.22, 1.0573],
    ['awards-shelf', '奖牌陈列架', 4.2, 1.667],
    ['team-bench', '运动员长凳', 5.9, 3.726],
    ['coral-step', '珊瑚色软垫台', 2.65, 2.432],
    ['blue-step', '蓝色软垫台', 2.65, 2.537],
  ],
};

export const detailURL = (room, slug) => new URL(`./campus-props/details/${room}/${slug}.webp`, import.meta.url).href;

const painted = (u, v) => {
  const [x, z] = gymFloorPoint(u, v);
  return { x, z, illustrated: true };
};

const floor = (x, z) => ({ x, z, y: 0.035, floor: true });
const wall = (x, z, y) => ({ x, z, y, wall: true });
const counter = (x, z) => ({ x, z, y: 1.91 });

function roomFurnishings(walls) {
  return {
    classroom: {
      clock: wall(-4.9, -31.02, 2.0),
      bookcase: floor(-5.65, -28.6),
      'pupil-chair': walls.filter((piece) => piece.kind === 'desk').map(
        ({ x0, x1, z1 }) => ({ x: (x0 + x1) / 2, z: z1, y: 0.025 }),
      ),
      'storage-run': floor(-33.8, -9.8),
      'bag-rail': floor(-26.95, -9.8),
    },
    lab: {
      'leaf-chart': wall(3, -31.02, 1.75), goggles: wall(35, -31.02, 2.05),
      microscope: counter(7.1, -23.42), 'specimen-jar': counter(9.94, -23.42),
      terrarium: counter(4.8, -21.25), stool: floor(11.08, -20.47),
      'leaf-press': counter(6.91, -12.36), magnifier: counter(9.02, -12.36),
      balance: counter(27.67, -23.05), minerals: counter(30.28, -23.05),
      hourglass: counter(32.58, -23.05),
      prism: counter(16.67, -15.01), molecule: counter(19.13, -15.01),
      'earth-model': counter(21.82, -15.01),
      trolley: floor(35.65, -28.12), 'recycling-bin': floor(38.01, -28.12),
    },
    art: {
      'color-wheel': wall(-29.45, 5.93, 0.7),
      'still-life': floor(-35.05, 10.38), 'art-stool': floor(-36.95, 12.05),
      'wash-cabinet': floor(-28.25, 9.65), 'drying-rack': floor(-24.15, 9.58),
      'art-screen': floor(-8.9, 9.7),
      'sketch-table': [floor(-28.2, 18.6), floor(-28.2, 26.0)],
      'watercolor-table': [floor(-13.0, 18.6), floor(-13.0, 26.0)],
      'clay-table': floor(-5.55, 22.05),
      'pottery-wheel': floor(-6.16, 25.12), 'clay-bucket': floor(-4.58, 25.12),
    },
    // These props are drawn on the court plate. Keep the catalogue links
    // pointing at their painted positions and avoid adding duplicate meshes.
    gym: {
      'team-bench': painted(174, 850),
      cooler: painted(304, 852),
      towels: painted(103, 804),
    },
  };
}

export function detailFootprint(x, z, width, height) {
  const halfWidth = width * 0.44;
  const depth = Math.min(width * 0.55, height * 0.66);
  const x0 = x - halfWidth, x1 = x + halfWidth, z0 = z - depth, z1 = z;
  return { kind: 'detail', height, x0, x1, z0, z1, corners: [[x0,z0], [x1,z0], [x1,z1], [x0,z1]] };
}

export function addCampusDetails(group, walls, elevation) {
  const placements = roomFurnishings(walls);
  const plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const ellipse = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const shade = new THREE.MeshBasicMaterial({ color: 0x695650, transparent: true, opacity: 0.16, depthWrite: false });
  const loader = new THREE.TextureLoader();
  const props = new THREE.Group();
  group.add(props);
  for (const [room, items] of Object.entries(placements)) {
    for (const [slug, placement] of Object.entries(items)) {
      if (placement.illustrated) continue;
      const [, label, width, aspect] = campusDetails[room].find(([id]) => id === slug);
      const map = loader.load(detailURL(room, slug));
      map.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.42 });
      const height = width / aspect;
      for (const mount of Array.isArray(placement) ? placement : [placement]) {
        const mesh = new THREE.Mesh(plane, material);
        mesh.name = label;
        mesh.position.set(mount.x, mount.y, mount.z);
        mesh.rotation.x = mount.wall ? 0 : -elevation;
        mesh.scale.set(width, mount.wall ? height / Math.cos(elevation) : height, 1);
        props.add(mesh);
        if (mount.floor) {
          const footprint = detailFootprint(mount.x, mount.z, width, height);
          walls.push(footprint);
          const shadow = new THREE.Mesh(ellipse, shade);
          shadow.scale.set(width * 0.45, 1, (footprint.z1 - footprint.z0) * 0.55);
          shadow.position.set(mount.x, 0.018, (footprint.z1 + footprint.z0) / 2);
          props.add(shadow);
        }
      }
    }
  }
  return placements;
}

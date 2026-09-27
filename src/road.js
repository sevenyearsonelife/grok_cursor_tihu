// 海岸公路场景：沥青路+车道线（程序化 DataTexture）、沙滩、草地、护栏、路灯、
// 远山与城市剪影（夜间窗户亮灯）。路面纹理滚动 + 周期性物件用取模回绕，无限延伸。
import * as THREE from '../vendor/three.module.js';
import { rand } from './utils.js';

const ROAD_LEN = 400;
const ROAD_W = 13.4;

// 512x128 程序化路面贴图：沥青噪点 + 两侧实线 + 两条虚线（u 沿路长、v 横穿路宽）
function makeRoadTexture() {
  const W = 512, H = 128;
  const data = new Uint8Array(W * H * 4);
  const lane1 = Math.round((( -2.2 + ROAD_W / 2) / ROAD_W) * H); // 车道分隔线行号
  const lane2 = Math.round((( 2.2 + ROAD_W / 2) / ROAD_W) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // 沥青底色 + 噪点（确定性伪随机，保证每次生成一致）
      let r = 50 + ((x * 7 + y * 13 + ((x * x * 31 + y * 17) % 23)) % 19) * 1.2;
      let g = r, b = r + 4;
      const edge = y < 5 || y >= H - 5;
      const dash = (x % 256) < 160 && (Math.abs(y - lane1) < 2 || Math.abs(y - lane2) < 2);
      if (edge || dash) {
        // 白色标线（带一点磨损噪点）
        const wear = ((x * 31 + y * 7) % 11) / 11;
        r = g = 205 + wear * 45;
        b = 200 + wear * 50;
      }
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(50, 1); // 一整段 repeat = 8m，虚线周期 = 2.5m 实 + 1.5m 空
  tex.generateMipmaps = true; // 512x128 是 POT，开 mipmap 避免远处路面闪烁
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export class Road {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const std = (color, extra) =>
      new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.95 }, extra || {}));

    // ---- 路面 ----
    this.roadTex = makeRoadTexture();
    const roadGeo = new THREE.PlaneGeometry(ROAD_LEN, ROAD_W);
    roadGeo.rotateX(-Math.PI / 2);
    // 粗糙度略降 + 一点金属度：阳光掠射时路面上有一层极 subtle 的镜面反光
    this.road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
      map: this.roadTex, roughness: 0.62, metalness: 0.08,
    }));
    this.road.position.y = 0.01;
    this.road.receiveShadow = true;
    this.group.add(this.road);

    // ---- 沙滩（海侧，z ∈ [6.7, 15.5]，再往 +z 延伸 2.5 没入水下当浅滩）----
    const beachGeo = new THREE.PlaneGeometry(ROAD_LEN, 11.3);
    beachGeo.rotateX(-Math.PI / 2);
    const beach = new THREE.Mesh(beachGeo, std(0xe6d29b));
    beach.position.set(0, 0.005, 12.35);
    beach.receiveShadow = true;
    this.group.add(beach);

    // ---- 路另一侧草地 ----
    const grassGeo = new THREE.PlaneGeometry(ROAD_LEN, 70);
    grassGeo.rotateX(-Math.PI / 2);
    const grass = new THREE.Mesh(grassGeo, std(0x4a7c50));
    grass.position.set(0, 0, -42);
    grass.receiveShadow = true;
    this.group.add(grass);

    // ---- 护栏（立柱 InstancedMesh + 双横杆），周期 2.5m 取模回绕 ----
    this.rail = new THREE.Group();
    this.group.add(this.rail);
    const postGeo = new THREE.BoxGeometry(0.1, 0.75, 0.1);
    const metalMat = std(0x9aa4ad, { roughness: 0.4, metalness: 0.7 });
    const POST_N = Math.floor(ROAD_LEN / 2.5);
    const posts = new THREE.InstancedMesh(postGeo, metalMat, POST_N);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < POST_N; i++) {
      m4.setPosition(-ROAD_LEN / 2 + 1.25 + i * 2.5, 0.37, -7.2);
      posts.setMatrixAt(i, m4);
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    this.rail.add(posts);
    for (const y of [0.62, 0.4]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(ROAD_LEN, 0.09, 0.035), metalMat);
      bar.position.set(0, y, -7.2);
      this.rail.add(bar);
    }

    // ---- 路灯（内陆侧一排 + 海侧几盏），周期 30m ----
    this.lampHeads = [];
    this.lampLights = [];
    this.lamps = new THREE.Group();
    this.group.add(this.lamps);
    const poleMat = std(0x55606b, { roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 14; i++) {
      const x = -ROAD_LEN / 2 + 15 + i * 30;
      const lamp = this._makeLamp(x, -1, poleMat, i % 2 === 0); // 内陆侧
      this.lamps.add(lamp);
    }
    for (let i = 0; i < 5; i++) {
      const lamp = this._makeLamp(-ROAD_LEN / 2 + 45 + i * 75, 1, poleMat, false); // 海滩侧
      this.lamps.add(lamp);
    }

    // ---- 海滩小物（礁石 / 木箱），周期 60m ----
    this.beachStuff = new THREE.Group();
    this.group.add(this.beachStuff);
    const rockMat = std(0x8d8577, { roughness: 1 });
    for (let i = 0; i < 7; i++) {
      const x = -ROAD_LEN / 2 + 30 + i * 60;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.0), 0), rockMat);
      rock.position.set(x, rand(0.15, 0.35), rand(9, 14));
      rock.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
      rock.castShadow = true;
      this.beachStuff.add(rock);
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), std(0x9c7845));
      crate.position.set(x + 18, 0.35, rand(8, 12));
      crate.rotation.y = rand(0, 1.5);
      crate.castShadow = true;
      this.beachStuff.add(crate);
    }

    // ---- 远山（内陆侧，静态远景）----
    const mountainMat = std(0x35566b, { roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const mt = new THREE.Mesh(
        new THREE.ConeGeometry(rand(28, 50), rand(16, 30), 7),
        mountainMat
      );
      mt.position.set(-170 + i * 62 + rand(-15, 15), 0, -95 - rand(0, 30));
      this.group.add(mt);
    }

    // ---- 城市剪影 + 夜间窗户点云 ----
    const cityMat = std(0x18223c, {
      roughness: 0.9,
      emissive: new THREE.Color(0x24365e),
      emissiveIntensity: 0.4,
    });
    this.cityMat = cityMat;
    const winPos = [];
    for (let i = 0; i < 26; i++) {
      const w = rand(4, 9), h = rand(6, 20), d = rand(4, 8);
      const bx = -190 + i * 15 + rand(-3, 3);
      const bz = -62 - rand(0, 14);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cityMat);
      b.position.set(bx, h / 2, bz);
      this.group.add(b);
      // 正面（朝 +z）撒窗点
      const cols = Math.floor(w / 1.6);
      const rows = Math.floor(h / 1.8);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (Math.random() < 0.45) {
            winPos.push(
              bx - w / 2 + 0.9 + c * 1.6,
              1.2 + r * 1.8,
              bz + d / 2 + 0.06
            );
          }
        }
      }
    }
    const winGeo = new THREE.BufferGeometry();
    winGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(winPos), 3));
    this.windows = new THREE.Points(
      winGeo,
      new THREE.PointsMaterial({
        color: 0xffdf9a,
        size: 2.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.group.add(this.windows);
  }

  // side=+1 在海滩侧（z+），side=-1 在内陆侧（z-）；灯臂朝路面（z0 方向）伸
  _makeLamp(x, side, poleMat, withLight) {
    const lamp = new THREE.Group();
    lamp.position.set(x, 0, 7.6 * side);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 4.6, 8), poleMat);
    pole.position.y = 2.3;
    pole.castShadow = true;
    lamp.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6), poleMat);
    arm.rotation.x = Math.PI / 2; // 圆柱轴向转为 z
    arm.position.set(0, 4.55, -0.65 * side);
    lamp.add(arm);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff4dc,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), headMat);
    head.position.set(0, 4.5, -1.3 * side);
    lamp.add(head);
    this.lampHeads.push(headMat);
    if (withLight) {
      const light = new THREE.PointLight(0xffc98a, 0, 13, 2);
      light.position.set(0, 4.35, -1.3 * side);
      lamp.add(light);
      this.lampLights.push(light);
    }
    return lamp;
  }

  // dist: 累计骑行距离；night: 夜晚系数
  update(dist, night) {
    // 路面纹理滚动（repeat.x=50 对应 400m，一段 repeat=8m）
    this.roadTex.offset.x = -(dist % 8) / 8;
    // 周期物件取模回绕
    this.rail.position.x = -(dist % 2.5);
    this.lamps.position.x = -(dist % 30);
    this.beachStuff.position.x = -(dist % 60);
    // 夜间灯光
    for (const h of this.lampHeads) h.emissiveIntensity = night * 2.4;
    for (const l of this.lampLights) l.intensity = night * 26;
    this.windows.material.opacity = night * 0.9;
    this.cityMat.emissiveIntensity = 0.4 + night * 0.8;
  }
}

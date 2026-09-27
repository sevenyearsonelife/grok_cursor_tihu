// 海岸公路场景：沥青路+车道线（程序化 DataTexture）、沙滩、草地、护栏、路灯
// （光晕/光锥/路面光斑）、道钉、远山与城市（窗户贴图夜间亮灯、屋顶航标灯闪烁）。
// 路面纹理滚动 + 周期性物件用取模回绕，无限延伸。
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
      // 车轮碾压带略亮（每条车道中间两道浅色磨痕）
      const lanePos = ((y / H) * ROAD_W) % 4.4;
      if (Math.abs(lanePos - 1.3) < 0.35 || Math.abs(lanePos - 3.1) < 0.35) r += 6;
      let g = r, b = r + 4;
      const edge = y < 5 || y >= H - 5;
      const dash = (x % 256) < 160 && (Math.abs(y - lane1) < 2 || Math.abs(y - lane2) < 2);
      if (edge || dash) {
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
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// 径向渐变（光晕 / 地面光斑用），中心亮、边缘平滑衰减到 0
function makeRadialTexture(size, power) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const v = Math.pow(1 - r, power) * 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 竖向渐变（光锥用）：v=1 顶端亮 → v=0 底端暗
function makeConeTexture() {
  const H = 64;
  const data = new Uint8Array(H * 4);
  for (let y = 0; y < H; y++) {
    const v = Math.pow(y / (H - 1), 1.8) * 255;
    data[y * 4] = data[y * 4 + 1] = data[y * 4 + 2] = v;
    data[y * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, H);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 城市立面贴图：16x16 个窗格，每格 8px。albedo 为墙面+玻璃，emissive 为夜间亮窗。
// 第 0 行/列留作纯墙面，屋顶面 uv 指向那里。
function makeFacadeTextures() {
  const S = 128, C = 8;
  const alb = new Uint8Array(S * S * 4);
  const emi = new Uint8Array(S * S * 4);
  for (let cy = 0; cy < 16; cy++) {
    for (let cx = 0; cx < 16; cx++) {
      const wall = cx === 0 || cy === 0;
      const lit = !wall && Math.random() < 0.42;
      const warm = Math.random() < 0.75;
      const lr = warm ? 255 : 190, lg = warm ? 206 : 220, lb = warm ? 138 : 255;
      const k = 0.55 + Math.random() * 0.45;
      for (let py = 0; py < C; py++) {
        for (let px = 0; px < C; px++) {
          const i = ((cy * C + py) * S + cx * C + px) * 4;
          const glass = !wall && px >= 2 && px <= 5 && py >= 2 && py <= 6;
          const shade = 222 + ((px * 13 + py * 7 + cx * 5) % 9);
          if (glass) {
            const refl = 110 + py * 10;
            alb[i] = refl * 0.55; alb[i + 1] = refl * 0.7; alb[i + 2] = refl * 0.9;
            if (lit) { emi[i] = lr * k; emi[i + 1] = lg * k; emi[i + 2] = lb * k; }
          } else {
            alb[i] = alb[i + 1] = alb[i + 2] = shade;
          }
          alb[i + 3] = 255; emi[i + 3] = 255;
        }
      }
    }
  }
  const mk = (d) => {
    const t = new THREE.DataTexture(d, S, S);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(alb), emissiveMap: mk(emi) };
}

const FACADE_TINTS = [0xe8dcc4, 0xd4d8de, 0xe2c2a4, 0xc4d4e2, 0xf0e4d0, 0xb8c0cc, 0xdcb8a8];

export class Road {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;

    const std = (color, extra) =>
      new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.95 }, extra || {}));

    // ---- 路面 ----
    this.roadTex = makeRoadTexture();
    const roadGeo = new THREE.PlaneGeometry(ROAD_LEN, ROAD_W);
    roadGeo.rotateX(-Math.PI / 2);
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

    // ---- 道钉：车道虚线旁的琥珀色反光钉，周期 8m 跟路面纹理同步滚动 ----
    this.studs = new THREE.Group();
    this.group.add(this.studs);
    this.studMat = new THREE.MeshStandardMaterial({
      color: 0xffc36a, emissive: new THREE.Color(0xffa530), emissiveIntensity: 0, roughness: 0.3,
    });
    const STUD_N = Math.floor(ROAD_LEN / 8) * 2;
    const studs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.035, 0.1), this.studMat, STUD_N);
    let si = 0;
    for (let i = 0; i < ROAD_LEN / 8; i++) {
      for (const z of [-2.2, 2.2]) {
        m4.setPosition(-ROAD_LEN / 2 + 3.4 + i * 8, 0.028, z);
        studs.setMatrixAt(si++, m4);
      }
    }
    studs.instanceMatrix.needsUpdate = true;
    this.studs.add(studs);

    // ---- 路灯（内陆侧一排 + 海侧稀疏几盏），组周期 30m ----
    this.lampHeads = [];
    this.lampLights = [];
    this.lampGlows = [];
    this.lamps = new THREE.Group();
    this.group.add(this.lamps);
    this._glowTex = makeRadialTexture(64, 2.2);
    this._poolTex = makeRadialTexture(64, 1.6);
    this._coneTex = makeConeTexture();
    const poleMat = std(0x55606b, { roughness: 0.5, metalness: 0.6 });
    for (let i = 0; i < 14; i++) {
      const x = -ROAD_LEN / 2 + 15 + i * 30;
      this.lamps.add(this._makeLamp(x, -1, poleMat, i % 2 === 0));
    }
    // 海侧间距取 30 的整数倍，回绕时位置不跳变
    for (let i = 0; i < 6; i++) {
      this.lamps.add(this._makeLamp(-ROAD_LEN / 2 + 45 + i * 60, 1, poleMat, false));
    }

    // ---- 海滩小物（礁石 / 木箱），周期 60m ----
    this.beachStuff = new THREE.Group();
    this.group.add(this.beachStuff);
    const rockMat = std(0x8d8577, { roughness: 1, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const x = -ROAD_LEN / 2 + 30 + i * 60;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.0), 1), rockMat);
      rock.scale.set(1, rand(0.55, 0.8), rand(0.8, 1.1));
      rock.position.set(x, rand(0.1, 0.25), rand(9, 14));
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
    const mountainMat = std(0x4a6a78, { roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const mt = new THREE.Mesh(
        new THREE.ConeGeometry(rand(28, 50), rand(16, 30), 7),
        mountainMat
      );
      mt.position.set(-170 + i * 62 + rand(-15, 15), 0, -95 - rand(0, 30));
      this.group.add(mt);
    }

    // ---- 城市：立面贴图（白天玻璃窗 / 夜间亮窗）+ 各楼色调 + 屋顶航标灯 ----
    const facade = makeFacadeTextures();
    const cityMat = new THREE.MeshStandardMaterial({
      map: facade.map,
      emissiveMap: facade.emissiveMap,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
    });
    this.cityMat = cityMat;
    this.beacons = [];
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0 });
    this.beaconMat = beaconMat;
    const tint = new THREE.Color();
    for (let i = 0; i < 26; i++) {
      const w = rand(4, 9), h = rand(6, 22), d = rand(4, 8);
      const bx = -190 + i * 15 + rand(-3, 3);
      const bz = -62 - rand(0, 14);
      const geo = this._buildingGeo(w, h, d);
      tint.setHex(FACADE_TINTS[Math.floor(Math.random() * FACADE_TINTS.length)]);
      const cols = new Float32Array(geo.attributes.position.count * 3);
      for (let k = 0; k < cols.length; k += 3) { cols[k] = tint.r; cols[k + 1] = tint.g; cols[k + 2] = tint.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      const b = new THREE.Mesh(geo, cityMat);
      b.position.set(bx, h / 2, bz);
      this.group.add(b);
      // 部分楼顶加一截退台
      let topH = h;
      if (h > 12 && Math.random() < 0.6) {
        const w2 = w * rand(0.45, 0.7), h2 = rand(2, 5), d2 = d * rand(0.5, 0.75);
        const g2 = this._buildingGeo(w2, h2, d2);
        const c2 = new Float32Array(g2.attributes.position.count * 3);
        for (let k = 0; k < c2.length; k += 3) { c2[k] = tint.r * 0.92; c2[k + 1] = tint.g * 0.92; c2[k + 2] = tint.b * 0.92; }
        g2.setAttribute('color', new THREE.BufferAttribute(c2, 3));
        const top = new THREE.Mesh(g2, cityMat);
        top.position.set(bx, h + h2 / 2, bz);
        this.group.add(top);
        topH = h + h2;
      }
      if (topH > 15) {
        const bc = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), beaconMat);
        bc.position.set(bx, topH + 0.35, bz);
        this.group.add(bc);
        this.beacons.push(bc);
      }
    }
  }

  // 盒子楼：侧面 uv 按真实尺寸缩放到窗格网格（每格 1.6m 宽 × 1.8m 高），屋顶指向纯墙格
  _buildingGeo(w, h, d) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const off = 1 / 16; // 从第 1 格起铺，回绕到第 0 格时正好形成一道墙柱
    for (let f = 0; f < 6; f++) {
      const span = f < 2 ? d : w;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        if (f === 2 || f === 3) { uv.setXY(i, 0.02, 0.02); continue; }
        uv.setXY(i, off + uv.getX(i) * span / 1.6 / 16, off + uv.getY(i) * h / 1.8 / 16);
      }
    }
    return geo;
  }

  // side=+1 在海滩侧（z+），side=-1 在内陆侧（z-）；灯臂朝路面（z0 方向）伸
  _makeLamp(x, side, poleMat, withLight) {
    const lamp = new THREE.Group();
    lamp.position.set(x, 0, 7.6 * side);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 4.6, 8), poleMat);
    pole.position.y = 2.3;
    pole.castShadow = true;
    lamp.add(pole);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.35, 8), poleMat);
    base.position.y = 0.17;
    lamp.add(base);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 6), poleMat);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, 4.55, -0.65 * side);
    lamp.add(arm);
    // 灯罩：扁平外壳 + 底部发光灯面
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.6), poleMat);
    housing.position.set(0, 4.56, -1.3 * side);
    lamp.add(housing);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xfff4dc,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.48), headMat);
    lens.position.set(0, 4.5, -1.3 * side);
    lamp.add(lens);
    this.lampHeads.push(headMat);

    // 夜间光效：光晕精灵 + 淡淡的光锥 + 路面暖色光斑（全部加色混合、不写深度）
    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0xffd69a, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(2.6, 2.6, 1);
    glow.position.set(0, 4.45, -1.3 * side);
    lamp.add(glow);
    const coneMat = new THREE.MeshBasicMaterial({
      map: this._coneTex, color: 0xffcf8a, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0, side: THREE.DoubleSide, fog: false,
    });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 2.3, 4.4, 20, 1, true), coneMat);
    cone.position.set(0, 2.28, -1.3 * side);
    lamp.add(cone);
    const poolMat = new THREE.MeshBasicMaterial({
      map: this._poolTex, color: 0xffb866, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0,
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.03, -1.6 * side);
    pool.renderOrder = 1;
    lamp.add(pool);
    this.lampGlows.push({ glowMat, coneMat, poolMat });

    if (withLight) {
      const light = new THREE.PointLight(0xffc98a, 0, 14, 2);
      light.position.set(0, 4.3, -1.3 * side);
      lamp.add(light);
      this.lampLights.push(light);
    }
    return lamp;
  }

  // dist: 累计骑行距离；night: 夜晚系数；time: 游戏时间（航标灯闪烁）
  update(dist, night, time) {
    this.time = time !== undefined ? time : this.time + 1 / 60;
    this.roadTex.offset.x = -(dist % 8) / 8;
    this.rail.position.x = -(dist % 2.5);
    this.studs.position.x = -(dist % 8);
    this.lamps.position.x = -(dist % 30);
    this.beachStuff.position.x = -(dist % 60);
    // 夜间灯光：天色越暗越亮，开灯带一点延迟感（night 超过 0.25 才明显）
    const on = Math.min(1, Math.max(0, (night - 0.2) / 0.5));
    for (const h of this.lampHeads) h.emissiveIntensity = on * 3.2;
    for (const l of this.lampLights) l.intensity = on * 26;
    for (const g of this.lampGlows) {
      g.glowMat.opacity = on * 0.9;
      g.coneMat.opacity = on * 0.1;
      g.poolMat.opacity = on * 0.5;
    }
    this.studMat.emissiveIntensity = on * 1.6;
    this.cityMat.emissiveIntensity = 0.15 + night * 1.6;
    const blink = Math.sin(this.time * 3.2) > 0.55 ? 1 : 0.15;
    this.beaconMat.opacity = Math.min(1, night * 1.5) * blink;
  }
}

// 3D 鹈鹕：全部程序化拼装。
// 身体：车削出的蛋形躯干（前胸饱满、尾端收尖）朝车把前倾，顶点色分出白背/灰腹/奶黄胸斑；
// 羽毛分层：背部肩羽两排叠压、尾羽扇、颈根羽领、头后冠羽；
// 翅膀：肩-肘-腕双骨骼 IK 伸向车把握住把套，覆羽/次级飞羽/初级飞羽三层，
//       腾空时松把展开扇动（羽毛朝向在收拢/展开两套姿态间球面插值）；
// 头颈：锥形 S 颈 + 小头 + 扁平长喙（喙脊、钩尖、分叉下颌）+ 下垂喉囊；
// 戴头盔 + 墨镜，系红围巾（双尾 Verlet 布料）。双腿双骨骼 IK 踩踏。
import * as THREE from '../vendor/three.module.js';
import { clamp } from './utils.js';
import { Scarf } from './scarf.js';

const L1 = 0.46; // 大腿长（髋到最低踏板约 0.9，需要长腿才够得着）
const L2 = 0.46; // 小腿长
const WL1 = 0.36; // 翅膀上臂
const WL2 = 0.46; // 翅膀前臂（到腕/握把）
const UP = new THREE.Vector3(0, 1, 0);

// 身体枢轴静止姿态（蛋形长轴沿局部 x，前端上扬 = 骑手前倾伏在车把上）
const BODY_POS = new THREE.Vector3(0.05, 0.36, 0);
const BODY_TILT = 0.5;
const BODY_LEN_BACK = 0.52;
const BODY_LEN_FRONT = 0.46;
const BODY_R = 0.29;
const BODY_ZS = 0.92;

// 以下坐标均为“鹈鹕组空间静止姿态”（座垫面为原点），挂到 rest 组里随身体运动
const NECK_PTS = [
  [0.36, 0.56], [0.52, 0.7], [0.6, 0.87], [0.7, 0.99], [0.86, 1.02],
];
const HEAD_JOINT = new THREE.Vector3(0.87, 1.0, 0);
const MOUTH_REST = new THREE.Vector3(1.73, 0.84, 0);
const SHOULDER = new THREE.Vector3(0.24, 0.5, 0.2);
const GRIP_DEFAULT = new THREE.Vector3(0.88, 0.13, 0.18);
const KNOT_POS = new THREE.Vector3(0.43, 0.63, 0);

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// 蛋形躯干轮廓半径（s: 0 尾端 → 1 胸前）
function eggR(s) {
  return BODY_R * Math.pow(Math.max(Math.sin(Math.PI * s), 0), 0.7) * (0.82 + 0.3 * s);
}

function makeBodyGeo() {
  const pts = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    pts.push(new THREE.Vector2(Math.max(eggR(s), 0.001), -BODY_LEN_BACK + s * (BODY_LEN_BACK + BODY_LEN_FRONT)));
  }
  const geo = new THREE.LatheGeometry(pts, 26);
  geo.rotateZ(-Math.PI / 2); // 车削轴 +y → 身体前方 +x
  geo.scale(1, 1, BODY_ZS);
  // 顶点色：背白 → 腹灰；胸前上方一片奶黄（繁殖期羽色）
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const white = new THREE.Color(0xfbf8f0), grey = new THREE.Color(0xc3c7ce), cream = new THREE.Color(0xf3e2b0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = (x + BODY_LEN_BACK) / (BODY_LEN_BACK + BODY_LEN_FRONT);
    const r = Math.max(eggR(s), 1e-3);
    const ny = y / r;
    c.copy(white).lerp(grey, smoothstep(0.1, -0.75, ny));
    const breast = smoothstep(0.62, 0.92, s) * smoothstep(-0.3, 0.5, ny) * (1 - Math.abs(z) / (r * BODY_ZS + 1e-3) * 0.6);
    c.lerp(cream, breast * 0.75);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// 单位羽片：长 1（沿 +y，从 0 到 1）、宽 0.28、厚 0.05，尖端收窄
function makeFeatherGeo() {
  const geo = new THREE.SphereGeometry(0.5, 10, 6);
  geo.scale(0.28, 1, 0.05);
  geo.translate(0, 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - 0.55 * smoothstep(0.35, 1, y)));
  }
  geo.computeVertexNormals();
  return geo;
}

// 蛋形体表上的点（身体局部坐标）：x 沿长轴，theta 为离脊线的角度，s 为左右侧
function surfacePt(x, theta, s, lift) {
  const r = eggR((x + BODY_LEN_BACK) / (BODY_LEN_BACK + BODY_LEN_FRONT)) + lift;
  return new THREE.Vector3(x, r * Math.cos(theta), s * r * Math.sin(theta) * BODY_ZS);
}

// 锥形管：沿曲线半径从 r0 渐变到 r1
function makeTaperTube(curve, segs, radial, r0, r1) {
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial);
  const p = geo.attributes.position;
  const ctr = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, ctr);
    const r = r0 + (r1 - r0) * Math.pow(u, 0.8);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(ctr).multiplyScalar(r).add(ctr);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  return geo;
}

// 用“长度方向 dir + 羽面法线 nrm”确定羽片朝向
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
function orientQuat(q, dir, nrm) {
  _by.copy(dir).normalize();
  _bz.copy(nrm).addScaledVector(_by, -nrm.dot(_by)).normalize();
  _bx.crossVectors(_by, _bz);
  _bm.makeBasis(_bx, _by, _bz);
  return q.setFromRotationMatrix(_bm);
}

export class Pelican {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    this.time = 0;
    this.mouthOpen = 0;
    this.mouthTarget = 0;
    this.reactT = 0;      // 被点击后的反应计时
    this.flap = 0;        // 振翅幅度 0~1（空中扇翅膀）
    this.landT = 0;       // 落地压缩计时
    this.jumpT = 0;       // 起跳拉伸计时
    this._wasAir = false;
    this._prevSpeed = null;
    this._accel = 0;
    this._lean = 0;
    this._roll = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._glanceT = 3;
    this._glance = 0;
    this._prevGroupWorld = null;
    this._velW = new THREE.Vector3();
    this._accW = new THREE.Vector3();

    // ---- 材质 ----
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf9f6ee, roughness: 0.88 });
    const greyMat = new THREE.MeshStandardMaterial({ color: 0xd4d6dc, roughness: 0.9 });
    const darkFeatherMat = new THREE.MeshStandardMaterial({ color: 0x26282e, roughness: 0.75 });
    const creamMat = new THREE.MeshStandardMaterial({ color: 0xf3e3b4, roughness: 0.9 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf3a444, roughness: 0.45 });
    const jawMat = new THREE.MeshStandardMaterial({ color: 0xf0ae5c, roughness: 0.5 });
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0xe0703a, roughness: 0.4 });
    const nailMat = new THREE.MeshStandardMaterial({ color: 0xc4472a, roughness: 0.35 });
    const pouchMat = new THREE.MeshStandardMaterial({
      color: 0xf29a68, roughness: 0.55, transparent: true, opacity: 0.88,
    });
    const legMat = new THREE.MeshStandardMaterial({ color: 0xe8862a, roughness: 0.65 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 0.35 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xd8443c, roughness: 0.22, metalness: 0.15 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.2, metalness: 0.35 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.08, metalness: 0.85 });
    this.bodyMat = bodyMat;
    const featherGeo = makeFeatherGeo();
    this._featherGeo = featherGeo;

    const feather = (parent, mat, pos, dir, nrm, len, width) => {
      const m = new THREE.Mesh(featherGeo, mat);
      m.position.copy(pos);
      orientQuat(m.quaternion, dir, nrm);
      m.scale.set(width / 0.28, len, 0.012 / 0.05 * Math.max(1, width / 0.08));
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // ---- 身体 ----
    const body = new THREE.Group();
    body.position.copy(BODY_POS);
    body.rotation.z = BODY_TILT;
    g.add(body);
    this.bodyPivot = body;
    const trunk = new THREE.Mesh(makeBodyGeo(), bodyMat);
    trunk.castShadow = true;
    body.add(trunk);
    this.trunk = trunk;

    // rest 组：抵消身体静止变换，里面的东西用“组空间静止坐标”摆放，但随身体一起动
    body.updateMatrix();
    const rest = new THREE.Group();
    rest.applyMatrix4(body.matrix.clone().invert());
    body.add(rest);
    this.rest = rest;

    // 背部肩羽：两侧各两排，从肩向尾叠压，末端几片偏灰（三级飞羽）
    const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      for (let row = 0; row < 2; row++) {
        const theta = row === 0 ? 0.62 : 1.0; // 离脊线的角度
        for (let k = 0; k < 6; k++) {
          const x = 0.26 - k * 0.1 - row * 0.05;
          const p = surfacePt(x, theta, s, 0.004);
          // 羽片顺着体表切线向后贴伏（尾端收窄处也不会翘出去）
          const dir = surfacePt(x - 0.12, theta, s, 0.004).sub(p).add(v3(0, 0.012, 0));
          const nrm = v3(0, Math.cos(theta), s * Math.sin(theta));
          const mat = k >= 4 ? greyMat : whiteMat;
          feather(body, mat, p, dir, nrm, 0.22 + k * 0.008, 0.1 - row * 0.015);
        }
      }
    }
    // 脊线一排
    for (let k = 0; k < 4; k++) {
      const x = 0.2 - k * 0.12;
      const p = surfacePt(x, 0, 1, 0.006);
      const dir = surfacePt(x - 0.12, 0, 1, 0.006).sub(p).add(v3(0, 0.012, 0));
      feather(body, whiteMat, p, dir, v3(0, 1, 0), 0.2, 0.11);
    }
    // 尾羽扇：从尾端向后下方展开
    this.tail = new THREE.Group();
    this.tail.position.set(-BODY_LEN_BACK + 0.06, 0.02, 0);
    body.add(this.tail);
    for (let k = 0; k < 7; k++) {
      const a = (k - 3) / 3;
      const mat = Math.abs(a) > 0.9 ? greyMat : whiteMat;
      feather(this.tail, mat, v3(0, 0.005 * (3 - Math.abs(k - 3)), a * 0.05),
        v3(-1, -0.05, a * 0.55), v3(0, 1, 0), 0.22 - Math.abs(a) * 0.04, 0.075);
    }

    // ---- S 形锥颈（组空间坐标，放 rest 组）----
    const neckCurve = new THREE.CatmullRomCurve3(NECK_PTS.map(([x, y]) => new THREE.Vector3(x, y, 0)));
    const neck = new THREE.Mesh(makeTaperTube(neckCurve, 20, 12, 0.135, 0.075), whiteMat);
    neck.castShadow = true;
    rest.add(neck);
    const neckBase = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), whiteMat);
    neckBase.position.set(NECK_PTS[0][0], NECK_PTS[0][1], 0);
    rest.add(neckBase);
    const neckTop = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), whiteMat);
    neckTop.position.copy(HEAD_JOINT);
    rest.add(neckTop);
    // 颈根羽领：一圈短羽顺着脖子朝胸口披下
    const nb = new THREE.Vector3(0.42, 0.64, 0);
    const nd = new THREE.Vector3(0.62, 0.78, 0).normalize();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const radial = v3(-nd.y * Math.cos(a), nd.x * Math.cos(a), Math.sin(a));
      const p = nb.clone().addScaledVector(radial, 0.1);
      const dir = nd.clone().multiplyScalar(-1).addScaledVector(radial, 0.35);
      feather(rest, k % 3 === 0 ? creamMat : whiteMat, p, dir, radial, 0.14, 0.075);
    }

    // ---- 头：基座（rest 空间，静止朝向）→ 可转动的头枢轴 ----
    const head = new THREE.Group();
    head.position.copy(HEAD_JOINT);
    rest.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.15, 22, 16), whiteMat);
    skull.scale.set(1.18, 0.96, 0.9);
    skull.position.set(0.09, 0.015, 0);
    skull.castShadow = true;
    head.add(skull);
    // 喙根过渡（脸颊裸皮，略带粉）
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf6c9a0, roughness: 0.6 }));
    cheek.scale.set(1.4, 0.9, 1.3);
    cheek.position.set(0.2, -0.025, 0);
    head.add(cheek);
    // 头后冠羽（从头盔下沿探出）
    for (const [dz, dy] of [[0, 0.03], [0.035, 0], [-0.035, 0]]) {
      feather(head, creamMat, v3(-0.03, 0.02 + dy, dz), v3(-1, 0.35, dz * 5), v3(0, 1, 0), 0.13, 0.05);
    }

    // 上喙：扁平渐细，可绕喙根抬起
    const BEAK_ANGLE = -0.16;
    const beakPivot = new THREE.Group();
    beakPivot.position.set(0.2, -0.012, 0);
    beakPivot.rotation.z = BEAK_ANGLE;
    head.add(beakPivot);
    this.beakPivot = beakPivot;
    this.beakAngle = BEAK_ANGLE;
    const upperGeo = new THREE.CylinderGeometry(0.028, 0.05, 0.68, 14, 6);
    upperGeo.rotateZ(-Math.PI / 2);
    upperGeo.translate(0.34, 0, 0);
    upperGeo.scale(1, 0.42, 1.2);
    const upper = new THREE.Mesh(upperGeo, beakMat);
    upper.position.y = 0.012;
    upper.castShadow = true;
    beakPivot.add(upper);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.012, 0.014), ridgeMat);
    ridge.position.set(0.33, 0.031, 0);
    ridge.rotation.z = -0.012;
    beakPivot.add(ridge);
    const nailGeo = new THREE.ConeGeometry(0.024, 0.075, 10);
    nailGeo.rotateZ(Math.PI - 0.35); // 指向前下方的钩
    const nail = new THREE.Mesh(nailGeo, nailMat);
    nail.position.set(0.68, -0.012, 0);
    beakPivot.add(nail);

    // 下颌 + 喉囊（可向下张开）
    const pouchPivot = new THREE.Group();
    pouchPivot.position.set(0.19, -0.034, 0);
    pouchPivot.rotation.z = BEAK_ANGLE;
    head.add(pouchPivot);
    this.pouchPivot = pouchPivot;
    const jawGeo = new THREE.CylinderGeometry(0.02, 0.038, 0.66, 12, 4);
    jawGeo.rotateZ(-Math.PI / 2);
    jawGeo.translate(0.33, 0, 0);
    jawGeo.scale(1, 0.36, 1.15);
    const jaw = new THREE.Mesh(jawGeo, jawMat);
    pouchPivot.add(jaw);
    // 喉囊：顶面贴着下颌，底部下垂（靠喉部更深）
    const pouchGeo = new THREE.SphereGeometry(1, 24, 14);
    {
      const p = pouchGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const u = (x + 1) / 2; // 0 喉部 → 1 喙尖
        const depth = 0.05 + 0.13 * Math.pow(1 - u, 1.3) * (0.75 + 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.4)));
        const ny = y > 0 ? y * 0.012 : y * depth;
        const w = 0.042 + 0.018 * (y < 0 ? -y : 0);
        p.setXYZ(i, 0.02 + u * 0.6, ny - 0.008, z * w);
      }
      pouchGeo.computeVertexNormals();
    }
    const pouch = new THREE.Mesh(pouchGeo, pouchMat);
    pouch.castShadow = true;
    pouchPivot.add(pouch);
    this.pouchMesh = pouch;

    // 嘴尖锚点（接鱼 / 第一视角相机用）：只随身体动、不随转头，保证接鱼判定位置稳定
    this.mouthAnchor = new THREE.Object3D();
    this.mouthAnchor.position.copy(MOUTH_REST);
    rest.add(this.mouthAnchor);

    // 墨镜：环绕镜片带 + 正面镜片 + 镜腿
    const HX = 0.09; // 头骨中心 x
    const shades = new THREE.Mesh(
      new THREE.CylinderGeometry(0.168, 0.168, 0.066, 20, 1, true, Math.PI / 2 - 1.05, 2.1),
      lensMat
    );
    shades.position.set(HX + 0.012, 0.04, 0);
    head.add(shades);
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.022, 16), lensMat);
      lens.rotation.z = Math.PI / 2;
      lens.rotation.y = -0.35 * s;
      lens.position.set(HX + 0.14, 0.04, 0.07 * s);
      head.add(lens);
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(HX + 0.11, 0.04, 0.115 * s),
            new THREE.Vector3(HX - 0.02, 0.055, 0.142 * s),
            new THREE.Vector3(HX - 0.15, 0.045, 0.04 * s),
          ]),
          12, 0.008, 6
        ),
        lensMat
      );
      head.add(temple);
    }

    // 头盔：半圆壳 + 帽檐 + 顶白条 + 通风槽 + 金色环
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.172, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      helmetMat
    );
    helmet.scale.set(1.12, 1, 0.98);
    helmet.position.set(HX - 0.01, 0.045, 0);
    helmet.castShadow = true;
    head.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.17), helmetMat);
    brim.position.set(HX + 0.15, 0.12, 0);
    brim.rotation.z = -0.3;
    head.add(brim);
    // 顶白条：沿壳面弯曲的弧带（前后方向）
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.174, 0.012, 4, 24, 1.9), stripeMat);
    stripe.rotation.z = Math.PI / 2 - 0.95;
    stripe.scale.set(1.12, 1, 2.2);
    stripe.position.set(HX - 0.01, 0.045, 0);
    head.add(stripe);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.014, 6, 24, Math.PI), accentMat);
    ring.rotation.y = Math.PI / 2;
    ring.scale.set(1, 1, 1.12);
    ring.position.set(HX - 0.01, 0.04, 0);
    head.add(ring);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(HX - 0.02, 0.02, 0.165 * s),
            new THREE.Vector3(HX + 0.06, -0.08, 0.07 * s),
            new THREE.Vector3(HX + 0.08, -0.13, 0.006 * s),
          ]),
          10, 0.01, 6
        ),
        darkMat
      );
      head.add(strap);
    }

    // ---- 翅膀：上臂/前臂两段（组空间，每帧 IK 摆放），三层飞羽 ----
    this.wings = [];
    const fq = () => ({ fold: new THREE.Quaternion(), spread: new THREE.Quaternion() });
    for (const side of [-1, 1]) {
      const upperSeg = new THREE.Group();
      const foreSeg = new THREE.Group();
      g.add(upperSeg, foreSeg);
      const armGeo = new THREE.CapsuleGeometry(0.058, WL1 - 0.1, 4, 10);
      armGeo.translate(0, WL1 / 2, 0);
      armGeo.scale(1.55, 1, 0.65);
      const arm = new THREE.Mesh(armGeo, whiteMat);
      arm.castShadow = true;
      upperSeg.add(arm);
      const foreGeo = new THREE.CapsuleGeometry(0.045, WL2 - 0.08, 4, 10);
      foreGeo.translate(0, WL2 / 2, 0);
      foreGeo.scale(1.5, 1, 0.65);
      const fore = new THREE.Mesh(foreGeo, whiteMat);
      fore.castShadow = true;
      foreSeg.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), whiteMat);
      hand.position.y = WL2;
      hand.scale.set(1.2, 1, 1);
      foreSeg.add(hand);

      // 羽片在段局部坐标：x = 后缘方向，y = 沿骨，z×side = 羽面朝外
      const feathers = [];
      const add = (seg, mat, t, segLen, len, width, fold, spread, layer) => {
        const m = new THREE.Mesh(featherGeo, mat);
        m.position.set(0.03, t * segLen, side * 0.012 * layer);
        m.scale.set(width / 0.28, len, 0.25);
        m.castShadow = true;
        seg.add(m);
        const q = fq();
        const nrm = new THREE.Vector3(0, 0, side);
        orientQuat(q.fold, fold, nrm);
        orientQuat(q.spread, spread, nrm);
        m.quaternion.copy(q.fold);
        feathers.push({ m, q });
      };
      // 覆羽（上臂，白）
      for (let k = 0; k < 4; k++) {
        const t = 0.2 + k * 0.22;
        add(upperSeg, whiteMat, t, WL1, 0.16, 0.085, new THREE.Vector3(1, -0.4, 0), new THREE.Vector3(1, -0.15, 0), 1);
      }
      // 次级飞羽（前臂，内侧白 → 外侧深）
      for (let k = 0; k < 6; k++) {
        const t = 0.05 + k * 0.16;
        const mat = k < 2 ? whiteMat : k < 4 ? greyMat : darkFeatherMat;
        add(foreSeg, mat, t, WL2, 0.26 + k * 0.01, 0.08, new THREE.Vector3(0.55, -0.83, 0), new THREE.Vector3(1, 0.08 * k, 0), 0);
      }
      // 初级飞羽（腕部，黑，收拢时顺前臂向后叠放，展开时指状张开）
      for (let k = 0; k < 5; k++) {
        const t = 0.9 + k * 0.025;
        const a = k / 4;
        add(foreSeg, darkFeatherMat, t, WL2, 0.34 + k * 0.02, 0.07,
          new THREE.Vector3(0.32 - a * 0.12, -0.95, 0),
          new THREE.Vector3(0.9 - a * 0.7, 0.35 + a * 0.65, 0), 2 + a);
      }
      this.wings.push({ side, upperSeg, foreSeg, feathers });
    }
    this._shoulderRest = [
      SHOULDER.clone().setZ(-SHOULDER.z),
      SHOULDER.clone(),
    ];

    // ---- 腿（双骨骼 IK，踩在脚踏上；髋位与曲柄距离经校验不可乱动）----
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Vector3(-0.08, 0.06, 0.13 * side);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.036, 1, 8), legMat);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 1, 8), legMat);
      // 大腿根部披一撮白羽（“裤腿”）
      const pants = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), whiteMat);
      pants.scale.set(1, 1.5, 1);
      pants.position.set(-0.04, 0.08, 0.14 * side);
      g.add(pants);
      // 蹼足：脚掌 + 三趾 + 趾间蹼
      const foot = new THREE.Group();
      for (const a of [-0.45, 0, 0.45]) {
        const toe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.022, 0.022), legMat);
        toe.position.set(0.07 * Math.cos(a), 0, 0.07 * Math.sin(a));
        toe.rotation.y = -a;
        foot.add(toe);
      }
      const web = new THREE.Mesh(new THREE.CircleGeometry(0.13, 10, -0.5, 1.0), legMat);
      web.rotation.x = -Math.PI / 2;
      web.material = legMat;
      foot.add(web);
      thigh.castShadow = true;
      shin.castShadow = true;
      g.add(thigh, shin, foot);
      this.legs.push({ hip, thigh, shin, foot, side });
    }

    // ---- 红围巾：颈根绳结（随身体）+ 两条飘带 ----
    const scarfColor = 0xe23b30;
    const scarfMat = new THREE.MeshStandardMaterial({ color: scarfColor, roughness: 0.85 });
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.034, 10, 22), scarfMat);
    knot.position.copy(KNOT_POS);
    knot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nd);
    rest.add(knot);
    const knotBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), scarfMat);
    knotBall.position.copy(KNOT_POS).add(new THREE.Vector3(-0.1, 0.09, 0.02));
    rest.add(knotBall);
    this._scarfRest = [
      KNOT_POS.clone().add(new THREE.Vector3(-0.1, 0.1, 0.035)),
      KNOT_POS.clone().add(new THREE.Vector3(-0.09, 0.09, -0.03)),
    ];
    this.scarf = new Scarf(g, this._scarfRest[0], scarfColor, { rows: 13, cols: 3, seg: 0.07, wid: 0.05, seed: 0 });
    this.scarf2 = new Scarf(g, this._scarfRest[1], scarfColor, { rows: 9, cols: 3, seg: 0.065, wid: 0.045, seed: 1.7 });
    // 身体碰撞球（含羽毛厚度），围巾不会贴进背羽里
    this._colliders = [
      { c: new THREE.Vector3(), r: 0.32, local: new THREE.Vector3(0.02, 0, 0) },
      { c: new THREE.Vector3(), r: 0.25, local: new THREE.Vector3(-0.3, 0, 0) },
      { c: new THREE.Vector3(), r: 0.2, local: new THREE.Vector3(0.25, 0, 0) },
    ];

    this._mw = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._restM = new THREE.Matrix4();
    this._windVec = new THREE.Vector3();
    this._inertia = new THREE.Vector3();
    this._grip = new THREE.Vector3();
    this._shoulder = new THREE.Vector3();
    this._elbow = new THREE.Vector3();
    this._wrist = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  // 被点击 / 被戳：张嘴歪头叫一声
  react() {
    this.reactT = 0.7;
    this.scarf.kick(0.6, 1.2, 0);
    this.scarf2.kick(0.5, 1.0, 0);
  }

  // 需要在 rig.updateMatrixWorld 之后调用：
  // ctx = { dt, time, speedNorm, airborne, pedalPhase, footL, footR,
  //         steer?, grips?: [Vector3(z-), Vector3(z+)], lookAt?: Vector3 世界坐标 }
  //   footL/footR/grips 为 rig 局部空间位置
  update(ctx) {
    const dt = ctx.dt;
    this.time += dt;
    const t = this.time;
    const ph = ctx.pedalPhase;
    const steer = ctx.steer || 0;

    // 起跳 / 落地事件
    if (ctx.airborne && !this._wasAir) {
      this.jumpT = 0.3;
      this.scarf.kick(0, -0.5, 0);
      this.scarf2.kick(0, -0.4, 0);
    }
    if (!ctx.airborne && this._wasAir) {
      this.landT = 0.42;
      this.scarf.kick(0, 0.9, 0);
      this.scarf2.kick(0, 0.8, 0);
    }
    this._wasAir = ctx.airborne;

    // 加减速前后倾（加速伏低、刹车后仰）
    if (this._prevSpeed !== null && dt > 0) {
      const a = (ctx.speedNorm - this._prevSpeed) / dt;
      this._accel += (a - this._accel) * Math.min(1, dt * 4);
    }
    this._prevSpeed = ctx.speedNorm;
    const leanTarget = clamp(this._accel * 1.4, -0.08, 0.08) + ctx.speedNorm * 0.05;
    this._lean += (leanTarget - this._lean) * Math.min(1, dt * 5);

    // ---- 身体：踩踏起伏 + 胯部左右摆 + 变道压弯 + 前后倾 ----
    let squash = 0;
    if (this.reactT > 0) {
      this.reactT -= dt;
      const k = Math.max(this.reactT, 0) / 0.7;
      squash += Math.sin((1 - k) * Math.PI) * 0.1;
    }
    if (this.landT > 0) {
      this.landT -= dt;
      const k = 1 - Math.max(this.landT, 0) / 0.42;
      squash += Math.sin(k * Math.PI) * Math.exp(-k * 2.5) * 0.24;
    }
    if (this.jumpT > 0) {
      this.jumpT -= dt;
      const k = 1 - Math.max(this.jumpT, 0) / 0.3;
      squash -= Math.sin(k * Math.PI) * 0.09;
    }
    const pedalAmp = ctx.airborne ? 0.3 : 1;
    const breath = Math.sin(t * 2.2) * 0.008;
    const bp = this.bodyPivot;
    bp.position.set(
      BODY_POS.x - this._lean * 0.12,
      BODY_POS.y + Math.abs(Math.sin(ph)) * 0.016 * pedalAmp - squash * 0.12,
      BODY_POS.z + Math.sin(ph) * 0.008 * pedalAmp
    );
    const rollTarget = steer * 0.16 + Math.sin(ph) * 0.045 * pedalAmp;
    this._roll += (rollTarget - this._roll) * Math.min(1, dt * 8);
    const tilt = BODY_TILT - this._lean + Math.sin(ph * 2) * 0.018 * pedalAmp;
    bp.rotation.set(this._roll, -Math.sin(ph) * 0.03 * pedalAmp, tilt);
    bp.scale.set(1 + squash * 0.35 + breath, 1 - squash + breath * 0.6, 1 + squash * 0.25 + breath);
    bp.updateMatrix();
    this.tail.rotation.set(Math.sin(ph) * 0.12, 0, Math.sin(t * 3.1) * 0.05 + squash * 0.8);

    // ---- 嘴 ----
    this.mouthOpen += (this.mouthTarget - this.mouthOpen) * Math.min(1, dt * 10);
    this.beakPivot.rotation.z = this.beakAngle + this.mouthOpen * 0.3;
    this.pouchPivot.rotation.z = this.beakAngle - this.mouthOpen * 0.5;
    this.pouchMesh.scale.set(1 + this.mouthOpen * 0.1, 1 + this.mouthOpen * 0.7, 1 + this.mouthOpen * 0.45);

    // ---- 头：稳像（抵消身体俯仰/侧倾）+ 盯着飞来的鱼 / 偶尔望海 + 踩踏点头 ----
    let yawT = 0, pitchT = 0;
    this._glanceT -= dt;
    if (this._glanceT <= 0) {
      this._glance = this._glance > 0 ? 0 : 1;
      this._glanceT = this._glance ? 1.1 + Math.random() * 0.8 : 3 + Math.random() * 4;
    }
    if (ctx.lookAt) {
      this._look.copy(ctx.lookAt);
      this.group.worldToLocal(this._look);
      const dx = this._look.x - HEAD_JOINT.x, dy = this._look.y - HEAD_JOINT.y, dz = this._look.z;
      const near = smoothstep(1.3, 3.2, Math.sqrt(dx * dx + dy * dy + dz * dz));
      yawT = clamp(Math.atan2(-dz, Math.max(dx, 0.3)), -0.5, 0.5) * near;
      pitchT = clamp(Math.atan2(dy, Math.hypot(dx, dz)) * 0.6, -0.25, 0.35) * near;
    } else if (this._glance) {
      yawT = -0.42;
      pitchT = 0.05;
    }
    this._yaw += (yawT - this._yaw) * Math.min(1, dt * 5);
    this._pitch += (pitchT - this._pitch) * Math.min(1, dt * 5);
    const hd = this.head;
    let shakeZ = 0;
    if (this.reactT > 0) {
      const k = Math.max(this.reactT, 0) / 0.7;
      shakeZ = Math.sin(this.reactT * 26) * 0.22 * k;
    }
    const nod = Math.sin(ph * 2 + 0.6) * 0.035 * pedalAmp;
    hd.rotation.set(
      -this._roll * 0.85 + shakeZ * 0.3,
      this._yaw + Math.sin(t * 0.7) * 0.04,
      (tilt - BODY_TILT) * -0.8 + this._pitch + nod + shakeZ
    );

    // ---- 双腿 IK ----
    const gp = this.group.position;
    for (const leg of this.legs) {
      const footRig = leg.side < 0 ? ctx.footL : ctx.footR;
      this._solveLeg(leg, footRig.x - gp.x, footRig.y - gp.y, footRig.z - gp.z);
    }

    // ---- 翅膀：地面握把，腾空松把扇翅 ----
    const flapTarget = ctx.airborne ? 1 : 0;
    this.flap += (flapTarget - this.flap) * Math.min(1, dt * (ctx.airborne ? 7 : 5));
    this._restM.multiplyMatrices(bp.matrix, this.rest.matrix);
    for (let i = 0; i < 2; i++) {
      const w = this.wings[i];
      const s = w.side;
      this._shoulder.copy(this._shoulderRest[i]).applyMatrix4(this._restM);
      // 握把目标
      if (ctx.grips && ctx.grips[i]) {
        this._grip.set(ctx.grips[i].x - gp.x, ctx.grips[i].y - gp.y, ctx.grips[i].z - gp.z);
      } else {
        this._grip.set(GRIP_DEFAULT.x, GRIP_DEFAULT.y, GRIP_DEFAULT.z * s);
      }
      // 展翅目标：侧上方，绕肩上下拍
      const fa = Math.sin(t * 15 + i * 0.2) * 0.75;
      this._tmp.set(
        this._shoulder.x - 0.12,
        this._shoulder.y + 0.12 + Math.sin(fa) * 0.72,
        this._shoulder.z + s * Math.cos(fa) * 0.72
      );
      this._wrist.copy(this._grip).lerp(this._tmp, this.flap);
      // 肘部极向：地面时朝外上，展翅时朝后
      this._tmp2.set(-0.25 - this.flap * 0.6, 0.55 - this.flap * 0.3, s * (1 - this.flap * 0.4));
      this._solveTwoBone(this._shoulder, this._wrist, WL1, WL2, this._tmp2, this._elbow);
      const refUp = this._tmp.set(-0.45 - this.flap * 0.55, -1 + this.flap * 0.85, 0);
      this._placeSeg(w.upperSeg, this._shoulder, this._elbow, refUp);
      this._placeSeg(w.foreSeg, this._elbow, this._wrist, refUp);
      // 收拢/展开插值 + 随风轻颤（地面时车速越快越明显）
      const flutter = (0.02 + ctx.speedNorm * 0.05) * (1 - this.flap) * 0.3;
      for (let k = 0; k < w.feathers.length; k++) {
        const f = w.feathers[k];
        f.m.quaternion.slerpQuaternions(f.q.fold, f.q.spread, this.flap);
        if (flutter > 0.0005) f.m.rotateX(Math.sin(t * 19 + k * 1.3 + i) * flutter);
      }
    }

    // ---- 围巾：挂点跟随颈根；风 = 迎面气流 + 阵风；惯性 = 鹈鹕整体加速度的反向 ----
    const wp = this.group.getWorldPosition(this._tmp2);
    if (this._prevGroupWorld && dt > 0) {
      this._tmp.subVectors(wp, this._prevGroupWorld).multiplyScalar(1 / dt);
      this._accW.subVectors(this._tmp, this._velW).multiplyScalar(1 / dt);
      this._velW.copy(this._tmp);
    } else {
      this._prevGroupWorld = new THREE.Vector3();
    }
    this._prevGroupWorld.copy(wp);
    this._inertia.copy(this._accW).clampLength(0, 40).multiplyScalar(-0.35);
    const windX = -(2.4 + ctx.speedNorm * 9);
    const gust = (Math.sin(t * 7.3) * 1.1 + Math.sin(t * 3.1) * 0.7) * (0.6 + ctx.speedNorm * 1.6);
    // 迎面气流带一点升力，车速快时飘带几乎水平向后展开
    this._windVec.set(windX, gust * 0.4 + 1.5 + ctx.speedNorm * 6, gust * 1.1);
    for (const c of this._colliders) c.c.copy(c.local).applyMatrix4(bp.matrix);
    this.scarf.setAttach(this._tmp.copy(this._scarfRest[0]).applyMatrix4(this._restM));
    this.scarf.update(dt, this._windVec, { inertia: this._inertia, colliders: this._colliders, speed: ctx.speedNorm });
    this.scarf2.setAttach(this._tmp.copy(this._scarfRest[1]).applyMatrix4(this._restM));
    this.scarf2.update(dt, this._windVec, { inertia: this._inertia, colliders: this._colliders, speed: ctx.speedNorm });
  }

  // 3D 双骨骼 IK：root → target，pole 决定关节弯向
  _solveTwoBone(root, target, l1, l2, pole, out) {
    const d = this._ikD || (this._ikD = new THREE.Vector3());
    d.subVectors(target, root);
    let len = d.length();
    const maxL = (l1 + l2) * 0.995;
    if (len > maxL) { d.multiplyScalar(maxL / len); len = maxL; target.copy(root).add(d); }
    len = Math.max(len, 1e-4);
    const u = d.multiplyScalar(1 / len);
    const a = (l1 * l1 - l2 * l2 + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
    const p = this._ikP || (this._ikP = new THREE.Vector3());
    p.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
    return out.copy(root).addScaledVector(u, a).addScaledVector(p, h);
  }

  // 段局部坐标：y 沿骨（a→b），x 为后缘（由 ref 正交化得到），z = x × y
  _placeSeg(seg, a, b, ref) {
    const y = this._sy || (this._sy = new THREE.Vector3());
    const x = this._sx || (this._sx = new THREE.Vector3());
    const z = this._sz || (this._sz = new THREE.Vector3());
    const m = this._sm || (this._sm = new THREE.Matrix4());
    y.subVectors(b, a).normalize();
    x.copy(ref).addScaledVector(y, -ref.dot(y));
    if (x.lengthSq() < 1e-6) x.set(-1, 0, 0);
    x.normalize();
    z.crossVectors(x, y);
    m.makeBasis(x, y, z);
    seg.position.copy(a);
    seg.quaternion.setFromRotationMatrix(m);
  }

  // 解析法双骨骼 IK，膝盖朝 +x（前）弯
  _solveLeg(leg, fx, fy, fz) {
    const H = leg.hip;
    let dx = fx - H.x, dy = fy - H.y;
    let d = Math.sqrt(dx * dx + dy * dy);
    const maxD = (L1 + L2) * 0.985;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    if (d < 1e-4) d = 1e-4;
    const ux = dx / d, uy = dy / d;
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
    const kx = H.x + ux * a - uy * h;
    const ky = H.y + uy * a + ux * h;
    const knee = this._knee || (this._knee = new THREE.Vector3());
    knee.set(kx, ky, fz);

    this._placeLimb(leg.thigh, H, knee);
    const foot = this._foot || (this._foot = new THREE.Vector3());
    foot.set(H.x + dx, H.y + dy, fz);
    this._placeLimb(leg.shin, knee, foot);

    leg.foot.position.set(foot.x, foot.y + 0.018, foot.z);
    leg.foot.rotation.z = clamp(-uy * 0.5, -0.5, 0.5);
  }

  _placeLimb(mesh, a, b) {
    const d = this._limbDir || (this._limbDir = new THREE.Vector3());
    d.subVectors(b, a);
    const len = d.length() || 1e-5;
    mesh.scale.set(1, len, 1); // 圆柱几何体高为 1，半径已烘焙
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  }

  getMouthWorld(target) {
    return this.mouthAnchor.getWorldPosition(target || this._mw);
  }
}

// 3D 鹈鹕：全部用几何体程序化拼装。身体按真实鹈鹕比例捏形——胸背曲线用
// 球体+胶囊组合（大而流线）、S 形脖颈、大 头、加长下钩喙+饱满下垂喉囊。
// 配色：背白 / 腹浅灰 / 翅尖深灰。戴头盔（高光色条）+ 墨镜，系红围巾
// （Verlet 布料）。双腿双骨骼 IK 踩踏，被点击会做反应。
import * as THREE from '../vendor/three.module.js';
import { clamp } from './utils.js';
import { Scarf } from './scarf.js';

const L1 = 0.46; // 大腿长（髋到最低踏板约 0.9，需要长腿才够得着）
const L2 = 0.46; // 小腿长
const UP = new THREE.Vector3(0, 1, 0);

// 身体基础姿态（ update 里在此基础上叠加踩踏起伏 / 俯仰 ）
const BODY_POS = new THREE.Vector3(0.08, 0.52, 0);
const BODY_TILT = -0.24; // 略前倾

export class Pelican {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    this.time = 0;
    this.mouthOpen = 0;
    this.mouthTarget = 0;
    this.reactT = 0;      // 被点击后的反应计时
    this.flap = 0;        // 振翅幅度 0~1（空中扇翅膀）

    // ---- 材质（羽毛高粗糙度 / 头盔低粗糙度高光 / 墨镜深色半反光）----
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf8f4ea, roughness: 0.92 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xc6c9cf, roughness: 0.95 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf0963a, roughness: 0.55 });
    const pouchMat = new THREE.MeshStandardMaterial({
      color: 0xf4a58c, roughness: 0.7,
      transparent: true, opacity: 0.8, // 半透明肉粉色喉囊
    });
    const legMat = new THREE.MeshStandardMaterial({ color: 0xe0821f, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 0.35 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x4b4e56, roughness: 0.95 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xd8443c, roughness: 0.22, metalness: 0.15 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.2, metalness: 0.35 });
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0a0b10, roughness: 0.12, metalness: 0.7 });

    this.bodyMat = bodyMat;

    // ---- 身体：胸球 + 躯干胶囊 + 臀球捏出流线胸背曲线 ----
    const body = new THREE.Group();
    body.position.copy(BODY_POS);
    body.rotation.z = BODY_TILT;
    g.add(body);
    this.bodyPivot = body;

    const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.34, 8, 16), bodyMat);
    trunk.scale.set(1, 1.08, 0.82);
    trunk.castShadow = true;
    body.add(trunk);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 14), bodyMat);
    chest.scale.set(0.95, 1.0, 0.9);
    chest.position.set(0.2, 0.02, 0);
    chest.castShadow = true;
    body.add(chest);
    const rump = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), bodyMat);
    rump.scale.set(1.08, 0.95, 0.86);
    rump.position.set(-0.26, -0.03, 0);
    rump.castShadow = true;
    body.add(rump);
    // 浅灰腹部：从下侧鼓出，与白背形成两层配色
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.3, 8, 16), bellyMat);
    belly.scale.set(0.98, 1.05, 0.86);
    belly.position.set(0.02, -0.13, 0);
    body.add(belly);

    // 尾巴（短而上翘的楔形）
    const tailGeo = new THREE.ConeGeometry(0.14, 0.5, 8);
    tailGeo.rotateZ(Math.PI / 2); // 锥尖指向 -x（身后）
    const tail = new THREE.Mesh(tailGeo, bodyMat);
    tail.scale.z = 0.45;
    tail.position.set(-0.5, 0.05, 0);
    tail.rotation.z = 0.2;
    tail.castShadow = true;
    body.add(tail);

    // ---- S 形脖颈：样条管 + 根部过渡球 ----
    const neckCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.3, 0.1, 0),
      new THREE.Vector3(0.46, 0.24, 0),
      new THREE.Vector3(0.4, 0.46, 0),
      new THREE.Vector3(0.52, 0.62, 0),
    ]);
    const neck = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 16, 0.085, 10), bodyMat);
    neck.castShadow = true;
    body.add(neck);
    const neckBase = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), bodyMat);
    neckBase.position.set(0.3, 0.1, 0);
    body.add(neckBase);

    // ---- 头（加大）----
    const head = new THREE.Group();
    head.position.set(0.58, 0.72, 0);
    body.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 20, 16), bodyMat);
    skull.scale.set(1.08, 0.98, 0.96);
    skull.castShadow = true;
    head.add(skull);
    const nape = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), bodyMat);
    nape.position.set(-0.1, -0.02, 0);
    head.add(nape);

    // 喙：明显加长的上喙（可绕根部抬起）+ 喉囊（可向下张开的枢轴）
    const beakPivot = new THREE.Group();
    beakPivot.position.set(0.13, -0.02, 0);
    head.add(beakPivot);
    this.beakPivot = beakPivot;

    const upperGeo = new THREE.ConeGeometry(0.085, 0.88, 12);
    upperGeo.rotateZ(-Math.PI / 2);
    const upper = new THREE.Mesh(upperGeo, beakMat);
    upper.scale.set(1, 0.5, 1); // 上下压扁的流线长喙
    upper.position.x = 0.44;
    upper.castShadow = true;
    beakPivot.add(upper);

    // 喙尖下钩（鹈鹕式的弯钩）
    const hookGeo = new THREE.ConeGeometry(0.045, 0.16, 8);
    hookGeo.rotateZ(-Math.PI / 2 - 0.7); // 指向前下方
    const hook = new THREE.Mesh(hookGeo, beakMat);
    hook.position.set(0.85, -0.02, 0);
    hook.castShadow = true;
    beakPivot.add(hook);

    // 喉囊：饱满下垂，挂在下颌随张嘴枢轴摆动
    const pouchPivot = new THREE.Group();
    pouchPivot.position.set(0.05, -0.05, 0);
    head.add(pouchPivot);
    this.pouchPivot = pouchPivot;
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), pouchMat);
    pouch.scale.set(2.3, 1.05, 0.62);
    pouch.position.set(0.34, -0.16, 0);
    pouch.castShadow = true;
    pouchPivot.add(pouch);
    this.pouchBase = new THREE.Vector3(2.3, 1.05, 0.62);

    // 嘴尖锚点（接鱼 / 第一视角相机用）
    this.mouthAnchor = new THREE.Object3D();
    this.mouthAnchor.position.set(0.95, -0.03, 0);
    head.add(this.mouthAnchor);

    // 墨镜：黑色镜片带（弧带加宽、半径略大于头骨，侧面也能看清）+ 正面镜片 + 镜腿
    const shades = new THREE.Mesh(
      new THREE.CylinderGeometry(0.205, 0.205, 0.078, 18, 1, true, Math.PI / 2 - 1.1, 2.2),
      lensMat
    );
    // thetaStart=π/2-1.1 使弧带中心正好落在 +x（脸朝向）一侧
    shades.position.y = 0.03;
    head.add(shades);
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.026, 16), lensMat);
      lens.rotation.z = Math.PI / 2; // 镜片面朝 +x
      lens.position.set(0.205, 0.03, 0.068 * s);
      head.add(lens);
      // 鼻梁小桥
      if (s === 1) {
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.014, 0.07), lensMat);
        bridge.position.set(0.205, 0.03, 0);
        head.add(bridge);
      }
      // 镜腿：从镜片外侧沿头侧绕到脑后
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.16, 0.03, 0.125 * s),
            new THREE.Vector3(0.0, 0.05, 0.172 * s),
            new THREE.Vector3(-0.16, 0.04, 0.04 * s),
          ]),
          12, 0.01, 6
        ),
        lensMat
      );
      head.add(temple);
    }

    // 头盔：半圆壳（低粗糙度高光）+ 帽檐 + 顶白条 + 一圈亮色高光环
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      helmetMat
    );
    helmet.position.y = 0.035;
    helmet.castShadow = true;
    head.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.024, 0.19), helmetMat);
    brim.position.set(0.14, 0.12, 0);
    brim.rotation.z = -0.25;
    head.add(brim);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.05), stripeMat);
    stripe.position.set(0, 0.195, 0);
    head.add(stripe);
    // 高光色条：沿头盔下缘绕一圈的金色环（半径贴壳面，明显可见）
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.017, 6, 24, Math.PI), accentMat);
    ring.rotation.y = Math.PI / 2; // 环面立起，从一侧镜腿绕过头顶到另一侧
    ring.position.y = 0.028;
    head.add(ring);

    // 下巴系带：从头盔两侧绕到下巴扣紧
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.02, 0.0, 0.18 * s),
            new THREE.Vector3(0.09, -0.09, 0.075 * s),
            new THREE.Vector3(0.11, -0.16, 0.007 * s),
          ]),
          10, 0.012, 6
        ),
        darkMat
      );
      head.add(strap);
    }

    // ---- 翅膀（肩部枢轴，收拢贴身，飞行时展开扇动，边缘随风微颤）----
    this.wings = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.02, 0.34, 0.26 * side);
      pivot.rotation.y = -0.3 * side; // 翅尖略向身后收
      pivot.rotation.z = 0.14;        // 翅尖略垂
      body.add(pivot);
      const wingGeo = new THREE.CapsuleGeometry(0.095, 0.36, 4, 10);
      wingGeo.rotateZ(Math.PI / 2); // 长轴转向 x，尖端朝 -x（身后）
      const wing = new THREE.Mesh(wingGeo, bodyMat);
      wing.scale.y = 0.8;
      wing.position.x = -0.2;
      wing.castShadow = true;
      pivot.add(wing);
      // 翅尖（深灰）单独挂在末端关节上，方便做随风微颤
      const tipPivot = new THREE.Group();
      tipPivot.position.set(-0.4, 0, 0);
      pivot.add(tipPivot);
      const tipGeo = new THREE.CapsuleGeometry(0.058, 0.24, 4, 8);
      tipGeo.rotateZ(Math.PI / 2);
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.x = -0.13;
      tip.castShadow = true;
      tipPivot.add(tip);
      this.wings.push({ pivot, tipPivot, side });
    }

    // ---- 腿（双骨骼 IK，踩在脚踏上；髋位与曲柄距离经校验不可乱动）----
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Vector3(-0.08, 0.06, 0.13 * side);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 1, 8), legMat);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.026, 1, 8), legMat);
      const foot = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 0.1), legMat);
      palm.position.x = 0.04;
      const web = new THREE.Mesh(new THREE.ConeGeometry(0.062, 0.1, 3), legMat);
      web.rotation.z = -Math.PI / 2;
      web.scale.set(1, 1, 0.28);
      web.position.set(0.14, 0.0, 0);
      foot.add(palm, web);
      thigh.castShadow = true;
      shin.castShadow = true;
      g.add(thigh, shin, foot);
      this.legs.push({ hip, thigh, shin, foot, side });
    }

    // ---- 红围巾（挂在 S 形脖颈根部）+ 颈部红环绳结 ----
    const scarfMat = new THREE.MeshStandardMaterial({ color: 0xe23b30, roughness: 0.9 });
    const knot = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.028, 8, 16), scarfMat);
    knot.rotation.x = Math.PI / 2.15;
    knot.rotation.y = -0.35;
    knot.position.set(0.4, 0.56, 0);
    g.add(knot);
    this.scarf = new Scarf(g, new THREE.Vector3(0.4, 0.56, 0), 0xe23b30);

    this._mw = new THREE.Vector3();
  }

  // 被点击 / 被戳：张嘴歪头叫一声
  react() {
    this.reactT = 0.7;
    this.scarf.kick(0.6, 1.2, 0);
  }

  // 需要在 rig.updateMatrixWorld 之后调用：
  // ctx = { dt, time, speedNorm, airborne, pedalPhase, footL, footR }
  //   footL/footR 为 rig 局部空间的脚踏位置
  update(ctx) {
    const dt = ctx.dt;
    this.time += dt;
    const t = this.time;

    // 身体随踩踏起伏 + 绕 z 轻微前后俯仰（±3°）
    this.bodyPivot.position.y = 0.52 + Math.sin(ctx.pedalPhase * 2) * 0.014;
    this.bodyPivot.rotation.z = BODY_TILT + Math.sin(ctx.pedalPhase) * 0.052;

    // 嘴：目标开合平滑过渡
    this.mouthOpen += (this.mouthTarget - this.mouthOpen) * Math.min(1, dt * 10);
    this.beakPivot.rotation.z = this.mouthOpen * 0.38;
    this.pouchPivot.rotation.z = -this.mouthOpen * 0.55;
    const pb = this.pouchBase;
    this.pouchPivot.children[0].scale.set(
      pb.x * (1 + this.mouthOpen * 0.25),
      pb.y * (1 + this.mouthOpen * 0.5),
      pb.z * (1 + this.mouthOpen * 0.25)
    );

    // 点击反应：歪头 + 身体压缩
    let squash = 0;
    if (this.reactT > 0) {
      this.reactT -= dt;
      const k = Math.max(this.reactT, 0) / 0.7;
      this.head.rotation.z = Math.sin(this.reactT * 26) * 0.22 * k;
      squash = Math.sin((1 - k) * Math.PI) * 0.1;
    } else {
      this.head.rotation.z *= 0.9;
      // 平时轻微的观察式摆头 + 随踩踏节奏的点头
      this.head.rotation.y = Math.sin(t * 0.7) * 0.08;
      this.head.rotation.x = Math.sin(t * 0.43) * 0.05;
      this.head.rotation.z = Math.sin(ctx.pedalPhase * 2 + 0.6) * 0.05;
    }
    this.bodyPivot.scale.y = 1 - squash;
    this.bodyPivot.scale.x = 1 + squash * 0.5;

    // 翅膀：空中展开扇翅，地面收拢贴身、边缘随风微颤（车速越快越明显）
    const flapTarget = ctx.airborne ? 1 : 0;
    this.flap += (flapTarget - this.flap) * Math.min(1, dt * 6);
    const breeze = 0.5 + ctx.speedNorm * 1.6;
    for (const w of this.wings) {
      if (this.flap > 0.02) {
        // 空中扇翅：整翅绕肩上下拍
        w.pivot.rotation.z = 0.14 - this.flap * 0.35 + Math.sin(t * 17) * 0.85 * this.flap;
        w.pivot.rotation.y = -0.3 * w.side * (1 - this.flap * 0.5);
      } else {
        // 收拢态：小幅气流颤动
        w.pivot.rotation.z = 0.14 + Math.sin(t * 9 + w.side * 1.7) * 0.02 * breeze;
        w.pivot.rotation.y = -0.3 * w.side + Math.sin(t * 7 + w.side) * 0.015 * breeze;
      }
      // 翅尖深灰羽毛的次级颤动（滞后相位，显得柔）
      w.tipPivot.rotation.z = Math.sin(t * 13 + w.side * 2.0) * 0.05 * breeze
        + Math.sin(t * 17 + 0.8) * 0.35 * this.flap;
    }

    // 双腿 IK 踩踏：把 rig 空间脚踏位置换算到鹈鹕局部空间
    const gp = this.group.position;
    for (const leg of this.legs) {
      const footRig = leg.side < 0 ? ctx.footL : ctx.footR;
      const fx = footRig.x - gp.x;
      const fy = footRig.y - gp.y;
      const fz = footRig.z - gp.z;
      this._solveLeg(leg, fx, fy, fz);
    }

    // 围巾：风 = 迎面气流(向后) + 重力方向扰动 + 随车速增大的抖动
    const windX = -(2.2 + ctx.speedNorm * 8);
    const gustScale = 0.6 + ctx.speedNorm * 1.6;
    const gust = (Math.sin(t * 7.3) * 1.1 + Math.sin(t * 3.1) * 0.7) * gustScale;
    this._windVec = this._windVec || new THREE.Vector3();
    this._windVec.set(windX, gust * 0.5, gust * 1.4);
    this.scarf.update(dt, this._windVec);
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
    // 膝盖位置：沿方向 a，再向“前方”法向偏 h
    const kx = H.x + ux * a - uy * h;
    const ky = H.y + uy * a + ux * h;
    const knee = this._knee || (this._knee = new THREE.Vector3());
    knee.set(kx, ky, fz);

    this._placeLimb(leg.thigh, H, knee);
    const foot = this._foot || (this._foot = new THREE.Vector3());
    foot.set(H.x + dx, H.y + dy, fz);
    this._placeLimb(leg.shin, knee, foot);

    leg.foot.position.set(foot.x, foot.y + 0.015, foot.z);
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

// 注意：腿的圆柱几何体是 (r≈0.04, height=1) 建的，_placeLimb 里用半径比例缩放即可

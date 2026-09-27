// 3D 鹈鹕：全部用几何体程序化拼装 —— 身体、头、长喙+喉囊、翅膀、尾巴、双腿，
// 戴头盔、墨镜，系红围巾（Verlet 布料）。双腿双骨骼 IK 踩踏，被点击会做反应。
import * as THREE from '../vendor/three.module.js';
import { tube, clamp } from './utils.js';
import { Scarf } from './scarf.js';

const L1 = 0.46; // 大腿长（髋到最低踏板约 0.9，需要长腿才够得着）
const L2 = 0.46; // 小腿长
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(1, 0, 0);

export class Pelican {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    this.time = 0;
    this.mouthOpen = 0;
    this.mouthTarget = 0;
    this.reactT = 0;      // 被点击后的反应计时
    this.flap = 0;        // 振翅幅度 0~1（空中扇翅膀）

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf7f2e6, roughness: 0.85 });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xbfc3c9, roughness: 0.9 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.7 });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xf59a2e, roughness: 0.65 });
    const pouchMat = new THREE.MeshStandardMaterial({
      color: 0xf2a184, roughness: 0.65,
      transparent: true, opacity: 0.72, // 半透明肉粉色喉囊
    });
    const legMat = new THREE.MeshStandardMaterial({ color: 0xe07f1f, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x17181f, roughness: 0.35 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xd8443c, roughness: 0.4 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x8f8f96, roughness: 0.9 });

    this.bodyMat = bodyMat;

    // ---- 身体（略前倾的胶囊）----
    const body = new THREE.Group();
    body.position.set(0.14, 0.46, 0);
    body.rotation.z = -0.42;
    g.add(body);
    this.bodyPivot = body;

    const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.26, 6, 14), bodyMat);
    trunk.scale.set(1, 1.12, 0.8);
    trunk.castShadow = true;
    body.add(trunk);

    // 两层配色：浅灰腹部（下侧露出）+ 白色背部（上侧露出）
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.22, 6, 14), bellyMat);
    belly.scale.set(1, 1.1, 0.84);
    belly.position.set(0.02, -0.1, 0);
    body.add(belly);
    const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.26, 6, 14), backMat);
    back.scale.set(1, 1.05, 0.84);
    back.position.set(-0.05, 0.1, 0);
    body.add(back);

    // 尾巴
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 8), bodyMat);
    tail.scale.z = 0.5;
    tail.position.set(-0.13, -0.34, 0);
    tail.rotation.z = 2.0;
    tail.castShadow = true;
    body.add(tail);

    // 脖子
    const neck = tube(
      new THREE.Vector3(0.16, 0.16, 0), new THREE.Vector3(0.32, 0.48, 0),
      0.082, bodyMat
    );
    body.add(neck);

    // ---- 头 ----
    const head = new THREE.Group();
    head.position.set(0.34, 0.52, 0);
    body.add(head);
    this.head = head;

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 18, 14), bodyMat);
    skull.scale.set(1.05, 0.95, 0.95);
    skull.castShadow = true;
    head.add(skull);

    // 喙：上喙（可绕根部抬起）+ 喉囊（可向下张开的枢轴）
    const beakPivot = new THREE.Group();
    beakPivot.position.set(0.1, -0.01, 0);
    head.add(beakPivot);
    this.beakPivot = beakPivot;

    const upperGeo = new THREE.ConeGeometry(0.075, 0.6, 10);
    upperGeo.rotateZ(-Math.PI / 2);
    const upper = new THREE.Mesh(upperGeo, beakMat);
    upper.scale.set(1, 0.55, 1);
    upper.position.x = 0.3;
    upper.castShadow = true;
    beakPivot.add(upper);

    // 喙尖下钩（猛禽式的弯钩）
    const hookGeo = new THREE.ConeGeometry(0.04, 0.14, 8);
    hookGeo.rotateZ(-Math.PI / 2 - 0.55); // 指向前下方
    const hook = new THREE.Mesh(hookGeo, beakMat);
    hook.position.set(0.55, 0.01, 0);
    hook.castShadow = true;
    beakPivot.add(hook);

    const pouchPivot = new THREE.Group();
    pouchPivot.position.set(0.04, -0.03, 0);
    head.add(pouchPivot);
    this.pouchPivot = pouchPivot;
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), pouchMat);
    pouch.scale.set(1.7, 0.85, 0.6);
    pouch.position.set(0.19, -0.07, 0);
    pouch.castShadow = true;
    pouchPivot.add(pouch);

    // 嘴尖锚点（接鱼 / 第一视角相机用）
    this.mouthAnchor = new THREE.Object3D();
    this.mouthAnchor.position.set(0.62, -0.04, 0);
    head.add(this.mouthAnchor);

    // 墨镜：黑色镜片带 + 两片正面镜片 + 绕到脑后的镜腿
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.2, metalness: 0.4 });
    const shadeGeo = new THREE.CylinderGeometry(
      0.158, 0.158, 0.068, 14, 1, true, Math.PI / 2 - 1.0, 2.0
    );
    // thetaStart=π/2-1.0 使弧带中心正好落在 +x（脸朝向）一侧
    const shades = new THREE.Mesh(shadeGeo, lensMat);
    shades.position.y = 0.028;
    head.add(shades);
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.054, 0.02, 16), lensMat);
      lens.rotation.z = Math.PI / 2; // 镜片面朝 +x
      lens.position.set(0.16, 0.028, 0.062 * s);
      head.add(lens);
      // 镜腿：从镜片外侧沿头侧绕到脑后
      const temple = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.15, 0.03, 0.112 * s),
            new THREE.Vector3(0.02, 0.05, 0.15 * s),
            new THREE.Vector3(-0.15, 0.04, 0.03 * s),
          ]),
          12, 0.009, 6
        ),
        lensMat
      );
      head.add(temple);
    }

    // 头盔：半圆壳 + 帽檐 + 顶部白条
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.172, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      helmetMat
    );
    helmet.position.y = 0.03;
    helmet.castShadow = true;
    head.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.17), helmetMat);
    brim.position.set(0.13, 0.115, 0);
    brim.rotation.z = -0.25;
    head.add(brim);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.016, 0.045), whiteMat);
    stripe.position.set(0, 0.168, 0);
    head.add(stripe);

    // 下巴系带：从头盔两侧绕到下巴扣紧
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3([
            new THREE.Vector3(0.02, 0.01, 0.165 * s),
            new THREE.Vector3(0.09, -0.08, 0.07 * s),
            new THREE.Vector3(0.11, -0.15, 0.006 * s),
          ]),
          10, 0.011, 6
        ),
        darkMat
      );
      head.add(strap);
    }

    // ---- 翅膀（肩部枢轴，收拢贴身，空中扇动）----
    this.wings = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.1, 0.24, 0.24 * side);
      shoulder.rotation.z = 2.35;
      shoulder.rotation.x = 0.3 * side;
      body.add(shoulder);
      const wing = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.32, 4, 8), bodyMat);
      wing.scale.set(0.6, 1, 1);
      wing.position.y = -0.22;
      wing.castShadow = true;
      shoulder.add(wing);
      const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), tipMat);
      tip.scale.set(0.6, 1, 1);
      tip.position.y = -0.48;
      shoulder.add(tip);
      this.wings.push({ shoulder, side });
    }

    // ---- 腿（双骨骼 IK，踩在脚踏上）----
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

    // ---- 红围巾（挂在脖根）----
    this.scarf = new Scarf(g, new THREE.Vector3(0.44, 0.52, 0), 0xe23b30);

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

    // 身体随踩踏轻微起伏
    this.bodyPivot.position.y = 0.46 + Math.sin(ctx.pedalPhase * 2) * 0.012;
    this.bodyPivot.rotation.x = Math.sin(ctx.pedalPhase) * 0.015;

    // 嘴：目标开合平滑过渡
    this.mouthOpen += (this.mouthTarget - this.mouthOpen) * Math.min(1, dt * 10);
    this.beakPivot.rotation.z = this.mouthOpen * 0.38;
    this.pouchPivot.rotation.z = -this.mouthOpen * 0.55;
    this.pouchPivot.children[0].scale.set(
      1.7 * (1 + this.mouthOpen * 0.25),
      0.85 * (1 + this.mouthOpen * 0.5),
      0.6 * (1 + this.mouthOpen * 0.25)
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
      // 平时轻微的观察式摆头
      this.head.rotation.y = Math.sin(t * 0.7) * 0.08;
      this.head.rotation.x = Math.sin(t * 0.43) * 0.05;
    }
    this.bodyPivot.scale.y = 1 - squash;
    this.bodyPivot.scale.x = 1 + squash * 0.5;

    // 翅膀：空中扇翅，地面收拢微动
    const flapTarget = ctx.airborne ? 1 : 0;
    this.flap += (flapTarget - this.flap) * Math.min(1, dt * 6);
    for (const w of this.wings) {
      const flapping = Math.sin(t * 17) * 0.85 * this.flap;
      w.shoulder.rotation.x = w.side * (0.3 + flapping + this.flap * 0.25);
      w.shoulder.rotation.z = 2.35 - this.flap * 0.3;
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

    // 围巾：风 = 迎面气流(向后) + 重力方向扰动 + 抖动
    const windX = -(2.2 + ctx.speedNorm * 7.5);
    const gust = Math.sin(t * 7.3) * 1.1 + Math.sin(t * 3.1) * 0.7;
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

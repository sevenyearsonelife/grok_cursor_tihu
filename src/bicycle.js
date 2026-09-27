// 复古自行车：车架、双轮（滚动+辐条）、车把、座椅、脚踏曲柄、车铃、前置车筐。
// 前叉连同前轮可转向；曲柄相位随车速，脚踏位置供鹈鹕双腿 IK 使用。
import * as THREE from '../vendor/three.module.js';
import { tube } from './utils.js';

const RW = new THREE.Vector3(-0.575, 0.38, 0);  // 后轮轴
const FW = new THREE.Vector3(0.575, 0.38, 0);   // 前轮轴
const BB = new THREE.Vector3(-0.06, 0.44, 0);   // 五通（曲柄轴）
const SB = new THREE.Vector3(-0.36, 0.86, 0);   // 座管顶
const ST = new THREE.Vector3(-0.42, 1.02, 0);   // 座垫面
const HT = new THREE.Vector3(0.5, 1.0, 0);      // 头管上端

function makeWheel() {
  const wheel = new THREE.Group();
  const tire = new THREE.Mesh(
    new THREE.TorusGeometry(0.345, 0.035, 10, 28),
    new THREE.MeshStandardMaterial({ color: 0x23252c, roughness: 0.9 })
  );
  tire.castShadow = true;
  wheel.add(tire);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.305, 0.012, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.35, metalness: 0.8 })
  );
  wheel.add(rim);
  const spokeMat = new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.3, metalness: 0.9 });
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.6, 4), spokeMat);
    spoke.rotation.z = (i * Math.PI) / 8; // 8 根细辐条 → 16 根视觉辐条
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.08, 8), spokeMat);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  return wheel;
}

export class Bicycle {
  constructor() {
    this.group = new THREE.Group();
    const g = this.group;
    this.wheelSpin = 0;
    this.steer = 0;
    this.steerTarget = 0;
    this.bellT = 0;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd93a30, roughness: 0.3, metalness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.6, metalness: 0.4 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.25, metalness: 0.85 });
    const brownMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.8 });
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.85 }); // 黑色把套

    // ---- 车架 ----
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const frame = [
      [RW, BB], [BB, SB], [SB, RW],          // 后三角
      [SB, HT], [BB, HT], [SB, ST],          // 主梁 + 座管
    ];
    for (const [a, b] of frame) {
      const t = tube(a.clone(), b.clone(), 0.03, frameMat);
      t.castShadow = true;
      g.add(t);
    }

    // ---- 前叉 + 前轮（可转向组，挂在头管）----
    this.fork = new THREE.Group();
    this.fork.position.copy(HT);
    g.add(this.fork);
    const forkTube = tube(V(0, 0, 0), V(FW.x - HT.x, FW.y - HT.y, 0), 0.024, chromeMat);
    this.fork.add(forkTube);
    this.frontWheel = makeWheel();
    this.frontWheel.position.set(FW.x - HT.x, FW.y - HT.y, 0);
    this.fork.add(this.frontWheel);

    // 车把：立管 + 横把 + 握把（微后掠，握把加长好握）
    this.fork.add(tube(V(0, 0, 0), V(0.02, 0.13, 0), 0.024, chromeMat));
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.48, 10), chromeMat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0.02, 0.15, 0);
    this.fork.add(bar);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.14, 10), gripMat);
      grip.rotation.x = Math.PI / 2;
      grip.position.set(0.02, 0.15, 0.18 * s);
      this.fork.add(grip);
    }

    // 车铃（金色小铃铛，响的时候晃动）
    this.bellMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8b93c, roughness: 0.25, metalness: 0.9 })
    );
    this.bellMesh.position.set(-0.02, 0.15, 0.11);
    this.fork.add(this.bellMesh);

    // 前车筐（藤编色小筐）
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.2), brownMat);
    basket.position.set(0.14, -0.1, 0);
    this.fork.add(basket);
    const basketRim = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.22), darkMat);
    basketRim.position.set(0.14, -0.04, 0);
    this.fork.add(basketRim);

    // ---- 后轮 ----
    this.rearWheel = makeWheel();
    this.rearWheel.position.copy(RW);
    g.add(this.rearWheel);

    // ---- 座垫（加宽加厚，与鹈鹕体型匹配；前端收窄的座鼻）----
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.15), seatMat);
    seat.position.set(ST.x, ST.y + 0.025, 0);
    seat.rotation.z = 0.08;
    seat.castShadow = true;
    g.add(seat);
    const seatNose = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.09), seatMat);
    seatNose.position.set(ST.x + 0.17, ST.y + 0.02, 0);
    seatNose.rotation.z = 0.12;
    g.add(seatNose);

    // ---- 链条 + 链轮（细圆环示意）----
    const chainMat = new THREE.MeshStandardMaterial({ color: 0x33363e, roughness: 0.5, metalness: 0.7 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.011, 8, 22), chainMat);
    ring.position.copy(BB);
    g.add(ring);
    const cog = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 14), chainMat);
    cog.position.set(RW.x, RW.y, 0.035);
    g.add(cog);
    g.add(tube(V(BB.x, BB.y + 0.105, 0.04), V(RW.x, RW.y + 0.04, 0.035), 0.006, chainMat));
    g.add(tube(V(BB.x, BB.y - 0.105, 0.04), V(RW.x, RW.y - 0.04, 0.035), 0.006, chainMat));

    // ---- 曲柄 + 脚踏 ----
    this.crank = new THREE.Group();
    this.crank.position.copy(BB);
    g.add(this.crank);
    const armGeo = new THREE.BoxGeometry(0.032, 0.3, 0.016);
    const armL = new THREE.Mesh(armGeo, chromeMat);
    armL.position.y = 0.085;
    this.crank.add(armL);
    const armR = new THREE.Mesh(armGeo, chromeMat);
    armR.position.y = -0.085;
    armR.rotation.z = Math.PI;
    this.crank.add(armR);

    this.pedalL = new THREE.Object3D();
    this.pedalL.position.set(0, 0.17, 0.16);
    this.pedalR = new THREE.Object3D();
    this.pedalR.position.set(0, -0.17, -0.16);
    const pedalGeo = new THREE.BoxGeometry(0.14, 0.028, 0.09);
    const pedalLm = new THREE.Mesh(pedalGeo, darkMat);
    this.pedalL.add(pedalLm);
    const pedalRm = new THREE.Mesh(pedalGeo, darkMat);
    this.pedalR.add(pedalRm);
    this.crank.add(this.pedalL, this.pedalR);
  }

  ring() {
    this.bellT = 1;
  }

  // steerTarget ∈ [-1,1]（变道时给一点转向），speed 单位 m/s
  update(dt, speed, steerTarget) {
    this.steerTarget = steerTarget || 0;
    this.steer += (this.steerTarget - this.steer) * Math.min(1, dt * 6);
    this.wheelSpin -= (speed / 0.345) * dt; // 朝 +x 滚动 → 绕 z 负向
    this.rearWheel.rotation.z = this.wheelSpin;
    this.frontWheel.rotation.z = this.wheelSpin;
    this.fork.rotation.y = -this.steer * 0.3;
    this.crank.rotation.z = this.wheelSpin * 0.36;

    if (this.bellT > 0) {
      this.bellT = Math.max(0, this.bellT - dt * 2.2);
      this.bellMesh.rotation.z = Math.sin(this.bellT * 32) * 0.5 * this.bellT;
    } else {
      this.bellMesh.rotation.z = 0;
    }
  }
}

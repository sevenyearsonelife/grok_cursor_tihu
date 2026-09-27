// 镜头：跟随 / 侧面 / 鹈鹕第一视角 / 电影运镜，C 键循环切换。
// 手感层：变道时镜头随横移侧倾、跳跃时竖向半跟随（弧线在画面里可见）、
// 落地下沉+震动、高速时轻微抖动与视野拉宽，并在镜头前方撒风线。
import * as THREE from '../vendor/three.module.js';
import { lerp, clamp } from './utils.js';

const STREAKS = 70;

export class CameraController {
  constructor(camera, scene) {
    this.camera = camera;
    this.mode = 0;
    this.modes = ['follow', 'side', 'cockpit', 'cinema'];
    this._pos = new THREE.Vector3(-7, 3.5, 7);
    this._look = new THREE.Vector3();
    this._lookS = new THREE.Vector3();
    this._ideal = new THREE.Vector3();
    this._fov = 60;
    this._prevRig = null;
    this._vz = 0;
    this._vy = 0;
    this._roll = 0;
    this._dip = 0;       // 落地下沉量（弹簧）
    this._dipV = 0;
    this._shake = 0;     // 瞬时震动能量
    this._airborne = false;
    this._t = 0;

    if (scene) this._initStreaks(scene);
  }

  next() {
    this.mode = (this.mode + 1) % this.modes.length;
    // 切换时别做长距离插值
    this.snap = true;
    return this.modes[this.mode];
  }

  name() {
    return this.modes[this.mode];
  }

  _initStreaks(scene) {
    const pos = new Float32Array(STREAKS * 6);
    const col = new Float32Array(STREAKS * 6);
    for (let i = 0; i < STREAKS; i++) {
      // 线头亮、线尾黑（加色混合下即透明）
      col[i * 6] = col[i * 6 + 1] = col[i * 6 + 2] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.streakMat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this.streaks = new THREE.LineSegments(geo, this.streakMat);
    this.streaks.frustumCulled = false;
    scene.add(this.streaks);
    this._sd = [];
    for (let i = 0; i < STREAKS; i++) this._sd.push({ x: 0, y: 0, z: 0, k: Math.random() });
    this._streakInit = false;
  }

  _respawnStreak(s, camX, rigZ, far) {
    // 主要贴着路面两侧与骑手周围，少量在头顶，不往天空里撒
    const ang = -0.6 + Math.random() * (Math.PI + 1.2);
    const r = 1.6 + Math.random() * 3.2;
    s.x = camX + (far ? 14 + Math.random() * 12 : 2 + Math.random() * 24);
    s.y = Math.max(0.15, 1.1 - Math.sin(ang) * r * 0.25 + Math.random() * 1.4);
    s.z = rigZ + Math.cos(ang) * r;
    s.k = 0.5 + Math.random() * 0.8;
  }

  _updateStreaks(dt, speed, speedNorm, rigZ) {
    if (!this.streaks) return;
    const camX = this.camera.position.x;
    if (!this._streakInit) {
      for (const s of this._sd) this._respawnStreak(s, camX, rigZ, false);
      this._streakInit = true;
    }
    const m = this.modes[this.mode];
    const a = (m === 'follow' || m === 'cockpit') ? clamp((speedNorm - 0.62) / 0.33, 0, 1) : 0;
    this.streakMat.opacity = a * 0.32;
    this.streaks.visible = a > 0.01;
    if (!this.streaks.visible) return;
    const arr = this.streaks.geometry.attributes.position.array;
    const len = 0.5 + speed * 0.13;
    for (let i = 0; i < STREAKS; i++) {
      const s = this._sd[i];
      s.x -= speed * 1.7 * s.k * dt;
      if (s.x < camX - 1) this._respawnStreak(s, camX, rigZ, true);
      arr[i * 6] = s.x; arr[i * 6 + 1] = s.y; arr[i * 6 + 2] = s.z;
      arr[i * 6 + 3] = s.x + len * s.k; arr[i * 6 + 4] = s.y; arr[i * 6 + 5] = s.z;
    }
    this.streaks.geometry.attributes.position.needsUpdate = true;
  }

  // ctx = { dt, time, rigPos, mouth, speedNorm, speed? }
  update(ctx) {
    const { dt, time, rigPos, mouth, speedNorm } = ctx;
    const speed = ctx.speed !== undefined ? ctx.speed : speedNorm * 15;
    this._t += dt;
    const mode = this.modes[this.mode];
    const pos = this._ideal;
    let lambda = 3.5;
    let lookLambda = 8;

    // 由 rig 位移推出横向/竖向速度（变道侧倾、跳跃/落地判定）
    if (this._prevRig && dt > 0) {
      const vz = (rigPos.z - this._prevRig.z) / dt;
      const vy = (rigPos.y - this._prevRig.y) / dt;
      this._vz = lerp(this._vz, vz, Math.min(1, dt * 10));
      const air = rigPos.y > 0.45 || vy > 1.5;
      if (this._airborne && !air && this._vy < -3) {
        // 落地：下沉冲量 + 震动，强度随下落速度
        const k = clamp(-this._vy / 9, 0, 1);
        this._dipV -= 1.6 * k;
        this._shake = Math.max(this._shake, 0.5 * k);
      }
      this._airborne = air;
      this._vy = vy;
    } else {
      this._prevRig = new THREE.Vector3();
    }
    this._prevRig.copy(rigPos);

    // 落地弹簧（临界阻尼附近）
    this._dipV += (-this._dip * 90 - this._dipV * 13) * dt;
    this._dip += this._dipV * dt;
    this._shake = Math.max(0, this._shake - dt * 1.8);

    // 竖向半跟随：跳起时镜头只跟一部分，主角在画面里画出上抛弧线
    const ry = rigPos.y * 0.5;
    if (mode === 'follow') {
      // 3/4 后侧视角：能看到鹈鹕侧脸与长喙；z 下限避开内陆侧路灯杆/护栏
      const back = 4.9 + speedNorm * 0.9;
      pos.set(rigPos.x - back, 2.2 + ry + speedNorm * 0.15, Math.max(rigPos.z - 3.0, -6.3));
      // 视线偏向海侧（+z）与前方，让海面稳定占据画面右侧
      this._look.set(rigPos.x + 4.5, 1.25 + rigPos.y * 0.75, rigPos.z + 2.2);
    } else if (mode === 'side') {
      // 从内陆侧（z-）朝海拍：骑手剪影在前，沙滩与海面铺满背景
      pos.set(rigPos.x + 0.6, 2.35 + ry, rigPos.z - 10.5);
      this._look.set(rigPos.x + 0.4, 0.95 + rigPos.y * 0.7, rigPos.z + 2.5);
      lambda = 5;
    } else if (mode === 'cockpit') {
      pos.set(mouth.x + 0.75, mouth.y + 0.06, mouth.z);
      this._look.set(rigPos.x + 14, 0.7, lerp(rigPos.z, 6, 0.4));
      lambda = 14;
      lookLambda = 14;
    } else {
      const ang = time * 0.22;
      const r = 7.5 + 2.5 * Math.sin(time * 0.11);
      const h = 1.7 + 1.9 * (0.5 + 0.5 * Math.sin(time * 0.07));
      pos.set(
        rigPos.x + Math.cos(ang) * r - r * 0.35,
        rigPos.y * 0.6 + h,
        rigPos.z + Math.sin(ang) * r
      );
      this._look.set(rigPos.x, rigPos.y + 1.1, rigPos.z);
      lambda = 2;
    }

    if (this.snap) {
      this._pos.copy(pos);
      this._lookS.copy(this._look);
      this.snap = false;
    } else {
      this._pos.x = THREE.MathUtils.damp(this._pos.x, pos.x, lambda, dt);
      this._pos.y = THREE.MathUtils.damp(this._pos.y, pos.y, lambda * 1.3, dt);
      this._pos.z = THREE.MathUtils.damp(this._pos.z, pos.z, lambda * 0.8, dt);
      this._lookS.x = THREE.MathUtils.damp(this._lookS.x, this._look.x, lookLambda, dt);
      this._lookS.y = THREE.MathUtils.damp(this._lookS.y, this._look.y, lookLambda, dt);
      this._lookS.z = THREE.MathUtils.damp(this._lookS.z, this._look.z, lookLambda, dt);
    }

    const cam = this.camera;
    cam.position.copy(this._pos);
    cam.position.y += this._dip * (mode === 'cockpit' ? 0.3 : 0.25);

    // 震动：高速路面细颤（与速度平方相关）+ 落地冲击
    if (mode !== 'cinema') {
      const road = speedNorm * speedNorm * 0.018;
      const amp = road + this._shake * 0.08;
      const t = this._t;
      cam.position.x += Math.sin(t * 37.1) * amp * 0.4;
      cam.position.y += (Math.sin(t * 43.7) * 0.6 + Math.sin(t * 71.3) * 0.4) * amp;
      cam.position.z += Math.sin(t * 29.3 + 1.3) * amp * 0.6;
    }
    cam.lookAt(this._lookS);

    // 变道侧倾：朝移动方向压一点
    const rollTarget = mode === 'cinema' ? 0 : clamp(-this._vz * 0.018, -0.07, 0.07);
    this._roll = THREE.MathUtils.damp(this._roll, rollTarget, 6, dt);
    cam.rotateZ(this._roll);

    // 速度越快视野越开阔（非线性，高速段拉伸更明显）
    const targetFov = 58 + Math.pow(speedNorm, 1.4) * 15;
    this._fov = lerp(this._fov, targetFov, Math.min(1, dt * 3));
    if (Math.abs(cam.fov - this._fov) > 0.01) {
      cam.fov = this._fov;
      cam.updateProjectionMatrix();
    }

    this._updateStreaks(dt, speed, speedNorm, rigPos.z);
  }
}

// 镜头：跟随 / 侧面 / 鹈鹕第一视角 / 电影运镜，C 键循环切换
import * as THREE from '../vendor/three.module.js';
import { lerp } from './utils.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.modes = ['follow', 'side', 'cockpit', 'cinema'];
    this._pos = new THREE.Vector3(-7, 3.5, 7);
    this._look = new THREE.Vector3();
    this._ideal = new THREE.Vector3();
    this._fov = 60;
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

  // ctx = { dt, time, rigPos, mouth, speedNorm }
  update(ctx) {
    const { dt, time, rigPos, mouth, speedNorm } = ctx;
    const mode = this.modes[this.mode];
    const pos = this._ideal;
    let lambda = 3.5;

    if (mode === 'follow') {
      pos.set(rigPos.x - 7.2, rigPos.y + 3.4, rigPos.z + 6.2);
      // 视线向海侧（+z）偏一点，让海面稳定占据画面右侧
      this._look.set(rigPos.x + 2.5, rigPos.y + 1.2, rigPos.z + 3);
    } else if (mode === 'side') {
      // 从内陆侧（z-）朝海拍：骑手剪影在前，沙滩与海面铺满背景
      pos.set(rigPos.x + 0.6, rigPos.y + 1.7, rigPos.z - 10.5);
      this._look.set(rigPos.x + 0.4, rigPos.y + 1.0, rigPos.z + 1.5);
      lambda = 5;
    } else if (mode === 'cockpit') {
      // 嘴尖前方的鹈鹕视角
      pos.set(mouth.x + 0.75, mouth.y + 0.06, mouth.z);
      this._look.set(rigPos.x + 14, 0.7, lerp(rigPos.z, 6, 0.4));
      lambda = 14;
    } else {
      // 电影运镜：缓慢环绕 + 高低起伏
      const ang = time * 0.22;
      const r = 7.5 + 2.5 * Math.sin(time * 0.11);
      const h = 1.7 + 1.9 * (0.5 + 0.5 * Math.sin(time * 0.07));
      pos.set(
        rigPos.x + Math.cos(ang) * r - r * 0.35,
        rigPos.y + h,
        rigPos.z + Math.sin(ang) * r
      );
      this._look.set(rigPos.x, rigPos.y + 1.1, rigPos.z);
      lambda = 2;
    }

    if (this.snap) {
      this._pos.copy(pos);
      this.snap = false;
    } else {
      this._pos.x = THREE.MathUtils.damp(this._pos.x, pos.x, lambda, dt);
      this._pos.y = THREE.MathUtils.damp(this._pos.y, pos.y, lambda, dt);
      this._pos.z = THREE.MathUtils.damp(this._pos.z, pos.z, lambda, dt);
    }
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);

    // 速度越快视野越开阔
    const targetFov = 60 + speedNorm * 9;
    this._fov = lerp(this._fov, targetFov, Math.min(1, dt * 4));
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

// 昼夜循环：约 90 秒一轮（黄昏 → 星空月夜 → 黎明 → 白天）。
// 天空穹顶渐变着色器 + 太阳/月亮 + 星星 + 灯光颜色/强度关键帧插值。
import * as THREE from '../vendor/three.module.js';
import { lerp } from './utils.js';

const CYCLE = 90; // 秒

// 关键帧：t, 天顶色, 地平线色, 雾色, 阳光色, 阳光强度, 半球光强, 环境光强, 夜晚系数
const KF = [
  { t: 0.0,  top: 0x35427e, hor: 0xff9a5e, fog: 0xd98a70, sun: 0xffc49a, sunI: 2.4, hemiI: 0.5,  ambI: 0.45, night: 0.18 },
  { t: 0.12, top: 0x1e2a5e, hor: 0xe07a56, fog: 0x9a6058, sun: 0xffb08a, sunI: 1.2, hemiI: 0.35, ambI: 0.32, night: 0.55 },
  { t: 0.28, top: 0x05081c, hor: 0x0e1630, fog: 0x0a1024, sun: 0xa8bcf0, sunI: 0.7, hemiI: 0.22, ambI: 0.2,  night: 1 },
  { t: 0.5,  top: 0x060a20, hor: 0x121a36, fog: 0x0c1226, sun: 0xa8bcf0, sunI: 0.7, hemiI: 0.22, ambI: 0.2,  night: 1 },
  { t: 0.62, top: 0x2e3f80, hor: 0xffa87e, fog: 0xc78f80, sun: 0xffcf9e, sunI: 1.8, hemiI: 0.4,  ambI: 0.35, night: 0.35 },
  { t: 0.75, top: 0x3f83cc, hor: 0xa8d4f2, fog: 0xb8d4ea, sun: 0xfff0d6, sunI: 2.8, hemiI: 0.6,  ambI: 0.5,  night: 0 },
  { t: 0.9,  top: 0x3a78c0, hor: 0xa0cce8, fog: 0xb0cce4, sun: 0xffeccf, sunI: 2.5, hemiI: 0.55, ambI: 0.48, night: 0.02 },
  // t=1.0 回到黄昏，保证循环无缝
  { t: 1.0,  top: 0x35427e, hor: 0xff9a5e, fog: 0xd98a70, sun: 0xffc49a, sunI: 2.4, hemiI: 0.5,  ambI: 0.45, night: 0.18 },
];

function smooth(u) {
  return u * u * (3 - 2 * u);
}

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.time = 0;          // 一轮内的相位 [0,1)
    this.night = 0;         // 平滑后的夜晚系数
    this.sunWorld = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0.4, 0.8, 0.3);
    this._cA = new THREE.Color();
    this._cB = new THREE.Color();

    // ---- 天空穹顶 ----
    this.uniforms = {
      topColor: { value: new THREE.Color(0x35427e) },
      horColor: { value: new THREE.Color(0xff9a5e) },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(520, 24, 14),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horColor;
          varying vec3 vPos;
          void main() {
            float h = clamp(normalize(vPos).y, 0.0, 1.0);
            gl_FragColor = vec4(mix(horColor, topColor, pow(h, 0.55)), 1.0);
          }`,
      })
    );
    scene.add(dome);

    // ---- 太阳 / 月亮 ----
    this.sun = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false })
    );
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(19, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8eefc, fog: false })
    );
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xc9d4ea, fog: false });
    for (const [cx, cy, r] of [[5, 4, 4], [-6, -3, 3], [2, -7, 2.4]]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r, 12), craterMat);
      c.position.set(cx, cy, 0.5);
      this.moon.add(c);
    }
    scene.add(this.sun, this.moon);

    // ---- 星星 ----
    const starGeo = new THREE.BufferGeometry();
    const n = 420;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // 上半球均匀撒点
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(Math.random());
      const r = 470;
      arr[i * 3] = Math.cos(el) * Math.cos(az) * r;
      arr[i * 3 + 1] = Math.sin(el) * r + 8;
      arr[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xdfe8ff,
        size: 2.2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        fog: false,
        depthWrite: false,
      })
    );
    scene.add(this.stars);

    // ---- 灯光 ----
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    const sc = this.dirLight.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 160;
    this.dirLight.shadow.bias = -0.0006;
    this.dirLight.shadow.normalBias = 0.02;
    scene.add(this.dirLight);
    scene.add(this.dirLight.target);

    this.hemi = new THREE.HemisphereLight(0x8a7ba0, 0x3a4a3f, 0.5);
    scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(this.amb);

    this._camera = camera;
    this._fog = new THREE.Fog(0xd98a70, 60, 330);
    scene.fog = this._fog;
  }

  // t ∈ [0,1) 相位；rigPos 用来让阴影相机跟着主角走
  update(t, rigPos) {
    this.time = t;
    // 关键帧插值
    let i = 0;
    while (i < KF.length - 1 && !(t >= KF[i].t && t < KF[i + 1].t)) i++;
    const a = KF[i];
    const b = KF[Math.min(i + 1, KF.length - 1)];
    const span = Math.max(b.t - a.t, 1e-5);
    const u = smooth(Math.min(Math.max((t - a.t) / span, 0), 1));

    this.uniforms.topColor.value.setHex(a.top).lerp(this._cA.setHex(b.top), u);
    this.uniforms.horColor.value.setHex(a.hor).lerp(this._cB.setHex(b.hor), u);
    this._fog.color.setHex(a.fog).lerp(this._cA.setHex(b.fog), u);
    this.dirLight.color.setHex(a.sun).lerp(this._cB.setHex(b.sun), u);
    this.dirLight.intensity = lerp(a.sunI, b.sunI, u);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, u);
    this.hemi.color.copy(this.uniforms.topColor.value).lerp(this._cA.set(0xffffff), 0.35);
    this.amb.intensity = lerp(a.ambI, b.ambI, u);
    this.night = lerp(a.night, b.night, u);

    // 太阳 / 月亮在天空圆弧上的位置（相位 0 = 黄昏太阳在地平线）
    const ph = t * Math.PI * 2;
    this.sunWorld.set(Math.cos(ph) * 300, -Math.sin(ph) * 330, 130);
    this.sun.position.copy(this.sunWorld);
    this.moon.position.set(-Math.cos(ph) * 300, Math.sin(ph) * 330, 130);
    if (this._camera) {
      this.sun.lookAt(this._camera.position);
      this.moon.lookAt(this._camera.position);
    }
    this.sun.visible = this.sunWorld.y > -40;
    this.moon.visible = this.moon.position.y > -40;
    this.stars.material.opacity = this.night * 0.95;

    // 主光：白天跟太阳、夜晚跟月亮，平滑过渡
    this.lightDir.copy(this.sunWorld).normalize()
      .lerp(this._moonDir(), this.night)
      .normalize();
    this.dirLight.position.copy(rigPos).addScaledVector(this.lightDir, 70);
    this.dirLight.target.position.copy(rigPos);
  }

  _moonDir() {
    const v = this._mv || (this._mv = new THREE.Vector3());
    return v.set(-Math.cos(this.time * Math.PI * 2), Math.sin(this.time * Math.PI * 2), 0.4).normalize();
  }

  phaseIcon() {
    const t = this.time;
    if (t < 0.14 || t >= 0.93) return '🌇';
    if (t < 0.55) return '🌙';
    if (t < 0.68) return '🌅';
    return '☀️';
  }

  static get cycleLength() {
    return CYCLE;
  }
}

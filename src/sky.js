// 昼夜循环：约 90 秒一轮（黄昏 → 余晖 → 蓝调 → 星空月夜 → 黎明 → 白天 → 金色午后）。
// 天空穹顶着色器：三段渐变 + 太阳光晕/地平线辉光 + 程序化云层（随太阳染色）+ 月晕；
// 星星为独立闪烁点精灵；灯光颜色/强度按关键帧插值。
import * as THREE from '../vendor/three.module.js';
import { lerp } from './utils.js';

const CYCLE = 90; // 秒

// 关键帧：天顶/地平线/雾色，太阳光晕色(glow)，云亮面/暗面，阳光色与强度，
// 半球光/环境光强度，夜晚系数（驱动路灯、星星、城市灯光）
const KF = [
  { t: 0.0,  top: 0x2b3a7a, hor: 0xffa062, fog: 0xd98c6c, glow: 0xff7a3c, cLit: 0xffb27c, cDark: 0x74507a, sun: 0xffb483, sunI: 2.3, hemiI: 0.55, ambI: 0.36, night: 0.18 },
  { t: 0.06, top: 0x232c66, hor: 0xf07a6c, fog: 0xa8666c, glow: 0xe0506a, cLit: 0xff8e8c, cDark: 0x4c3864, sun: 0xff9a80, sunI: 1.4, hemiI: 0.44, ambI: 0.3,  night: 0.4 },
  { t: 0.13, top: 0x141c4a, hor: 0x6a5a8e, fog: 0x34365e, glow: 0x8a4a8a, cLit: 0x8a7aa8, cDark: 0x2a2a4a, sun: 0xb0a8e0, sunI: 0.85, hemiI: 0.32, ambI: 0.24, night: 0.72 },
  { t: 0.28, top: 0x040716, hor: 0x111b3c, fog: 0x0b1329, glow: 0x1c2c5c, cLit: 0x566890, cDark: 0x0e1426, sun: 0x9fb4f0, sunI: 0.65, hemiI: 0.22, ambI: 0.18, night: 1 },
  { t: 0.5,  top: 0x050818, hor: 0x131e40, fog: 0x0c142b, glow: 0x1c2c5c, cLit: 0x566890, cDark: 0x0e1426, sun: 0x9fb4f0, sunI: 0.65, hemiI: 0.22, ambI: 0.18, night: 1 },
  { t: 0.57, top: 0x1a2050, hor: 0x8a5a7a, fog: 0x4a3a5a, glow: 0xb0607a, cLit: 0xc08aa0, cDark: 0x34304e, sun: 0xc0a0c0, sunI: 0.95, hemiI: 0.3,  ambI: 0.25, night: 0.62 },
  { t: 0.63, top: 0x3a4a8e, hor: 0xffb07a, fog: 0xd0a084, glow: 0xff9a50, cLit: 0xffc49a, cDark: 0x7a6a8a, sun: 0xffc88e, sunI: 1.9, hemiI: 0.5,  ambI: 0.38, night: 0.3 },
  { t: 0.72, top: 0x3f86d0, hor: 0xb8dcf4, fog: 0xbcd6ea, glow: 0xfff0d0, cLit: 0xffffff, cDark: 0xb4c4d8, sun: 0xffe6c0, sunI: 2.7, hemiI: 0.72, ambI: 0.5,  night: 0 },
  { t: 0.86, top: 0x3a7cc8, hor: 0xa8d0ec, fog: 0xb2cee4, glow: 0xffe8c0, cLit: 0xffffff, cDark: 0xaebed4, sun: 0xffdcb0, sunI: 2.55, hemiI: 0.68, ambI: 0.5,  night: 0.02 },
  { t: 0.94, top: 0x3a5aa0, hor: 0xffcf9e, fog: 0xe0bc9e, glow: 0xffb060, cLit: 0xffe0b0, cDark: 0x9a8a9e, sun: 0xffc890, sunI: 2.45, hemiI: 0.6,  ambI: 0.42, night: 0.08 },
  // t=1.0 回到黄昏，保证循环无缝
  { t: 1.0,  top: 0x2b3a7a, hor: 0xffa062, fog: 0xd98c6c, glow: 0xff7a3c, cLit: 0xffb27c, cDark: 0x74507a, sun: 0xffb483, sunI: 2.3, hemiI: 0.55, ambI: 0.36, night: 0.18 },
];

const GROUND_DAY = new THREE.Color(0x8a7a5c);
const GROUND_NIGHT = new THREE.Color(0x10141e);

function smooth(u) {
  return u * u * (3 - 2 * u);
}

const DOME_FRAG = `
  uniform vec3 topColor;
  uniform vec3 horColor;
  uniform vec3 glowColor;
  uniform vec3 cloudLit;
  uniform vec3 cloudDark;
  uniform vec3 sunDir;
  uniform vec3 moonDir;
  uniform float sunVis;
  uniform float night;
  uniform float time;
  varying vec3 vPos;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vPos);
    float h = d.y;
    float hc = max(h, 0.0);

    // 三段渐变：地平线 → 过渡色 → 天顶
    vec3 mid = mix(horColor, topColor, 0.42);
    vec3 col = mix(horColor, mid, smoothstep(0.0, 0.3, hc));
    col = mix(col, topColor, smoothstep(0.22, 0.85, hc));
    // 地平线以下（被海面遮挡的部分）略压暗，避免远端接缝发亮
    col = mix(col, horColor * 0.75, smoothstep(0.0, -0.08, h));

    // 太阳：大范围暖色光晕 + 贴地平线横向铺开的辉光（日落时最强）+ 柔边日轮
    float sd = max(dot(d, sunDir), 0.0);
    float lowSun = 1.0 - smoothstep(0.05, 0.45, sunDir.y);
    vec2 dh = normalize(d.xz + 1e-5), sh = normalize(sunDir.xz + 1e-5);
    float az = max(dot(dh, sh), 0.0);
    // 日轮落下后辉光仍残留一阵（暮光），日轮本身只在地平线以上可见
    float glowVis = smoothstep(-0.32, 0.0, sunDir.y);
    col += glowColor * (pow(sd, 6.0) * 0.5 + pow(sd, 48.0) * 0.7) * glowVis;
    col += glowColor * pow(az, 3.0) * exp(-hc * 6.0) * 0.6 * lowSun * glowVis;
    float disc = smoothstep(0.99935, 0.99975, sd);
    col = mix(col, vec3(1.0, 0.96, 0.86) + glowColor * 0.2, disc * sunVis);

    // 月晕
    float md = max(dot(d, moonDir), 0.0);
    col += vec3(0.55, 0.65, 0.9) * (pow(md, 24.0) * 0.18 + pow(md, 400.0) * 0.4) * night;

    // 云层：把视线投影到一个高空平面上做 fbm，缓慢漂移；靠近太阳一侧被染亮
    if (h > -0.02) {
      vec2 uv = d.xz / (h + 0.18) * 0.55 + vec2(time * 0.006, time * 0.0025);
      float n = fbm(uv * 1.2);
      float n2 = fbm(uv * 3.1 + 5.0);
      float c = smoothstep(0.5, 0.78, n * 0.75 + n2 * 0.35);
      c *= smoothstep(-0.02, 0.1, h) * (1.0 - 0.55 * smoothstep(0.35, 0.9, h));
      float lit = clamp(pow(sd, 3.0) * 0.9 + (n2 - 0.35) * 0.6 + 0.15, 0.0, 1.0);
      vec3 cc = mix(cloudDark, cloudLit, lit);
      // 云的亮边（银边/火烧云）
      cc += glowColor * pow(sd, 12.0) * 0.6 * glowVis * (1.0 - c);
      col = mix(col, cc, c * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const STAR_VERT = `
  attribute float aSize;
  attribute float aPhase;
  uniform float time;
  varying float vTw;
  void main() {
    vTw = 0.6 + 0.4 * sin(time * (1.3 + aPhase * 2.1) + aPhase * 40.0);
    gl_PointSize = aSize * (0.75 + 0.35 * vTw);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STAR_FRAG = `
  uniform float opacity;
  varying float vTw;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r = length(p);
    float a = smoothstep(0.5, 0.0, r);
    a = a * a;
    gl_FragColor = vec4(vec3(0.88, 0.92, 1.0), a * opacity * vTw);
  }`;

export class Sky {
  constructor(scene, camera) {
    this.scene = scene;
    this.time = 0;          // 一轮内的相位 [0,1)
    this.night = 0;         // 平滑后的夜晚系数
    this.clock = 0;         // 连续秒数（云漂移/星闪烁）
    this.sunWorld = new THREE.Vector3();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3(0.4, 0.8, 0.3);
    this.skyTop = new THREE.Color(0x2b3a7a);
    this.skyHor = new THREE.Color(0xffa062);
    this.glow = new THREE.Color(0xff7a3c);
    this._cA = new THREE.Color();
    this._cB = new THREE.Color();
    this._prevT = null;

    // ---- 天空穹顶 ----
    this.uniforms = {
      topColor: { value: this.skyTop },
      horColor: { value: this.skyHor },
      glowColor: { value: this.glow },
      cloudLit: { value: new THREE.Color(0xffb27c) },
      cloudDark: { value: new THREE.Color(0x74507a) },
      sunDir: { value: this.sunDir },
      moonDir: { value: this.moonDir },
      sunVis: { value: 1 },
      night: { value: 0 },
      time: { value: 0 },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(520, 32, 20),
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
        fragmentShader: DOME_FRAG,
      })
    );
    dome.renderOrder = -2;
    scene.add(dome);

    // ---- 月亮（日轮由穹顶着色器绘制）----
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(15, 32),
      new THREE.MeshBasicMaterial({ color: 0xeef2fc, fog: false, transparent: true })
    );
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xc8d2e8, fog: false, transparent: true, opacity: 0.8 });
    for (const [cx, cy, r] of [[4, 3.5, 3.2], [-5, -2.5, 2.4], [1.5, -6, 1.9], [-2, 5.5, 1.3]]) {
      const c = new THREE.Mesh(new THREE.CircleGeometry(r, 16), craterMat);
      c.position.set(cx, cy, 0.3);
      this.moon.add(c);
    }
    this.moon.renderOrder = -1;
    scene.add(this.moon);

    // ---- 星星：随机大小与闪烁相位 ----
    const n = 700;
    const arr = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const az = Math.random() * Math.PI * 2;
      const el = Math.asin(0.04 + Math.random() * 0.96);
      const r = 470;
      arr[i * 3] = Math.cos(el) * Math.cos(az) * r;
      arr[i * 3 + 1] = Math.sin(el) * r;
      arr[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r;
      const big = Math.random();
      size[i] = big > 0.96 ? 4.5 : big > 0.8 ? 3.2 : 2.2;
      phase[i] = Math.random();
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { opacity: { value: 0 }, time: { value: 0 } };
    this.stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.stars.renderOrder = -1;
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
    this.dirLight.shadow.normalBias = 0.03;
    this.dirLight.shadow.radius = 4;
    scene.add(this.dirLight);
    scene.add(this.dirLight.target);

    this.hemi = new THREE.HemisphereLight(0x8a7ba0, 0x3a4a3f, 0.5);
    scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(this.amb);

    this._camera = camera;
    this._fog = new THREE.Fog(0xd98a70, 45, 300);
    scene.fog = this._fog;
  }

  // t ∈ [0,1) 相位；rigPos 用来让阴影相机跟着主角走
  update(t, rigPos) {
    if (this._prevT !== null) this.clock += (((t - this._prevT) % 1) + 1) % 1 * CYCLE;
    this._prevT = t;
    this.time = t;
    let i = 0;
    while (i < KF.length - 1 && !(t >= KF[i].t && t < KF[i + 1].t)) i++;
    const a = KF[i];
    const b = KF[Math.min(i + 1, KF.length - 1)];
    const span = Math.max(b.t - a.t, 1e-5);
    const u = smooth(Math.min(Math.max((t - a.t) / span, 0), 1));
    const mix = (key, target) => target.setHex(a[key]).lerp(this._cA.setHex(b[key]), u);

    const U = this.uniforms;
    mix('top', this.skyTop);
    mix('hor', this.skyHor);
    mix('glow', this.glow);
    mix('cLit', U.cloudLit.value);
    mix('cDark', U.cloudDark.value);
    mix('fog', this._fog.color);
    mix('sun', this.dirLight.color);
    this.dirLight.intensity = lerp(a.sunI, b.sunI, u);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, u);
    this.amb.intensity = lerp(a.ambI, b.ambI, u);
    this.night = lerp(a.night, b.night, u);
    // 半球光：天空侧取天色，地面侧从暖沙色过渡到夜色（地面反弹光）
    this.hemi.color.copy(this.skyTop).lerp(this._cB.set(0xffffff), 0.35);
    this.hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, this.night);
    this.amb.color.copy(this.skyHor).lerp(this._cB.set(0xffffff), 0.6);

    // 太阳 / 月亮在天空圆弧上的位置（相位 0 = 黄昏太阳在地平线）
    const ph = t * Math.PI * 2;
    this.sunWorld.set(Math.cos(ph) * 300, -Math.sin(ph) * 330, 130);
    this.sunDir.copy(this.sunWorld).normalize();
    this.moonDir.set(-Math.cos(ph) * 300, Math.sin(ph) * 330, 130).normalize();
    this.moon.position.copy(this.moonDir).multiplyScalar(440);
    if (this._camera) this.moon.lookAt(this._camera.position);
    this.moon.visible = this.moonDir.y > -0.08;
    const moonFade = Math.min(1, Math.max(0, this.night * 1.4 - 0.1));
    this.moon.material.opacity = 0.25 + 0.75 * moonFade;
    for (const c of this.moon.children) c.material.opacity = 0.8 * moonFade;

    U.sunVis.value = Math.min(1, Math.max(0, (this.sunDir.y + 0.12) / 0.14));
    U.night.value = this.night;
    U.time.value = this.clock;
    this.starUniforms.opacity.value = Math.max(0, this.night - 0.25) / 0.75;
    this.starUniforms.time.value = this.clock;

    // 主光：白天跟太阳、夜晚跟月亮，平滑过渡
    this.lightDir.copy(this.sunDir).lerp(this._moonDir(), this.night).normalize();
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

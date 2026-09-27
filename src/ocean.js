// 大海：GPU 顶点波浪（多层涌浪 + 近岸向岸推进的卷浪），片元里做深浅水渐变、
// 菲涅尔天空反射、日/月光斑、浪尖白沫与破浪泡沫；沙滩上另有一层“冲流”
// （浪花冲上沙滩再退回、留下湿沙痕）；破浪处周期性溅起水花粒子。
// 海面相位随骑行距离滚动，与公路同速后退。
import * as THREE from '../vendor/three.module.js';
import { rand } from './utils.js';
import { Particles } from './fish.js';

const SHORE_Z = 15.5;     // 海岸线（世界坐标，沙滩在路侧 6.7 ~ 15.5）
const OCEAN_DEPTH = 190;  // 海面纵深

const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// 波函数：x 已加上滚动距离。返回 (高度, 破浪强度)
const WAVE_GLSL = `
  uniform float time;
  uniform float scroll;
  const float SHORE = ${SHORE_Z.toFixed(2)};
  vec2 wave(float x, float z) {
    float dz = z - SHORE;
    float far = 0.35 + 0.65 * smoothstep(0.0, 9.0, dz); // 贴岸处大涌浪收敛
    float h = far * (
      0.42 * sin(0.13 * x + time * 1.4) +
      0.3 * sin(0.075 * z - time * 1.05) +
      0.16 * sin(0.31 * (x + z * 0.6) + time * 2.1)) +
      0.06 * sin(0.52 * x - time * 2.6) +
      0.05 * sin(0.61 * (z * 0.8 - x * 0.3) + time * 2.2) +
      0.035 * sin(1.3 * x + 0.7 * z + time * 3.3);
    // 近岸卷浪：波峰沿 -z 推向岸边，尖峰形；在离岸 2~30m 带里最明显
    float env = smoothstep(0.5, 4.0, dz) * (1.0 - smoothstep(14.0, 34.0, dz));
    float ph = 0.5 * dz + time * 1.7 + sin(x * 0.045) * 1.3;
    float crest = pow(0.5 + 0.5 * sin(ph), 4.0);
    float swell = env * crest * (0.75 + 0.25 * sin(x * 0.08 + time * 0.35));
    h += swell * 0.62;
    return vec2(h, swell);
  }
`;

const OCEAN_VERT = `
  ${WAVE_GLSL}
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vH;
  varying float vBreak;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float x = wp.x + scroll;
    vec2 w = wave(x, wp.z);
    float e = 0.35;
    float hx = wave(x + e, wp.z).x;
    float hz = wave(x, wp.z + e).x;
    vN = normalize(vec3(-(hx - w.x) / e, 1.0, -(hz - w.x) / e));
    wp.y += w.x;
    vH = w.x;
    vBreak = w.y;
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const OCEAN_FRAG = `
  uniform float time;
  uniform float scroll;
  uniform vec3 skyTop;
  uniform vec3 skyHor;
  uniform vec3 glowColor;
  uniform vec3 lightDir;
  uniform vec3 lightColor;
  uniform vec3 ambient;
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform float night;
  varying vec3 vWorld;
  varying vec3 vN;
  varying float vH;
  varying float vBreak;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  const float SHORE = ${SHORE_Z.toFixed(2)};

  void main() {
    vec2 p = vec2(vWorld.x + scroll, vWorld.z);
    float dist = length(cameraPosition - vWorld);
    // 细碎涟漪：两层滚动噪声扰动法线（远处淡出防闪烁）
    float fade = 1.0 - smoothstep(25.0, 120.0, dist);
    float n1 = noise(p * vec2(0.9, 1.3) + vec2(time * 0.6, -time * 0.4));
    float n2 = noise(p * vec2(2.3, 1.9) - vec2(time * 0.9, time * 0.5));
    vec3 N = normalize(vN + vec3(n1 - 0.5, 0.0, n2 - 0.5) * 0.35 * fade);

    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);

    // 天空反射（与穹顶同一套颜色，太阳方向带辉光）
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = mix(skyHor, skyTop, smoothstep(0.0, 0.55, R.y));
    sky += glowColor * pow(max(dot(R, lightDir), 0.0), 6.0) * 0.6 * (1.0 - night);

    // 水体：近岸浅绿蓝 → 远海深蓝；背光浪峰透出浅色（次表面散射感）
    float dz = vWorld.z - SHORE;
    float shallow = 1.0 - smoothstep(0.0, 22.0, dz);
    vec3 water = mix(deepColor, shallowColor, shallow);
    float sss = pow(max(dot(V, -lightDir) * 0.5 + 0.5, 0.0), 3.0) * smoothstep(0.1, 1.0, vH);
    water += shallowColor * sss * 0.5;
    float diff = max(dot(N, lightDir), 0.0) * 0.35 + 0.65;
    vec3 col = water * (ambient + lightColor * 0.35) * diff;
    col = mix(col, sky, fres * 0.9);

    // 日光/月光斑：锐利高光 + 宽柔光带
    vec3 H = normalize(lightDir + V);
    float nh = max(dot(N, H), 0.0);
    col += lightColor * (pow(nh, 320.0) * 5.0 + pow(nh, 36.0) * 0.18);

    // 泡沫：浪尖白沫 + 卷浪破碎泡沫 + 贴岸泡沫带（均为噪声镂空的蕾丝状）
    float lace = noise(p * vec2(1.6, 2.4) + vec2(0.0, time * 0.8)) * 0.6
               + noise(p * vec2(4.2, 5.0) - vec2(time * 0.5, 0.0)) * 0.4;
    float crestFoam = smoothstep(0.82, 1.15, vH + lace * 0.4);
    float breakFoam = smoothstep(0.45, 0.85, vBreak + lace * 0.35) * smoothstep(0.0, 1.5, dz);
    float trail = smoothstep(0.25, 0.6, vBreak) * smoothstep(0.55, 0.75, lace) * 0.6;
    float shoreFoam = (1.0 - smoothstep(0.0, 1.2 + lace * 2.2, dz)) * smoothstep(0.35, 0.6, lace + 0.2);
    float foam = clamp(crestFoam * 0.7 + breakFoam + trail + shoreFoam, 0.0, 1.0) * (0.35 + 0.65 * fade);
    vec3 foamCol = vec3(0.95, 0.98, 1.0) * (ambient + lightColor * 0.55);
    col = mix(col, foamCol, foam);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// 沙滩冲流：浪头冲上沙滩再退回，前沿是一条亮白泡沫线，身后留下渐干的湿沙
const SWASH_VERT = `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const SWASH_FRAG = `
  uniform float time;
  uniform float scroll;
  uniform vec3 ambient;
  uniform vec3 lightColor;
  uniform vec3 shallowColor;
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  const float SHORE = ${SHORE_Z.toFixed(2)};
  void main() {
    float x = vWorld.x + scroll;
    float z = vWorld.z;
    // 冲流前沿：周期往复 + 沿岸方向起伏，退潮时比涨潮慢（锯齿形相位）
    float ph = fract(time * 0.16 + sin(x * 0.035) * 0.18 + noise(vec2(x * 0.06, 3.0)) * 0.25);
    float reach = ph < 0.35 ? smoothstep(0.0, 0.35, ph) : 1.0 - smoothstep(0.35, 1.0, ph);
    float edge = SHORE - 0.4 - reach * (2.6 + 0.9 * noise(vec2(x * 0.1, 7.0)));
    float maxEdge = SHORE - 0.4 - 3.5;
    float lace = noise(vec2(x * 1.7, z * 2.2) + vec2(0.0, time * 0.7));
    float d = z - edge; // >0 在水里
    float sheet = smoothstep(-0.05, 0.25, d);
    float line = (1.0 - smoothstep(0.0, 0.35 + lace * 0.25, abs(d - 0.12))) * (0.5 + 0.5 * reach);
    float bubbles = sheet * smoothstep(0.55, 0.8, lace) * (1.0 - smoothstep(0.5, 2.5, d));
    // 湿沙：最高冲上点到当前前沿之间偏暗
    float wet = (1.0 - sheet) * smoothstep(maxEdge - 0.6, maxEdge + 0.8, z);
    vec3 lit = ambient + lightColor * 0.5;
    vec3 water = shallowColor * 1.15 * lit;
    vec3 foam = vec3(0.96, 0.98, 1.0) * lit;
    vec3 col = mix(vec3(0.33, 0.27, 0.18) * lit, water, sheet);
    float a = wet * 0.32 + sheet * 0.42 * (1.0 - smoothstep(SHORE, SHORE + 1.4, z));
    float f = clamp(line + bubbles * 0.7, 0.0, 1.0);
    col = mix(col, foam, f);
    a = max(a, f * 0.95);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const DAY_DEEP = new THREE.Color(0x0b4a78);
const DAY_SHALLOW = new THREE.Color(0x2fb5b8);
const NIGHT_DEEP = new THREE.Color(0x03101f);
const NIGHT_SHALLOW = new THREE.Color(0x0d3a4c);

export class Ocean {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(420, OCEAN_DEPTH, 240, 110);
    geo.rotateX(-Math.PI / 2);

    const fog = THREE.UniformsLib.fog;
    this.uniforms = THREE.UniformsUtils.merge([fog, {
      time: { value: 0 },
      scroll: { value: 0 },
      skyTop: { value: new THREE.Color(0x2b3a7a) },
      skyHor: { value: new THREE.Color(0xffa062) },
      glowColor: { value: new THREE.Color(0xff7a3c) },
      lightDir: { value: new THREE.Vector3(0.6, 0.3, 0.3).normalize() },
      lightColor: { value: new THREE.Color(0xffc49a) },
      ambient: { value: new THREE.Color(0x505060) },
      deepColor: { value: DAY_DEEP.clone() },
      shallowColor: { value: DAY_SHALLOW.clone() },
      night: { value: 0 },
    }]);
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(0, -0.12, SHORE_Z + OCEAN_DEPTH / 2); // 覆盖 z ∈ [15.5, 205.5]
    this.mesh.frustumCulled = false; // 顶点在着色器里位移，包围盒不准
    scene.add(this.mesh);

    // 冲流层：共用海面的时间/光照 uniform 对象
    const U = this.uniforms;
    const swashGeo = new THREE.PlaneGeometry(420, 7.5, 1, 1);
    swashGeo.rotateX(-Math.PI / 2);
    this.swash = new THREE.Mesh(swashGeo, new THREE.ShaderMaterial({
      uniforms: {
        fogColor: U.fogColor, fogNear: U.fogNear, fogFar: U.fogFar,
        fogDensity: U.fogDensity,
        time: U.time, scroll: U.scroll, ambient: U.ambient,
        lightColor: U.lightColor, shallowColor: U.shallowColor,
      },
      vertexShader: SWASH_VERT,
      fragmentShader: SWASH_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    }));
    this.swash.position.set(0, 0.03, SHORE_Z - 2.2);
    this.swash.renderOrder = 1;
    scene.add(this.swash);

    // 破浪水花
    this.spray = new Particles(scene, 160, 0xf4fbff, 0.16);
    this.spray.points.material.opacity = 0.75;
    this._sprayT = 0;
    this._lastDist = null;
    this._sp = new THREE.Vector3();
  }

  // time: 游戏时间；dist: 累计骑行距离（海面相位随之滚动）；sky: 取颜色与光照
  update(time, dist, sky) {
    const U = this.uniforms;
    U.time.value = time;
    const d = dist || 0;
    U.scroll.value = d % 4000;

    if (sky) {
      U.skyTop.value.copy(sky.skyTop);
      U.skyHor.value.copy(sky.skyHor);
      U.glowColor.value.copy(sky.glow);
      U.night.value = sky.night;
      U.lightDir.value.copy(sky.lightDir);
      U.lightColor.value.copy(sky.dirLight.color).multiplyScalar(sky.dirLight.intensity * 0.45);
      U.ambient.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.55)
        .add(this._tmpC().copy(sky.amb.color).multiplyScalar(sky.amb.intensity * 0.35));
      U.deepColor.value.copy(DAY_DEEP).lerp(NIGHT_DEEP, sky.night);
      U.shallowColor.value.copy(DAY_SHALLOW).lerp(NIGHT_SHALLOW, sky.night);
    }
    // 水花：沿破浪带随机溅起，并跟着世界一起后退
    const dt = this._lastT === undefined ? 0 : Math.min(Math.max(time - this._lastT, 0), 0.1);
    this._lastT = time;
    const moved = this._lastDist === null ? 0 : d - this._lastDist;
    this._lastDist = d;
    this._sprayT -= dt;
    if (this._sprayT <= 0) {
      this._sprayT = rand(0.12, 0.35);
      this._sp.set(rand(-6, 45), rand(0.1, 0.45), SHORE_Z + rand(0.8, 4.5));
      this.spray.burst(this._sp, Math.floor(rand(4, 9)), 0.9, 2.6);
    }
    this.spray.update(dt);
    if (moved) {
      const pos = this.spray.pos;
      for (let i = 0; i < this.spray.count; i++) pos[i * 3] -= moved;
    }
  }

  _tmpC() {
    return this._c || (this._c = new THREE.Color());
  }
}

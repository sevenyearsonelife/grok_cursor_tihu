// 冒烟测试：在 Node 里直接实例化所有纯 3D 模块并推进若干帧，
// 捕捉 API 拼写错误、不存在的构造参数等问题（DOM/音频模块不在此测）。
import * as THREE from '../vendor/three.module.js';
import { Sky } from '../src/sky.js';
import { Road } from '../src/road.js';
import { Ocean } from '../src/ocean.js';
import { Bicycle } from '../src/bicycle.js';
import { Pelican } from '../src/pelican.js';
import { FishManager } from '../src/fish.js';
import { Scarf } from '../src/scarf.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1500);
const rig = new THREE.Group();
scene.add(rig);

let sky, bike;
let ok = 0;
const step = (name, fn) => {
  fn();
  ok++;
  console.log(`  ✓ ${name}`);
};

step('Sky 构建', () => {
  sky = new Sky(scene, camera);
});
step('Road 构建', () => new Road(scene));
step('Ocean 构建 + 波浪推进', () => {
  const ocean = new Ocean(scene);
  ocean.update(1.0);
});
step('Bicycle 构建 + 更新', () => {
  bike = new Bicycle();
  rig.add(bike.group);
  bike.update(0.016, 8, 0.3);
  bike.ring();
  bike.update(0.016, 8, 0);
});
step('Pelican 构建 + IK/围巾更新', () => {
  const p = new Pelican();
  p.group.position.set(-0.36, 1.02, 0);
  rig.add(p.group);
  rig.updateMatrixWorld(true);
  const footL = new THREE.Vector3();
  const footR = new THREE.Vector3();
  bike.pedalL.getWorldPosition(footL);
  bike.pedalR.getWorldPosition(footR);
  for (let i = 0; i < 30; i++) {
    p.update({
      dt: 0.016,
      time: i * 0.016,
      speedNorm: 0.5,
      airborne: false,
      pedalPhase: i * 0.2,
      footL,
      footR,
    });
  }
  p.react();
  const mouth = new THREE.Vector3();
  p.getMouthWorld(mouth);
  if (!isFinite(mouth.x)) throw new Error('mouth 坐标非法');
});
step('Scarf 单独构建', () => {
  const holder = new THREE.Group();
  new Scarf(holder, new THREE.Vector3(0, 0, 0), 0xcc2222).update(0.016, { x: -3, y: 0.5, z: 0.2 });
});
step('FishManager 构建 + 推进（触发生成/粒子）', () => {
  const fm = new FishManager(scene);
  const mouth = new THREE.Vector3(0, 2, 0);
  for (let i = 0; i < 600; i++) {
    fm.update({ dt: 0.016, time: i * 0.016, mouth, pelicanZ: 0, canCatch: true, onCatch: () => {} });
  }
});
step('昼夜循环整轮推进（阴影目标跟随）', () => {
  const rigPos = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i <= 100; i++) {
    sky.update(i / 100, rigPos);
  }
  if (!isFinite(sky.dirLight.position.x)) throw new Error('灯光位置非法');
});
step('场景图完整性', () => {
  scene.updateMatrixWorld(true);
  if (scene.children.length < 5) throw new Error('场景对象过少');
});

console.log(`\n全部 ${ok} 项冒烟检查通过 ✅`);

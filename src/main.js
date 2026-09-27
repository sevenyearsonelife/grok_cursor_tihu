// 入口：创建渲染器/场景，搭建各系统，rAF 统一驱动
import * as THREE from '../vendor/three.module.js';
import { Game } from './game.js';
import { AudioManager } from './audio.js';
import { HUD } from './hud.js';
import { Input } from './input.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.display = 'block';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1500
);
camera.position.set(-7, 3.5, 7);

const audio = new AudioManager();
const hud = new HUD();
const input = new Input(hud);
const game = new Game(scene, camera, audio, hud, input);

// 点击画布：接鱼 / 戳鹈鹕（HUD 按钮自带 pointer-events，不会冒泡到这里）
renderer.domElement.addEventListener('pointerdown', (e) => {
  input.humanActivity = true;
  if (game.running) game.handleClick(e.clientX, e.clientY);
});

hud.showStart(() => {
  audio.ensure(); // 必须在用户手势里创建 AudioContext
  game.start();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- 主循环 ----
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  game.update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

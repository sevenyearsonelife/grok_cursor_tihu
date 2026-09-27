// 通用小工具：几何辅助 + 数学函数
import * as THREE from '../vendor/three.module.js';

// 在 p1、p2 之间放一根圆柱（车架管、脖子、栏杆等）
export function tube(p1, p2, r, material, r2) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r2 !== undefined ? r2 : r, r, len, 8),
    material
  );
  mesh.position.copy(p1).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize()
  );
  return mesh;
}

export function rand(a, b) {
  return a + Math.random() * (b - a);
}

export function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

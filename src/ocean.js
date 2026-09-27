// 大海：大平面 + 顶点级正弦波动画（flatShading 出低多边形海面风格），岸边泡沫线
import * as THREE from '../vendor/three.module.js';

const SHORE_Z = 15.5;     // 海岸线（世界坐标，沙滩在路侧 6.7 ~ 15.5）
const OCEAN_DEPTH = 190;  // 海面纵深

// 海面与泡沫共用的同一套波函数，保证泡沫始终贴着浪走
function waveY(x, z, t) {
  return (
    0.48 * Math.sin(0.13 * x + t * 1.4) +
    0.33 * Math.sin(0.075 * z - t * 1.05) +
    0.18 * Math.sin(0.31 * (x + z * 0.6) + t * 2.1)
  );
}

export class Ocean {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(420, OCEAN_DEPTH, 84, 36);
    geo.rotateX(-Math.PI / 2); // 顶点直接落在 XZ 平面，方便动 y
    this.base = geo.attributes.position.array.slice(); // 保存原始 x/z
    this.geo = geo;

    this.mat = new THREE.MeshPhongMaterial({
      color: 0x1878a8,
      specular: 0xbfe8ff,
      shininess: 90,
      flatShading: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(0, -0.12, SHORE_Z + OCEAN_DEPTH / 2); // 覆盖 z ∈ [15.5, 205.5]
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // 岸边泡沫：三条浪花带，顶点随波面起伏 + 沿 z 前后拍岸
    this.foams = [];
    for (let i = 0; i < 3; i++) {
      const fgeo = new THREE.PlaneGeometry(420, 1.3, 84, 1);
      fgeo.rotateX(-Math.PI / 2);
      const foam = new THREE.Mesh(
        fgeo,
        new THREE.MeshBasicMaterial({
          color: 0xf2fdff,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        })
      );
      foam.renderOrder = 1; // 半透明泡沫画在海面之后
      scene.add(foam);
      this.foams.push({
        mesh: foam,
        geo: fgeo,
        base: fgeo.attributes.position.array.slice(),
        z0: SHORE_Z + 0.8 + i * 2.7, // 各带的基准岸距
        phase: i * 2.1,
      });
    }
  }

  update(time) {
    // 海面顶点波浪
    const pos = this.geo.attributes.position;
    const base = this.base;
    const oz = this.mesh.position.z;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2] + oz; // 世界坐标 z 参与波动相位
      pos.setY(i, waveY(x, z, time));
    }
    pos.needsUpdate = true;

    // 泡沫：贴着波面（略抬高避免被浪峰盖住），沿 z 往复拍岸
    for (const f of this.foams) {
      const fp = f.geo.attributes.position;
      const fb = f.base;
      const fz = f.z0 + Math.sin(time * 0.8 + f.phase) * 0.9;
      for (let i = 0; i < fp.count; i++) {
        const x = fb[i * 3];
        fp.setY(i, waveY(x, fz, time) * 0.85 + 0.16);
      }
      fp.needsUpdate = true;
      f.mesh.position.set(0, -0.12, fz);
      f.mesh.material.opacity = 0.3 + 0.16 * Math.sin(time * 1.6 + f.phase);
    }
  }
}

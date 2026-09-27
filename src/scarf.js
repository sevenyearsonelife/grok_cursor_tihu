// 红围巾：简化版 Verlet 布料（质点网格 + 距离约束），挂在脖子上随风/车速飘
import * as THREE from '../vendor/three.module.js';

const ROWS = 7;   // 沿长度方向的质点行数（第 0 行钉在脖子上）
const COLS = 2;   // 宽度方向 2 个质点（一条窄带）
const SEG = 0.085; // 长度方向间距
const WID = 0.09;  // 宽度方向间距
const DAMP = 0.984;

export class Scarf {
  // attach: 挂点在 parent 局部空间的位置；scarf 网格也建在 parent 局部空间
  constructor(parent, attach, color) {
    this.attach = attach.clone();
    this.parent = parent;

    // 质点初始化：从挂点向 -x（身后）延伸，略微下垂
    this.pts = [];
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        const p = new THREE.Vector3(
          this.attach.x - i * SEG,
          this.attach.y - i * 0.03,
          this.attach.z + (j - (COLS - 1) / 2) * WID
        );
        this.pts.push({ p: p.clone(), pp: p.clone(), pin: i === 0 });
      }
    }
    const idx = (i, j) => i * COLS + j;

    // 结构约束（沿长度 / 沿宽度）
    this.cons = [];
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLS; j++) {
        if (i + 1 < ROWS) this.cons.push([idx(i, j), idx(i + 1, j), SEG]);
        if (j + 1 < COLS) this.cons.push([idx(i, j), idx(i, j + 1), WID]);
      }
    }

    // 渲染网格：ROWS x COLS 顶点，每格两个三角形
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.pts.length * 3), 3)
    );
    const indices = [];
    for (let i = 0; i < ROWS - 1; i++) {
      for (let j = 0; j < COLS - 1; j++) {
        const a = idx(i, j), b = idx(i, j + 1), c = idx(i + 1, j), d = idx(i + 1, j + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(indices);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: color !== undefined ? color : 0xe23b30,
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this._tmp = new THREE.Vector3();
    this._writeGeometry();
  }

  // 给所有质点一个瞬时冲量（鹈鹕被戳、落地时用）
  kick(x, y, z) {
    for (const pt of this.pts) {
      if (pt.pin) continue;
      pt.pp.x -= x;
      pt.pp.y -= y;
      pt.pp.z -= z;
    }
  }

  update(dt, wind /* Vector3: 局部空间风加速度 */) {
    const step = Math.min(dt, 1 / 30);
    const ax = wind.x, ay = wind.y - 5.5, az = wind.z; // ay 里含重力
    const dt2 = step * step;

    for (const pt of this.pts) {
      if (pt.pin) continue;
      const px = pt.p.x, py = pt.p.y, pz = pt.p.z;
      pt.p.x += (px - pt.pp.x) * DAMP + ax * dt2;
      pt.p.y += (py - pt.pp.y) * DAMP + ay * dt2;
      pt.p.z += (pz - pt.pp.z) * DAMP + az * dt2;
      pt.pp.set(px, py, pz);
    }

    // 约束迭代：解距离约束，钉住第 0 行
    for (let iter = 0; iter < 3; iter++) {
      for (const [ia, ib, rest] of this.cons) {
        const a = this.pts[ia], b = this.pts[ib];
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d * 0.5;
        const ox = dx * diff, oy = dy * diff, oz = dz * diff;
        if (!a.pin) { a.p.x += ox; a.p.y += oy; a.p.z += oz; }
        if (!b.pin) { b.p.x -= ox; b.p.y -= oy; b.p.z -= oz; }
      }
      // 钉住端
      for (let j = 0; j < COLS; j++) {
        const pt = this.pts[j];
        pt.p.copy(this.attach);
        pt.p.z += (j - (COLS - 1) / 2) * WID;
        pt.pp.copy(pt.p);
      }
    }

    this._writeGeometry();
  }

  _writeGeometry() {
    const attr = this.mesh.geometry.attributes.position;
    for (let i = 0; i < this.pts.length; i++) {
      attr.setXYZ(i, this.pts[i].p.x, this.pts[i].p.y, this.pts[i].p.z);
    }
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

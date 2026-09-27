// 红围巾：Verlet 布料（质点网格 + 结构/剪切/弯曲约束），挂在脖子上随风/车速飘。
// 飘带沿长度方向有行波式抖动（越靠末端越明显），并受鹈鹕整体加速度的惯性影响
// （起跳、落地、变道时甩动），与身体球形碰撞体做穿插修正。末端带两道白条纹。
import * as THREE from '../vendor/three.module.js';

const GRAV = -6.2;

export class Scarf {
  // attach: 挂点在 parent 局部空间的位置；scarf 网格也建在 parent 局部空间
  // opts: { rows, cols, seg, wid, seed }
  constructor(parent, attach, color, opts) {
    const o = opts || {};
    this.rows = o.rows || 11;
    this.cols = o.cols || 3;
    this.seg = o.seg || 0.075;
    this.wid = o.wid || 0.05;
    this.seed = o.seed || 0;
    this.attach = attach.clone();
    this.parent = parent;
    this.time = 0;
    const R = this.rows, C = this.cols;

    // 宽度随长度略收窄
    this._colOff = (i, j) => (j - (C - 1) / 2) * this.wid * (1 - 0.3 * i / (R - 1));

    this.pts = [];
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        const p = new THREE.Vector3(
          this.attach.x - i * this.seg,
          this.attach.y - i * 0.025,
          this.attach.z + this._colOff(i, j)
        );
        this.pts.push({ p: p.clone(), pp: p.clone(), pin: i === 0, row: i });
      }
    }
    const idx = (i, j) => i * C + j;
    this._idx = idx;

    // 约束：[a, b, 静止长度, 刚度]
    this.cons = [];
    const link = (a, b, k) => {
      this.cons.push([a, b, this.pts[a].p.distanceTo(this.pts[b].p), k]);
    };
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        if (i + 1 < R) link(idx(i, j), idx(i + 1, j), 1);
        if (j + 1 < C) link(idx(i, j), idx(i, j + 1), 1);
        if (i + 1 < R && j + 1 < C) {
          link(idx(i, j), idx(i + 1, j + 1), 0.6);
          link(idx(i, j + 1), idx(i + 1, j), 0.6);
        }
        if (i + 2 < R) link(idx(i, j), idx(i + 2, j), 0.25);
      }
    }

    // 渲染网格
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pts.length * 3), 3));
    const cols = new Float32Array(this.pts.length * 3);
    const base = new THREE.Color(color !== undefined ? color : 0xe23b30);
    const white = new THREE.Color(0xfff4ea);
    const dark = base.clone().multiplyScalar(0.72);
    const c = new THREE.Color();
    for (let i = 0; i < R; i++) {
      const u = i / (R - 1);
      const stripe = (u > 0.62 && u < 0.7) || (u > 0.8 && u < 0.87);
      for (let j = 0; j < C; j++) {
        const edge = j === 0 || j === C - 1;
        c.copy(stripe ? white : base);
        if (edge && !stripe) c.lerp(dark, 0.35);
        const k = idx(i, j) * 3;
        cols[k] = c.r; cols[k + 1] = c.g; cols[k + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const indices = [];
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < C - 1; j++) {
        const a = idx(i, j), b = idx(i, j + 1), cc = idx(i + 1, j), d = idx(i + 1, j + 1);
        indices.push(a, cc, b, b, cc, d);
      }
    }
    geo.setIndex(indices);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.85,
        metalness: 0,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this._writeGeometry();
  }

  setAttach(v) {
    this.attach.copy(v);
  }

  // 给所有质点一个瞬时冲量（鹈鹕被戳、落地时用）
  kick(x, y, z) {
    for (const pt of this.pts) {
      if (pt.pin) continue;
      const k = 0.4 + 0.6 * pt.row / (this.rows - 1);
      pt.pp.x -= x * k * 0.05;
      pt.pp.y -= y * k * 0.05;
      pt.pp.z -= z * k * 0.05;
    }
  }

  // wind: 局部空间风加速度 {x,y,z}；opts: { inertia?: Vector3, colliders?: [{c, r}], speed?: 0~1 }
  update(dt, wind, opts) {
    const o = opts || {};
    const frame = Math.min(dt, 1 / 30);
    const SUB = 2;
    const step = frame / SUB;
    const dt2 = step * step;
    const inx = o.inertia ? o.inertia.x : 0;
    const iny = o.inertia ? o.inertia.y : 0;
    const inz = o.inertia ? o.inertia.z : 0;
    const speed = o.speed || 0;
    const R = this.rows, C = this.cols;
    const damp = 0.992 - speed * 0.004;

    for (let s = 0; s < SUB; s++) {
      this.time += step;
      const t = this.time;
      for (const pt of this.pts) {
        if (pt.pin) continue;
        const u = pt.row / (R - 1);
        // 行波抖动：相位沿长度推进，末端幅度最大
        const ph = t * (9 + speed * 9) - pt.row * 0.85 + this.seed;
        const amp = (1.2 + speed * 11) * u;
        const fx = wind.x + inx;
        const fy = wind.y + GRAV + iny + Math.sin(ph) * amp;
        const fz = wind.z + inz + Math.cos(ph * 1.3 + this.seed) * amp * 0.6;
        const px = pt.p.x, py = pt.p.y, pz = pt.p.z;
        pt.p.x += (px - pt.pp.x) * damp + fx * dt2;
        pt.p.y += (py - pt.pp.y) * damp + fy * dt2;
        pt.p.z += (pz - pt.pp.z) * damp + fz * dt2;
        pt.pp.set(px, py, pz);
      }

      for (let iter = 0; iter < 4; iter++) {
        for (const [ia, ib, rest, k] of this.cons) {
          const a = this.pts[ia], b = this.pts[ib];
          const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - rest) / d * 0.5 * k;
          const ox = dx * diff, oy = dy * diff, oz = dz * diff;
          if (!a.pin) { a.p.x += ox; a.p.y += oy; a.p.z += oz; }
          if (!b.pin) { b.p.x -= ox; b.p.y -= oy; b.p.z -= oz; }
        }
        for (let j = 0; j < C; j++) {
          const pt = this.pts[j];
          pt.p.set(this.attach.x, this.attach.y, this.attach.z + this._colOff(0, j));
          pt.pp.copy(pt.p);
        }
      }

      // 身体碰撞：把钻进球体里的质点推回表面
      if (o.colliders) {
        for (const col of o.colliders) {
          const rr = col.r + 0.02;
          for (const pt of this.pts) {
            if (pt.pin) continue;
            const dx = pt.p.x - col.c.x, dy = pt.p.y - col.c.y, dz = pt.p.z - col.c.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rr * rr) {
              const d = Math.sqrt(d2) || 1e-6;
              const k = rr / d;
              pt.p.set(col.c.x + dx * k, col.c.y + dy * k, col.c.z + dz * k);
            }
          }
        }
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

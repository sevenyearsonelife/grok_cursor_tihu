// 抓鱼小游戏：鱼从海里跃出沿抛物线（二次贝塞尔）飞向公路，
// 靠近或点击让鹈鹕张嘴接住；附带通用粒子池（水花/落地尘土）。
import * as THREE from '../vendor/three.module.js';
import { rand } from './utils.js';

// ---- 通用粒子池 ----
export class Particles {
  constructor(scene, count, color, size) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color,
        size,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }

  burst(p, n, spread, up) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.vel[i * 3] = rand(-spread, spread);
      this.vel[i * 3 + 1] = rand(up * 0.4, up);
      this.vel[i * 3 + 2] = rand(-spread, spread);
      this.life[i] = rand(0.4, 0.9);
    }
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 14 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ---- 鱼 ----
function makeFish() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff8c42, roughness: 0.5, metalness: 0.25,
    emissive: new THREE.Color(0x442200), emissiveIntensity: 0.4,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
  body.scale.set(0.8, 1, 1.55); // 鱼头朝 +z（lookAt 用 +z 对准速度方向）
  body.castShadow = true;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 4), mat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.28;
  g.add(tail);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 6, 6), eyeMat);
    eye.position.set(0.09 * s, 0.04, 0.17);
    g.add(eye);
  }
  g.visible = false;
  return g;
}

export class FishManager {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < 4; i++) {
      this.pool.push({ mesh: makeFish(), state: 'idle', t: 0, T: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), aimed: false, prev: new THREE.Vector3() });
      scene.add(this.pool[i].mesh);
    }
    this.splash = new Particles(scene, 140, 0xcfeaff, 0.14);
    this.spawnTimer = rand(1.5, 3);
    this.activeCount = 0;
    this._v = new THREE.Vector3();
  }

  // ctx = { dt, time, mouth: Vector3 世界坐标, pelicanZ, onCatch(pos), canCatch }
  update(ctx) {
    const dt = ctx.dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.activeCount < 3) {
      this.spawnTimer = rand(2.2, 4.8);
      this._spawn(ctx.pelicanZ);
    }

    for (const f of this.pool) {
      if (f.state === 'idle') continue;
      if (f.state === 'air') {
        f.t += dt / f.T;
        const t = Math.min(f.t, 1);
        const it = 1 - t;
        const m = f.mesh;
        f.prev.copy(m.position);
        m.position.set(
          it * it * f.p0.x + 2 * it * t * f.p1.x + t * t * f.p2.x,
          it * it * f.p0.y + 2 * it * t * f.p1.y + t * t * f.p2.y,
          it * it * f.p0.z + 2 * it * t * f.p1.z + t * t * f.p2.z
        );
        // 朝向速度方向
        this._v.copy(m.position).sub(f.prev);
        if (this._v.lengthSq() > 1e-8) {
          this._v.add(m.position);
          m.lookAt(this._v);
        }
        // 接住判定：鱼靠近鹈鹕嘴（靠近时鹈鹕张嘴由 game 处理）
        if (ctx.canCatch && f.aimed && m.position.distanceTo(ctx.mouth) < 1.35) {
          this._catch(f, ctx);
          continue;
        }
        if (t >= 1) {
          // 没接住，落水
          this.splash.burst(m.position, 16, 1.6, 3.2);
          f.state = 'idle';
          m.visible = false;
          this.activeCount--;
        }
      } else if (f.state === 'caught') {
        f.t += dt * 8;
        f.mesh.position.lerp(ctx.mouth, Math.min(f.t, 1));
        f.mesh.scale.setScalar(Math.max(1 - f.t, 0.01));
        if (f.t >= 1) {
          f.state = 'idle';
          f.mesh.visible = false;
          f.mesh.scale.setScalar(1);
          this.activeCount--;
        }
      }
    }
    this.splash.update(dt);
  }

  _spawn(pelicanZ) {
    const f = this.pool.find((p) => p.state === 'idle');
    if (!f) return;
    f.aimed = Math.random() < 0.55;
    // 起跳点在新海岸线（z≈15.5）之外的海面上方，高于浪峰
    f.p0.set(rand(-5, 5), 1.05, rand(17.5, 21));
    if (f.aimed) {
      // 瞄准鹈鹕嘴附近的落点，变道靠近就能接
      f.p2.set(rand(-0.5, 1.2), 2.1, pelicanZ + rand(-0.4, 0.6));
    } else {
      // 随便跳一下，只能点击捕捉
      f.p2.set(rand(-4, 4), 0.15, rand(9, 15));
    }
    f.p1.set(
      (f.p0.x + f.p2.x) / 2 + rand(-1, 1),
      Math.max(f.p0.y, f.p2.y) + rand(2.2, 3.4),
      (f.p0.z + f.p2.z) / 2
    );
    f.T = f.aimed ? 2.4 : 2.0;
    f.t = 0;
    f.state = 'air';
    f.mesh.visible = true;
    f.mesh.scale.setScalar(1);
    f.mesh.position.copy(f.p0);
    this.activeCount++;
    this.splash.burst(f.p0, 12, 1.4, 3.5);
  }

  // 点击捕鱼：射线先打中鱼才有效；靠近才够得着。ctx = { mouth, onCatch }
  tryClickCatch(raycaster, ctx) {
    for (const f of this.pool) {
      if (f.state !== 'air') continue;
      const hit = raycaster.intersectObject(f.mesh, true);
      if (hit.length && f.mesh.position.distanceTo(ctx.mouth) < 6) {
        this._catch(f, ctx);
        return true;
      }
    }
    return false;
  }

  _catch(f, ctx) {
    f.state = 'caught';
    f.t = 0;
    this.splash.burst(f.mesh.position, 14, 1.5, 3);
    if (ctx.onCatch) ctx.onCatch(f.mesh.position.clone());
  }

  // 是否有正飞向鹈鹕的鱼（用来让鹈鹕提前张嘴）
  aimedFishNear(z) {
    for (const f of this.pool) {
      if (f.state === 'air' && f.aimed && f.mesh.position.z < 14) return true;
    }
    return false;
  }
}

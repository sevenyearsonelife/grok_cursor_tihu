// 游戏主控：物理（加速/刹车/变道/跳跃/特技）、抓鱼判定、昼夜推进、成就、
// 演示模式、点击交互，统一由 main.js 的 rAF 循环驱动。
import * as THREE from '../vendor/three.module.js';
import { clamp, rand } from './utils.js';
import { Bicycle } from './bicycle.js';
import { Pelican } from './pelican.js';
import { FishManager } from './fish.js';
import { Sky } from './sky.js';
import { Road } from './road.js';
import { Ocean } from './ocean.js';
import { CameraController } from './camera.js';

const LANES = [-4.4, 0, 4.4];
const MAX_SPEED = 15;   // m/s（≈54 km/h）
const GRAVITY = 20;
const JUMP_V = 7.2;
const IDLE_DEMO = 10;   // 不操作 N 秒进入演示模式

export class Game {
  constructor(scene, camera, audio, hud, input) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.hud = hud;
    this.input = input;
    this.running = false;

    // ---- 玩法状态 ----
    this.speed = 4;
    this.dist = 0;
    this.time = 0;
    this.lane = 1;
    this.z = 0;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.wheelie = 0;       // 0~1 抬前轮程度
    this.trickTime = 0;
    this.score = 0;
    this.fishCount = 0;
    this.dayT = 0.02;       // 从黄昏开始
    this.nightSeen = false;
    this.idleT = 0;
    this.demo = false;
    this.demoT = 0;
    this.demoLaneT = 3;
    this.chompT = 0;

    // ---- 场景成员 ----
    this.sky = new Sky(scene, camera);
    this.road = new Road(scene);
    this.ocean = new Ocean(scene);

    this.rig = new THREE.Group(); // 车 + 鹈鹕 + 围巾作为一个整体（跳跃/特技时整体变换）
    scene.add(this.rig);
    this.bike = new Bicycle();
    this.rig.add(this.bike.group);
    this.pelican = new Pelican();
    this.pelican.group.position.set(-0.36, 1.02, 0);
    this.rig.add(this.pelican.group);

    this.fish = new FishManager(scene);
    this.camCtrl = new CameraController(camera);

    this._mouth = new THREE.Vector3();
    this._footL = new THREE.Vector3();
    this._footR = new THREE.Vector3();
    this._rigPos = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    // ---- 成就 ----
    this.achDefs = [
      { id: 'first_fish', icon: '🐟', name: '首杀：接到第一条鱼' },
      { id: 'ten_fish', icon: '🎣', name: '渔夫：累计接到 10 条鱼' },
      { id: 'speed', icon: '⚡', name: '速度恶魔：时速超过 45 km/h' },
      { id: 'night', icon: '🌙', name: '夜行者：完整经历一个夜晚' },
      { id: 'wheelie', icon: '🤸', name: '特技演员：前轮抬起骑行 2 秒' },
    ];
    hud.setAchievements(this.achDefs);

    // ---- 输入 ----
    input.onAction = (name) => this._action(name);
  }

  start() {
    this.running = true;
    this.input.enabled = true;
  }

  _action(name) {
    switch (name) {
      case 'left': this._changeLane(-1); break;
      case 'right': this._changeLane(1); break;
      case 'jump': this._jump(); break;
      case 'bell': this.audio.bell(); this.bike.ring(); break;
      case 'camera': this.camCtrl.next(); break;
      case 'mute': this.audio.toggleMute(); break;
    }
  }

  _changeLane(d) {
    const next = clamp(this.lane + d, 0, LANES.length - 1);
    if (next !== this.lane) this.lane = next;
  }

  _jump() {
    if (this.airborne || this.wheelie > 0.05) return;
    this.vy = JUMP_V;
    this.airborne = true;
    this.audio.jump();
  }

  // 画布点击：先试接鱼，再试戳鹈鹕
  handleClick(clientX, clientY) {
    this._ndc.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, this.camera);
    this.pelican.getMouthWorld(this._mouth);
    if (this.fish.tryClickCatch(this._raycaster, { mouth: this._mouth, onCatch: (p) => this._onCatch(p) })) {
      return;
    }
    const hit = this._raycaster.intersectObject(this.pelican.group, true);
    if (hit.length) {
      this.pelican.react();
      this.audio.squawk();
      this.chompT = Math.max(this.chompT, 0.5);
    }
  }

  _onCatch(pos) {
    this.score += 1;
    this.fishCount += 1;
    this.audio.catchFish();
    this.chompT = 0.45;
    if (this.hud.unlockAchievement('first_fish')) this.audio.achievement();
    if (this.fishCount >= 10 && this.hud.unlockAchievement('ten_fish')) this.audio.achievement();
  }

  update(dt) {
    if (!this.running) return;
    this.time += dt;
    const inp = this.input;

    // ---- 演示模式进出 ----
    if (inp.humanActivity) {
      inp.humanActivity = false;
      this.idleT = 0;
      if (this.demo) this.demo = false;
    } else {
      this.idleT += dt;
      if (this.idleT > IDLE_DEMO && !this.demo) {
        this.demo = true;
        this.demoT = 0;
      }
    }

    // ---- 控制输入（真人 or 自动驾驶）----
    let accel = inp.hold.accel;
    let brake = inp.hold.brake;
    let trick = inp.hold.trick;
    if (this.demo) this._autopilot(dt);

    // ---- 速度物理 ----
    const drag = 0.35 + this.speed * 0.14;
    this.speed += ((accel ? 5.5 : 0) - (brake ? 16 : 0) - drag) * dt;
    this.speed = clamp(this.speed, 0, MAX_SPEED);

    // ---- 变道 ----
    const targetZ = LANES[this.lane];
    this.z = THREE.MathUtils.damp(this.z, targetZ, 5, dt);
    const steer = clamp((targetZ - this.z) * 0.5, -1, 1);

    // ---- 跳跃 ----
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.fish.splash.burst(this._rigPos, 10, 1.2, 1.5); // 落地尘土
      }
    }

    // ---- 特技（抬前轮）----
    if (trick && !this.airborne && this.speed > 3) {
      this.wheelie = Math.min(1, this.wheelie + dt * 1.6);
      this.trickTime += dt;
    } else {
      if (this.wheelie > 0 && this.trickTime >= 2) {
        this.score += 2;
        this.hud.toast('🤸 特技完成 +2');
        if (this.hud.unlockAchievement('wheelie')) this.audio.achievement();
      }
      if (this.trickTime > 0 && (this.wheelie === 0 || this.airborne)) this.trickTime = 0;
      this.wheelie = Math.max(0, this.wheelie - dt * 2.5);
    }
    const wheelieAngle = this.wheelie * 0.55;

    // ---- rig 变换（含跳跃俯仰 / 特技绕后轮轴旋转）----
    let pitch = wheelieAngle;
    if (this.airborne) pitch += clamp(this.vy * 0.035, -0.28, 0.32);
    this.rig.rotation.z = pitch;
    const wheelieLift = 0.38 + 0.575 * Math.sin(wheelieAngle) - 0.38 * Math.cos(wheelieAngle);
    this.rig.position.set(0, this.y + (this.airborne ? 0 : wheelieLift), this.z);
    this._rigPos.copy(this.rig.position);

    // ---- 昼夜循环 ----
    const prevDayT = this.dayT;
    this.dayT = (this.dayT + dt / Sky.cycleLength) % 1;
    if (prevDayT > this.dayT) {
      // 跨过了一整轮
      if (this.nightSeen && this.hud.unlockAchievement('night')) this.audio.achievement();
      this.nightSeen = false;
    }
    if (this.sky.night > 0.8) this.nightSeen = true;

    // ---- 世界滚动 ----
    this.dist += this.speed * dt;
    this.road.update(this.dist, this.sky.night, this.time);

    // ---- 灯光 / 天空（阴影相机跟主角走）----
    this.sky.update(this.dayT, this._rigPos);
    this.ocean.update(this.time, this.dist, this.sky);

    // ---- 自行车 & 鹈鹕 ----
    this.bike.update(dt, this.speed, steer);
    this.rig.updateMatrixWorld(true);
    this.bike.pedalL.getWorldPosition(this._footL);
    this.bike.pedalR.getWorldPosition(this._footR);
    this.pelican.getMouthWorld(this._mouth);

    // 鹈鹕张嘴逻辑：附近有瞄准它的鱼 / 正在嚼 / 被戳
    if (this.chompT > 0) this.chompT -= dt;
    let mouthTarget = 0;
    if (this.chompT > 0) mouthTarget = 1;
    else if (this.fish.aimedFishNear()) mouthTarget = 0.7;
    this.pelican.mouthTarget = mouthTarget;

    const ctx = {
      dt,
      time: this.time,
      speedNorm: this.speed / MAX_SPEED,
      airborne: this.airborne,
      pedalPhase: this.bike.crank.rotation.z,
      footL: this._footL,
      footR: this._footR,
    };
    this.pelican.update(ctx);

    // ---- 抓鱼 ----
    this.fish.update({
      dt,
      time: this.time,
      mouth: this._mouth,
      pelicanZ: this.z,
      canCatch: true,
      onCatch: (p) => this._onCatch(p),
    });

    // ---- 成就：速度 ----
    if (this.speed * 3.6 > 45 && this.hud.unlockAchievement('speed')) this.audio.achievement();

    // ---- 镜头 ----
    this.camCtrl.update({
      dt,
      time: this.time,
      rigPos: this._rigPos,
      mouth: this._mouth,
      speedNorm: this.speed / MAX_SPEED,
    });

    // ---- 风声 / HUD ----
    this.audio.setWind(this.speed / MAX_SPEED);
    this.hud.update({
      speedKmh: this.speed * 3.6,
      score: this.score,
      icon: this.sky.phaseIcon(),
      demo: this.demo,
      muted: this.audio.muted,
    });
  }

  // 自动驾驶：保持中速、瞄鱼变道、偶尔跳跳按铃
  _autopilot(dt) {
    this.demoT += dt;
    this.demoLaneT -= dt;
    // 朝瞄准鱼的落点车道靠
    let targetLane = this.lane;
    for (const f of this.fish.pool) {
      if (f.state === 'air' && f.aimed) {
        targetLane = this._nearestLane(f.p2.z);
        break;
      }
    }
    if (this.demoLaneT <= 0) {
      this.demoLaneT = rand(3, 6);
      targetLane = this._nearestLane(rand(-4.4, 4.4));
    }
    if (targetLane !== this.lane) {
      this._changeLane(targetLane > this.lane ? 1 : -1);
    }
    if (this.demoT > 5 && Math.random() < dt * 0.25) {
      this.demoT = 0;
      if (Math.random() < 0.5) this._jump();
      else { this.audio.bell(); this.bike.ring(); }
    }
  }

  _nearestLane(z) {
    let best = 0;
    for (let i = 1; i < LANES.length; i++) {
      if (Math.abs(LANES[i] - z) < Math.abs(LANES[best] - z)) best = i;
    }
    return best;
  }
}

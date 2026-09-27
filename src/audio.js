// 合成音效（Web Audio 全程序化）：车铃、风声（随车速）、鹈鹕叫声、接鱼音效、
// 跳跃音、成就音。M 静音；AudioContext 在首次用户手势时创建。
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
  }

  // 必须在用户手势里调用
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // 风声：循环白噪声 → 低通 → 增益（随车速）
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 320;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setWind(speedNorm) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.22 * speedNorm * speedNorm, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(260 + 900 * speedNorm, t, 0.15);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }

  // 简单包络振荡器
  _tone(type, f0, f1, dur, vol, when) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + (when || 0);
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  bell() {
    // 经典双响“叮铃”
    for (const [dt, v] of [[0, 0.22], [0.14, 0.18]]) {
      this._tone('sine', 2093, 2093, 0.5, v, dt);
      this._tone('sine', 2637, 2637, 0.35, v * 0.5, dt);
      this._tone('triangle', 3136, 3136, 0.15, v * 0.3, dt);
    }
  }

  squawk() {
    if (!this.ctx) return;
    // 带沙哑感的下滑叫声
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 950;
    bp.Q.value = 1.6;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(820, t0);
    osc.frequency.linearRampToValueAtTime(1150, t0 + 0.07);
    osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.3);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.24, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.34);
    osc.connect(bp).connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.4);
  }

  catchFish() {
    // 上行三连音
    this._tone('triangle', 660, 660, 0.09, 0.16, 0);
    this._tone('triangle', 880, 880, 0.09, 0.16, 0.08);
    this._tone('triangle', 1320, 1320, 0.16, 0.16, 0.16);
  }

  jump() {
    this._tone('sine', 300, 700, 0.18, 0.1, 0);
  }

  achievement() {
    this._tone('sine', 880, 880, 0.28, 0.14, 0);
    this._tone('sine', 1318, 1318, 0.4, 0.14, 0.16);
  }
}

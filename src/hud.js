// HUD：速度/分数面板、昼夜图标、成就列表与弹窗、触屏按钮、开始界面、演示模式横幅
export class HUD {
  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <style>
        #hud { position: fixed; inset: 0; pointer-events: none; z-index: 10;
               font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
               user-select: none; -webkit-user-select: none; }
        .panel { position: absolute; background: rgba(10, 16, 32, 0.55);
                 border: 1px solid rgba(255,255,255,0.14); border-radius: 12px;
                 color: #fff; padding: 8px 14px; backdrop-filter: blur(4px);
                 text-shadow: 0 1px 3px rgba(0,0,0,0.6); }
        #speed-panel { top: 14px; left: 14px; }
        #speed-panel .num { font-size: 30px; font-weight: 700;
                            font-variant-numeric: tabular-nums; line-height: 1; }
        #speed-panel .unit { font-size: 12px; opacity: 0.75; }
        #score-panel { top: 14px; right: 14px; text-align: right; }
        #score-panel .num { font-size: 26px; font-weight: 700; line-height: 1.1; }
        #score-panel .icon { font-size: 22px; margin-left: 6px; }
        #topbtns { position: absolute; top: 74px; right: 14px; display: flex;
                   flex-direction: column; gap: 8px; pointer-events: auto; }
        .btn { pointer-events: auto; cursor: pointer; background: rgba(10,16,32,0.55);
               border: 1px solid rgba(255,255,255,0.18); border-radius: 10px;
               color: #fff; font-size: 14px; padding: 8px 12px;
               backdrop-filter: blur(4px); touch-action: none; }
        .btn:active { background: rgba(90,140,255,0.45); }
        #toast-wrap { position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
                      display: flex; flex-direction: column; gap: 8px; align-items: center; }
        .toast { background: linear-gradient(135deg, rgba(255,196,84,0.95), rgba(255,140,60,0.95));
                 color: #20140a; font-weight: 700; font-size: 15px; border-radius: 999px;
                 padding: 8px 22px; box-shadow: 0 4px 18px rgba(0,0,0,0.35);
                 animation: toast-in 3s forwards; white-space: nowrap; }
        @keyframes toast-in {
          0% { opacity: 0; transform: translateY(-14px) scale(0.9); }
          8% { opacity: 1; transform: translateY(0) scale(1); }
          85% { opacity: 1; } 100% { opacity: 0; transform: translateY(-8px); } }
        #banner { position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
                  background: rgba(80,50,160,0.72); border-radius: 999px; color: #fff;
                  font-size: 14px; padding: 7px 18px; display: none; white-space: nowrap; }
        #ach-list { position: absolute; right: 14px; bottom: 96px; font-size: 12px;
                    color: rgba(255,255,255,0.85); text-align: right; line-height: 1.8; }
        #ach-list .done { color: #ffd36e; }
        #touchbar { position: absolute; left: 0; right: 0; bottom: 0; display: flex;
                    justify-content: space-between; align-items: flex-end;
                    padding: 10px 14px 14px; gap: 8px; }
        #touchbar .cluster { display: flex; gap: 8px; }
        #touchbar .btn { font-size: 16px; padding: 12px 14px; border-radius: 14px; }
        #start { position: absolute; inset: 0; pointer-events: auto; cursor: pointer;
                 background: radial-gradient(ellipse at center, rgba(24,34,64,0.82), rgba(8,12,26,0.95));
                 display: flex; flex-direction: column; justify-content: center; align-items: center;
                 color: #fff; text-align: center; gap: 14px; }
        #start h1 { font-size: 40px; margin: 0; letter-spacing: 2px;
                    text-shadow: 0 3px 14px rgba(255,150,80,0.5); }
        #start .sub { opacity: 0.85; font-size: 15px; }
        #start .keys { font-size: 13.5px; line-height: 2; opacity: 0.8; }
        #start .keys b { display: inline-block; min-width: 90px; color: #ffd36e; }
        #start .go { margin-top: 10px; font-size: 19px; font-weight: 700;
                     background: linear-gradient(135deg, #ff9a4d, #ff5e4d);
                     padding: 12px 44px; border-radius: 999px;
                     box-shadow: 0 6px 24px rgba(255,110,70,0.45); }
        @media (max-width: 720px) {
          #ach-list { display: none; }
          #start h1 { font-size: 30px; }
          #start .keys { display: none; }
        }
      </style>
      <div id="speed-panel" class="panel">
        <div class="num">0</div><div class="unit">km/h</div>
      </div>
      <div id="score-panel" class="panel">
        🐟 <span class="num">0</span><span class="icon">☀️</span>
      </div>
      <div id="topbtns">
        <div class="btn" data-tap="camera">📷 镜头</div>
        <div class="btn" data-tap="mute">🔊 声音</div>
      </div>
      <div id="banner">🤖 自动驾驶演示中 —— 按任意键 / 触屏接管</div>
      <div id="toast-wrap"></div>
      <div id="ach-list"></div>
      <div id="touchbar">
        <div class="cluster">
          <div class="btn" data-hold="accel">加速</div>
          <div class="btn" data-hold="brake">刹车</div>
        </div>
        <div class="cluster">
          <div class="btn" data-tap="left">◀</div>
          <div class="btn" data-tap="right">▶</div>
        </div>
        <div class="cluster">
          <div class="btn" data-tap="jump">跳</div>
          <div class="btn" data-hold="trick">特技</div>
          <div class="btn" data-tap="bell">🔔</div>
        </div>
      </div>
      <div id="start">
        <h1>🚲 鹈鹕海岸骑行</h1>
        <div class="sub">戴好头盔，沿着海岸公路追海风、接跳鱼！</div>
        <div class="keys">
          <div><b>W / ↑</b> 加速　<b>S / ↓</b> 刹车</div>
          <div><b>A / D</b> 左右变道　<b>空格</b> 跳跃</div>
          <div><b>T</b> 抬前轮特技　<b>B</b> 车铃　<b>C</b> 切换镜头</div>
          <div><b>M</b> 静音　点鹈鹕它会叫，点鱼试试接住它</div>
        </div>
        <div class="go">点击开始骑行</div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.speedNum = this.root.querySelector('#speed-panel .num');
    this.scoreNum = this.root.querySelector('#score-panel .num');
    this.dayIcon = this.root.querySelector('#score-panel .icon');
    this.banner = this.root.querySelector('#banner');
    this.toastWrap = this.root.querySelector('#toast-wrap');
    this.achList = this.root.querySelector('#ach-list');
    this.startEl = this.root.querySelector('#start');
    this.muteBtn = this.root.querySelector('[data-tap="mute"]');

    this.achDefs = [];
    this.achDone = {};
  }

  // 成就定义（game 调用）：[{id, icon, name}]
  setAchievements(defs) {
    this.achDefs = defs;
    this.achList.innerHTML = defs
      .map((d) => `<div data-ach="${d.id}">🔒 ${d.icon} ${d.name}</div>`)
      .join('');
  }

  unlockAchievement(id) {
    if (this.achDone[id]) return false;
    this.achDone[id] = true;
    const def = this.achDefs.find((d) => d.id === id);
    if (def) {
      const el = this.achList.querySelector(`[data-ach="${id}"]`);
      if (el) {
        el.classList.add('done');
        el.textContent = `✅ ${def.icon} ${def.name}`;
      }
      this.toast(`🏆 成就解锁：${def.name}`);
    }
    return true;
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toastWrap.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // state = { speedKmh, score, icon, demo, muted }
  update(state) {
    this.speedNum.textContent = String(Math.round(state.speedKmh));
    this.scoreNum.textContent = String(state.score);
    this.dayIcon.textContent = state.icon;
    this.banner.style.display = state.demo ? 'block' : 'none';
    this.muteBtn.textContent = state.muted ? '🔇 静音中' : '🔊 声音';
  }

  // 绑定触屏按钮：hold 回调（加速/刹车/特技），tap 回调（其余）
  bindButtons(onHold, onTap) {
    for (const el of this.root.querySelectorAll('.btn[data-hold]')) {
      const name = el.dataset.hold;
      const down = (e) => { e.preventDefault(); onHold(name, true); };
      const up = (e) => { e.preventDefault(); onHold(name, false); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointerleave', up);
      el.addEventListener('pointercancel', up);
    }
    for (const el of this.root.querySelectorAll('.btn[data-tap]')) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onTap(el.dataset.tap);
      });
    }
  }

  showStart(onStart) {
    this.startEl.style.display = 'flex';
    const go = () => {
      this.startEl.style.display = 'none';
      this.startEl.removeEventListener('pointerdown', go);
      onStart();
    };
    this.startEl.addEventListener('pointerdown', go);
  }
}

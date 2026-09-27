// 输入：键盘 + 触屏按钮统一入口。持续按住状态（加速/刹车/特技）+ 一次性动作回调。
export class Input {
  constructor(hud) {
    this.hold = { accel: false, brake: false, trick: false };
    this.onAction = null;   // (name) => void
    this.humanActivity = false; // 真人操作标记（区别于自动驾驶）
    this.enabled = false;   // 开始界面之后才生效

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._mark();
      if (!this._keyHold(e.code, true)) {
        const act = this._keyAction(e.code);
        if (act) {
          if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
          this._fire(act);
        }
      } else if (e.code === 'Space' || e.code.startsWith('Arrow')) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this._keyHold(e.code, false));

    if (hud) {
      hud.bindButtons(
        (name, v) => {
          this._mark();
          if (this.enabled && name in this.hold) this.hold[name] = v;
        },
        (name) => {
          this._mark();
          this._fire(name);
        }
      );
    }
  }

  _mark() {
    this.humanActivity = true;
  }

  _fire(name) {
    if (this.enabled && this.onAction) this.onAction(name);
  }

  // 返回 true 表示这是持续按住型按键
  _keyHold(code, v) {
    let hit = true;
    switch (code) {
      case 'KeyW': case 'ArrowUp': this.hold.accel = v; break;
      case 'KeyS': case 'ArrowDown': this.hold.brake = v; break;
      case 'KeyT': this.hold.trick = v; break;
      default: hit = false;
    }
    return hit;
  }

  _keyAction(code) {
    switch (code) {
      case 'KeyA': case 'ArrowLeft': return 'left';
      case 'KeyD': case 'ArrowRight': return 'right';
      case 'Space': return 'jump';
      case 'KeyB': return 'bell';
      case 'KeyC': return 'camera';
      case 'KeyM': return 'mute';
      default: return null;
    }
  }
}

# 🚲 鹈鹕海岸骑行（3D）

全程序化生成的 3D 鹈鹕骑自行车小游戏，构建产物为**单文件** `dist/index.html`，
运行时零外部依赖（Three.js r170 已内联打包）。

## 构建与验证

```bash
npm install        # 可选：装 esbuild 后构建器自动切换到 esbuild
node test/smoke.mjs  # Node 冒烟测试：实例化全部 3D 模块并推进若干帧
node build.mjs       # 产出 dist/index.html（单 IIFE bundle 内联）
```

未安装 esbuild 时，`build.mjs` 会自动回退到内置的零依赖 mini-bundler
（解析本项目使用的受限 ESM import/export 子集 + vendor/three.module.js 的单导出结构），
产物同为单 IIFE 内联 HTML。

## 操作

| 按键 | 功能 |
| --- | --- |
| W / ↑ | 加速 |
| S / ↓ | 刹车 |
| A / D | 左右变道 |
| 空格 | 跳跃 |
| T（按住） | 抬前轮特技 |
| B | 车铃 |
| C | 切换镜头（跟随/侧面/鹈鹕第一视角/电影运镜） |
| M | 静音 |

点击鹈鹕它会叫；点击飞鱼可以接住。屏幕下方有触屏按钮。10 秒不操作进入自动驾驶演示模式，任意输入接管。

## 模块结构（src/）

- `main.js` 入口：渲染器 + rAF 主循环
- `game.js` 主控：物理/玩法/成就/演示模式
- `pelican.js` 程序化鹈鹕（双骨骼 IK 踩腿、墨镜头盔、点击反应）
- `scarf.js` 红围巾（简化 Verlet 布料）
- `bicycle.js` 复古自行车（双轮辐条、曲柄、车铃、车筐）
- `road.js` 海岸公路（程序化路面贴图、护栏、路灯、远山、城市剪影）
- `ocean.js` 低多边形海面（顶点波浪）+ 岸边泡沫
- `sky.js` 90 秒昼夜循环（渐变穹顶着色器、日月星辰、灯光关键帧）
- `fish.js` 抓鱼小游戏 + 通用粒子池
- `audio.js` Web Audio 合成音效（车铃/风声/叫声/接鱼/成就）
- `hud.js` HUD、成就、触屏按钮、开始界面
- `input.js` 键盘/触屏统一输入
- `camera.js` 四种镜头

`vendor/three.module.js` 为本地 Three.js r170（构建时打包，运行时零 CDN 依赖）。

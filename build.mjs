// 构建脚本：把 src/ + vendor/three.module.js 打包成单个 IIFE，内联进 dist/index.html。
// 优先用 esbuild（npm install esbuild 后自动启用）；未安装时回退到内置的
// 零依赖 mini-bundler（解析受限的 ESM import/export 子集，足够本项目使用）。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'src/main.js';
const OUT = join(ROOT, 'dist/index.html');

// ---------- 产物 HTML 模板 ----------
function htmlTemplate(js) {
  // 防止内联脚本里出现 </script> 提前闭合标签（js 字符串里若有会被转义）
  const safe = js.replace(/<\/script/gi, '<\\/script');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>🚲 鹈鹕海岸骑行</title>
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; height: 100%;
               background: #0a1024; touch-action: none; }
  canvas { display: block; }
</style>
</head>
<body>
<script>
${safe}
</script>
</body>
</html>
`;
}

// ---------- 路线 A：esbuild ----------
async function buildWithEsbuild() {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(ROOT, ENTRY)],
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['es2020'],
    legalComments: 'none',
    write: false,
    logLevel: 'info',
  });
  return result.outputFiles[0].text;
}

// ---------- 路线 B：内置 mini-bundler ----------
// 支持的模块语法子集：
//   import * as NS from '<relpath>';
//   import { a, b as c } from '<relpath>';
//   export class X / export function X / export const X = ...
// three.module.js（单个末尾 export 语句）自动特殊处理。
function buildWithMiniBundler() {
  const modules = new Map(); // id(相对 ROOT 的 posix 路径) -> {src, deps}
  const toId = (abs) => relative(ROOT, abs).replace(/\\/g, '/');
  function load(id) {
    if (modules.has(id)) return;
    const abs = resolve(ROOT, id);
    let src = readFileSync(abs, 'utf8');
    // 解析依赖并改写 import 语句
    const deps = [];
    const depId = (spec, fromId) =>
      toId(resolve(ROOT, dirname(fromId), spec));
    src = src.replace(
      /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
      (_, ns, spec) => {
        const dep = depId(spec, id);
        deps.push(dep);
        return `const ${ns} = __req("${dep}");`;
      }
    );
    src = src.replace(
      /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm,
      (_, names, spec) => {
        const dep = depId(spec, id);
        deps.push(dep);
        const destruct = names
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.replace(/\s+as\s+/, ': '))
          .join(', ');
        return `const { ${destruct} } = __req("${dep}");`;
      }
    );
    // three.module.js：唯一的 `export { ... }` 换成对象声明
    if (id === 'vendor/three.module.js') {
      const n = (src.match(/^export\s*\{/gm) || []).length;
      if (n !== 1) throw new Error(`vendor three.module.js 导出结构变化（发现 ${n} 处 export）`);
      src = src.replace(/^export\s*\{/m, 'const __exp = {');
      src += '\nObject.assign(exports, __exp);\n';
    } else {
      // 收集并剥离 export 前缀
      const exported = [];
      src = src.replace(
        /^export\s+(const|let|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm,
        (_, kind, name) => {
          exported.push(name);
          return `${kind} ${name}`;
        }
      );
      src += '\n' + exported.map((nm) => `exports.${nm} = ${nm};`).join('\n') + '\n';
      // 项目源码不应残留 mini-bundler 不支持的模块语法
      const leftover = src.match(/^(import|export)\b.*$/gm);
      if (leftover) throw new Error(`${id} 存在 mini-bundler 不支持的模块语法:\n${leftover.join('\n')}`);
    }
    modules.set(id, { src, deps });
    for (const d of deps) load(d);
  }
  load(ENTRY);

  // 拼接 IIFE：注册表 + 惰性实例化 + 入口
  let out = '(function(){\n"use strict";\n';
  out += 'var __mods = Object.create(null);\n';
  out += 'function __def(id, fn){ __mods[id] = { fn: fn, e: null }; }\n';
  out += 'function __req(id){ var m = __mods[id]; if (!m) throw new Error("module not found: " + id);' +
         ' if (!m.e) { m.e = {}; m.fn(m.e, __req); } return m.e; }\n';
  for (const [id, m] of modules) {
    out += `__def("${id}", function(exports, __req){\n${m.src}\n});\n`;
  }
  out += `__req("${ENTRY}");\n})();\n`;
  return out;
}

// ---------- 主流程 ----------
mkdirSync(join(ROOT, 'dist'), { recursive: true });
let js, engine;
if (existsSync(join(ROOT, 'node_modules/esbuild'))) {
  js = await buildWithEsbuild();
  engine = 'esbuild';
} else {
  js = buildWithMiniBundler();
  engine = 'mini-bundler (esbuild 未安装，零依赖回退)';
}
// 语法自查：能被解析成合法 JS
new Function(js);
const html = htmlTemplate(js);
writeFileSync(OUT, html);
console.log(`[build] engine: ${engine}`);
console.log(`[build] dist/index.html: ${(html.length / 1024).toFixed(1)} KB`);

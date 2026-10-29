/**
 * Playwright 加载器 —— 让所有 UI 验收脚本在「仓库克隆下来就能跑」和
 * 「没装 node_modules 但机器上某处有 playwright」两种情况下都能工作。
 *
 * 查找顺序：
 *   1. 项目自己的 node_modules（`npm i -D playwright` 之后走这条）
 *   2. 环境变量 PW_PREFIX 指向的目录（子进程/CI 里显式指定）
 *   3. 已知的兜底位置（本机沙箱环境，仅当存在时）
 *
 * 为什么单独抽一个文件：以前每个脚本里都写死了一条绝对路径，
 * 换一台机器全部报 "Cannot find module 'playwright'"，而且报错位置在脚本顶部，
 * 看起来像脚本坏了而不是环境没装。集中在这里，报错信息能给出一条能照做的命令。
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const FALLBACKS = [
  process.env.PW_PREFIX,
  '/Users/v/.workbuddy/binaries/node/workspace'
].filter(Boolean);

let playwright = null;

// ① 项目内 node_modules（最常见）
try {
  const req = createRequire(import.meta.url);
  playwright = req('playwright');
} catch (e) { /* 继续找 */ }

// ② 环境变量 / 兜底目录：把该目录当成 require 的解析根
if (!playwright) {
  for (const base of FALLBACKS) {
    const anchor = path.join(base, 'noop.js');
    if (!fs.existsSync(base)) continue;
    try {
      playwright = createRequire(anchor)('playwright');
      break;
    } catch (e) { /* 换下一个 */ }
  }
}

// ③ node 的全局解析路径
if (!playwright) {
  try {
    const { execFileSync } = await import('child_process');
    const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    if (root) playwright = createRequire(path.join(root, 'noop.js'))('playwright');
  } catch (e) { /* 放弃 */ }
}

if (!playwright || !playwright.chromium) {
  console.error([
    '',
    '找不到 playwright，UI 验收脚本跑不了。装一下就好：',
    '',
    '    npm i -D playwright && npx playwright install chrome',
    '',
    '已经装在别处的话，用 PW_PREFIX 指过去：',
    '',
    '    PW_PREFIX=/opt/node_modules node scripts/ui-smoke.mjs',
    ''
  ].join('\n'));
  process.exit(2);
}

export const { chromium } = playwright;
export default playwright;

/**
 * 测试账号 —— 不要硬编码在脚本里。
 *
 * 为什么单独抽出来：验收脚本里曾经写死了主账号密码，
 * 一旦仓库推到 GitHub，等于把生产密码连同用户名一起公开。
 *
 * 读取顺序：
 *   1. 环境变量 SB_TEST_USER / SB_TEST_PASS（CI、临时库、体验库用这套）
 *   2. 本机 config.json 的 auth 段（开发最省事，config.json 已在 gitignore 里）
 *   3. 两者都没有 → 直接报错退出，并给出照做就行的命令
 *
 * 注意：config.json 的明文密码只在「首次启动迁移」时用过，
 * 迁移后仍然和真实密码是同一个串，所以拿它做测试登录是成立的。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fromConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    return { user: (c.auth && c.auth.username) || '', pass: (c.auth && c.auth.password) || '' };
  } catch (e) { return { user: '', pass: '' }; }
}

const cfg = fromConfig();
export const USER = process.env.SB_TEST_USER || cfg.user;
export const PASS = process.env.SB_TEST_PASS || cfg.pass;
export const CRED = { username: USER, password: PASS };

if (!USER || !PASS) {
  console.error([
    '',
    '缺少测试账号。两种办法：',
    '',
    '  a) 配 config.json 的 auth 段（推荐，本机开发）',
    '  b) 用环境变量：SB_TEST_USER=xxx SB_TEST_PASS=yyy node scripts/selftest.mjs',
    ''
  ].join('\n'));
  process.exit(2);
}

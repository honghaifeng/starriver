'use strict';
/**
 * 生成 / 校准「体验环境」数据库：真实数据一个字节都不碰。
 *
 * 用法：
 *   node scripts/make-demo-env.mjs                     → 没有就建，有就只校准账号，不动里面的数据
 *   node scripts/make-demo-env.mjs --force             → 删掉重建（会话/资产/台账全清）
 *   DEMO_PASS=xxx node scripts/make-demo-env.mjs       → 换体验账号密码（不用重建数据）
 *   DEMO_INVITE=1 node scripts/make-demo-env.mjs       → 开放邀请码自助注册
 *
 * 体验库和正式库的差别：
 *   1. 期初额度压到 DEMO_OPENING（默认 20,000 积分），用完自动拦住，不会烧穿真账；
 *   2. 组织名改成「体验空间」，只有「体验账号」一个人；
 *   3. 账号是这套库自己的（密码哈希写在这里），正式账号在这套库里不存在 —— 主密码登不进来；
 *   4. 不带任何真实会话 / 资产 / 台账。
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const identity = require(path.join(ROOT, 'lib', 'identity.js'));

const DEMODIR = path.join(ROOT, 'data-demo');
const DEMO_OPENING = Number(process.env.DEMO_OPENING || 20000);
const DEMO_USER = String(process.env.DEMO_USER || 'demo').toLowerCase();
const DEMO_PASS = process.env.DEMO_PASS || 'star-river-2026';
const INVITE_OPEN = process.env.DEMO_INVITE === '1';
const force = process.argv.includes('--force');
const fresh = force || !fs.existsSync(path.join(DEMODIR, 'db.json'));

if (force && fs.existsSync(DEMODIR)) {
  fs.rmSync(DEMODIR, { recursive: true, force: true });
  console.log('已清空旧体验库');
}
// 旧登录态也要清掉，否则重建后旧 cookie 还能直接进
const sessFile = path.join(DEMODIR, 'sessions.json');
if (fresh && fs.existsSync(sessFile)) fs.rmSync(sessFile, { force: true });

if (fresh) {
  console.log('导入基础语料（Agent + 选题 + Box）…');
  execFileSync(process.execPath, [path.join(ROOT, 'seed.js')], {
    cwd: ROOT,
    env: { ...process.env, SB_DATA: DEMODIR },
    stdio: 'inherit'
  });
}

const file = path.join(DEMODIR, 'db.json');
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

if (fresh) {
  // 清空所有「真实痕迹」，只留可展示的语料
  db.conversations = [];
  db.assets = [];
  db.uploads = [];
  db.tasks = [];
  db.ledger = [];
  db.usage = { calls: 0, totalIn: 0, totalOut: 0, tokenCredits: 0, perModel: {}, perDay: {} };
  db.members = [{ id: 'mb-demo', name: '体验账号', role: 'editor', quota: 0, used: 0, active: true, createdAt: Date.now() }];
  db.org = {
    name: '春科 · 星河 StarRiver（体验空间）',
    opening: DEMO_OPENING,
    recharged: 0,
    balance: DEMO_OPENING,
    used: 0,
    lowBalance: Math.round(DEMO_OPENING * 0.1),
    createdAt: Date.now()
  };
}

// 账号：每次都对一遍，保证「改了 DEMO_PASS 立刻生效」，也保证不会混进正式账号
if (!db.members || !db.members.length) {
  db.members = [{ id: 'mb-demo', name: '体验账号', role: 'editor', quota: 0, used: 0, active: true, createdAt: Date.now() }];
}
db.users = [];
for (const m of db.members) {
  const isFirst = m === db.members[0];
  const { salt, passHash } = identity.hashPassword(isFirst ? DEMO_PASS : identity.tempPassword(12));
  db.users.push({
    id: 'u-' + (isFirst ? 'demo' : m.id.replace(/^mb-/, '')),
    username: isFirst ? DEMO_USER : m.id.replace(/^mb-/, ''),
    name: m.name,
    salt, passHash,
    role: isFirst ? 'owner' : 'member',
    status: 'active',
    memberId: m.id,
    createdAt: Date.now(),
    lastLoginAt: null
  });
}
db.org.inviteOpen = INVITE_OPEN;
db.org.inviteCode = INVITE_OPEN ? (process.env.DEMO_INVITE_CODE || 'star-river') : null;

fs.writeFileSync(file, JSON.stringify(db));

console.log('体验库就绪：' + DEMODIR + (fresh ? '（新建）' : '（沿用已有数据）'));
console.log('  语料   Agent ' + db.agents.length + ' / 选题 ' + db.topics.length + ' / Box ' + db.boxes.length);
console.log('  会话   ' + db.conversations.length + '（0 = 外人从空白开始，看不到真实内容）');
console.log('  额度   ' + (db.org.balance) + ' 积分（用完自动拦，不会烧穿正式账）');
console.log('  账号   ' + DEMO_USER + ' / ' + DEMO_PASS + '　← 只在这个库里有效，正式账号登不进来');
console.log('  注册   ' + (INVITE_OPEN ? '已开放，邀请码 ' + db.org.inviteCode : '关闭，账号由管理员开通'));

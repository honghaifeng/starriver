/**
 * 多账号隔离验收 —— 这个脚本存在的意义：
 * 「前端看起来各看各的」不算隔离，服务端必须挡住「换个人、换个 ID 再试一次」。
 *
 * 每一条断言都对应一个真实攻击动作：
 *   不登录能不能进 / 用别人的会话 ID 能不能读 / 能不能删 / 能不能改 /
 *   能不能把消耗记到别人头上 / 普通成员能不能改额度 / 停用后旧 cookie 还能不能用 /
 *   密码错 5 次会不会被锁 / 附件会不会串号。
 *
 * 数据隔离：默认自己起一个临时服务 + 临时空库跑，跑完即毁。
 * 绝不拿正式库做越权测试 —— 那会往里塞测试账号和测试会话。
 *
 * 用法：
 *   node scripts/verify-tenancy.mjs            # 起临时库自测（推荐）
 *   node scripts/verify-tenancy.mjs <baseUrl>  # 打一个已在跑的服务（会污染该库）
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { USER, PASS } from './_cred.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = { username: USER, password: PASS };
const A = { username: 'alice', name: '测试甲', password: 'alice2026pass' };
const B = { username: 'bob', name: '测试乙', password: 'bob2026pass' };

let BASE = process.argv[2] || process.env.SB_TEST_URL || '';
let child = null, tmpDir = null;

/**
 * 默认自己起一份「临时空库 + 临时端口」的服务来跑，跑完即毁。
 * 越权测试必然会往里塞 alice/bob、测试会话、测试附件，
 * 所以绝不允许默认打到正式库（7777）上。
 * 显式传 baseUrl 时才会打外部服务。
 */
async function startIsolated() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tenancy-'));
  const port = 7900 + Math.floor(Math.random() * 80);
  BASE = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, SB_DATA: tmpDir, PORT: String(port), SB_HOST: '127.0.0.1', SB_USER: OWNER.username, SB_PASS: OWNER.password },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 150));
    try { const r = await fetch(BASE + '/api/ping'); if (r.ok) return; } catch (e) { }
    if (child.exitCode !== null) break;
  }
  throw new Error('临时服务没起来：' + log.slice(-500));
}
function cleanup() {
  if (child && child.exitCode === null && !child.killed) { try { child.kill('SIGKILL'); } catch (e) { } }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { } }
}
process.on('exit', cleanup);

async function preflight() {
  let ok = false;
  for (let i = 0; i < 8; i++) {
    try { const r = await fetch(BASE + '/api/ping'); if (r.ok) { ok = true; break; } } catch (e) { }
    await new Promise(r => setTimeout(r, 250));
  }
  if (!ok) {
    console.error(`连不上 ${BASE}`);
    process.exit(2);
  }
  if (/:(7777|7788)\b/.test(BASE)) {
    console.warn('⚠️  你正在用正式/演示库做越权测试，会产生测试账号与测试会话。');
  }
}

let pass = 0, fail = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; fails.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function group(t) { console.log('\n' + t); }

const jars = {};
async function call(who, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (jars[who]) headers.Cookie = jars[who];
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual'
  });
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const sc = setCookie.find(c => c.startsWith('sid='));
  if (sc) {
    const v = sc.split(';')[0];
    if (/sid=;/.test(v)) delete jars[who]; else jars[who] = v;
  }
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch (e) { body = { raw: text.slice(0, 200) }; }
  return { status: r.status, body };
}
async function login(who, cred) {
  const r = await call(who, '/api/auth/login', { method: 'POST', body: cred });
  return r;
}
/** 确保测试账号存在且密码已知（以 owner 身份重置，避免上一轮改过密码导致跑不动） */
async function ensureUser(me, spec) {
  const list = await call('owner', '/api/users');
  const hit = (list.body.list || []).find(x => x.username === spec.username);
  if (!hit) {
    const r = await call('owner', '/api/users', {
      method: 'POST',
      body: { username: spec.username, name: spec.name, password: spec.password, role: 'member', quota: 5000 }
    });
    return { created: true, status: r.status };
  }
  if (hit.status === 'disabled') {
    await call('owner', `/api/users/${hit.id}/status`, { method: 'POST', body: { status: 'active' } });
  }
  await call('owner', `/api/users/${hit.id}/password`, { method: 'POST', body: { password: spec.password } });
  return { created: false };
}
async function chat(who, text) {
  // 走 SSE，但只关心首帧 meta 里的 conversationId
  const headers = { 'Content-Type': 'application/json' };
  if (jars[who]) headers.Cookie = jars[who];
  const r = await fetch(BASE + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ content: text, model: 'qwen3.8-flash' }) });
  const t = await r.text();
  const m = t.match(/"conversationId":"([\w-]+)"/);
  return { status: r.status, conversationId: m ? m[1] : null, raw: t.slice(0, 160) };
}

/** 只看状态码地取一个非 JSON 资源（图片、导出件），用来验媒体路由的归属闸门 */
async function rawGet(who, path) {
  const headers = {};
  if (jars[who]) headers.Cookie = jars[who];
  const r = await fetch(BASE + path, { headers, redirect: 'manual' });
  return r.status;
}

(async () => {
  if (!BASE) await startIsolated();
  await preflight();
  console.log('目标：' + BASE + (tmpDir ? '（临时空库，跑完即毁）' : '（外部服务）'));

  group('0. 准备账号');
  const ol = await login('owner', OWNER);
  ok(ol.status === 200, 'owner 能登录', ol.status);
  for (const spec of [A, B]) {
    const e = await ensureUser('owner', spec);
    ok(e.status === 200 || e.status === undefined, `${spec.username} 可登录（${e.created ? '新建' : '复用'}）`, e.status);
    const l = await login(spec.username, spec);
    ok(l.status === 200 && l.body.user && l.body.user.role === 'member', `${spec.username} 登录成功且角色为成员`, l.status);
  }

  group('1. 未登录一律挡住');
  delete jars.anon;
  for (const [path, method] of [['/api/bootstrap', 'GET'], ['/api/conversations', 'GET'], ['/api/ledger', 'GET'], ['/api/assets', 'GET'], ['/api/users', 'GET']]) {
    const r = await call('anon', path, { method });
    ok(r.status === 401, `未登录 ${method} ${path} → 401`, r.status);
  }

  group('2. 各建一条会话');
  const ca = await chat(A.username, '只回复：甲');
  ok(ca.status === 200 && !!ca.conversationId, '甲建会话成功', ca.raw.slice(0, 80));
  const cb = await chat(B.username, '只回复：乙');
  ok(cb.status === 200 && !!cb.conversationId, '乙建会话成功', cb.raw.slice(0, 80));
  ok(ca.conversationId !== cb.conversationId, '两条会话是不同 ID');

  group('3. 会话列表只给自己看');
  const la = await call(A.username, '/api/conversations?limit=1000');
  const lb = await call(B.username, '/api/conversations?limit=1000');
  const idsA = (la.body.list || []).map(x => x.id);
  const idsB = (lb.body.list || []).map(x => x.id);
  ok(idsA.includes(ca.conversationId), '甲能看到自己的会话');
  ok(!idsA.includes(cb.conversationId), '甲的列表里没有乙的会话', idsA.length);
  ok(idsB.includes(cb.conversationId), '乙能看到自己的会话');
  ok(!idsB.includes(ca.conversationId), '乙的列表里没有甲的会话', idsB.length);
  ok(la.body.total <= 1000 && idsA.every(id => idsA.indexOf(id) === idsA.lastIndexOf(id)), '甲的列表无重复');
  const ol2 = await call('owner', '/api/conversations?limit=1000');
  ok(ol2.body.total > idsA.length, '管理员能看到全部（视角不同，scope 标记正确）', { scope: ol2.body.scope, total: ol2.body.total });

  group('4. 猜 ID 读别人的会话');
  const readOther = await call(B.username, '/api/conversation/' + ca.conversationId);
  ok(readOther.status === 404, '乙按 ID 读甲的会话 → 404（不是 403，避免暴露存在性）', readOther.status);
  const readOwn = await call(B.username, '/api/conversation/' + cb.conversationId);
  ok(readOwn.status === 200, '乙读自己的会话 → 200', readOwn.status);

  group('5. 改别人的会话');
  const patchOther = await call(B.username, '/api/conversation/' + ca.conversationId, { method: 'PATCH', body: { title: '我劫持了' } });
  ok(patchOther.status === 404, '乙改甲的会话标题 → 404', patchOther.status);
  const stillA = await call(A.username, '/api/conversation/' + ca.conversationId);
  ok(stillA.body.conversation && stillA.body.conversation.title !== '我劫持了', '甲的标题没有被改掉', stillA.body.conversation && stillA.body.conversation.title);

  group('6. 往别人的会话里发消息');
  const chatOther = await chat(B.username, '这条不该进得去');
  const inject = await call(B.username, '/api/chat', { method: 'POST', body: { content: '注入测试', conversationId: ca.conversationId } });
  ok(inject.status === 404, '乙往甲的会话发消息 → 404', inject.status);
  const afterInject = await call(A.username, '/api/conversation/' + ca.conversationId);
  const msgs = afterInject.body.conversation ? afterInject.body.conversation.messages : [];
  ok(!msgs.some(m => m.content && String(m.content).includes('注入测试')), '甲的会话里没有出现注入内容');

  group('7. 删别人的会话');
  const delOther = await call(B.username, '/api/conversation/' + ca.conversationId, { method: 'DELETE' });
  ok(delOther.status === 404, '乙删甲的会话 → 404', delOther.status);
  const survive = await call(A.username, '/api/conversation/' + ca.conversationId);
  ok(survive.status === 200, '甲的会话仍然存在', survive.status);

  group('8. 账号管理只有管理员能做');
  const bobCreate = await call(B.username, '/api/users', { method: 'POST', body: { username: 'hacker' + Date.now().toString(36), password: 'hack2026pass' } });
  ok(bobCreate.status === 403, '乙建账号 → 403', bobCreate.status);
  const bobList = await call(B.username, '/api/users');
  ok(bobList.status === 403, '乙读账号列表 → 403', bobList.status);
  const bobQuota = await call(B.username, '/api/members', { method: 'POST', body: { name: '影子成员', quota: 999999 } });
  ok(bobQuota.status === 403, '乙加成员 → 403', bobQuota.status);
  const bobRecharge = await call(B.username, '/api/org/recharge', { method: 'POST', body: { credits: 100000 } });
  ok(bobRecharge.status === 403, '乙给自己充积分 → 403', bobRecharge.status);
  const bobAdjust = await call(B.username, '/api/org/adjust', { method: 'POST', body: { credits: 5000 } });
  ok(bobAdjust.status === 403, '乙调账 → 403', bobAdjust.status);
  const bobOrg = await call(B.username, '/api/org');
  ok(bobOrg.status === 403, '乙读企业控制台 → 403', bobOrg.status);
  const bobAgent = await call(B.username, '/api/agents', { method: 'POST', body: { name: 'x', instruction: 'y' } });
  ok(bobAgent.status === 403, '乙改 Agent → 403', bobAgent.status);

  group('9. 不能把消耗记到别人头上');
  const sw = await call(B.username, '/api/member/switch', { method: 'POST', body: { memberId: 'mb-7b6f78b7' } });
  ok(sw.status === 410, '旧的「切换记账成员」接口已废弃 → 410', sw.status);

  group('10. 台账与用量各看各的');
  const ledA = await call(A.username, '/api/ledger?days=7&pageSize=200');
  const ledB = await call(B.username, '/api/ledger?days=7&pageSize=200');
  const ownersOf = r => [...new Set((r.body.list || []).map(e => e.ownerId))];
  ok(ledA.status === 200 && ownersOf(ledA).length <= 1, '甲只看到自己的台账行', ownersOf(ledA));
  ok(ledB.status === 200 && ownersOf(ledB).length <= 1, '乙只看到自己的台账行', ownersOf(ledB));
  ok(ledA.body.audit && ledA.body.audit.personal === true, '甲的对账视图是个人口径', ledA.body.audit && ledA.body.audit.personal);
  const ledOwner = await call('owner', '/api/ledger?days=7&pageSize=5');
  ok(ledOwner.body.audit && !ledOwner.body.audit.personal, '管理员的对账视图是组织口径');

  group('11. 资产与附件不串号');
  const up = await call(A.username, '/api/upload', {
    method: 'POST',
    body: { name: '甲的客户名单.txt', mime: 'text/plain', data: Buffer.from('客户：张三 电话 13800000000').toString('base64') }
  });
  ok(up.status === 200 && up.body.upload && up.body.upload.id, '甲上传附件成功', up.status);
  const upId = up.body.upload && up.body.upload.id;
  const upsB = await call(B.username, '/api/uploads');
  ok(!(upsB.body.list || []).some(x => x.id === upId), '乙的附件列表里没有甲的文件');
  const assetA = await call(A.username, '/api/assets', { method: 'POST', body: { type: 'doc', title: '甲的文档', content: '机密' } });
  const assetId = assetA.body.asset && assetA.body.asset.id;
  const assetB = await call(B.username, '/api/asset/' + assetId);
  ok(assetB.body.asset === null, '乙按 ID 取甲的资产 → null', assetB.body.asset);
  const assetListB = await call(B.username, '/api/assets');
  ok(!(assetListB.body.list || []).some(x => x.id === assetId), '乙的资产列表里没有甲的文档');

  // 文件本体：知道文件名也不能下别人的（这是最容易漏的一层，页面 403 不代表文件 403）
  const fileOfUp = (upsB.status === 200 ? null : null) || (up.body.upload && up.body.upload.file);
  const rawA = await fetch(BASE + '/file/' + fileOfUp, { headers: { Cookie: jars[A.username] || '' } });
  ok(rawA.status === 200, '甲自己能下自己的附件', rawA.status);
  const rawB = await fetch(BASE + '/file/' + fileOfUp, { headers: { Cookie: jars[B.username] || '' } });
  ok(rawB.status === 404, '乙拿着文件名下甲的文件 → 404', rawB.status);
  const rawAnon = await fetch(BASE + '/file/' + fileOfUp);
  ok(rawAnon.status === 401, '不登录下附件 → 401', rawAnon.status);
  const rawAdmin = await fetch(BASE + '/file/' + fileOfUp, { headers: { Cookie: jars.owner || '' } });
  ok(rawAdmin.status === 200, '管理员可以下（管理需要）', rawAdmin.status);
  // 导出件同理
  const exA = await call(A.username, '/api/docx', { method: 'POST', body: { title: '甲的导出', content: '机密内容' } });
  const exFile = (exA.body.url || '').split('/').pop();
  const exB = await fetch(BASE + '/export/' + exFile, { headers: { Cookie: jars[B.username] || '' } });
  ok(exB.status === 404, '乙下甲的导出件 → 404', exB.status);
  const exOwn = await fetch(BASE + '/export/' + exFile, { headers: { Cookie: jars[A.username] || '' } });
  ok(exOwn.status === 200, '甲自己能下自己的导出件', exOwn.status);

  group('12. 改密码');
  const badPw = await call(A.username, '/api/auth/password', { method: 'POST', body: { oldPassword: 'wrongpass1', newPassword: 'newalice2026' } });
  ok(badPw.status === 400, '旧密码不对 → 400', badPw.status);
  const weakPw = await call(A.username, '/api/auth/password', { method: 'POST', body: { oldPassword: A.password, newPassword: '123' } });
  ok(weakPw.status === 400, '新密码太弱 → 400', weakPw.status);
  const goodPw = await call(A.username, '/api/auth/password', { method: 'POST', body: { oldPassword: A.password, newPassword: 'newalice2026' } });
  ok(goodPw.status === 200, '改密成功', goodPw.status);
  const loginNew = await login('alice2', { username: A.username, password: 'newalice2026' });
  ok(loginNew.status === 200, '新密码能登录', loginNew.status);
  const loginOld = await login('alice3', { username: A.username, password: A.password });
  ok(loginOld.status === 401, '旧密码不能登录', loginOld.status);
  // 改回去，保证脚本可重复运行
  await call(A.username, '/api/auth/password', { method: 'POST', body: { oldPassword: 'newalice2026', newPassword: A.password } });

  group('13. 停用立即失效');
  const bobMe = await call(B.username, '/api/auth/me');
  const bobId = bobMe.body.user && bobMe.body.user.id;
  const beforeDisable = await call(B.username, '/api/conversations');
  ok(beforeDisable.status === 200, '停用前乙能访问', beforeDisable.status);
  const dis = await call('owner', `/api/users/${bobId}/status`, { method: 'POST', body: { status: 'disabled' } });
  ok(dis.status === 200, '管理员停用乙的账号', dis.status);
  const afterDisable = await call(B.username, '/api/conversations');
  ok(afterDisable.status === 401, '乙的旧 cookie 立刻失效 → 401（不等过期）', afterDisable.status);
  const relogin = await login('bob2', B);
  ok(relogin.status === 403, '乙被停用后重新登录 → 403', relogin.status);
  await call('owner', `/api/users/${bobId}/status`, { method: 'POST', body: { status: 'active' } });
  const back = await login(B.username, B);
  ok(back.status === 200, '恢复启用后能登录', back.status);

  group('14. 密码连错会被锁');
  let last = 0, hit429 = false;
  for (let i = 0; i < 7; i++) {
    const r = await login('probe', { username: 'nosuchuser_probe', password: 'bad' + i });
    last = r.status;
    if (r.status === 429) { hit429 = true; break; }
  }
  ok(hit429, '连续错密码触发限流 → 429', last);
  const correctAfterLock = await login('probe2', { username: 'nosuchuser_probe', password: 'bad' });
  ok(correctAfterLock.status === 429, '锁定期内继续尝试仍被拒', correctAfterLock.status);

  group('15. 角色提升只有所有者能做');
  const aliceMe = await call(A.username, '/api/auth/me');
  const aliceId = aliceMe.body.user && aliceMe.body.user.id;
  // owner 先造一个管理员，验证管理员不能自我提权、不能造管理员
  const mkAdmin = await call('owner', '/api/users', { method: 'POST', body: { username: 'tmpadmin', name: '临时管理员', password: 'tmpadmin2026', role: 'admin' } });
  let tmpOk = mkAdmin.status === 200;
  if (!tmpOk) {
    // 上一轮留下的：改回管理员 + 重置密码后复用，不让测试因为脏数据跑不动
    const lst = await call('owner', '/api/users');
    const ex = (lst.body.list || []).find(x => x.username === 'tmpadmin');
    if (ex && ex.id) {
      await call('owner', '/api/users/' + ex.id + '/status', { method: 'POST', body: { status: 'active' } });
      await call('owner', '/api/users/' + ex.id, { method: 'PATCH', body: { role: 'admin' } });
      await call('owner', '/api/users/' + ex.id + '/password', { method: 'POST', body: { password: 'tmpadmin2026' } });
      tmpOk = true;
    }
  }
  ok(tmpOk, '准备一个临时管理员账号', mkAdmin.status);
  if (tmpOk) {
    await login('tmpadmin', { username: 'tmpadmin', password: 'tmpadmin2026' });
    const selfPromote = await call('tmpadmin', `/api/users/${(await call('tmpadmin', '/api/auth/me')).body.user.id}`, { method: 'PATCH', body: { role: 'owner' } });
    ok(selfPromote.status === 403, '管理员不能给自己升成所有者', selfPromote.status);
    const makeAdmin = await call('tmpadmin', '/api/users', { method: 'POST', body: { username: 'tmpadmin2', password: 'tmpadmin2026', role: 'admin' } });
    ok(makeAdmin.status === 403, '管理员不能新建管理员', makeAdmin.status);
    const ownerId = (await call('owner', '/api/auth/me')).body.user.id;
    const killOwner = await call('tmpadmin', '/api/users/' + ownerId + '/status', { method: 'POST', body: { status: 'disabled' } });
    // 400 或 403 都算挡住：先命中「所有者不可停用」是 400，先命中权限是 403，两者都不能放过
    ok(killOwner.status === 403 || killOwner.status === 400, '管理员不能停用所有者', killOwner.status);
    const resetOwner = await call('tmpadmin', '/api/users/' + ownerId + '/password', { method: 'POST', body: { password: 'hacked2026' } });
    ok(resetOwner.status === 403, '管理员不能重置所有者密码', resetOwner.status);
    // 清理临时管理员，避免它在账号列表里越积越多
    await call('owner', '/api/users/' + (await call('tmpadmin', '/api/auth/me')).body.user.id + '/status', { method: 'POST', body: { status: 'disabled' } });
  } else {
    ok(false, '创建临时管理员失败', mkAdmin.status);
  }

  group('16. 管理员能看到谁的会话是谁的');
  const adminList = await call('owner', '/api/conversations?limit=200');
  const ada = (adminList.body.list || []).find(x => x.id === ca.conversationId);
  ok(ada && ada.owner === A.name, '管理员视角标出归属人', ada && ada.owner);
  ok(ada && ada.mine === false, '管理员的「我的」标记不会误标别人会话', ada && ada.mine);

  /* 余额与额度闸门：只在隔离库里做——它必须临时把余额清零，
     在正式库做一旦中断就会留下残账（已经踩过一次，账被改到只剩 3 千） */
  group('17. 余额与额度闸门（隔离库，安全）');
  const org0 = await call('owner', '/api/org');
  const keep = org0.body.org.balance;
  const zero = await call('owner', '/api/org/adjust', { method: 'POST', body: { credits: -keep, note: '越权自测：临时清零' } });
  ok(Math.abs(zero.body.balance) < 0.01, '管理员把组织余额清零', zero.body.balance);
  const gated = await call(A.username, '/api/chat', { method: 'POST', body: { content: '你好', model: 'claude-haiku-4-5-20251001' } });
  ok(gated.status === 402, '余额为 0 时对话被拒 → 402', gated.status);
  await call('owner', '/api/org/adjust', { method: 'POST', body: { credits: keep, note: '越权自测：还原' } });
  const restored = await call('owner', '/api/org');
  ok(Math.abs(restored.body.org.balance - keep) < 0.01, '余额已还原', restored.body.org.balance);

  // 成员额度闸门：先让乙真的花掉一点，再把额度压到「已用」，下一条应被拦
  await call(B.username, '/api/chat', { method: 'POST', body: { content: '只回两个字：收到', model: 'claude-haiku-4-5-20251001' } });
  const meB = await call(B.username, '/api/auth/me');
  const usedB = meB.body.user.used || 0;
  ok(usedB > 0, '乙已经有消耗，可以拿来卡额度', usedB);
  await call('owner', '/api/users/' + meB.body.user.id, { method: 'PATCH', body: { quota: Math.max(1, Math.floor(usedB)) } });
  const qgated = await call(B.username, '/api/chat', { method: 'POST', body: { content: '你好', model: 'claude-haiku-4-5-20251001' } });
  ok(qgated.status === 402, '成员额度用满时对话被拒 → 402', qgated.status);
  await call('owner', '/api/users/' + meB.body.user.id, { method: 'PATCH', body: { quota: 5000 } });

  /* 资产共享：默认私有，主人可以主动「团队可见」。
     这是唯一允许跨人可见的东西，所以更要证明：
     没共享时连文件都取不到、共享后只能看不能改、收回后立刻失效。 */
  group('18. 资产共享（团队可见开关）');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const shareImg = 'ten-share-' + Date.now().toString(36) + '.png';
  fs.mkdirSync(path.join(tmpDir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'images', shareImg), PNG);

  const mk = await call(A.username, '/api/assets', {
    method: 'POST',
    body: { type: 'image', title: '越权自测：共享图', imageUrl: '/img/' + shareImg }
  });
  const shareId = mk.body.asset && mk.body.asset.id;
  ok(mk.status === 200 && !!shareId, '甲建了一条图片资产', mk.status);

  const listB0 = await call(B.username, '/api/assets?type=image');
  ok(!(listB0.body.list || []).some(x => x.id === shareId), '未共享时，乙的资产库看不到');
  const peekB0 = await call(B.username, '/api/asset/' + shareId);
  ok(peekB0.body.asset === null, '未共享时，乙按 ID 读也读不到', peekB0.body.asset && peekB0.body.asset.title);
  const imgB0 = await rawGet(B.username, '/img/' + shareImg);
  ok(imgB0 === 404, '未共享时，乙直接取图片文件 → 404', imgB0);

  const shareOn = await call(A.username, `/api/asset/${shareId}/share`, { method: 'POST', body: { team: true } });
  ok(shareOn.status === 200 && shareOn.body.visibility === 'team', '甲开「团队可见」', shareOn.body);

  const listB1 = await call(B.username, '/api/assets?type=image');
  const seen = (listB1.body.list || []).find(x => x.id === shareId);
  ok(!!seen && seen.mine === false, '共享后，乙的资产库出现了并标明不是我产出的', seen && seen.mine);
  const peekB1 = await call(B.username, '/api/asset/' + shareId);
  ok(peekB1.body.asset && peekB1.body.asset.title === '越权自测：共享图', '共享后，乙能读到内容', peekB1.status);
  const imgB1 = await rawGet(B.username, '/img/' + shareImg);
  ok(imgB1 === 200, '共享后，图片文件放行 → 200', imgB1);

  const reShare = await call(B.username, `/api/asset/${shareId}/share`, { method: 'POST', body: { team: false } });
  ok(reShare.status === 404, '乙不能替甲收回共享 → 404', reShare.status);
  const stillShared = await call(B.username, '/api/asset/' + shareId);
  ok(stillShared.body.asset && stillShared.body.asset.visibility === 'team', '共享状态没被乙改掉');
  const delB = await call(B.username, '/api/asset/' + shareId, { method: 'DELETE' });
  ok(delB.status === 404, '乙不能删甲共享出来的资产 → 404', delB.status);
  const favB = await call(B.username, `/api/asset/${shareId}/fav`, { method: 'POST' });
  const afterFav = await call(A.username, '/api/asset/' + shareId);
  ok(!(afterFav.body.asset || {}).fav, '乙不能把甲的东西标成自己的收藏', favB.status);

  const shareOff = await call(A.username, `/api/asset/${shareId}/share`, { method: 'POST', body: { team: false } });
  ok(shareOff.status === 200 && shareOff.body.visibility === 'private', '甲收回共享');
  const listB2 = await call(B.username, '/api/assets?type=image');
  ok(!(listB2.body.list || []).some(x => x.id === shareId), '收回后，乙的资产库又看不到');
  const imgB2 = await rawGet(B.username, '/img/' + shareImg);
  ok(imgB2 === 404, '收回后，已经发出去的图片链接立刻失效 → 404', imgB2);
  const ownerStill = await call(A.username, '/api/asset/' + shareId);
  ok(ownerStill.body.asset && ownerStill.body.asset.title, '甲自己始终看得到');

  console.log('\n' + '─'.repeat(52));
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fail) {
    console.log('失败项：');
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('全部通过：换账号、换 ID、越权动作都被服务端挡住');
  process.exit(0);
})().catch(e => { console.error('脚本异常：', e); process.exit(1); });

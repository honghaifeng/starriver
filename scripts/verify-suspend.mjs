import { USER, PASS } from './_cred.mjs';
/* 挂起（暂停使用）验证
   背景：原平台没有启停开关，账号主人靠改名加「（挂起）」标记。
   这里验四件事：
   ① 启动时把命名约定固化成 suspended 字段（38 个 Agent 全都有布尔值）
   ② 挂起 Agent 服务端拒发（409）且不留空会话
   ③ 前端有提示条 + 「取消挂起，启用它」开关，点完真的能用
   ④ 改名不再改变启停状态（这正是旧实现「按名字正则判断」的坑） */
// BASE 可覆盖：体验库（7788）跑验收时不要指向正式库，否则会往真实数据里塞测试内容
const BASE = process.env.BASE || 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const jar = [];
let RESTORE = null; // 崩溃兜底：把两个原始 Agent 重新挂起
async function api(path, opts = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', cookie: jar.join('; '), ...(opts.headers || {}) }
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of sc) jar.push(c.split(';')[0]);
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch { /* SSE 或空 */ }
  return { status: r.status, body: j, text: txt };
}

(async () => {
  /* ---------- ① 字段固化 ---------- */
  let r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: USER, password: PASS }) });
  ok(r.status === 200, '登录成功');

  // 先把现场归位：名字里带「（挂起）」的两个 Agent 恢复成挂起，保证断言是确定的
  r = await api('/api/bootstrap');
  const agents0 = r.body.boxes.flatMap(b => b.agents);
  const named = agents0.filter(a => /（挂起）$/.test(a.name));
  for (const a of named) await api('/api/agent/' + a.id, { method: 'PATCH', body: JSON.stringify({ suspended: true }) });
  // 中途抛错也要还原：否则这两个 Agent 会静默变成「已启用」，库里状态和原平台对不上
  RESTORE = async () => { for (const a of named) await api('/api/agent/' + a.id, { method: 'PATCH', body: JSON.stringify({ suspended: true }) }); };

  r = await api('/api/bootstrap');
  const agents = r.body.boxes.flatMap(b => b.agents);
  const susp = agents.filter(a => a.suspended);
  ok(agents.length > 30, `读到 ${agents.length} 个 Agent`);
  ok(agents.every(a => typeof a.suspended === 'boolean'), '每个 Agent 都有布尔 suspended 字段');
  ok(susp.length === 2 && susp.some(a => /案例故事长图文/.test(a.name)) && susp.some(a => /客户案例视频/.test(a.name)),
    `挂起的是哪两个：${susp.map(a => a.name).join('、')}`);

  /* ---------- ② 服务端拒发 ---------- */
  const target = susp.find(a => /案例故事长图文/.test(a.name)) || susp[0];
  const other = susp.find(a => a.id !== target.id) || susp[1] || target;
  const convBefore = (await api('/api/conversations?limit=1000')).body.total;
  r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ agentId: target.id, content: '挂起测试' }) });
  ok(r.status === 409, `挂起 Agent 发送被拒：HTTP ${r.status} ${(r.body || {}).error || ''}`);
  const convAfter = (await api('/api/conversations?limit=1000')).body.total;
  ok(convAfter === convBefore, `被拒后没留空会话（${convBefore} → ${convAfter}）`);

  /* ---------- ④ 改名不改变启停 ---------- */
  r = await api('/api/agent/' + target.id, { method: 'PATCH', body: JSON.stringify({ name: target.name.replace('（挂起）', '') }) });
  ok(r.status === 200 && r.body.agent.suspended === true, '去掉名字后缀，挂起状态不变（仍为 true）');
  r = await api('/api/agent/' + target.id, { method: 'PATCH', body: JSON.stringify({ name: target.name }) });
  ok(r.body.agent.suspended === true, '名字改回来，挂起状态仍为 true');

  /* ---------- ③ 开关能解除，也能再加回去 ---------- */
  r = await api('/api/agent/' + target.id, { method: 'PATCH', body: JSON.stringify({ suspended: false }) });
  ok(r.status === 200 && r.body.agent.suspended === false, '取消挂起（字段置 false）');
  const boot2 = await api('/api/bootstrap');
  ok(boot2.body.boxes.flatMap(b => b.agents).filter(a => a.suspended).length === 1, 'bootstrap 里挂起数从 2 变 1');

  /* ---------- UI ---------- */
  const { chromium } = await import('./_pw.mjs');
  const br = await chromium.launch({ channel: 'chrome' });
  const p = await br.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) { await p.fill('#u', USER); await p.fill('#p', PASS); await p.click('#loginBtn'); await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); } }
  await p.waitForTimeout(800);

  await p.evaluate(() => location.hash = '#/agents');
  await p.waitForTimeout(1200);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.susp-chip')].map(x => x.textContent.trim()));
  ok(chips.length === 1, `Agent 列表里还有 ${chips.length} 个挂起标记（已解除的那个不再标）`);

  // 打开仍挂起的那个 Agent 的对话页
  const stillSusp = other;
  await p.evaluate(id => location.hash = '#/agent/' + id, stillSusp.id);
  await p.waitForTimeout(1200);
  ok(await p.evaluate(() => !!document.querySelector('.susp-bar')), '挂起 Agent 的对话页有红条说明');
  ok(await p.evaluate(() => !!document.querySelector('#btnUnSusp')), '红条上有「取消挂起」按钮');

  // 发送被前端拦下
  await p.fill('#chatInput', '挂起时能发吗');
  await p.click('#sendBtn');
  await sleep(600);
  const toastTxt = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok(/挂起/.test(toastTxt), `前端拦下发送：「${toastTxt.trim()}」`);

  // 点按钮解除
  await p.click('#btnUnSusp');
  await sleep(1800);
  ok(await p.evaluate(() => !document.querySelector('.susp-bar')), '点完「取消挂起」红条消失');
  const boot3 = await api('/api/bootstrap');
  ok(boot3.body.boxes.flatMap(b => b.agents).filter(a => a.suspended).length === 0, '两个都解除后库里挂起数归零');

  // 切换 Agent 弹窗：挂起项灰且有启用按钮（先把它重新挂起）
  await api('/api/agent/' + stillSusp.id, { method: 'PATCH', body: JSON.stringify({ suspended: true }) });
  await p.evaluate(() => location.hash = '#/chat');
  await p.waitForTimeout(600);
  await p.evaluate(() => { const b = document.querySelector('#atAgentBtn'); if (b) b.click(); });
  await sleep(900);
  const modal = await p.evaluate(() => {
    const s = [...document.querySelectorAll('.ap-item.susp')];
    return { susp: s.length, enable: document.querySelectorAll('.ap-enable').length, total: document.querySelectorAll('.ap-item').length };
  });
  ok(modal.susp === 1 && modal.enable === 1, `切换弹窗：${modal.total} 项里 ${modal.susp} 项灰显、带 ${modal.enable} 个「取消挂起」`);

  ok(errs.length === 0, `无 JS 报错${errs.length ? '：' + errs[0] : ''}`);
  await br.close();

  /* ---------- 还原现场：两个原始 Agent 恢复成挂起，测试新建的删掉 ---------- */
  for (const a of susp) await api('/api/agent/' + a.id, { method: 'PATCH', body: JSON.stringify({ suspended: true }) });
  const fin = await api('/api/bootstrap');
  const finSusp = fin.body.boxes.flatMap(b => b.agents).filter(a => a.suspended).map(a => a.name);
  ok(finSusp.length === 2, `收尾还原：挂起回到 2 个（${finSusp.join('、')}）`);

  console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error('运行出错：', e);
  if (RESTORE) { try { await RESTORE(); console.log('已把两个原始 Agent 还原为挂起（挂起数应回到 2）'); } catch (e2) { console.error('还原失败：', e2.message); } }
  process.exit(1);
});

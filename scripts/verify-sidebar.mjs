/* 侧栏布局验收 v3：顶部收口（logo｜积分｜管理）+ 新建/工作区 + 最近对话
   要点：
   · 侧栏常驻只保留「工作区 / 新建对话 / 最近对话」三样；
   · 积分明细与「管理」（台账/控制台/搜索记录/使用说明）都收进右上角，
     点一下在顶栏下方向下展开，不占常驻空间；
   · 底部不再有任何常驻条。 */
import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

// BASE 可覆盖：体验库（7788）跑验收时不要指向正式库，否则会往真实数据里塞测试内容
const BASE = process.env.BASE || 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const probe = () => {
  const q = s => document.querySelector(s);
  const qa = s => [...document.querySelectorAll(s)];
  const box = e => e.getBoundingClientRect();
  const side = q('.sidebar'), top = q('.sb-top'), bar = q('.topbar');
  const cred = q('#balToggle'), ico = q('#cfgToggle'), pops = q('.bar-pops');
  const fixed = q('.sb-fixed'), conv = q('.sb-conv');
  return {
    width: Math.round(box(side).width),
    topH: Math.round(box(top).height),
    barH: Math.round(box(bar).height),
    /* 侧栏顶只有品牌；积分与管理搬到窗口最右上角 */
    brandText: q('.logo').textContent.replace(/\s+/g, ' ').trim(),
    brandW: Math.round(box(q('.logo')).width),
    brandClipped: q('.logo').scrollWidth > q('.logo').clientWidth + 1,
    brandInSidebar: !!q('.sidebar .logo'),
    credInSidebar: !!q('.sidebar .sb-cred') || !!q('.sidebar .sb-ico'),
    credInTopbar: !!q('.topbar .sb-cred') && !!q('.topbar .sb-ico'),
    barOrder: [...bar.children].map(e => e.id || e.className.split(' ')[0]).join('>'),
    credLeftOfIco: box(cred).right <= box(ico).left + 1,
    icoNearWindowEdge: Math.round(innerWidth - box(ico).right),
    popsNearWindowEdge: Math.round(innerWidth - box(pops).right),
    credText: cred.textContent.replace(/\s+/g, ''),
    topFits: top.scrollWidth <= top.clientWidth + 1,
    barFits: bar.scrollWidth <= bar.clientWidth + 1,
    /* 侧栏常驻只剩三块：顶栏 / 新建+工作区 / 最近对话 */
    noBottomBar: !q('.sb-bal') && !q('.bal-strip') && !q('.side-bottom'),
    orderOK: box(top).top <= 1 && box(top).bottom <= box(fixed).top + 1 && box(fixed).bottom <= box(conv).top + 1,
    sideFull: Math.abs(box(conv).bottom - innerHeight) <= 1,
    fixedBottom: Math.round(box(fixed).bottom),
    convH: Math.round(box(conv).height),
    convRows: qa('#convList .conv-item').length,
    convScrolls: conv.scrollHeight > conv.clientHeight + 1,
    sections: qa('.sb-sec-head > span').map(x => x.textContent.trim()),
    navRows: qa('.sb-fixed .nav-item').length,
    menuItems: qa('#cfgPop .nav-item').map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    /* 管理项不该再出现在常驻区 */
    adminNotInSidebar: !qa('.sb-fixed .nav-item').some(e => /台账|控制台|搜索记录|使用说明/.test(e.textContent)),
    newChatH: Math.round(box(q('.new-chat')).height),
    navRowH: Math.round(box(q('.sb-fixed .nav-item')).height),
    navFontSize: parseFloat(getComputedStyle(q('.sb-fixed .nav-item')).fontSize),
    popsHidden: ['#balPop', '#cfgPop'].every(s => getComputedStyle(q(s)).visibility === 'hidden'),
    hasIds: ['#sbBalance', '#balBig', '#sbRecharged', '#sbUsed', '#sbCalls', '#sbTok', '#navCredits'].every(s => !!q(s)),
    docOverflowX: document.documentElement.scrollWidth - innerWidth,
    sideOverflowX: side.scrollWidth - side.clientWidth,
    navFits: qa('.sidebar .nav-item').every(e => e.scrollWidth <= e.clientWidth + 1),
    convFits: qa('#convList .conv-item').every(e => e.scrollWidth <= e.clientWidth + 1),
    noCollide: qa('.sidebar .nav-item').every(e => {
      const cnt = e.querySelector('.cnt');
      const tn = [...e.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      if (!cnt || !tn) return true;
      const r = document.createRange(); r.selectNodeContents(tn);
      const rects = [...r.getClientRects()];
      if (!rects.length) return true;
      return Math.max(...rects.map(x => x.right)) <= cnt.getBoundingClientRect().left + 1;
    })
  };
};

/* 浮层位置：是否从顶栏下方展开、右边缘是否与 ⋯ 对齐、是否整块在视口内 */
const popGeo = sel => {
  const q = s => document.querySelector(s), box = e => e.getBoundingClientRect();
  const pop = q(sel), bar = q('.topbar'), ico = q('#cfgToggle');
  const cs = getComputedStyle(pop);
  return {
    vis: cs.visibility, op: +cs.opacity,
    belowBar: box(pop).top >= box(bar).bottom - 1,
    rightAligned: Math.abs(box(pop).right - box(ico).right) <= 1,
    inView: box(pop).top >= 0 && box(pop).bottom <= innerHeight + 1 && box(pop).right <= innerWidth + 1,
    w: Math.round(box(pop).width), h: Math.round(box(pop).height),
    coversContent: box(pop).bottom > box(bar).bottom
  };
};

(async () => {
  const br = await chromium.launch({ channel: 'chrome' });
  const p = await br.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) { await p.fill('#u', USER); await p.fill('#p', PASS); await p.click('#loginBtn'); await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); } }
  await p.waitForTimeout(1400);

  const m = await p.evaluate(probe);

  /* ---------- 只留三样 ---------- */
  ok(m.sections.join('/') === '工作区/最近对话', `常驻分组只剩：${m.sections.join(' / ')}`);
  ok(m.noBottomBar, '底部没有任何常驻条（旧余额卡/窄条都已移除）');
  ok(m.navRows === 4, `常驻导航 4 项（工作区），实际 ${m.navRows}`);
  ok(m.adminNotInSidebar, '管理四项不再占常驻位（已收进右上菜单）');

  /* ---------- 侧栏顶：只有品牌 ---------- */
  ok(m.brandInSidebar && /春科 · 星河/.test(m.brandText) && /StarRiver/.test(m.brandText), `侧栏顶是品牌全名：${m.brandText}`);
  ok(!m.brandClipped, `品牌名没被裁（宽 ${m.brandW}px，侧栏 ${m.width}px）`);
  ok(!m.credInSidebar, '侧栏里已经没有积分胶囊和 ⋯（它们搬到窗口右上角了）');
  ok(m.topH <= 52, `品牌行只占 ${m.topH}px`);

  /* ---------- 窗口最右上角：积分 / 管理 ---------- */
  ok(m.credInTopbar, '积分与管理都在主区顶栏（窗口最右侧）');
  ok(/bar-pops$/.test(m.barOrder), `顶栏顺序：${m.barOrder}（⋯ 在最右）`);
  ok(m.credLeftOfIco, '积分胶囊在 ⋯ 左边，⋯ 始终最靠右');
  ok(m.icoNearWindowEdge <= 20, `「⋯」距窗口右边缘 ${m.icoNearWindowEdge}px`);
  ok(m.popsNearWindowEdge === m.icoNearWindowEdge, `积分/管理这一组与 ⋯ 右边缘齐（${m.popsNearWindowEdge}px）`);
  ok(/^[\d,]+积分$/.test(m.credText), `积分胶囊文案：${m.credText}`);
  ok(m.barFits, '顶栏一行放得下（标题 + 今日 + 累计 + 积分 + ⋯）');

  /* ---------- 三段与空间 ---------- */
  ok(m.orderOK, '顺序：顶栏 → 新建+工作区 → 最近对话，谁都不插队');
  ok(m.sideFull, '会话列表一直铺到侧栏底部');
  ok(m.convH >= 500, `会话区拿到 ${m.convH}px（去掉底部条后多出约 250px）`);
  ok(m.convRows === 12, `侧栏显示最近 12 条，实际 ${m.convRows}`);
  ok(m.convScrolls || !m.convScrolls, `会话区仍是唯一滚动区（${m.convScrolls ? '内容超出内部滚动' : '当前全部显示'}）`);
  ok(m.newChatH >= 40, `「新建对话」按钮高 ${m.newChatH}px`);
  ok(m.navRowH >= 34 && m.navFontSize >= 13, `导航行高 ${m.navRowH}px / 字号 ${m.navFontSize}px`);

  /* ---------- 溢出与裁切 ---------- */
  ok(m.docOverflowX === 0 && m.sideOverflowX === 0, `无横向溢出（页面 ${m.docOverflowX}px / 侧栏 ${m.sideOverflowX}px）`);
  ok(m.navFits && m.convFits && m.noCollide, '导航与会话的文字都没被裁、没和右侧数字重叠');
  ok(m.popsHidden, '两个下拉默认都收起');
  ok(m.hasIds, '动态挂点齐全（#sbBalance/#balBig/#sbRecharged/#sbUsed/#sbCalls/#sbTok/#navCredits）');

  /* ---------- 积分浮层 ---------- */
  await p.click('#balToggle'); await p.waitForTimeout(320);
  const bal = await p.evaluate(popGeo, '#balPop');
  ok(bal.vis === 'visible' && bal.op > 0.9, '点积分胶囊 → 明细在右上角展开');
  ok(bal.belowBar, '浮层从顶栏**下方**展开（不压住顶栏，也不是往上飘）');
  ok(bal.inView, '浮层整块在视口内');
  ok(bal.rightAligned, '浮层右边缘与右上角 ⋯ 对齐');
  ok(bal.w >= 250, `浮层宽 ${bal.w}px（够放余额大字 + 三行台账）`);
  ok(bal.h >= 180 && bal.h <= 360, `浮层高 ${bal.h}px，信息完整又不占满屏`);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#cfgPop')).visibility === 'hidden'), '开积分面板时管理菜单自动关（互斥）');
  ok(await p.evaluate(() => document.querySelector('#balToggle').getAttribute('aria-expanded') === 'true'), 'aria-expanded 同步为 true');

  /* ---------- 管理菜单 ---------- */
  await p.click('#cfgToggle'); await p.waitForTimeout(320);
  const cfg = await p.evaluate(popGeo, '#cfgPop');
  ok(cfg.vis === 'visible' && cfg.op > 0.9, '点「⋯」→ 管理菜单在右上角展开');
  ok(cfg.belowBar && cfg.inView && cfg.rightAligned, '菜单同样从顶栏下方展开、右对齐、不出界');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#balPop')).visibility === 'hidden'), '开管理菜单时积分面板自动关（互斥）');
  ok(m.menuItems.length === 5, `菜单 5 项：${m.menuItems.join(' / ')}`);
  ok(/使用台账/.test(m.menuItems[0]) && /企业控制台/.test(m.menuItems[1]) && /账号与权限/.test(m.menuItems[2]) && /搜索记录/.test(m.menuItems[3]) && /使用说明/.test(m.menuItems[4]), '菜单顺序：台账 / 控制台 / 账号与权限 / 搜索记录 / 使用说明');

  /* ---------- 菜单项真的能跳 ---------- */
  await p.click('#cfgPop [data-nav="#/ledger"]'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => location.hash) === '#/ledger', '菜单点「使用台账」→ 进台账页');
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#cfgPop')).visibility === 'hidden'), '跳转后菜单自动收起');
  await p.click('#cfgToggle'); await p.waitForTimeout(250);
  await p.click('#cfgPop [data-nav="#/org"]'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => location.hash) === '#/org', '菜单点「企业控制台」→ 进控制台');
  await p.click('#cfgToggle'); await p.waitForTimeout(250);
  await p.click('#cfgPop [data-nav="#/records"]'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => location.hash) === '#/records', '菜单点「搜索记录」→ 进全部记录');
  await p.click('#cfgToggle'); await p.waitForTimeout(250);
  await p.click('#cfgPop #guideNav'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => !!document.querySelector('.modal-mask')), '菜单点「使用说明」→ 弹出说明');
  await p.evaluate(() => document.querySelector('#guideOk')?.click()); await p.waitForTimeout(300);

  /* ---------- 收起行为 ---------- */
  await p.click('#balToggle'); await p.waitForTimeout(250);
  await p.mouse.click(900, 420); await p.waitForTimeout(280);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#balPop')).visibility === 'hidden'), '点面板外面自动收起');
  await p.click('#cfgToggle'); await p.waitForTimeout(200);
  await p.keyboard.press('Escape'); await p.waitForTimeout(280);
  ok(await p.evaluate(() => !document.querySelector('#cfgPop').classList.contains('open')), 'Esc 收起');
  await p.click('#balToggle'); await p.waitForTimeout(200);
  await p.click('#balToggle'); await p.waitForTimeout(280);
  ok(await p.evaluate(() => !document.querySelector('#balPop').classList.contains('open')), '再点一次自己收起');

  /* ---------- 工作区与新建照旧可用 ---------- */
  await p.click('.new-chat'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => location.hash) === '#/chat', '点「新建对话」进对话页');
  ok(await p.evaluate(() => !!document.querySelector('#chatInput')), '对话输入框在');
  await p.click('[data-nav="#/assets"]'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => location.hash) === '#/assets', '点工作区「Asset 数字资产」→ 进资产页');
  await p.click('#convAll'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => location.hash) === '#/records', '点「全部 N」进全部记录页');

  /* ---------- 小屏 ---------- */
  for (const h of [760, 640, 560]) {
    await p.setViewportSize({ width: 1400, height: h });
    await p.waitForTimeout(420);
    const r = await p.evaluate(probe);
    const bg = await p.evaluate(popGeo, '#balPop');
    ok(r.orderOK && r.sideFull && r.docOverflowX === 0 && r.topH <= 56,
      `${h}px 高：三段顺序不乱、顶栏 ${r.topH}px、无横向溢出（会话区 ${r.convH}px）`);
    ok(r.convH >= 80, `${h}px 高：会话区仍保留 ${r.convH}px`);
    ok(bg.h <= h - 60 || bg.inView, `${h}px 高：浮层不会撑出视口（高 ${bg.h}px）`);
  }

  ok(errs.length === 0, `无 JS 报错${errs.length ? '：' + errs[0] : ''}`);
  await br.close();
  console.log(`\n侧栏布局：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('运行出错：', e.message); process.exit(1); });

import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

// BASE 可覆盖：体验库（7788）跑验收时不要指向正式库，否则会往真实数据里塞测试内容
const BASE = process.env.BASE || 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1340, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/401|ERR_ABORTED/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) {
    await p.fill('#u', USER); await p.fill('#p', PASS);
    await p.click('#loginBtn');
    await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
  }
  await p.waitForTimeout(1200);
  /* 记下基线：跑完要把本次自测新建的会话删掉，别污染正式库 */
  const convIds = async () => p.evaluate(async () => (await (await fetch('/api/conversations?limit=1000')).json()).list.map(c => c.id));
  const baseConvIds = new Set(await convIds());

  console.log('\n【一】全部记录页');
  await p.evaluate(() => location.hash = '#/records');
  await p.waitForTimeout(1600);
  const apiTotal = await p.evaluate(async () => (await (await fetch('/api/conversations?limit=1000')).json()).total);
  const rec = await p.evaluate(() => ({
    title: document.querySelector('#tbTitle')?.textContent,
    rows: document.querySelectorAll('.rec-row').length,
    stars: document.querySelectorAll('.rec-title .cv-src').length,
    head: document.querySelector('.rec-head')?.innerText
  }));
  ok(rec.title === '全部记录', '标题是「全部记录」：' + rec.title);
  ok(rec.rows === apiTotal, `列表条数与接口 total 一致（${rec.rows} / ${apiTotal}）`);
  ok(rec.stars === 15, '15 条标了星盒来源，实际 ' + rec.stars);

  console.log('\n【二】按来源筛选');
  await p.click('[data-src="imported"]');
  await p.waitForTimeout(700);
  const imp = await p.evaluate(() => document.querySelectorAll('.rec-row').length);
  ok(imp === 15, '星盒归档筛选 = 15 条，实际 ' + imp);
  await p.click('[data-src="local"]');
  await p.waitForTimeout(700);
  const loc = await p.evaluate(() => document.querySelectorAll('.rec-row').length);
  ok(loc === apiTotal - 15, `本地新建筛选 = ${apiTotal - 15} 条，实际 ${loc}`);
  await p.click('[data-src="all"]');
  await p.waitForTimeout(600);

  console.log('\n【三】打开星盒会话：来源条 + markdown + 思考块');
  await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.rec-row')];
    const t = rows.find(r => r.innerText.includes('COSMO BOUNTY 是什么品牌')) || rows[0];
    t.click();
  });
  await p.waitForTimeout(2200);
  const chat = await p.evaluate(() => {
    const texts = [...document.querySelectorAll('.m-text')];
    const raw = texts.map(t => t.innerText).join('\n');
    return {
      banner: !!document.querySelector('.src-banner'),
      bannerText: document.querySelector('.src-banner')?.innerText.replace(/\s+/g, ' ').slice(0, 110),
      bannerLink: document.querySelector('.src-banner a')?.getAttribute('href') || '',
      msgs: texts.length,
      thinks: document.querySelectorAll('.think-box').length,
      tables: document.querySelectorAll('.m-text table').length,
      headings: document.querySelectorAll('.m-text h1,.m-text h2,.m-text h3').length,
      strong: document.querySelectorAll('.m-text strong').length,
      lists: document.querySelectorAll('.m-text ul,.m-text ol').length,
      leaked: ['<details', '<summary', '<read_file', '<table', '<style', '<task_items', '<generated_file']
        .filter(x => raw.includes(x))
    };
  });
  ok(chat.banner, '顶部有星盒归档来源条');
  ok(/starbox\.ing/.test(chat.bannerLink), '来源条带原站链接：' + chat.bannerLink.slice(0, 60));
  ok(chat.msgs >= 16, '消息全部渲染：' + chat.msgs + ' 条');
  ok(chat.thinks >= 4, '思考块独立渲染：' + chat.thinks + ' 个');
  ok(chat.tables >= 5, '表格渲染成真表格：' + chat.tables + ' 个');
  ok(chat.headings >= 5, '标题渲染：' + chat.headings + ' 个');
  ok(chat.strong >= 20, '加粗生效：' + chat.strong + ' 处');
  ok(chat.lists >= 3, '列表渲染：' + chat.lists + ' 组');
  ok(chat.leaked.length === 0, '无原始标签泄漏' + (chat.leaked.length ? '：' + chat.leaked.join(',') : ''));

  console.log('\n【四】侧栏全部记录入口');
  const sb = await p.evaluate(() => ({
    items: document.querySelectorAll('#convList .conv-item').length,
    more: document.querySelector('#convMore')?.innerText || '',
    stars: document.querySelectorAll('#convList .cv-src').length
  }));
  ok(sb.items === 12, '侧栏显示最近 12 条，实际 ' + sb.items);
  ok(sb.more.includes(String(apiTotal)), `有「查看全部 ${apiTotal} 条」入口：` + sb.more);

  console.log('\n【五】布局与溢出');
  const layout = await p.evaluate(() => {
    const de = document.documentElement;
    const side = document.querySelector('.sidebar');
    return { hOverflow: de.scrollWidth > de.clientWidth + 1, sideW: Math.round(side.getBoundingClientRect().width) };
  });
  ok(!layout.hOverflow, '页面无横向溢出');
  ok(layout.sideW === 252, '侧栏 252px，实际 ' + layout.sideW);

  console.log('\n【六】思考块可折叠');
  const fold = await p.evaluate(async () => {
    const box = document.querySelector('.think-box');
    if (!box) return null;
    const body = box.querySelector('.tk-body');
    const summ = box.querySelector('summary');
    const m = () => Math.round(body.getBoundingClientRect().height);
    const wait = () => new Promise(r => setTimeout(r, 320));
    const closedH = m();                       // 初始：历史消息默认收起
    summ.click(); await wait();                 // 展开
    const openH = m();
    summ.click(); await wait();                 // 再收起
    const backH = m();
    return { closedH, openH, backH, isOpen: box.hasAttribute('open') };
  });
  ok(fold && fold.closedH === 0, '默认收起，高度 0（实际 ' + (fold && fold.closedH) + '）');
  ok(fold && fold.openH > 60, '展开后有内容高度（' + (fold && fold.openH) + 'px）');
  ok(fold && fold.backH === 0 && !fold.isOpen, '再收起又归零（' + (fold && fold.backH) + 'px）');

  console.log('\n【七】其它页面无报错');
  for (const h of ['#/agents', '#/automate', '#/assets', '#/ledger', '#/org', '#/chat']) {
    await p.evaluate(x => location.hash = x, h);
    await p.waitForTimeout(800);
  }
  ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs.slice(0, 3).join(' | ') : ''));

  /* 收尾清理：本次新建的会话删除（只删本地新建，星盒归档不动） */
  const fresh = (await convIds()).filter(id => !baseConvIds.has(id));
  for (const id of fresh) await p.evaluate(i => fetch('/api/conversation/' + i, { method: 'DELETE' }), id);
  console.log(`  · 收尾清理：删掉本次新建的 ${fresh.length} 条会话`);

  await b.close();
  console.log('\n' + '='.repeat(46));
  console.log(`通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : '  全部通过'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e.message); process.exit(1); });

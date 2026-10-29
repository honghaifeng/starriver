import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

const BASE = 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1320, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) {
    await p.fill('#u', USER); await p.fill('#p', PASS);
    await p.click('#loginBtn');
    await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
  }
  await p.waitForTimeout(1000);

  const list = await p.evaluate(async () => (await (await fetch('/api/conversations')).json()).list);
  log('侧栏会话数:', list.length);

  const target = list.find(x => x.turns >= 15) || list[0];
  log('打开:', target.title.slice(0, 44), '| turns', target.turns);
  await p.evaluate(id => { location.hash = '#/chat/' + id; }, target.id);
  await p.waitForTimeout(2200);

  const dom = await p.evaluate(() => {
    const texts = [...document.querySelectorAll('.m-text')];
    const raw = texts.map(t => t.innerText).join('\n');
    const leaked = ['<details', '<summary', '<read_file', '<table', '<div', '<style', '<task_items', '<generated_file']
      .filter(tag => raw.includes(tag));
    return {
      msgs: texts.length,
      thinks: document.querySelectorAll('.think-box').length,
      tables: document.querySelectorAll('.m-text table').length,
      headings: document.querySelectorAll('.m-text h1,.m-text h2,.m-text h3').length,
      strong: document.querySelectorAll('.m-text strong').length,
      leaked,
      lastSample: texts.length ? texts[texts.length - 1].innerText.slice(0, 260) : ''
    };
  });
  log('DOM:', JSON.stringify(dom, null, 1));
  log('JS 报错:', errs.length ? errs.slice(0, 4) : '无');

  await p.screenshot({ path: 'report/imported-chat.png', fullPage: false });

  // 顺带测一个 markdown 表格渲染的会话
  const pdfConv = list.find(x => /整理成pdf/.test(x.title) && x.turns >= 10);
  if (pdfConv) {
    await p.evaluate(id => { location.hash = '#/chat/' + id; }, pdfConv.id);
    await p.waitForTimeout(2200);
    const d2 = await p.evaluate(() => ({
      tables: document.querySelectorAll('.m-text table').length,
      thinks: document.querySelectorAll('.think-box').length,
      msgs: document.querySelectorAll('.m-text').length,
      leaked: ['<div', '<table', '<style', '<details'].filter(t => [...document.querySelectorAll('.m-text')].map(x => x.innerText).join('').includes(t))
    }));
    log('PDF 会话:', JSON.stringify(d2));
    await p.screenshot({ path: 'report/imported-pdf.png' });
  }

  await p.goto(APP + '#/ledger', { waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.screenshot({ path: 'report/imported-ledger.png' });

  await b.close();
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

// 只截图不测试：确认顶栏/侧栏/台账对账条/控制台在真实浏览器里的渲染
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOT = path.join(__dirname, '..', 'report');
// BASE 可覆盖：体验库（7788）跑验收时不要指向正式库，否则会往真实数据里塞测试内容
const BASE = process.env.BASE || 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
fs.mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(APP, { waitUntil: 'networkidle' });
if (await page.$('#p')) {
  await page.fill('#u', USER); await page.fill('#p', PASS);
  await page.click('#loginBtn');
  await page.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await page.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
}
await page.waitForTimeout(800);

// 顶栏与侧栏文案
const money = await page.evaluate(() => ({
  badges: [...document.querySelectorAll('.topbar .badge')].map(e => e.textContent.trim().replace(/\s+/g, ' ')),
  side: [...document.querySelectorAll('.side-bottom .side-meta, .side-bottom .bal-line, .side-bottom .side-note')]
    .map(e => e.textContent.trim().replace(/\s+/g, ' ')),
  bal: (document.querySelector('#sbBalance') || {}).textContent,
  today: (document.querySelector('#tbCost') || {}).textContent
}));
console.log('\n顶栏:', JSON.stringify(money.badges));
console.log('侧栏:', JSON.stringify(money.side, null, 1));

await page.screenshot({ path: path.join(SHOT, 'verify-chat.png') });

// 台账页
await page.goto(APP + '#/ledger', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
const audit = await page.evaluate(() => {
  const a = document.querySelector('.lg-audit');
  return a ? { cls: a.className, text: a.textContent.replace(/\s+/g, ' ').trim() } : null;
});
console.log('\n台账对账条:', audit ? audit.cls + ' | ' + audit.text.slice(0, 260) : '缺失');
await page.screenshot({ path: path.join(SHOT, 'verify-ledger.png'), fullPage: true });

// 控制台
await page.goto(APP + '#/org', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const org = await page.evaluate(() => {
  const a = document.querySelector('.lg-audit');
  const sub = document.querySelector('.lg-card .lg-sub');
  return { audit: a ? a.className + ' | ' + a.textContent.replace(/\s+/g, ' ').slice(0, 200) : null, sub: sub ? sub.textContent.trim() : null };
});
console.log('\n控制台:', JSON.stringify(org, null, 1));
await page.screenshot({ path: path.join(SHOT, 'verify-org.png'), fullPage: true });

console.log('\nJS 报错:', errs.length ? errs : '无');
await browser.close();

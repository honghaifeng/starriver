// 调试脚本：抓 401 来源 + 附件上传链路 + 出图工具事件
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

const BASE = 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('response', async r => {
  const u = r.url();
  if (u.includes('/api/') && r.status() >= 400) console.log('HTTP', r.status(), u);
});
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
page.on('requestfailed', r => console.log('REQFAIL', r.url(), r.failure()?.errorText));

await page.goto(APP);
await page.fill('#u', USER); await page.fill('#p', PASS);
await page.click('#loginBtn');
await page.waitForSelector('.sidebar');
if (await page.isVisible('#guideOk')) await page.click('#guideOk');

await page.click('[data-nav="#/chat"]');
await page.waitForSelector('#attachBtn');

// 直接在页面里检查 upload 接口
const up = await page.evaluate(async () => {
  const r = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'probe.txt', mime: 'text/plain', data: btoa('hello probe ascii only') })
  });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
});
console.log('\n页面内 /api/upload →', up);

// 走真实 input 上传
await page.setInputFiles('#filePick', path.join(ROOT, 'data/ui-smoke.txt'));
await page.waitForTimeout(2500);
console.log('chips:', await page.evaluate(() => document.querySelector('#ciChips').innerHTML.slice(0, 500)));
console.log('composer:', await page.evaluate(() => JSON.stringify(S.composer).slice(0, 300)));
console.log('toasts:', await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent)));

// 发消息 + 抓 SSE 事件
const seen = [];
await page.exposeFunction('__sse', o => seen.push(o));
await page.evaluate(() => {
  const orig = window.fetch;
  window.fetch = async (...a) => {
    const res = await orig(...a);
    if (String(a[0]).includes('/api/chat')) {
      const clone = res.clone();
      (async () => {
        const rd = clone.body.getReader(); const dec = new TextDecoder(); let b = '';
        while (true) { const { done, value } = await rd.read(); if (done) break; b += dec.decode(value, { stream: true });
          const ps = b.split('\n\n'); b = ps.pop();
          for (const p of ps) { const l = p.trim(); if (l.startsWith('data:')) { try { window.__sse(JSON.parse(l.slice(5))); } catch (e) {} } }
        }
      })();
    }
    return res;
  };
});
await page.fill('#chatInput', '生成 1 张 1:1 的图：白底上一片银杏叶。直接出图。');
await page.press('#chatInput', 'Enter');
await page.waitForTimeout(45000);
console.log('\nSSE 事件：', JSON.stringify(seen.filter(e => e.tool || e.error || e.meta).slice(0, 8)));
console.log('最后回复：', await page.evaluate(() => {
  const els = [...document.querySelectorAll('.msg.ai')];
  const last = els[els.length - 1];
  return last ? last.innerText.slice(0, 400) : '(none)';
}));
console.log('工具卡 HTML：', await page.evaluate(() => [...document.querySelectorAll('.tool-card')].map(e => e.outerHTML.slice(0, 200))));
await page.screenshot({ path: path.join(ROOT, 'report/ui-debug.png') });
await browser.close();

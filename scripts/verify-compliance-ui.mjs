// 合规体检条的 UI 验收：真浏览器里把它渲染出来，看结构、展开、点击改写。
//
// 为什么不走「发一条真消息」：那要烧上游 token，而且模型每次回复内容不同，
// 断言就没法写死。这里直接把 /api/compliance/check 的真实返回喂给渲染函数，
// 测的是「渲染 + 交互」，与「模型写了什么」解耦。
//
// 用法：
//   node scripts/verify-compliance-ui.mjs                      # 默认 127.0.0.1:7788
//   BASE=http://127.0.0.1:7777 SB_TEST_USER=x SB_TEST_PASS=y node scripts/verify-compliance-ui.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:7788';
const SHOT = path.join(ROOT, 'report');
fs.mkdirSync(SHOT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', n, extra == null ? '' : String(extra).slice(0, 80)); }
  else { fail++; console.log('  ✗', n, extra == null ? '' : '→ ' + JSON.stringify(extra).slice(0, 200)); }
};

const BAD = '日间瓶主打供能抗炎，三项炎症因子一起列出。激素、农残未检出。遵医嘱。这是全网销量第一的产品。';
const GOOD = '早两粒晚一粒，一盒三十天。早餐后半小时温水送服，坚持四周再看体感变化。';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

console.log('【合规体检 · UI】' + BASE);

await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
await page.fill('#u', USER); await page.fill('#p', PASS);
await page.click('#loginBtn');
await page.waitForSelector('.sidebar', { timeout: 20000 });
// 使用说明弹窗会盖住页面，先关掉
const hasGuide = await page.waitForSelector('.guide-step', { timeout: 2500 }).then(() => true).catch(() => false);
if (hasGuide) { await page.click('#guideOk').catch(() => { }); await page.waitForTimeout(300); }
ok('已进入工作台', true);

// 把两条样例塞进聊天区（走真实接口拿 result，再走真实渲染函数）
await page.evaluate(async ({ bad, good }) => {
  const call = async text => (await (await fetch('/api/compliance/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  })).json()).result;
  const host = document.createElement('div');
  document.querySelectorAll('#compTest').forEach(e => e.remove());
  host.id = 'compTest';
  host.className = 'msg ai';
  host.innerHTML = '<div class="m-body"><div class="m-name">助手</div><div class="m-text"></div><div class="m-tools"></div></div>';
  host.querySelector('.m-text').textContent = bad;
  host.querySelector('.m-tools').innerHTML =
    window.__compHTML(await call(bad)) + window.__compHTML(await call(good));
  document.querySelector('#chatScroll').appendChild(host);
}, { bad: BAD, good: GOOD });

const root = '#compTest';
ok('渲染出体检条', await page.locator(root + ' .comp').count() === 2, await page.locator(root + ' .comp').count());
ok('有命中 → block 样式', await page.locator(root + ' .comp.block').count() === 1);
ok('无命中 → pass 样式', await page.locator(root + ' .comp.pass').count() === 1);
ok('pass 只占一行（不展开）', await page.locator(root + ' .comp.pass details, ' + root + ' .comp.pass .comp-body').count() === 0);

const summary = (await page.locator(root + ' .comp.block .comp-line').textContent()) || '';
ok('摘要说清几处要改', /\d+ 处必须改/.test(summary), summary);
ok('摘要提到建议改', /建议改/.test(summary), summary);
ok('pass 文案是「未发现违禁词」', ((await page.locator(root + ' .comp.pass .comp-line').textContent()) || '').includes('未发现违禁词'));

// 默认收起：明细不该占地方
ok('明细默认收着', !(await page.locator(root + ' .comp.block').evaluate(el => el.open)));

await page.locator(root + ' .comp.block > summary').click();
await page.waitForTimeout(150);
ok('点击后展开', await page.locator(root + ' .comp.block').evaluate(el => el.open));

const rows = await page.locator(root + ' .comp.block .comp-row').count();
ok('命中项逐条列出', rows >= 4, rows);
const marks = await page.locator(root + ' .comp.block .comp-sample mark').allTextContents();
ok('原文片段有高亮', marks.length > 0, marks.join('/'));
ok('高亮的是真违禁词', marks.every(m => ['抗炎', '炎症', '激素', '医嘱', '销量第一'].includes(m)), marks.join('/'));
const sug = await page.locator(root + ' .comp.block .comp-sug').first().textContent();
ok('给了替换建议', /→/.test(sug || ''), sug);
const foot = (await page.locator(root + ' .comp.block .comp-foot').textContent()) || '';
ok('表明了依据来源', /小红书违禁词/.test(foot) && /不会自动改正文/.test(foot), foot.slice(0, 60));

// 结构对不等于看得见：量一下盒子，防止「渲染了但高度为 0 / 被裁掉」
const box = await page.locator(root + ' .comp.block').boundingBox();
ok('体检条有实际尺寸', !!box && box.height > 24 && box.width > 200 && box.width <= 600, box && { w: Math.round(box.width), h: Math.round(box.height) });
const bodyBox = await page.locator(root + ' .comp.block .comp-body').boundingBox();
ok('展开后明细占位', !!bodyBox && bodyBox.height > 40, bodyBox && Math.round(bodyBox.height));
const tagStyle = await page.locator(root + ' .comp.block .comp-tag').evaluate(el => {
  const s = getComputedStyle(el);
  return { color: s.color, bg: s.backgroundColor };
});
ok('block 标签用告警色而非默认色', tagStyle.color !== 'rgb(0, 0, 0)' && tagStyle.bg !== 'rgba(0, 0, 0, 0)', tagStyle);

// 「让它按建议改写」：把要求填进输入框，但不自动发送
await page.fill('#chatInput', '');
await page.locator(root + ' .comp.block .comp-fix').click();
await page.waitForFunction(() => (document.querySelector('#chatInput').value || '').length > 10, null, { timeout: 8000 }).catch(() => { });
const filled = await page.inputValue('#chatInput');
ok('改写要求已填进输入框', /抗炎|合规要求改写/.test(filled), filled.slice(0, 50));
ok('没有自动发送', !(await page.evaluate(() => window.__S.chat.sending)));

await page.locator(root + ' .comp.block > summary').click();
await page.waitForTimeout(200);
await page.locator(root).scrollIntoViewIfNeeded();
await page.locator(root).screenshot({ path: path.join(SHOT, 'compliance-ui.png') }).catch(() => { });
await page.screenshot({ path: path.join(SHOT, 'compliance-ui-full.png') });

ok('页面无 JS 报错', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(`\n截图：report/compliance-ui.png（结果 ${pass} 通过 / ${fail} 失败）`);
process.exit(fail ? 1 : 0);

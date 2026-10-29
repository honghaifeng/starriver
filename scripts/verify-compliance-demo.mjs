#!/usr/bin/env node
/**
 * 演示页验收：确认 report/compliance-demo.html 在浏览器里长得对。
 *
 * 为什么单独验：
 *   这一页是发给客户/同事看的「这就是效果」，它坏了比功能坏了更糟 ——
 *   功能坏了会有报错，页面坏了只会让人以为产品就长这样。
 *   而且它内联了 public/style.css，样式改动（尤其是 CSS 变量）会第一时间在这里露馅。
 *
 * 判据都用计算后的样式，不看截图 —— 本机 report/*.png 读不出来（文件头非 PNG）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './_pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'report/compliance-demo.html');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ← ' + extra : '')); }
};

// channel:'chrome' —— 用系统装的 Chrome。Playwright 自带的 headless shell 常常没下载，
// 报 "Executable doesn't exist" 会让人以为是脚本坏了。
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });

const errors = [];
page.on('pageerror', e => errors.push(e.message));

await page.goto(FILE, { waitUntil: 'load' });

/* --- 结构 --- */
ok('页面无 JS 报错', errors.length === 0, errors.join(' | '));

const blockOpen = await page.locator('.comp.block').first().getAttribute('open');
ok('改前那条默认展开（不展开就看不到明细）', blockOpen !== null);

const rows = await page.locator('.comp.block .comp-row').count();
ok('改前命中 6 类词全部渲染', rows === 6, '实际 ' + rows);

ok('有 pass 态那条（改后的稿子）', await page.locator('.comp.pass').count() === 1);

const marks = await page.locator('.comp.block .comp-sample mark').count();
ok('原文片段里有高亮定位', marks >= 3, '实际 ' + marks);

/* --- 颜色：这是改 CSS 变量的意义所在 --- */
const tagBg = await page.locator('.comp.block .comp-tag').first()
  .evaluate(el => getComputedStyle(el).backgroundColor);
ok('命中标签有底色（不是透明）', tagBg !== 'rgba(0, 0, 0, 0)' && tagBg !== 'transparent', tagBg);

const markBg = await page.locator('.comp.block .comp-sample mark').first()
  .evaluate(el => getComputedStyle(el).backgroundColor);
ok('高亮词有底色', markBg !== 'rgba(0, 0, 0, 0)' && markBg !== 'transparent', markBg);

const [moreC, bodyC] = await page.evaluate(() => {
  const m = document.querySelector('.comp.block .comp-more');
  const b = document.querySelector('.msg.ai .m-text');
  return [getComputedStyle(m).color, getComputedStyle(b).color];
});
ok('「展开›」是次级灰，不是正文色（--sub 生效）', moreC !== bodyC && /rgb\(138, 147, 173\)/.test(moreC), moreC + ' vs ' + bodyC);

const footC = await page.locator('.comp.block .comp-foot').first()
  .evaluate(el => getComputedStyle(el).color);
ok('脚注是次级灰（--sub 生效）', /rgb\(138, 147, 173\)/.test(footC), footC);

const passTag = await page.locator('.comp.pass .comp-tag').first()
  .evaluate(el => getComputedStyle(el).backgroundColor);
ok('pass 标签是绿底（--green-bg 生效）', passTag !== 'rgba(0, 0, 0, 0)' && passTag !== 'transparent', passTag);

/* --- 正文渲染：不能把 markdown 原样漏出来 --- */
const body = await page.locator('.msg.ai .m-text').first().innerText();
ok('标题已渲染成 h3，没有残留 ##', !body.includes('##') && (await page.locator('.msg.ai .m-text h3').count()) === 2);

/* --- 交互 --- */
await page.locator('.comp.block .comp-fix').first().click();
const toast = page.locator('#td');
await toast.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
const toastTxt = await toast.textContent();
ok('点「让它按建议改写」会给出具体改写要求', /请按合规要求改写/.test(toastTxt || '') && /抗炎/.test(toastTxt || ''), (toastTxt || '').slice(0, 70));

// 提示条有 .18s 的位移淡入，立刻读 opacity 会拿到过渡中间值（0.08），误判成不可见。
// 等它稳定下来再断言 —— 这类「动画没跑完就断言」是最常见的假红。
const opacity = await page.waitForFunction(
  () => {
    const el = document.getElementById('td');
    const o = Number(getComputedStyle(el).opacity);
    return o > 0.9 ? o : null;
  },
  null, { timeout: 2000 }
).then(h => h.jsonValue()).catch(() => 0);
ok('提示条可见（--toast-bg 生效，不是透明黑字）', Number(opacity) > 0.5, opacity);

await browser.close();

console.log(`\n演示页：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);

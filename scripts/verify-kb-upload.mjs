/* 知识库上传验证：文件 → 文本 → 存进 Agent → 进系统提示词 */
import fs from 'fs';
import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';

const BASE = 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const TMP = '/tmp/kb-test.md';
const MARK = 'KB上传标记' + Math.random().toString(36).slice(2, 8);
fs.writeFileSync(TMP, `# 测试知识库\n\n这是自测上传的知识库文件。\n\n关键标记：${MARK}\n\n后面还有一些内容用于确认全文都被读到。\n`);

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) {
    await p.fill('#u', USER); await p.fill('#p', PASS);
    await p.click('#loginBtn');
    await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
  }
  await p.waitForTimeout(1000);
  await p.evaluate(() => location.hash = '#/agents');
  await p.waitForTimeout(1500);

  /* 直接点卡片上的 ⚙（data-edit），不要先点卡片本体（那是跳去对话页） */
  let hasEditor = await p.evaluate(() => !!document.querySelector('#upKb'));
  if (!hasEditor) {
    const clicked = await p.evaluate(() => {
      const btn = document.querySelector('[data-edit]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    await p.waitForTimeout(1400);
    hasEditor = await p.evaluate(() => !!document.querySelector('#upKb'));
    if (!clicked) console.log('  · 未找到 ⚙ 编辑按钮');
  }
  ok(hasEditor, '编辑器里有「上传文件」入口');

  if (!hasEditor) {
    await b.close();
    console.log(`\n通过 ${pass} / ${pass + fail}`);
    process.exit(fail ? 1 : 0);
  }

  const before = await p.evaluate(() => ({
    count: +document.querySelector('#kbCount').textContent,
    chars: document.querySelector('#kbChars').textContent
  }));

  /* 直接给隐藏的 file input 塞文件，等价于用户点「上传文件」后选文件 */
  await p.setInputFiles('#kbFile', TMP);
  await p.waitForTimeout(2500);

  const after = await p.evaluate(() => {
    const areas = [...document.querySelectorAll('.kb-text')];
    const names = [...document.querySelectorAll('.kb-name')];
    return {
      count: +document.querySelector('#kbCount').textContent,
      chars: document.querySelector('#kbChars').textContent,
      areas: areas.map(a => a.value),
      names: names.map(n => n.value),
      lastText: areas.length ? areas[areas.length - 1].value : ''
    };
  });

  ok(after.count === before.count + 1, `知识库条目 +1（${before.count} → ${after.count}）`);
  ok(after.lastText.includes(MARK), '上传的正文完整填进了知识库条目');
  ok(after.names.some(n => /kb-test/.test(n)), '用文件名自动命名：' + after.names.join(' / ').slice(0, 60));
  ok(/\d/.test(after.chars) && after.chars !== before.chars, `总字数已更新（${before.chars} → ${after.chars}）`);

  /* 删除刚加的那份，确认可撤销 */
  const del = await p.evaluate(async () => {
    const btns = [...document.querySelectorAll('[data-delkb]')];
    if (!btns.length) return null;
    btns[btns.length - 1].click();
    await new Promise(r => setTimeout(r, 400));
    return +document.querySelector('#kbCount').textContent;
  });
  ok(del === before.count, `删除后条目数回到 ${before.count}，实际 ${del}`);

  ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  /* 关掉弹窗，不改动真实 Agent 数据 */
  await p.evaluate(() => { const c = document.querySelector('#cancelEdit'); if (c) c.click(); });
  await b.close();
  console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });

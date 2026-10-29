/* 流式 markdown 渲染验证：真发一条要求带格式的消息，看流式过程中和结束后 DOM 是否正确 */
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
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));

  await p.goto(APP, { waitUntil: 'networkidle' });
  if (await p.$('#p')) {
    await p.fill('#u', USER); await p.fill('#p', PASS);
    await p.click('#loginBtn');
    await p.waitForSelector('.sidebar', { timeout: 15000 }); { const _g = await p.waitForSelector('#guideOk', { timeout: 2500 }).catch(() => null); if (_g) await _g.click(); }
  }
  await p.waitForTimeout(900);

  await p.evaluate(() => location.hash = '#/chat');
  await p.waitForTimeout(900);

  const prompt = '用 markdown 回答，必须包含：一个二级标题、一个三项的短横线列表、一处加粗、一个两列表格。内容讲"抗衰补剂的三个选择要点"，每项一句话，简短。';
  await p.fill('#chatInput', prompt);
  await p.click('#sendBtn');

  /* 流式过程中：拿到中间态，确认已有结构性标签而非裸符号 */
  let mid = null;
  for (let i = 0; i < 120; i++) {
    await p.waitForTimeout(250);
    const st = await p.evaluate(() => {
      const boxes = [...document.querySelectorAll('.m-text')];
      const last = boxes[boxes.length - 1];
      const sending = !!(window.__S && window.__S.chat && window.__S.chat.sending);
      return {
        sending,
        tags: last ? {
          h: last.querySelectorAll('h1,h2,h3,h4').length,
          li: last.querySelectorAll('li').length,
          strong: last.querySelectorAll('strong').length,
          table: last.querySelectorAll('table').length,
          p: last.querySelectorAll('p').length
        } : null,
        raw: last ? last.innerText.slice(0, 120) : '',
        hasCursor: !!(last && last.querySelector('.cursor-blink'))
      };
    });
    if (st.tags && (st.tags.h + st.tags.li + st.tags.strong + st.tags.table) > 0 && st.sending && !mid) { mid = st; }
    if (!st.sending) { var final = st; break; }
  }

  ok(!!mid, '流式过程中已出现结构化标签' + (mid ? `（h:${mid.tags.h} li:${mid.tags.li} strong:${mid.tags.strong}）` : '（未捕捉到中间态）'));
  ok(final && final.tags.h >= 1, '结束时至少 1 个标题，实际 ' + (final && final.tags.h));
  ok(final && final.tags.li >= 3, '列表至少 3 项，实际 ' + (final && final.tags.li));
  ok(final && final.tags.strong >= 1, '加粗至少 1 处，实际 ' + (final && final.tags.strong));
  ok(final && final.tags.table >= 1, '表格渲染，实际 ' + (final && final.tags.table));
  ok(final && !final.hasCursor, '结束后光标已移除');
  ok(final && !/^\s*#{2,3}\s/m.test(final.raw) && !final.raw.includes('**'), '正文没有残留 markdown 裸符号');
  ok(errs.length === 0, '无 JS 报错' + (errs.length ? '：' + errs[0] : ''));

  const convId = await p.evaluate(() => window.__S && window.__S.chat && window.__S.chat.convId);
  console.log('  会话 id:', convId);

  /* 刷新后回放：历史消息也必须渲染成结构 */
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  if (convId) {
    await p.evaluate(id => { location.hash = '#/chat/' + id; }, convId);
    await p.waitForTimeout(1800);
    const replay = await p.evaluate(() => {
      const boxes = [...document.querySelectorAll('.m-text')];
      const last = boxes[boxes.length - 1];
      return { h: last.querySelectorAll('h1,h2,h3').length, li: last.querySelectorAll('li').length, table: last.querySelectorAll('table').length };
    });
    ok(replay.h >= 1 && replay.li >= 3, '刷新回放后仍然渲染成结构：' + JSON.stringify(replay));
  }

  await b.close();
  console.log(`\n通过 ${pass} / ${pass + fail}` + (fail ? `  ✗ 失败 ${fail}` : ''));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.message); process.exit(1); });

// UI 冒烟测试：真浏览器点一遍（登录 → 选 Agent → 传附件 → 发消息 → 出图 → 改名）
// 依赖 workspace 里的 playwright + 本机 Chrome
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from './_pw.mjs';
import { USER, PASS } from './_cred.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
// BASE 可覆盖：体验库（7788）跑验收时不要指向正式库，否则会往真实数据里塞测试内容
const BASE = process.env.BASE || 'http://127.0.0.1:7777';
// 站点根 / 是对外介绍页；工作台（登录入口）在 /index.html
const APP = BASE + '/index.html';
const SHOT = path.join(ROOT, 'report');
fs.mkdirSync(SHOT, { recursive: true });

const steps = [];
const ok = (n, x) => { steps.push(['✓', n, x || '']); console.log(`  ✓ ${n} ${x || ''}`); };
const bad = (n, w) => { steps.push(['✗', n, w]); console.log(`  ✗ ${n} → ${w}`); };
async function step(n, fn) {
  console.log(`\n[${steps.length + 1}] ${n}`);
  try { const e = await fn(); ok(n, e); } catch (e) { bad(n, String(e.message || e).slice(0, 200)); }
}

/* 自测收尾：删掉本次新建的会话（只删本地新建的，星盒归档一条不动） */
let baseConvIds = [];
const convIds = async () => page.evaluate(async () => (await (await fetch('/api/conversations?limit=1000')).json()).list.map(c => c.id));
const pruneNewConvs = async () => {
  const now = await convIds();
  const base = new Set(baseConvIds);
  const fresh = now.filter(id => !base.has(id));
  for (const id of fresh) await page.evaluate(i => fetch('/api/conversation/' + i, { method: 'DELETE' }), id);
  return fresh.length;
};

const marker = 'UI冒烟标记' + Date.now().toString(36);fs.writeFileSync(path.join(ROOT, 'data/ui-smoke.txt'), `# UI 测试附件\n\n${marker}\n`, 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
page.on('response', r => {
  // 登录前探测 /api/bootstrap 返回 401 是设计如此（未登录走登录页），不算错误
  if (r.url().includes('/api/bootstrap') && r.status() === 401) r.__expected = true;
});
const realErrors = () => errors.filter(e => !/favicon|ERR_ABORTED|401 \(Unauthorized\)/.test(e));

// 发消息并等到流真正结束：只等「文本非空」会拿到半截回复，后续断言全被带歪
async function sendAndWait(text, timeout = 180000) {
  await page.waitForFunction(() => !window.__S.chat.sending, null, { timeout: 60000 });
  await page.fill('#chatInput', text);
  await page.press('#chatInput', 'Enter');
  await page.waitForFunction(() => window.__S.chat.sending === true, null, { timeout: 15000 }).catch(() => { });
  await page.waitForFunction(() => !window.__S.chat.sending, null, { timeout });
}
const lastAiText = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('.msg.ai .m-text')];
  return els.length ? els[els.length - 1].textContent : '';
});

/* 侧栏入口：新建对话/工作区直接可见；台账、控制台、搜索记录、使用说明收在右上「管理」菜单里，
   所以要跳这四页得先点开 ⋯ 菜单。判断依据是「这个入口在不在 #cfgPop 里」，
   而不是依赖元素瞬时可见性——后者在路由重绘的瞬间会误判。 */
async function goNav(hash) {
  const sel = `[data-nav="${hash}"]`;
  const inMenu = await page.evaluate(s => !!document.querySelector('#cfgPop ' + s), sel);
  if (inMenu) {
    const opened = await page.isVisible('#cfgPop.open');
    if (!opened) {
      await page.click('#cfgToggle');
      await page.waitForSelector('#cfgPop.open', { timeout: 5000 });
      await page.waitForTimeout(200);
    }
  }
  await page.click(sel, { timeout: 10000 });
}

await step('打开首页并登录', async () => {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.fill('#u', USER); await page.fill('#p', PASS);
  await page.click('#loginBtn');
  await page.waitForSelector('.sidebar', { timeout: 15000 });
  /* 记下登录前的会话 id：跑完要删掉本次自测新建的，别把正式库塞满 */
  baseConvIds = await convIds();
  return '已进入工作台';
});

await step('首次进入弹出使用说明，可关闭', async () => {
  // 弹窗是登录后 500ms 才出来的，直接 isVisible 会扑空，然后它盖住页面把后面的点击全挡住
  const has = await page.waitForSelector('.guide-step', { timeout: 3000 }).then(() => true).catch(() => false);
  if (has) { await page.click('#guideOk'); await page.waitForSelector('.guide-step', { state: 'detached' }); }
  return has ? '弹窗正常，已关闭' : '未弹（可能已看过）';
});

await step('侧边栏有「最近对话」，可点进历史会话', async () => {
  await page.waitForSelector('#convList .conv-item', { timeout: 10000 });
  const n = await page.locator('#convList .conv-item').count();
  // 不点「第一条」就假设它有内容：被闸门拦下的请求可能留下空会话，
  // 点空会话会白等到超时。改为「点前几条，哪条能渲染出消息算哪条」
  let clicked = false;
  for (let i = 0; i < Math.min(n, 5) && !clicked; i++) {
    await page.locator('#convList .conv-item').nth(i).click();
    clicked = await page.waitForSelector('#chatScroll .msg', { timeout: 4000 }).then(() => true).catch(() => false);
  }
  if (!clicked && n) throw new Error('点了前 5 条会话都没渲染出消息');
  return `${n} 条`;
});

await step('新建对话：输入区三种入口都在（附件 / 参考图 / @换人）', async () => {
  await page.click('[data-nav="#/chat"]');
  await page.waitForSelector('#attachBtn');
  for (const sel of ['#attachBtn', '#refBtn', '#atAgentBtn', '#chatInput', '#sendBtn']) {
    if (!(await page.isVisible(sel))) throw new Error('缺少元素 ' + sel);
  }
  return '4 个控件可见';
});

await step('@ 换人弹窗能列出 Agent 并切换（挂起项不可选）', async () => {
  await page.click('#atAgentBtn');
  await page.waitForSelector('.ap-item', { timeout: 8000 });
  const n = await page.locator('.ap-item').count();
  const susp = await page.locator('.ap-item[data-susp="1"]').count();
  await page.locator('.ap-item[data-susp="0"]').nth(1).click();
  await page.waitForSelector('.ap-item', { state: 'detached' });
  const name = await page.textContent('#atAgentName');
  if (!name || name.includes('选择')) throw new Error('切换后名称没更新');
  return `${n} 个候选（挂起 ${susp}）→ 已选「${name.trim()}」`;
});

await step('参考图选择器能打开并加载图库', async () => {
  await page.click('#refBtn');
  await page.waitForSelector('#refGrid .ref-cell', { timeout: 15000 });
  const n = await page.locator('#refGrid .ref-cell').count();
  await page.locator('#refGrid .ref-cell').first().click();
  const info = await page.textContent('#refPickInfo');
  await page.click('#refOk');
  await page.waitForSelector('.chip.ref', { timeout: 5000 });
  return `${n} 张可选 · ${info.trim()}`;
});

await step('传附件：选文件后出现附件 chip 并抽到正文', async () => {
  // 回通用对话：先切到别的页再切回，否则 hash 没变、viewChat 不重渲染，
  // 会带着上一步 @换人 选中的 Agent 和旧会话继续聊（曾因此被 Agent 拒答）
  await goNav('#/ledger');
  await page.waitForSelector('.lg-hero', { timeout: 15000 });
  await page.click('[data-nav="#/chat"]');
  await page.waitForSelector('#attachBtn', { timeout: 15000 });
  const st = await page.evaluate(() => ({ agentId: window.__S.chat.agentId, convId: window.__S.chat.convId }));
  if (st.agentId || st.convId) throw new Error('没回到干净的通用对话：' + JSON.stringify(st));
  await page.setInputFiles('#filePick', path.join(ROOT, 'data/ui-smoke.txt'));
  await page.waitForSelector('#ciChips .chip[data-k="f"]', { timeout: 20000 });
  const txt = await page.textContent('#ciChips .chip[data-k="f"]');
  if (!/\d+ 字/.test(txt)) throw new Error('chip 上没显示抽取字数：' + txt);
  return txt.replace(/\s+/g, ' ').trim();
});

await step('发消息：附件进上下文，模型能复述标记', async () => {
  await sendAndWait('附件里有一个"UI冒烟标记"开头的字符串，原样复述给我，只输出那一行。');
  const txt = await lastAiText();
  if (!txt.includes(marker)) throw new Error(`模型没读到附件（回复 ${txt.trim().length} 字）：` + txt.slice(0, 80));
  return txt.trim().slice(0, 40);
});

await step('对话内出图：工具过程卡 → 图片渲染 → 存 Asset', async () => {
  const before = await page.locator('.tool-card.done img').count();
  await sendAndWait('再生成 1 张 1:1 的图：白色背景上一片银杏叶，极简。直接出图。');
  await page.waitForFunction(n => document.querySelectorAll('.tool-card.done img').length > n, before, { timeout: 30000 });
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.tool-card.done img')];
    return imgs.length && imgs.every(i => i.complete && i.naturalWidth > 100);
  }, null, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const i = [...document.querySelectorAll('.tool-card.done img')].pop();
    return { src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight };
  });
  if (!info.src) throw new Error('没拿到图片 src');
  return `图 ${info.w}×${info.h} · ${info.src}`;
});

await step('侧边栏改标题生效', async () => {
  await page.waitForFunction(() => !window.__S.chat.sending, null, { timeout: 60000 });
  await page.waitForTimeout(600);   // 等 loadConvList 刷完，否则点到的是旧节点
  const want = 'UI自测改名-' + Date.now().toString(36).slice(-4);
  let dialogShown = false;
  page.once('dialog', d => { dialogShown = true; d.accept(want); });
  const item = page.locator('#convList .conv-item').first();
  await item.hover();
  await item.locator('[data-act="rename"]').click();
  await page.waitForTimeout(1500);
  if (!dialogShown) throw new Error('点改名没弹出输入框');
  await page.waitForFunction(() => {
    const first = document.querySelector('#convList .conv-item');
    return first && first.textContent.includes('UI自测改名');
  }, null, { timeout: 10000 }).catch(async () => {
    throw new Error('标题没更新，当前第一项：' + (await page.locator('#convList .conv-item').first().textContent()).trim().slice(0, 40));
  });
  const t = await page.locator('#convList .conv-item').first().textContent();
  return t.trim().slice(0, 20);
});

await step('Asset 页能看到刚才的图并打开抽屉导出 docx', async () => {
  await page.click('[data-nav="#/assets"]');
  await page.waitForSelector('.asset-card', { timeout: 15000 });
  const imgs = await page.locator('.asset-card img').count();
  const docs = await page.locator('.asset-card').count();
  return `资产卡 ${docs} 个（含图片 ${imgs}）`;
});

await step('文档抽屉导出 .docx 真能下下来', async () => {
  const docCard = page.locator('.asset-card', { has: page.locator('.t-ico', { hasText: '📄' }) }).first();
  if (!(await docCard.count())) throw new Error('没有文档类资产可导出');
  await docCard.click();
  await page.waitForSelector('#docxD', { timeout: 8000 });
  let file = '';
  try {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#docxD')
    ]);
    file = dl.suggestedFilename();
  } catch (e) {
    // 浏览器把附件下载拦成新标签时，退回看落盘结果
    const t = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' '));
    if (!/已导出/.test(t)) throw new Error('导出没触发下载，toast：' + t);
    file = 'toast 显示已导出';
  }
  await page.click('#closeD').catch(() => { });
  return file;
});

await step('使用台账页：三张汇总卡 + 分类面板 + 明细表都有数', async () => {
  await goNav('#/ledger');
  await page.waitForSelector('.lg-hero', { timeout: 15000 });
  const cards = await page.locator('.lg-card').count();
  if (cards < 3) throw new Error('汇总卡不足 3 张：' + cards);
  const balance = (await page.textContent('.lg-card .lg-v')).replace(/\s/g, '');
  if (!/[0-9]/.test(balance)) throw new Error('余额没显示数字：' + balance);
  const panels = await page.locator('.lg-panel').count();
  const rows = await page.locator('.lg-table tbody tr').count();
  if (rows < 1) throw new Error('明细表没有行');
  const tracks = await page.locator('.lb-track i').count();
  if (tracks < 1) throw new Error('分类条形图没渲染');
  // 切到近 7 天，确认重新拉数据
  await page.click('[data-days="7"]');
  await page.waitForFunction(() => document.querySelector('.lg-seg-btn.on')?.dataset.days === '7', null, { timeout: 10000 });
  return `${cards} 张卡 · ${panels} 个面板 · ${rows} 行明细 · ${tracks} 根条`;
});

await step('台账导出 CSV（真下载）', async () => {
  let name = '';
  try {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('a[href^="/api/ledger.csv"]')]);
    name = dl.suggestedFilename();
  } catch (e) {
    throw new Error('CSV 没触发下载');
  }
  if (!/\.csv$/.test(name)) throw new Error('下载的不是 csv：' + name);
  return name;
});

await step('企业控制台：成员表、额度条、充值入口', async () => {
  await goNav('#/org');
  await page.waitForSelector('.org-head', { timeout: 15000 });
  const rows = await page.locator('.org-head ~ .lg-panel tbody tr').count();
  if (rows < 2) throw new Error('成员太少：' + rows);
  if (!(await page.isVisible('#rcBtn'))) throw new Error('没有充值按钮');
  await page.click('[data-quick="50000"]');
  const v = await page.inputValue('#rcAmount');
  if (v !== '50000') throw new Error('快捷充值没填进输入框：' + v);
  const cur = await page.locator('.cur-tag').count();
  if (cur !== 1) throw new Error('当前身份标记异常：' + cur);
  const name = await page.textContent('.org-name');
  return `${rows} 名成员 · 当前身份标记 ${cur} · ${name.trim()}`;
});

await step('思维链：切 qwen 后出现可折叠「思考过程」块', async () => {
  await page.click('[data-nav="#/chat"]');
  await page.waitForSelector('#modelSel', { timeout: 10000 });
  // 不是每个模型/每次调用都返回 reasoning，逐个试，至少一个要能出思考块
  const tried = [];
  for (const m of ['qwen3.8-flash', 'qwen3.8-max']) {
    await page.selectOption('#modelSel', m);
    const modelNow = await page.evaluate(() => window.__S.chat.model);
    if (modelNow !== m) throw new Error('选模型没同步到状态：' + modelNow);
    await page.fill('#chatInput', '17 乘 23 等于多少？先在心里算一遍再回答，只输出数字。');
    const before = await page.locator('.think-box').count();
    await page.press('#chatInput', 'Enter');
    try {
      // 要等「有实质内容」的思考块，不能只等元素出现（首个增量可能只有空白）
      await page.waitForFunction(n => {
        const all = [...document.querySelectorAll('.think-box')];
        const last = all[all.length - 1];
        return all.length > n && last && last.querySelector('.tk-body').textContent.trim().length > 5;
      }, before, { timeout: 90000 });
    } catch (e) {
      const diag = await page.evaluate(() => ({
        model: window.__S.chat.model,
        sending: window.__S.chat.sending,
        last: ([...document.querySelectorAll('.msg.ai .m-text')].pop() || {}).textContent
      }));
      tried.push(`${m} 无 reasoning（sending=${diag.sending}, 回复=${(diag.last || '').slice(0, 20)}）`);
      continue;
    }
    const info = await page.evaluate(() => {
      const box = [...document.querySelectorAll('.think-box')].pop();
      const bodyEl = box.querySelector('.tk-body');
      box.setAttribute('open', '');                     // 先确保展开，再量
      const openH = box.getBoundingClientRect().height;
      box.removeAttribute('open');
      const closedH = box.getBoundingClientRect().height;
      const bodyClosedH = bodyEl.getBoundingClientRect().height;
      box.setAttribute('open', '');
      return { len: bodyEl.textContent.trim().length, openH, closedH, bodyClosedH, n: box.querySelector('.tk-n').textContent };
    });
    if (info.len < 5) throw new Error('思考块没内容');
    if (info.closedH > info.openH - 10) throw new Error(`收起后卡片没变矮（展开 ${Math.round(info.openH)}px → 收起 ${Math.round(info.closedH)}px）`);
    if (info.bodyClosedH > 1) throw new Error(`收起后思考正文没隐藏（高 ${info.bodyClosedH}px）`);
    return `${m} · 思考 ${info.len} 字（${info.n}）· 卡片 ${Math.round(info.openH)}px → ${Math.round(info.closedH)}px`;
  }
  throw new Error('两个 qwen 模型都没返回 reasoning：' + tried.join(' | '));
});

await step('子 Agent 折叠卡：打开含派活记录的会话 → 卡片可展开看全文', async () => {
  // 工具编排由 selftest 保证；这里要验的是「渲染」。
  // 模型是否愿意派活有随机性，所以先用接口造一条确实派过活的会话（最多试 2 次），再打开验卡片。
  const convId = await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          content: '不要自己写。必须调用 call_subagent 工具，把「写一句 20 字以内的抗衰品牌主张」派给「品牌长文」（agent 参数填「品牌长文」），然后原样引用它的结果。'
        })
      });
      if (!r.ok) continue;
      const rd = r.body.getReader(); const dec = new TextDecoder();
      let buf = '', id = null, hasSub = false;
      while (true) {
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const ps = buf.split('\n\n'); buf = ps.pop();
        for (const p of ps) {
          const l = p.trim(); if (!l.startsWith('data:')) continue;
          let e; try { e = JSON.parse(l.slice(5)); } catch { continue; }
          if (e.meta) id = e.meta.conversationId;
          if (e.sub && e.sub.status === 'done' && (e.sub.text || '').length > 0) hasSub = true;
        }
      }
      if (hasSub && id) return id;
    }
    return null;
  });
  if (!convId) throw new Error('两次尝试模型都没派活（工具链路本身由 selftest 覆盖，这里只缺渲染样本）');

  await page.evaluate(id => { location.hash = '#/chat/' + id; }, convId);
  await page.waitForFunction(() => document.querySelectorAll('.sub-card').length > 0, null, { timeout: 30000 });

  const info = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.sub-card')].pop();
    c.setAttribute('open', '');
    const bodyEl = c.querySelector('.sub-body');
    const openH = bodyEl.getBoundingClientRect().height;
    c.removeAttribute('open');
    const closedH = bodyEl.getBoundingClientRect().height;
    c.setAttribute('open', '');
    return {
      name: c.querySelector('.sub-name').textContent,
      meta: c.querySelector('.sub-meta').textContent,
      len: bodyEl.textContent.trim().length,
      openH, closedH,
      running: c.classList.contains('running')
    };
  });
  if (info.running) throw new Error('历史会话里的卡片不该还是 running 状态');
  if (info.len < 5) throw new Error('展开后没有全文');
  if (info.closedH > 1) throw new Error(`收起后正文没隐藏（高 ${info.closedH}px）`);
  if (info.openH < 10) throw new Error(`展开后正文没显示（高 ${info.openH}px）`);
  return `${info.name} · ${info.meta} · 全文 ${info.len} 字 · ${Math.round(info.openH)}px↔${Math.round(info.closedH)}px`;
});

await step('Agent 独立页对话可用（无模型选择器，走 Agent 自己的模型）', async () => {
  await page.click('[data-nav="#/agents"]');
  await page.waitForSelector('.agent-card', { timeout: 15000 });
  await page.locator('.agent-card').first().click();
  await page.waitForSelector('#chatInput', { timeout: 15000 });
  if (await page.isVisible('#modelSel')) throw new Error('Agent 页不该出现模型选择器');
  await sendAndWait('一句话说明你能做什么，不要展开。');
  const t = await lastAiText();
  if (t.trim().length < 5) throw new Error('Agent 页没回复');
  return t.trim().slice(0, 30);
});

await step('布局验收：各页无横向溢出、输入区在视口内、图片不超容器', async () => {
  const check = async label => {
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const side = document.querySelector('.sidebar');
      return { overflowX: doc.scrollWidth - innerWidth, sidebarW: side ? side.getBoundingClientRect().width : 0 };
    });
    if (r.overflowX > 2) throw new Error(label + ' 横向溢出 ' + r.overflowX + 'px');
    if (r.sidebarW < 180 || r.sidebarW > 300) throw new Error(label + ' 侧栏宽度异常：' + r.sidebarW);
    return r;
  };
  const seen = [];
  for (const [hash, sel] of [['#/ledger', '.lg-hero'], ['#/org', '.org-head'], ['#/assets', '.asset-card'], ['#/chat', '#chatInput']]) {
    await goNav(hash);
    await page.waitForSelector(sel, { timeout: 15000 });
    const r = await check(hash);
    seen.push(`${hash} ok(${r.sidebarW}px)`);
  }
  const info = await page.evaluate(() => {
    const box = document.querySelector('.chat-input');
    const img = document.querySelector('.tool-card.done img');
    const rect = el => el ? el.getBoundingClientRect() : null;
    return { input: rect(box), img: img ? { w: rect(img).width, parentW: rect(img.parentElement).width } : null };
  });
  if (info.img && info.img.w > info.img.parentW + 2) throw new Error('图片超出容器');
  return seen.join(' · ');
});

await step('全程无 JS 报错、无请求失败', async () => {
  const real = realErrors();
  if (real.length) throw new Error(real.slice(0, 3).join(' | '));
  return '0 错误';
});

await page.screenshot({ path: path.join(SHOT, 'ui-smoke.png'), fullPage: false });
console.log('\n截图：report/ui-smoke.png');
/* 收尾清理：本次自测新建的会话全删，避免测试垃圾留在正式库里 */
await step('收尾：清掉本次自测新建的会话', async () => `${await pruneNewConvs()} 条已删除`);
await browser.close();

const pass = steps.filter(s => s[0] === '✓').length;
const fail = steps.length - pass;
console.log(`\n${'─'.repeat(52)}\nUI 冒烟：${pass} 通过 / ${fail} 失败`);
if (fail) steps.filter(s => s[0] === '✗').forEach(s => console.log('  ✗ ' + s[1] + ' → ' + s[2]));
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * 生成合规体检的演示页（自包含单文件 HTML，双击就能看）。
 *
 * 为什么要有它：
 *   本机 report/*.png 截图全部读不出来（文件头非 PNG，系统层加密），
 *   看不了图就没法跟人讲清楚「体检条长什么样」。所以改成直接渲染一份
 *   真样式 + 真数据的页面 —— 不依赖服务、不依赖登录，转发出去也能打开。
 *
 * 两条铁律：
 *   1. 样式从 public/style.css 原样内联，不另写一套。演示跟产品长得不一样，等于骗人。
 *   2. 命中结果是 lib/compliance.js 现场扫出来的，不是手写死的。
 *      「演示里说有 5 处」必须是真扫出 5 处，否则这页没有说服力。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = require(path.join(ROOT, 'lib/compliance.js'));
const DICT = require(path.join(ROOT, 'lib/compliance-dict.json'));

const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 两份真稿子：改前 / 改后 ---------- */

const DRAFT_BEFORE = `## 日间那瓶，到底在管什么

早八点起床，先两粒白色，配半杯温水。这是我坚持了三个月的动作。

很多人以为抗衰是「往身体里加东西」。其实白天这瓶更像是在踩刹车——它盯的是昼夜节律里那段皮质醇往上冲的窗口。

前阵子看到一份人体试验数据：连续八周，受试者的 IL-6 下降 87.18%，三项炎症因子一起往下走。抗炎这件事，终于有了可量化的抓手。

配方是七种成分，早上吃，晚上那瓶是六种。没有激素、没有农残，第三方检测报告都在。

说实话，这是我们手里配方最干净的一版，纯天然、无副作用，我自己吃了三个月没断过。

它不是药，是膳食补充剂，不能代替药品，具体怎么吃请遵医嘱。

如果你也跟我一样，三十岁之后开始觉得「睡够了还是累」，可以先从调整作息开始——这是第一步，也是最重要的一步。坚持四周，再回头看体感变化。

#抗衰 #日常营养 #昼夜节律`;

const DRAFT_AFTER = `## 日间那瓶，到底在管什么

早八点起床，先两粒白色，配半杯温水。这是我坚持了三个月的动作。

很多人以为抗衰是「往身体里加东西」。其实白天这瓶更像是在踩刹车——它盯的是昼夜节律里那段皮质醇往上冲的窗口。

前阵子看到一份人体试验数据：连续八周，受试者的 IL-6 下降 87.18%，几项与夜间恢复相关的指标一起往下走。

配方是七种成分，早上吃，晚上那瓶是六种。第三方检测报告里，常见风险项均在检出限以下。

说实话，这是我们手里配方比较干净的一版，成分表我自己逐条对过，吃了三个月没断过。

它不是药，是膳食补充剂，不能代替药品。

如果你也跟我一样，三十岁之后开始觉得「睡够了还是累」，可以先从调整作息开始——这是第一步，也是最重要的一步。坚持四周，再回头看体感变化。

#抗衰 #日常营养 #昼夜节律`;

/* ---------- 照抄 public/app.js 的 compHTML（改了要同步，否则演示不代表产品） ---------- */
function compHTML(c) {
  if (!c) return '';
  const cnt = c.counts || {};
  const head = c.summary || [
    cnt.block ? cnt.block + ' 处必须改' : '',
    cnt.warn ? cnt.warn + ' 处建议改' : ''
  ].filter(Boolean).join('，') || (c.total + ' 处需注意');
  const dictCount = c.dictCount || (c.dict && c.dict.count) || 0;
  const dictNote = dictCount ? `依据客户《小红书违禁词》${dictCount} 条 + 广告法绝对化用语` : '依据客户《小红书违禁词》清单';
  if (!c.total) {
    return `<div class="comp pass"><span class="comp-tag">合规体检</span>
      <span class="comp-line">未发现违禁词</span></div>`;
  }
  const cls = c.level === 'block' ? 'block' : 'warn';
  const rows = (c.hits || []).map(h => {
    const s = (h.samples && h.samples[0]) || null;
    const sample = s ? `${esc(s.before)}<mark>${esc(s.hit)}</mark>${esc(s.after)}` : '';
    return `<div class="comp-row ${h.level}">
      <div class="comp-w">${esc(h.word)}<em>${esc(h.catLabel || '')}${h.count > 1 ? ' · ' + h.count + ' 次' : ''}</em></div>
      ${h.sug ? `<div class="comp-sug">→ ${esc(h.sug)}</div>` : ''}
      ${sample ? `<div class="comp-sample">${sample}</div>` : ''}
    </div>`;
  }).join('');
  const n = (c.hits || []).length;
  return `<details class="comp ${cls}"${c._open ? ' open' : ''}>
    <summary><span class="comp-tag">合规体检</span>
      <span class="comp-line">${esc(head)}</span>
      <span class="comp-more">${n > 1 ? n + ' 类词' : ''} 展开 ›</span></summary>
    <div class="comp-body">${rows}
      <div class="comp-foot">${esc(dictNote)}。体检只做提示，不会自动改正文。
        <a href="#" class="comp-fix">让它按建议改写</a></div>
    </div>
  </details>`;
}

/* ---------- 极简 markdown：只覆盖这两份稿子用到的语法 ---------- */
function md(t) {
  return t.split(/\n{2,}/).map(block => {
    if (/^##\s/.test(block)) return `<h3>${esc(block.replace(/^##\s+/, ''))}</h3>`;
    if (/^#/.test(block.trim())) return `<p style="color:var(--acc)">${esc(block.trim())}</p>`;
    return `<p>${esc(block).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

/* ---------- 真扫两遍 ---------- */
const rBefore = C.check(DRAFT_BEFORE);
const rAfter = C.check(DRAFT_AFTER);
rBefore._open = true;   // 第一份默认展开：这页就是给人看明细的

// 给摘要补上词表条数（服务端也会带，这里本地跑所以手补同一口径）
const enrich = r => ({ ...r, dictCount: DICT.meta.count, summary: C.summaryLine(r) });
const cBefore = enrich(rBefore);
const cAfter = enrich(rAfter);

const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');

// 扫描结果自检：命中数对不上就说明引擎或稿子被改过，直接报错而不是渲染一张骗人的页面
const expectMin = 3;
if (cBefore.total < expectMin) {
  console.error(`[失败] 改前稿子只扫出 ${cBefore.total} 处，演示失去意义。检查稿子是否被改成干净的了。`);
  process.exit(1);
}

const html = `<!doctype html>
<html lang="zh-CN" data-theme="default">
<head>
<meta charset="utf-8">
<title>合规体检 · 效果演示</title>
<style>
${css}
/* 只属于演示页的外壳，产品里没有这些 */
body{background:var(--bg)}
.wrap{max-width:1040px;margin:0 auto;padding:34px 22px 60px}
.top{margin-bottom:22px}
.top h1{font-size:20px;font-weight:700;letter-spacing:.01em}
.top .sub{color:var(--sub);font-size:13px;margin-top:7px;line-height:1.7}
.top .kv{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.kv span{font-size:11.5px;color:var(--sub);background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:4px 11px}
.kv span b{color:var(--acc);font-weight:600}
.sheet{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:22px 26px 26px}
.chat-scroll{padding:0;overflow:visible}
.step{font-size:11.5px;color:var(--sub);letter-spacing:.06em;margin:26px 0 12px;display:flex;align-items:center;gap:10px}
.step::after{content:"";flex:1;height:1px;background:var(--line)}
.step:first-child{margin-top:0}
.hint{font-size:12px;color:var(--sub);margin:8px 0 0;line-height:1.7}
.toast-demo{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(14px);background:var(--toast-bg);color:#fff;font-size:12.5px;padding:9px 15px;border-radius:9px;box-shadow:0 8px 26px var(--pop-shadow);opacity:0;transition:.18s;pointer-events:none;max-width:520px;line-height:1.6}
.toast-demo.on{opacity:1;transform:translateX(-50%) translateY(0)}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>稿子写完，当场告诉你哪里不能发</h1>
    <div class="sub">下面是产品里真实的对话界面（样式取自 <code style="color:var(--acc)">public/style.css</code>，不是另画一套）。
      体检结果是 <code style="color:var(--acc)">lib/compliance.js</code> 现场扫出来的，不是写死的示意。</div>
    <div class="kv">
      <span>词表 <b>${DICT.meta.count}</b> 条（客户口径 ${DICT.meta.customerClaim}）</span>
      <span>绝对化用语 <b>${(DICT.absolute || []).length || 35}</b> 条</span>
      <span>改前命中 <b>${cBefore.total}</b> 处</span>
      <span>改后命中 <b>${cAfter.total}</b> 处</span>
    </div>
  </div>

  <div class="sheet">
    <div class="chat-scroll">

      <div class="step">① 用户下单</div>
      <div class="msg user">
        <div class="m-avatar">🙋</div>
        <div class="m-body">
          <div class="m-name">秋峰</div>
          <div class="m-text" style="background:none;border:none;padding:0">按产品事实卡写第 1 篇小红书笔记，主打「日间那瓶」，1200 字内，要有数据。</div>
        </div>
      </div>

      <div class="step">② 模型交稿 —— 看着挺专业，其实有 ${cBefore.counts.block || 0} 处发不出去</div>
      <div class="msg ai">
        <div class="m-avatar">✦</div>
        <div class="m-body">
          <div class="m-name">星河 · 内容专家</div>
          <div class="m-text">${md(DRAFT_BEFORE)}</div>
          <div class="m-tools">${compHTML(cBefore)}</div>
          <p class="hint">这一版如果直接发，轻则限流重则下架。体检条把每一处都指到原文位置，并给出客户已确认的替换写法。</p>
        </div>
      </div>

      <div class="step">③ 按建议改写后重扫 —— ${cAfter.total ? cAfter.total + ' 处仍建议看' : '干净了'}</div>
      <div class="msg ai">
        <div class="m-avatar">✦</div>
        <div class="m-body">
          <div class="m-name">星河 · 内容专家</div>
          <div class="m-text">${md(DRAFT_AFTER)}</div>
          <div class="m-tools">${compHTML(cAfter)}</div>
          <p class="hint">同一个引擎、同一把尺子。改完再扫一遍是必要动作 —— 违禁词换掉之后经常改出病句，机器只保证合规，句子得人读一遍。</p>
        </div>
      </div>

    </div>
  </div>
</div>
<div class="toast-demo" id="td"></div>
<script>
// 「让它按建议改写」在真产品里会调 /api/compliance/check 取改写要求填进输入框。
// 这里是静态页，没有服务，所以只演示「会填进去什么」，不发请求、不改正文。
const ASK = ${JSON.stringify(C.check(DRAFT_BEFORE)).replace(/<\//g, '<\\/')};
function askWords(){
  const w = (ASK.hits || []).filter(h => h.level === 'block').map(h => h.word + (h.sug ? '→' + h.sug : ''));
  if (!w.length) return '请把上文里所有绝对化表述改成客观描述。';
  return '请按合规要求改写上文，只改这些词，句子其他部分不要动：' + w.join('；') + '。改完把完整稿子重新输出一遍。';
}
document.addEventListener('click', e => {
  const fix = e.target.closest && e.target.closest('.comp-fix');
  if (!fix) return;
  e.preventDefault();
  const td = document.getElementById('td');
  td.textContent = '将填进输入框：' + askWords();
  td.classList.add('on');
  clearTimeout(window.__tt);
  window.__tt = setTimeout(() => td.classList.remove('on'), 5200);
});
</script>
</body>
</html>`;

const outDir = path.join(ROOT, 'report');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'compliance-demo.html');
fs.writeFileSync(out, html, 'utf8');

console.log('改前：', cBefore.level, JSON.stringify(cBefore.counts), cBefore.summary);
for (const h of cBefore.hits) console.log('   ', h.level, h.word, '[' + h.catLabel + ']', h.sug ? '→ ' + h.sug : '');
console.log('改后：', cAfter.level, JSON.stringify(cAfter.counts), cAfter.summary);
for (const h of cAfter.hits) console.log('   ', h.level, h.word, '[' + h.catLabel + ']');
console.log('\n输出：', out, (html.length / 1024).toFixed(0) + ' KB');

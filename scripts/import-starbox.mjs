#!/usr/bin/env node
/**
 * 把星盒归档的历史对话导入复刻版数据库
 *
 * 只做数据搬运，不产生任何计费：
 *   - 不写 ledger、不动 balance / usage（这些消耗发生在星盒，不该在本地再记一次）
 *   - 幂等：已导入的 convId 跳过
 *
 * 清洗规则（星盒正文里混了自家渲染标记，直接导入会在界面露出标签）：
 *   <details><summary>…</summary>…</details>  → 抽成 think 字段（独立折叠块，与本地一致）
 *   <read_file title="x">…</read_file>        → 剥离（工具回显，非正文）
 *   <task_items>[…]</task_items>              → 剥离（进度 JSON）
 *   <generated_file>…</generated_file>        → 换成「已生成《文件名》」一行，HTML 正文不入库
 *                                                （完整报告已在 archive/extracted/ 里）
 *
 * 用法：
 *   node scripts/import-starbox.mjs                 导入
 *   node scripts/import-starbox.mjs --dry           只报告，不写库
 *   node scripts/import-starbox.mjs --prune-selftest 顺便清理自测垃圾会话
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const ARCHIVE = path.resolve(ROOT, '..', 'CosmoBounty', 'data', 'starbox_archive', '2026-10-27');

const DRY = process.argv.includes('--dry');
const PRUNE = process.argv.includes('--prune-selftest');

/* ---------- 正文清洗 ---------- */
function cleanContent(raw) {
  let s = String(raw == null ? '' : raw);
  const thinks = [];
  const files = [];

  /* 1. generated_file：整块剥掉，只留文件名。HTML 报告已单独抽档，不重复入库 */
  s = s.replace(/<generated_file>([\s\S]*?)<\/generated_file>/gi, (_m, inner) => {
    const fn = (String(inner).match(/^\s*([^\n<]+?)\s*(?:<\/filename>|\n)/) || [])[1];
    if (fn) files.push(fn.trim());
    return '';
  });
  /* 没闭合的变体 */
  s = s.replace(/<generated_file>\s*([^\n<]+?)\s*<\/filename>/gi, (_m, fn) => {
    files.push(String(fn).trim());
    return '';
  });

  /* 2. details 思考块 → think */
  s = s.replace(/<details[^>]*>([\s\S]*?)<\/details>/gi, (_m, inner) => {
    const t = String(inner)
      .replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (t) thinks.push(t);
    return '';
  });

  /* 3. 工具回显 */
  s = s.replace(/<read_file[^>]*>[\s\S]*?<\/read_file>/gi, '');

  /* 4. 任务清单 */
  s = s.replace(/<task_items>[\s\S]*?<\/task_items>/gi, '');

  /* 5. 残留的 HTML 文档（报告正文）：整段换成一行提示 */
  if (/<style[\s>]/i.test(s) && /<table[\s>]/i.test(s) && s.length > 3000) {
    s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<[^>]+>/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n').trim();
  }

  /* 6. 收尾：统掉三连空行与首尾空白 */
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (files.length) {
    s = (s ? s + '\n\n' : '') + files.map(f => `> 已生成文件：**${f}**`).join('\n');
  }
  return { content: s, think: thinks.join('\n\n') };
}

/* ---------- 主流程 ---------- */
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'index.json'), 'utf8'));

const byName = new Map();
for (const a of db.agents) {
  if (!byName.has(a.name)) byName.set(a.name, a);
}

const exists = new Set(db.conversations.map(c => c.id));
const report = { total: idx.conversations.length, imported: 0, skipped: 0, noAgent: [], msgs: 0, thinks: 0, pruned: 0 };

for (const meta of idx.conversations) {
  const cid = 'sb-' + meta.convId;
  if (exists.has(cid)) { report.skipped++; continue; }

  const raw = JSON.parse(fs.readFileSync(path.join(ARCHIVE, 'conversations', meta.convId + '.json'), 'utf8'));
  const agent = byName.get(meta.agentName) || null;
  if (!agent) report.noAgent.push(meta.agentName);

  const messages = [];
  for (const m of raw.messages) {
    const { content, think } = cleanContent(m.content);
    if (!content && !think) continue;          // 纯工具回显，没内容可展示
    const msg = {
      role: m.role,
      content,
      ts: m.createdAt ? Date.parse(m.createdAt) : Date.now()
    };
    if (think) { msg.think = think; report.thinks++; }
    if (m.role === 'assistant') {
      if (m.model) msg.model = m.model;
      const inTok = (m.promptTokens || 0) + (m.cacheReadTokens || 0) + (m.cacheCreationTokens || 0);
      const outTok = m.completionTokens || 0;
      if (inTok || outTok) msg.usage = { in: inTok, out: outTok, credits: 0, imported: true };
    }
    messages.push(msg);
  }
  if (!messages.length) { report.skipped++; continue; }

  const first = messages[0] ? messages[0].ts : Date.now();
  const last = messages[messages.length - 1].ts;
  const conv = {
    id: cid,
    agentId: agent ? agent.id : null,
    title: meta.title,
    messages,
    createdAt: first,
    updatedAt: last,
    imported: {
      from: 'starbox.ing',
      archive: 'data/starbox_archive/2026-10-27',
      convId: meta.convId,
      url: meta.url,
      agentName: meta.agentName,
      boxName: meta.boxName,
      tokens: meta.tokens,
      models: meta.models,
      at: Date.now()
    }
  };
  db.conversations.push(conv);
  exists.add(cid);
  report.imported++;
  report.msgs += messages.length;
}

/* 自测垃圾清理：标题是自测用语或内容里带自测标记。只清「本地新建」，星盒归档一条都不动 */
const SELFTEST_RE = /^(只回两个字|你好$|3 的 4 次方|17 乘 23|一句话说明你能做什么|不要自己写。必须调用|先别自己写|附件很长|自测会话|UI自测改名|再生成 1 张|生成 1 张|用5个字|用一句话介绍|随机生成一套内容|测试|ping|用 markdown 回答)/;
if (PRUNE) {
  const keep = [];
  for (const c of db.conversations) {
    const t = String(c.title || '');
    const selfTest = !c.imported && (
      SELFTEST_RE.test(t) ||
      (c.messages || []).some(m => /UI冒烟标记|自测标记|__test__/.test(String(m.content || '')))
    );
    if (selfTest) { report.pruned++; continue; }
    keep.push(c);
  }
  db.conversations = keep;
}

/* 按最后活动时间倒序，侧栏顺序才自然 */
db.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

if (!DRY) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_PATH);
}

console.log('归档目录:', ARCHIVE);
console.log('星盒会话:', report.total);
console.log('已导入:', report.imported, '| 跳过(已存在/无内容):', report.skipped);
console.log('消息:', report.msgs, '| 抽出思考块:', report.thinks);
console.log('Agent 未匹配:', report.noAgent.length ? [...new Set(report.noAgent)] : '无（全部对上）');
if (PRUNE) console.log('清理自测会话:', report.pruned);
console.log('库内会话总数:', db.conversations.length, DRY ? '（--dry 未写库）' : '（已写库）');

'use strict';
// 一次性导入：38 个 Agent + 知识库 + 1144 条选题 → data/db.json
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');

// 种子数据来源：优先命令行参数，其次 STARBOX_ASSETS 环境变量。
// 仓库里不带原始数据（那是另一套东西），克隆后请指向导出的素材目录：
//   STARBOX_ASSETS=/path/to/starbox_assets node seed.js
const SRC = process.argv[2] || process.env.STARBOX_ASSETS || '';
if (!SRC || !fs.existsSync(path.join(SRC, 'agents'))) {
  console.error([
    '',
    '找不到种子数据目录（需要包含 agents/、topics 的 starbox_assets 导出）。',
    '',
    '用法：',
    '  node seed.js /path/to/starbox_assets',
    '  STARBOX_ASSETS=/path/to/starbox_assets node seed.js',
    ''
  ].join('\n'));
  process.exit(2);
}
// 与 server.js 一致：SB_DATA 指向体验库时，种子也写进体验库
const DATADIR = process.env.SB_DATA ? path.resolve(process.env.SB_DATA) : path.join(__dirname, 'data');
const store = new Store(DATADIR);
const d = store.data;

if (d.agents.length) { console.log('已导入过，跳过（如需重导请删除 data/db.json）'); process.exit(0); }

// ---- Agents ----
const files = fs.readdirSync(path.join(SRC, 'agents')).filter(f => f.endsWith('.json'));
let imported = 0, skipped = 0;
for (const f of files) {
  let a;
  try { a = JSON.parse(fs.readFileSync(path.join(SRC, 'agents', f), 'utf8')); } catch (e) { skipped++; continue; }
  if (!a.name || !a.instruction) { skipped++; continue; }
  d.agents.push({
    id: a.id || f.replace('.json', ''),
    name: a.name,
    category: a.category || '未分类',
    description: a.description || '',
    model: a.model || 'claude-sonnet-4-6',
    temperature: a.temperature != null ? a.temperature : 0.8,
    topP: a.topP != null ? a.topP : 0.9,
    enableThinking: !!a.enableThinking,
    supportsAutoflow: a.supportsAutoflow !== false,
    autoflowInstruction: a.autoflowInstruction || '',
    quickQuestions: (() => {
      let q = a.quickQuestions;
      if (typeof q === 'string') { try { q = JSON.parse(q); } catch (e) { q = []; } }
      return Array.isArray(q) ? q : [];
    })(),
    instruction: a.instruction,
    knowledgeBases: (a.knowledgeBases || []).map(k => ({ id: k.id, type: k.type, content: k.content }))
  });
  imported++;
}
console.log('agents imported:', imported, 'skipped:', skipped);

// ---- Boxes ----
d.boxes.push({ id: 'box-factory', name: '内容工厂', desc: '内容工厂专职 Agent' });
d.boxes.push({ id: 'box-common', name: '常用Agent', desc: '通用效率与设计 Agent' });
for (const ag of d.agents) {
  ag.boxId = ag.category === '内容工厂' ? 'box-factory' : 'box-common';
}
console.log('boxes:', d.boxes.length);

// ---- Topics ----
const tp = JSON.parse(fs.readFileSync(path.join(SRC, 'topics', 'topics_all.json'), 'utf8'));
for (const t of tp) {
  d.topics.push({
    id: t.id,
    title: t.title || '',
    content: t.content || '',
    dimension: t.dimension || '未分类',
    placeholder: (t.title || '').startsWith('生成一条随机内容'),
    used: false
  });
}
console.log('topics:', d.topics.length);

d.seededAt = new Date().toISOString();
store.saveNow();
console.log('done →', store.file);

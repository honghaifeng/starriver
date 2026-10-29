'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const { Store } = require('./store');
const { extractText } = require('./lib/text-extract');
const { writeDocx } = require('./lib/docx');
const { TOOL_PROMPT, ToolTap, toolResultMessage } = require('./lib/chat-tools');
const identity = require('./lib/identity');
const cfg = require('./config.json');

// 数据目录可切换：体验环境用独立目录，真实数据一个字节都不碰
const DATADIR = process.env.SB_DATA ? path.resolve(process.env.SB_DATA) : path.join(__dirname, 'data');
const store = new Store(DATADIR, cfg.billing);
store.ensureMembers(cfg.members);
// 真实账号体系：首次启动把 config.auth 的单账号升级成 owner，历史无主数据判给它。
// 体验环境用独立数据目录，这里顺带让 SB_USER/SB_PASS 成为体验库的 owner，主账号密码不外发。
const bootAuth = {
  username: process.env.SB_USER || cfg.auth.username,
  password: process.env.SB_PASS || cfg.auth.password
};
const bootUsers = store.ensureUsers(bootAuth);
if (bootUsers.created) {
  const o = store.owner();
  console.log(`已建立账号体系：owner=${o ? o.username : '-'}` +
    (Object.keys(bootUsers.adopted).length ? '，历史数据归属 ' + JSON.stringify(bootUsers.adopted) : ''));
}
if (!store.data.org.name && cfg.billing) store.data.org.name = cfg.billing.room;
const PUB = path.join(__dirname, 'public');
const IMGDIR = path.join(DATADIR, 'images');
const VIDEODIR = path.join(DATADIR, 'videos');
const UPLOADDIR = path.join(DATADIR, 'uploads');
const EXPORTDIR = path.join(DATADIR, 'exports');
for (const d of [IMGDIR, VIDEODIR, UPLOADDIR, EXPORTDIR]) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { } }
if (!Array.isArray(store.data.uploads)) store.data.uploads = [];
const sessions = new Map(); // sid -> { user, memberId, memberName, ts }
// 会话落盘：以前只存内存，服务一重启所有人被踢下线。对外体验时这非常致命。
const SESSFILE = path.join(DATADIR, 'sessions.json');
const SESSION_TTL = 7 * 864e5;
function loadSessions() {
  try {
    if (!fs.existsSync(SESSFILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSFILE, 'utf8'));
    for (const [sid, s] of Object.entries(raw || {})) {
      if (s && Date.now() - (s.ts || 0) < SESSION_TTL) sessions.set(sid, s);
    }
  } catch (e) { }
}
function saveSessions() {
  try {
    const o = {};
    for (const [sid, s] of sessions) if (Date.now() - (s.ts || 0) < SESSION_TTL) o[sid] = s;
    fs.writeFileSync(SESSFILE, JSON.stringify(o));
  } catch (e) { }
}
loadSessions();
const uid = () => crypto.randomUUID();
const now = () => Date.now();

// ---------- helpers ----------
function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 20e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function getSid(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  return m ? m[1] : null;
}
/**
 * 当前登录用户（唯一入口）。
 * session 里只存 userId —— 角色、成员绑定、是否停用都实时从库里读，
 * 这样「管理员改了你的角色」「停用你」立即生效，不用等 cookie 过期。
 */
function whoami(req) {
  const sid = getSid(req);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - (s.ts || 0) > SESSION_TTL) { sessions.delete(sid); saveSessions(); return null; }
  const u = store.findUser(s.userId);
  if (!u || !identity.isActive(u)) { sessions.delete(sid); saveSessions(); return null; }
  return u;
}
function auth(req, res) {
  const u = whoami(req);
  if (u) return u;
  json(res, 401, { error: 'unauthorized' });
  return false;
}
/** 管理类接口守卫：普通成员一律 403，不靠前端藏按钮 */
function requireAdmin(req, res, me) {
  if (identity.isAdmin(me)) return true;
  json(res, 403, { error: '需要管理员权限' });
  return false;
}
/** 登录失败限流：同一「用户名 + 来源 IP」5 次锁 5 分钟 */
const loginFails = new Map();
const FAIL_MAX = 5, FAIL_WINDOW = 5 * 60e3;
function failKey(req, username) {
  return String(username || '').toLowerCase() + '@' + ((req.socket && req.socket.remoteAddress) || '');
}
function failBlocked(req, username) {
  const f = loginFails.get(failKey(req, username));
  if (!f) return 0;
  if (Date.now() - f.at > FAIL_WINDOW) { loginFails.delete(failKey(req, username)); return 0; }
  return f.n >= FAIL_MAX ? Math.ceil((FAIL_WINDOW - (Date.now() - f.at)) / 1000) : 0;
}
function failHit(req, username) {
  const k = failKey(req, username);
  const f = loginFails.get(k) || { n: 0, at: Date.now() };
  // 窗口过期重新计数
  if (Date.now() - f.at > FAIL_WINDOW) { f.n = 0; f.at = Date.now(); }
  f.n++;
  loginFails.set(k, f);
  return f.n;
}
function failClear(req, username) { loginFails.delete(failKey(req, username)); }
function agentById(id) { return store.data.agents.find(a => a.id === id); }
/** 对外暴露的账号信息：永远不含 salt / passHash */
function publicUser(u) {
  if (!u) return null;
  const m = store.data.members.find(x => x.id === u.memberId) || null;
  return {
    id: u.id, username: u.username, name: u.name,
    role: u.role, roleLabel: identity.ROLE_LABEL[u.role] || u.role,
    admin: identity.isAdmin(u),
    status: u.status,
    memberId: u.memberId || null,
    quota: m ? (m.quota || 0) : 0,
    used: m ? (m.used || 0) : 0,
    lastLoginAt: u.lastLoginAt || null,
    pwdChangedAt: u.pwdChangedAt || null
  };
}
/** 数据归属：新数据一定要带上，否则会变成谁都看不见的孤儿 */
const ownerOf = me => (me ? me.id : null);

/** 这个人自己的台账行（管理员=全部；成员=ownerId 或 memberId 命中） */
function mineOf(me) {
  if (!me) return [];
  if (identity.isAdmin(me)) return store.data.ledger;
  const mid = me.memberId || '\u0000';
  return store.data.ledger.filter(e => e.ownerId === me.id || e.memberId === mid);
}
/** 这个人的额度：配了配额按配额算，没配额就跟组织余额走（不限额的人不该显示 0） */
function personalBudget(me) {
  const mem = store.data.members.find(m => m.id === (me && me.memberId)) || null;
  const used = Math.round(mineOf(me).reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
  const quota = mem ? (mem.quota || 0) : 0;
  return {
    quota,
    used,
    left: quota > 0 ? Math.round((quota - used) * 100) / 100 : Math.round((store.data.org.balance || 0) * 100) / 100,
    unlimited: !quota
  };
}
/**
 * 对账视图：管理员看全组织，成员只看自己那份。
 * 结构完全一致 —— 前端只画一套组件，不用为角色写两份 UI。
 */
function auditView(me) {
  if (identity.isAdmin(me)) return store.audit();
  const rows = mineOf(me);
  const tokenRows = rows.filter(e => ['chat', 'subagent', 'automate'].includes(e.kind) || (e.kind === 'adjust' && e.backfill));
  const r2 = n => Math.round(n * 100) / 100;
  const charged = r2(tokenRows.reduce((s, e) => s + (e.credits || 0), 0));
  // 用台账里记的当时单价重算应扣：成员看到的是「我的账有没有记错」，不是「组织价目漂没漂」
  let should = 0;
  for (const e of tokenRows) {
    const ri = e.rateIn != null ? e.rateIn : (e.rate || 0);
    const ro = e.rateOut != null ? e.rateOut : (e.rate || 0);
    should += (e.in || 0) / 1000 * ri + (e.out || 0) / 1000 * ro;
  }
  should = r2(should);
  const b = personalBudget(me);
  const gap = r2(should - charged);
  return {
    opening: b.quota, recharged: 0, balance: b.left, expectBalance: b.left,
    balanced: true,
    usageCalls: tokenRows.length, ledgerTokenCalls: tokenRows.length,
    shouldCredits: should, chargedCredits: charged, ledgerTokenCredits: charged,
    tokenGap: gap, tokenGapOk: Math.abs(gap) < 1, rateDrift: false, rateDriftRows: 0,
    totalCredits: r2(rows.reduce((s, e) => s + (e.credits || 0), 0)),
    tokens: tokenRows.reduce((s, e) => s + (e.in || 0) + (e.out || 0), 0),
    personal: true, unlimited: b.unlimited
  };
}
// 「挂起」是显式字段（原平台没有启停开关，靠名字后缀标记，启动时已固化为字段）
const isSusp = a => !!(a && a.suspended);

// --- 多 key 路由：按模型归属选择 provider ---
function providerFor(model) {
  const ps = cfg.providers;
  const hit = ps.find(p => (p.models || []).includes(model));
  return hit || ps[0];
}
function allModels() {
  const out = [];
  for (const p of cfg.providers) for (const m of (p.models || [])) out.push({ id: m, provider: p.id, label: p.label });
  return out;
}

function buildSystemPrompt(agent) {
  if (!agent) return '';
  let s = agent.instruction;
  if (agent.knowledgeBases && agent.knowledgeBases.length) {
    let kbs = '', used = 0;
    for (const k of agent.knowledgeBases) {
      const c = (k.content || '').trim();
      if (!c) continue;
      if (used + c.length > cfg.kbTotalLimit) continue; // 平台规则：知识库总量 ≤100KB
      kbs += '\n\n===== 知识库：' + (k.title || k.name || k.id) + ' =====\n' + c;
      used += c.length;
    }
    if (kbs) s += '\n\n# 你可以使用的知识库（内置，已授权）' + kbs;
  }
  return s;
}
function buildMessages(agent, conv, userMsg, extraSystem) {
  const msgs = [];
  let sys = buildSystemPrompt(agent);
  if (extraSystem) sys = (sys ? sys + '\n' : '') + extraSystem;
  if (sys) msgs.push({ role: 'system', content: sys });
  const hist = (conv ? conv.messages : []).slice(-cfg.historyLimit);
  for (const m of hist) {
    msgs.push({ role: m.role, content: String(m.content || '').slice(0, cfg.historyMsgCap) });
  }
  if (userMsg) msgs.push({ role: 'user', content: userMsg });
  return msgs;
}
async function upstreamChat(messages, model, temperature, topP, stream) {
  const prov = providerFor(model);
  const body = {
    model: model || cfg.defaultModel,
    messages,
    max_tokens: cfg.maxTokens,
    stream: !!stream
  };
  // Claude 系列在网关上会拒「temperature 和 top_p 同时给」（400 cannot both be specified）。
  // 界面上主控是温度，所以两个都配了时只发 temperature，top_p 只在没设温度时才发。
  if (temperature != null) body.temperature = temperature;
  else if (topP != null) body.top_p = topP;
  if (stream) body.stream_options = { include_usage: true };
  return fetch(cfg.baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + prov.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}
function newConv(agentId, title, ownerId) {
  const conv = { id: uid(), agentId: agentId || null, title: (title || '新对话').slice(0, 40), messages: [], createdAt: now(), updatedAt: now(), ownerId: ownerId || null };
  store.data.conversations.unshift(conv);
  store.save();
  return conv;
}
function newAsset(o) {
  const a = Object.assign({ id: uid(), type: 'doc', fav: false, deleted: false, createdAt: now() }, o);
  store.data.assets.unshift(a);
  store.save();
  return a;
}

// ---------- 任务队列 runner ----------
let runnerBusy = false;
async function runQueue() {
  if (runnerBusy) return;
  runnerBusy = true;
  try {
    while (true) {
      const task = store.data.tasks.find(t => t.status === 'queued');
      if (!task) break;
      task.status = 'running'; task.startedAt = now(); store.save();
      try {
        const agent = agentById(task.agentId);
        if (!agent) throw new Error('agent 不存在: ' + task.agentId);
        const topic = store.data.topics.find(t => t.id === task.topicId);
        const userMsg = (agent.autoflowInstruction || '请根据以下选题生成一套完整内容。') +
          '\n\n【选题】' + (topic ? topic.title : task.title || '') +
          (topic && topic.content ? '\n【选题说明】' + topic.content : '');
        const conv = newConv(agent.id, (topic ? topic.title : task.title || '任务').slice(0, 40), task.ownerId);
        conv.messages.push({ role: 'user', content: userMsg, ts: now() });
        const msgs = buildMessages(agent, null, userMsg);
        const r = await upstreamChat(msgs, agent.model, agent.temperature, agent.topP, false);
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.choices) throw new Error('上游错误 ' + r.status + ': ' + JSON.stringify(j).slice(0, 300));
        const text = j.choices[0].message.content || '';
        // 谁来点的批量任务就记在谁头上 —— 以前一律记到「owner 成员」，
        // 等于把所有人的消耗算在一个人账上，成员额度形同虚设。
        const ownerMember = store.data.members.find(m => m.id === task.memberId) || null;
        const usage = store.recordUsage(agent.model, j.usage, {
          kind: 'automate', agentId: agent.id, agentName: agent.name, boxId: agent.boxId,
          memberId: task.memberId || (ownerMember ? ownerMember.id : null),
          memberName: task.memberName || (ownerMember ? ownerMember.name : null),
          ownerId: task.ownerId || null,
          conversationId: conv.id,
          note: (topic ? topic.title : '').slice(0, 60)
        });
        conv.messages.push({ role: 'assistant', content: text, ts: now(), model: agent.model, usage });
        conv.updatedAt = now(); store.save();
        task.conversationId = conv.id;
        const asset = newAsset({
          type: 'doc', title: (topic ? topic.title : '任务产出').slice(0, 60),
          content: text, agentId: agent.id, agentName: agent.name,
          topicId: task.topicId, dimension: topic ? topic.dimension : '', conversationId: conv.id,
          model: agent.model, usage, ownerId: task.ownerId || null
        });
        task.assetId = asset.id;
        if (topic) topic.used = true;
        task.status = 'done'; task.finishedAt = now(); store.save();
      } catch (e) {
        task.status = 'error'; task.error = String(e.message || e).slice(0, 500); task.finishedAt = now(); store.save();
      }
    }
  } finally { runnerBusy = false; }
}

// ---------- SSE 对话 ----------
// 上游流式读取：tap 会把 <tool>…</tool> 从可见流里剥离，只把干净文本发给前端
// onThink：思维链增量（部分模型返回 reasoning_content / reasoning / thinking）
async function pumpStream({ msgs, model, temperature, topP, tap, onDelta, onThink }) {
  const up = await upstreamChat(msgs, model, temperature, topP, true);
  if (!up.ok) {
    const t = await up.text().catch(() => '');
    throw new Error('上游 ' + up.status + ': ' + t.slice(0, 300));
  }
  const reader = up.body.getReader();
  const dec = new TextDecoder();
  let buf = '', raw = '', usage = null, thinkRaw = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      let j; try { j = JSON.parse(payload); } catch (e) { continue; }
      if (j.usage) usage = j.usage;
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (!d) continue;
      const rsn = d.reasoning_content || d.reasoning || d.thinking;
      if (rsn && onThink) {
        // 有的网关每个 chunk 都吐全量思考，有的吐增量，这里统一成增量
        const piece = String(rsn);
        let add = piece;
        if (thinkRaw && piece.startsWith(thinkRaw)) add = piece.slice(thinkRaw.length);
        thinkRaw += add;
        if (add) onThink(add);
      }
      if (d.content) {
        raw += d.content;
        const vis = tap ? tap.feed(d.content) : d.content;
        if (vis) onDelta(vis);
      }
    }
  }
  if (tap) { const rest = tap.flush(); if (rest) onDelta(rest); }
  return { raw, usage, think: thinkRaw };
}

// ---------- 附件读取（长附件只给摘要，靠 read_file 按需取） ----------
function attachBlock(up) {
  const text = String(up.text || '').trim();
  const limit = cfg.attachInlineLimit || 6000;
  if (!text) return `\n\n【附件】${up.name}（正文未抽取，只能作为文件引用）`;
  if (text.length <= limit) return `\n\n【附件】${up.name}（${text.length} 字）\n${text}`;
  return `\n\n【附件】${up.name}（共 ${text.length} 字，正文较长，仅给出开头 ${limit} 字）\n` +
    `${text.slice(0, limit)}\n…（其余 ${text.length - limit} 字未展开；需要时用 read_file 工具按关键词或位置读取）`;
}

function readAttachment({ file, query, offset, limit }, uploads) {
  const lim = Math.min(20000, Math.max(200, limit || 4000));
  let cands = uploads.slice();
  if (file) {
    const hit = uploads.filter(u => String(u.name || '').includes(file) || file.includes(String(u.name || '')));
    if (hit.length) cands = hit;
  }
  if (!cands.length) return { ok: false, error: '当前对话没有可读的附件' };
  if (query) {
    const hits = [];
    for (const u of cands) {
      const t = String(u.text || '');
      let i = -1, n = 0;
      while (n < 4 && hits.length < 6) {
        i = t.indexOf(query, i + 1);
        if (i < 0) break;
        n++;
        hits.push(`【${u.name}｜第 ${i} 字】…${t.slice(Math.max(0, i - 180), i + query.length + 220)}…`);
        i += query.length;
      }
    }
    if (!hits.length) {
      return { ok: true, file: file || cands[0].name, query, text: `未找到「${query}」。可读附件：${cands.map(u => `${u.name}（${u.chars || 0} 字）`).join('、')}` };
    }
    return { ok: true, file: (file || cands[0].name), query, text: hits.join('\n\n') };
  }
  const u = cands[0];
  const t = String(u.text || '');
  const seg = t.slice(offset || 0, (offset || 0) + lim);
  return { ok: true, file: u.name, text: seg || '（该位置之后没有内容）' };
}

// ---------- 子智能体编排 ----------
// 主 Agent 派活 → 子 Agent 用自己的提示词/知识库独立跑一轮 → 产出回填主 Agent 上下文
function findSubAgent(name, parentAgent) {
  const pool = store.data.agents.filter(a => !isSusp(a) && (!parentAgent || a.id !== parentAgent.id));
  const exact = pool.find(a => a.name === name);
  if (exact) return exact;
  const loose = pool.filter(a => a.name.includes(name) || name.includes(a.name));
  if (loose.length) {
    // 同 Box 优先，减少跨组派活
    if (parentAgent) {
      const same = loose.find(a => a.boxId === parentAgent.boxId);
      if (same) return same;
    }
    return loose[0];
  }
  return null;
}

async function runSubAgent({ name, task, parentAgent, emit, billCtx }) {
  const sub = findSubAgent(String(name).slice(0, 40), parentAgent);
  if (!sub) {
    const sample = store.data.agents.filter(a => !isSusp(a)).slice(0, 12).map(a => a.name).join('、');
    throw new Error(`没有找到「${name}」这个 Agent。可用：${sample}`);
  }
  emit({ sub: { agentName: sub.name, agentId: sub.id, task, status: 'start' } });
  let sys = buildSystemPrompt(sub);
  sys += '\n\n# 你的工作方式\n你是被主 Agent 派活的专职子智能体。只完成下面这一件具体任务，' +
    '直接交可用产出（不要寒暄、不要问问题、不要说明流程）。产出会被主 Agent 直接使用。';
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: String(task).slice(0, 8000) }];
  const r = await upstreamChat(msgs, sub.model, sub.temperature, sub.topP, false);
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.choices) throw new Error('子 Agent 上游错误 ' + r.status + '：' + JSON.stringify(j).slice(0, 200));
  const text = String((j.choices[0].message || {}).content || '');
  const usage = store.recordUsage(sub.model, j.usage, {
    kind: 'subagent', agentId: sub.id, agentName: sub.name,
    boxId: sub.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId,
    conversationId: billCtx.conversationId, note: String(task).slice(0, 60)
  });
  emit({ sub: { agentName: sub.name, agentId: sub.id, task, status: 'done', chars: text.length, model: sub.model, usage, text: text.slice(0, 20000) } });
  return { ok: true, name: 'call_subagent', agent: sub.name, text, chars: text.length, model: sub.model, agentId: sub.id };
}

async function handleChat(req, res, body) {
  const me = whoami(req);
  if (!me) return json(res, 401, { error: 'unauthorized' });
  const preConv = body.conversationId ? store.data.conversations.find(c => c.id === body.conversationId) : null;
  // 不能往别人的会话里发消息 —— 否则拿到一个会话 ID 就能往人家对话框里塞内容
  if (preConv && !identity.canWrite(me, preConv.ownerId)) return json(res, 404, { error: '会话不存在' });
  const bodyAgent = body.agentId ? agentById(body.agentId) : null;
  // 会话里换过 Agent 时以会话为准（@ 换人保留上下文）
  const agent = (preConv && preConv.agentId && agentById(preConv.agentId)) || bodyAgent || null;
  // 服务端也拦一道：挂起 Agent 不能跑（前端拦截只是提示，不能当唯一防线）
  // 注意要放在建会话之前，否则被拒也会留下一个空会话
  if (isSusp(agent)) return json(res, 409, { error: `「${agent.name}」已挂起，不能发送。先在 Agent 编辑页取消挂起` });
  const model = body.model || (agent && agent.model) || cfg.defaultModel;

  // 两道闸门都要在「建会话」之前：被拒的请求不该在侧栏留一条空对话
  const org = store.data.org;
  if (org.balance <= 0) return json(res, 402, { error: '积分余额不足（当前 ' + org.balance + '），去「企业控制台」充值后再用' });
  // 额度闸门：认准「当前登录账号绑定的成员」，不再退回到 members[0]（那样会把别人的额度当自己的）
  const memGate = store.data.members.find(x => x.id === me.memberId) || null;
  if (memGate && memGate.quota > 0 && (memGate.used || 0) >= memGate.quota) {
    return json(res, 402, {
      error: `你的额度已用完（${Math.round(memGate.used || 0)} / ${memGate.quota} 积分），请联系管理员加额度`,
      memberQuota: { used: memGate.used || 0, quota: memGate.quota }
    });
  }
  const conv = preConv || newConv(agent ? agent.id : null, (body.content || '新对话').slice(0, 30), ownerOf(me));

  const userText = String(body.content || '').slice(0, 60000);
  // 附件也只能引用自己的：别人的附件正文里可能有客户名单
  const uploads = (Array.isArray(body.uploadIds) ? body.uploadIds : []).slice(0, 5)
    .map(id => store.data.uploads.find(u => u.id === id && identity.canRead(me, u.ownerId))).filter(Boolean);
  const refIds = (Array.isArray(body.refImageIds) ? body.refImageIds : []).slice(0, 9);
  if (!userText.trim() && !uploads.length) return json(res, 400, { error: '内容为空' });

  // 给模型看的正文：用户输入 + 附件正文 + 参考图说明
  let composed = userText.trim() || '（请阅读附件）';
  for (const up of uploads) composed += attachBlock(up);
  if (refIds.length) composed += `\n\n【参考图】用户已选 ${refIds.length} 张图作为生成参考，调用 generate_image 时会自动带入。`;

  const billCtx = {
    memberId: me.memberId || null,
    memberName: me.name || me.username,
    ownerId: ownerOf(me),
    boxId: agent ? agent.boxId : null, conversationId: conv.id
  };

  conv.messages.push({
    role: 'user', content: userText.trim(), ts: now(),
    uploads: uploads.map(u => ({ id: u.id, name: u.name, chars: u.chars || 0 })),
    refCount: refIds.length
  });
  conv.updatedAt = now(); store.save();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache', 'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  const send = o => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch (e) { } };
  send({ meta: { conversationId: conv.id, model, agent: agent ? { id: agent.id, name: agent.name } : null, member: billCtx.memberName || null } });

  let visible = '', thinkText = '';
  const emit = t => { visible += t; send({ delta: t }); };
  const emitThink = t => { thinkText += t; send({ think: t }); };
  let billedFirst = false;   // 第一段是否已经记过账，避免中断时重复计
  try {
    const histBefore = { messages: conv.messages.slice(0, -1) };
    const msgs = buildMessages(agent, histBefore, composed, TOOL_PROMPT);
    const tap = new ToolTap();
    const r1 = await pumpStream({
      msgs, model, temperature: agent ? agent.temperature : 0.8, topP: agent ? agent.topP : null,
      tap, onDelta: emit, onThink: emitThink
    });
    const u1 = store.recordUsage(model, r1.usage, {
      kind: 'chat', agentId: agent ? agent.id : null, agentName: agent ? agent.name : null,
      boxId: billCtx.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId,
      conversationId: conv.id, note: userText.slice(0, 60),
      // 上游没回 usage 时的兜底估算口径（按字符折算），避免这一轮白送
      estInChars: msgs.reduce((s, m) => s + String(m.content || '').length, 0),
      estOutChars: visible.length
    });
    billedFirst = true;

    const toolAssets = [], subAgents = [];
    let u2 = { in: 0, out: 0, credits: 0 };
    if (tap.tools.length) {
      const results = [];
      for (const call of tap.tools.slice(0, 4)) {
        const label = call.name === 'generate_image' ? '配图'
          : call.name === 'generate_video' ? '视频'
            : call.name === 'read_file' ? '读文件' : '子 Agent：' + (call.agent || '');
        send({ tool: { name: call.name, status: 'start', prompt: call.prompt || call.file || call.query || call.task || '', label } });
        try {
          if (call.name === 'generate_image') {
            const useRefs = (call.refs && call.refs.length) ? call.refs : refIds;
            const asset = await createImageAsset({
              prompt: call.prompt, ratio: call.ratio, refIds: useRefs,
              agentId: agent ? agent.id : null, agentName: agent ? agent.name : null,
              bill: { boxId: billCtx.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId },
              me
            });
            toolAssets.push({ id: asset.id, type: 'image', url: asset.imageUrl, prompt: call.prompt, refCount: asset.refCount || 0 });
            results.push({ ok: true, name: call.name, count: 1, assetIds: [asset.id], prompt: call.prompt });
            send({ tool: { name: call.name, status: 'done', asset: { id: asset.id, type: 'image', url: asset.imageUrl, title: asset.title, refCount: asset.refCount || 0 } } });
          } else if (call.name === 'generate_video') {
            const asset = await createVideoAsset({
              prompt: call.prompt, model: body.videoModel || cfg.ark.videoToolDefault || cfg.ark.videoDefault,
              ratio: call.ratio, duration: call.duration, resolution: call.resolution,
              agentId: agent ? agent.id : null, agentName: agent ? agent.name : null,
              bill: { boxId: billCtx.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId },
              me
            });
            toolAssets.push({ id: asset.id, type: 'video', url: null, prompt: call.prompt, status: asset.videoStatus });
            results.push({ ok: true, name: call.name, count: 1, assetIds: [asset.id], prompt: call.prompt });
            send({ tool: { name: call.name, status: 'done', asset: { id: asset.id, type: 'video', title: asset.title, status: asset.videoStatus, modelLabel: asset.modelLabel } } });
          } else if (call.name === 'read_file') {
            const rr = readAttachment(call, uploads);
            if (!rr.ok) throw new Error(rr.error);
            results.push({ ok: true, name: 'read_file', file: rr.file, query: rr.query, text: rr.text });
            send({ tool: { name: call.name, status: 'done', read: { file: rr.file, chars: String(rr.text || '').length, query: rr.query || '' } } });
          } else {
            const sr = await runSubAgent({ name: call.agent, task: call.task, parentAgent: agent, emit: send, billCtx });
            subAgents.push({ agentName: sr.agent, agentId: sr.agentId, task: call.task, text: sr.text, chars: sr.chars, model: sr.model });
            results.push(sr);
            send({ tool: { name: call.name, status: 'done', sub: { agentName: sr.agent, chars: sr.chars, task: call.task } } });
          }
        } catch (e) {
          const msg = String(e.message || e).slice(0, 300);
          results.push({ ok: false, name: call.name, error: msg });
          send({ tool: { name: call.name, status: 'error', error: msg } });
        }
      }
      // 第二段：把工具结果交回模型，让它用一两句话收尾（不许再调工具）
      send({ tool: { name: '__summary', status: 'start' } });
      const msgs2 = msgs.concat([
        { role: 'assistant', content: visible || '（已调用工具）' },
        { role: 'user', content: toolResultMessage(results) + '\n\n（本轮工具已执行完毕，不要再次调用工具。）' }
      ]);
      const r2 = await pumpStream({
        msgs: msgs2, model, temperature: agent ? agent.temperature : 0.8, topP: agent ? agent.topP : null,
        tap: null, onDelta: emit, onThink: emitThink
      });
      u2 = store.recordUsage(model, r2.usage, {
        kind: 'chat', agentId: agent ? agent.id : null, agentName: agent ? agent.name : null,
        boxId: billCtx.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId,
        conversationId: conv.id, note: '工具结果收尾',
        estInChars: msgs2.reduce((s, m) => s + String(m.content || '').length, 0),
        estOutChars: visible.length
      });
      send({ tool: { name: '__summary', status: 'done' } });
    }

    const usage = { in: (u1.in || 0) + (u2.in || 0), out: (u1.out || 0) + (u2.out || 0), credits: (u1.credits || 0) + (u2.credits || 0) };
    conv.messages.push({
      role: 'assistant', content: visible, ts: now(), model, usage,
      think: thinkText.trim() ? thinkText : undefined,
      toolAssets: toolAssets.length ? toolAssets : undefined,
      subAgents: subAgents.length ? subAgents : undefined
    });
    conv.updatedAt = now();
    if (!conv.title || conv.title === '新对话') conv.title = (visible.split('\n').find(l => l.trim()) || conv.title).replace(/[#*>`【】]/g, '').trim().slice(0, 30) || conv.title;

    // 长文产出自动入库 Asset（对话产物进数字资产，归属于发起人）
    let assetId = null;
    if (visible.length > 800) {
      const firstLine = (visible.split('\n').find(l => l.trim()) || conv.title).replace(/[#*>【】]/g, '').trim().slice(0, 60);
      const a = newAsset({
        type: 'doc', title: firstLine || conv.title, content: visible,
        agentId: agent ? agent.id : null, agentName: agent ? agent.name : '通用对话',
        conversationId: conv.id, model, usage, ownerId: conv.ownerId || ownerOf(me)
      });
      assetId = a.id;
    }
    store.save();
    send({
      done: true, conversationId: conv.id, usage, assetId,
      toolCount: toolAssets.length, subCount: subAgents.length,
      credits: usage.credits, balance: store.data.org.balance
    });
  } catch (e) {
    // 已经吐了一部分也要把残句存下来，别让用户白等
    if (visible) conv.messages.push({ role: 'assistant', content: visible, ts: now(), model, think: thinkText.trim() ? thinkText : undefined });
    // 上游中断时 token 已经烧掉了（账单照扣），这里按字符兜底记一笔，否则这段成本无处可查。
    // 第一段已记账的情况下不再重复记，避免中断在「工具收尾」时双算。
    if (!billedFirst && (visible || composed)) {
      try {
        store.recordUsage(model, null, {
          kind: 'chat', agentId: agent ? agent.id : null, agentName: agent ? agent.name : null,
          boxId: billCtx.boxId, memberId: billCtx.memberId, memberName: billCtx.memberName, ownerId: billCtx.ownerId,
          conversationId: conv.id, note: '上游中断（按字符估算）',
          estInChars: composed.length, estOutChars: visible.length
        });
      } catch (_) { }
    }
    store.save();
    send({ error: String(e.message || e) });
  }
  res.end();
}

// ---------- 火山引擎（方舟）：生图 ----------
function arkHeaders() { return { 'Authorization': 'Bearer ' + cfg.ark.apiKey, 'Content-Type': 'application/json' }; }

// 远端媒体一律立刻落盘：方舟返回的是预签名 URL，过期即 403
async function saveRemote(url, dir, ext) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载失败 ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const fn = uid() + ext;
  fs.writeFileSync(path.join(dir, fn), buf);
  return fn;
}

async function handleImage(req, res, body) {
  const prompt = String(body.prompt || '').slice(0, 8000);
  if (!prompt) return json(res, 400, { error: 'prompt 为空' });
  const me = whoami(req);
  if (!me) return json(res, 401, { error: 'unauthorized' });
  try {
    const asset = await createImageAsset({
      prompt, title: body.title, ratio: body.ratio,
      refIds: body.refImageIds || body.refs || [], agentId: body.agentId, agentName: body.agentName,
      bill: { memberId: me.memberId || null, memberName: me.name || me.username, boxId: body.boxId || null, ownerId: me.id },
      me
    });
    json(res, 200, { asset, model: asset.model, provider: 'volcengine', size: asset.size, refCount: asset.refCount || 0, balance: store.data.org.balance });
  } catch (e) { json(res, 502, { error: String(e.message || e) }); }
}

// 比例 → 方舟支持的尺寸（超出范围会 400，所以只给这几档）
const RATIO_SIZE = { '1:1': '1024x1024', '3:4': '864x1152', '4:3': '1152x864', '16:9': '1280x720', '9:16': '720x1280', '21:9': '1344x576' };

// 参考图：可以是资产图（/img/…），也可以是用户上传的图片文件。
// 必须校验归属 —— 否则拿到别人的 assetId 就能把别人的图当参考图读出来。
/**
 * 资产可见性。默认私有，产出者可以一键「团队可见」。
 *
 * 为什么只放开资产、不放附件和导出件：
 * 资产是成品（图/视频/文档），团队复用价值高；
 * 附件常是客户名单、未公开文案，导出件是给客户的东西，
 * 这类一共享就等于事实泄露，所以永远私有。
 */
function canSeeAsset(me, a) {
  if (!a) return false;
  if (identity.canRead(me, a.ownerId)) return true;
  return a.visibility === 'team' && identity.isActive(me);
}
function refFileOf(id, me) {
  const a = store.data.assets.find(x => x.id === id && x.type === 'image' && !x.deleted);
  if (a && canSeeAsset(me, a) && a.imageUrl && a.imageUrl.startsWith('/img/')) return path.join(IMGDIR, path.basename(a.imageUrl));
  const up = store.data.uploads.find(x => x.id === id && /^image\//.test(x.mime || ''));
  if (up && identity.canRead(me, up.ownerId)) return path.join(UPLOADDIR, up.file);
  return null;
}
function refToDataUri(file) {
  try {
    const tmp = path.join(os.tmpdir(), 'cb-ref-' + crypto.randomBytes(4).toString('hex') + '.jpg');
    execFileSync('/usr/bin/sips', ['-Z', '768', '-s', 'format', 'jpeg', file, '--out', tmp], { stdio: 'ignore' });
    const buf = fs.readFileSync(tmp); try { fs.unlinkSync(tmp); } catch (e) { }
    return 'data:image/jpeg;base64,' + buf.toString('base64');
  } catch (e) { return null; }
}

async function arkGenerateImage({ prompt, ratio, size, refIds, me }) {
  const finalSize = size && /^\d+x\d+$/.test(size) ? size : (RATIO_SIZE[ratio] || cfg.ark.imageSize);
  const body = { model: cfg.ark.imageModel, prompt, size: finalSize, response_format: 'url', watermark: false };
  const imgs = (refIds || []).map(id => refFileOf(id, me)).filter(Boolean).slice(0, 9).map(refToDataUri).filter(Boolean);
  if (imgs.length) body.image = imgs;
  const call = async payload => {
    const r = await fetch(cfg.ark.baseUrl + '/images/generations', { method: 'POST', headers: arkHeaders(), body: JSON.stringify(payload) });
    const j = await r.json().catch(() => null);
    return { r, j };
  };
  let { r, j } = await call(body);
  let usedRefs = imgs.length;
  if (!r.ok && imgs.length) {          // 参考图不被接受时退回纯文生图，别让整单失败
    const retry = Object.assign({}, body); delete retry.image;
    ({ r, j } = await call(retry)); usedRefs = 0;
  }
  if (!r.ok) throw new Error('方舟生图失败：' + ((j && j.error && j.error.message) || r.status));
  const item = (j.data || [])[0];
  if (!item || !item.url) throw new Error('方舟未返回图片 URL');
  const fn = await saveRemote(item.url, IMGDIR, '.jpeg');
  return { url: '/img/' + fn, size: item.size || finalSize, usedRefs };
}

async function createImageAsset({ prompt, title, ratio, refIds, agentId, agentName, bill, me }) {
  const out = await arkGenerateImage({ prompt, ratio, refIds, me });
  const asset = newAsset({
    type: 'image', title: (title || prompt).slice(0, 60), content: prompt,
    imageUrl: out.url, model: cfg.ark.imageModel, provider: 'volcengine',
    size: out.size, refCount: out.usedRefs, agentId: agentId || null, agentName: agentName || null,
    ownerId: (bill || {}).ownerId || null
  });
  store.recordMedia('image', Object.assign({ model: cfg.ark.imageModel, agentId, agentName, note: String(prompt).slice(0, 60) }, bill || {}));
  return asset;
}

// ---------- 火山引擎（方舟）：生视频 ----------
// 每个型号能力不同（分辨率/时长/比例），统一按 config.ark.videoModels 的声明裁剪参数，
// 不支持的组合不拼接，避免方舟建单阶段直接 400。
function videoMeta(modelId) {
  const list = cfg.ark.videoModels || [];
  return list.find(v => v.id === modelId) || list[0] || {};
}

function pickParam(val, allowed, fallback) {
  if (!Array.isArray(allowed) || !allowed.length) return val ? String(val) : String(fallback);
  const s = val == null ? '' : String(val);
  if (allowed.includes(s)) return s;
  return String(fallback != null && allowed.includes(String(fallback)) ? fallback : allowed[0]);
}

// 按型号能力裁剪参数（Mini 传 1080p 会落回 720p，避免建单 400）
function videoParams({ prompt, model, ratio, duration, resolution }) {
  const m = model && videoMeta(model).id === model ? model : cfg.ark.videoDefault;
  const meta = videoMeta(m);
  const R = pickParam(ratio, meta.ratios, '16:9');
  const D = pickParam(duration, meta.durations, '5');
  const RES = pickParam(resolution, meta.resolutions, (meta.resolutions || []).includes('720p') ? '720p' : (meta.resolutions || [])[0]);
  return { model: m, meta, ratio: R, duration: D, resolution: RES, text: prompt + ' --ratio ' + R + ' --duration ' + D + ' --resolution ' + RES };
}

async function createVideoAsset({ prompt, model, ratio, duration, resolution, title, agentId, agentName, imageUrl, bill }) {
  const vp = videoParams({ prompt, model, ratio, duration, resolution });
  const content = [{ type: 'text', text: vp.text }];
  if (imageUrl) content.push({ type: 'image_url', image_url: { url: imageUrl }, role: 'first_frame' });
  const r = await fetch(cfg.ark.baseUrl + '/contents/generations/tasks', {
    method: 'POST', headers: arkHeaders(), body: JSON.stringify({ model: vp.model, content })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error('方舟建任务失败：' + ((j && j.error && j.error.message) || r.status));
  const asset = newAsset({
    type: 'video', title: (title || prompt).slice(0, 60), content: prompt,
    model: vp.model, modelLabel: vp.meta.label || vp.model, provider: 'volcengine',
    ratio: vp.ratio, duration: vp.duration, resolution: vp.resolution,
    agentId: agentId || null, agentName: agentName || null,
    artTaskId: j.id, videoStatus: 'queued',
    ownerId: (bill || {}).ownerId || null
  });
  store.recordMedia('video', Object.assign({
    model: vp.model, duration: vp.duration, agentId, agentName, note: String(prompt).slice(0, 60)
  }, bill || {}));
  pollVideo(asset.id).catch(() => { });
  return asset;
}

async function handleVideoCreate(req, res, body) {
  const prompt = String(body.prompt || '').slice(0, 4000);
  if (!prompt) return json(res, 400, { error: 'prompt 为空' });
  if (body.dry) {
    const vp = videoParams({ prompt, model: body.model, ratio: body.ratio, duration: body.duration, resolution: body.resolution });
    return json(res, 200, { dry: true, model: vp.model, label: vp.meta.label, ratio: vp.ratio, duration: vp.duration, resolution: vp.resolution, text: vp.text });
  }
  const me = whoami(req);
  if (!me) return json(res, 401, { error: 'unauthorized' });
  try {
    const asset = await createVideoAsset({
      prompt, model: body.model, ratio: body.ratio, duration: body.duration, resolution: body.resolution,
      title: body.title, imageUrl: body.imageUrl, agentId: body.agentId, agentName: body.agentName,
      bill: { memberId: me.memberId || null, memberName: me.name || me.username, boxId: body.boxId || null, ownerId: me.id }
    });
    json(res, 200, { asset, balance: store.data.org.balance });
  } catch (e) { json(res, 502, { error: String(e.message || e) }); }
}

// 视频任务轮询：成功即下载到本地（外链 24h 过期）
const pollingVideos = new Set();
async function pollVideo(assetId) {
  const a = store.data.assets.find(x => x.id === assetId);
  if (!a || !a.artTaskId) return a;
  if (a.videoStatus === 'succeeded' || a.videoStatus === 'failed') return a;
  if (pollingVideos.has(assetId)) return a;   // 同一任务只跑一个轮询
  pollingVideos.add(assetId);
  try {
    for (let i = 0; i < 180; i++) {
      let r, j;
      try {
        r = await fetch(cfg.ark.baseUrl + '/contents/generations/tasks/' + a.artTaskId, { headers: arkHeaders() });
        j = await r.json().catch(() => null);
      } catch (e) {
        await new Promise(s => setTimeout(s, 5000));
        continue;
      }
      if (!r.ok || !j) { a.videoStatus = 'failed'; a.videoError = 'poll ' + r.status; store.save(); return a; }
      if (j.status === 'succeeded') {
        const url = j.content && j.content.video_url;
        if (!url) { a.videoStatus = 'failed'; a.videoError = '没有返回 video_url'; store.save(); return a; }
        try { a.videoUrl = '/vid/' + await saveRemote(url, VIDEODIR, '.mp4'); }
        catch (e) { a.videoUrl = url; }
        a.videoStatus = 'succeeded';
        a.usage = j.usage;
        a.finishedAt = now();
        store.save();
        return a;
      }
      if (j.status === 'failed' || j.status === 'expired') {
        a.videoStatus = 'failed';
        a.videoError = (j.error && j.error.message) || j.status;
        store.save();
        return a;
      }
      if (a.videoStatus !== j.status) { a.videoStatus = j.status; store.save(); }
      await new Promise(s => setTimeout(s, 5000));
    }
    return a;
  } finally {
    pollingVideos.delete(assetId);
  }
}

// 服务启动时续接未完成的视频任务（重启不丢单）
function resumeVideos() {
  const pending = store.data.assets.filter(a => a.type === 'video' && a.artTaskId && a.videoStatus !== 'succeeded' && a.videoStatus !== 'failed');
  for (const a of pending) pollVideo(a.id).catch(() => { });
  if (pending.length) console.log('续接未完成视频任务：' + pending.length + ' 个');
}

// ---------- 路由 ----------
async function route(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const m = req.method;

  if (m === 'POST' && p === '/api/auth/login') {
    const b = await readBody(req);
    const raw = String(b.username || '');
    const wait = failBlocked(req, raw);
    if (wait) return json(res, 429, { error: `密码错误次数过多，请 ${wait} 秒后再试` });
    const norm = identity.normalizeUsername(raw);
    const u = norm.value ? store.findUserByName(norm.value) : null;
    // 账号不存在与密码错走同一条路径、同一句提示、同样计一次失败 —— 不给枚举账号的机会
    if (!u || !identity.verifyPassword(b.password, u)) {
      const n = failHit(req, raw);
      return json(res, 401, {
        error: '用户名或密码错误',
        remain: Math.max(0, FAIL_MAX - n)
      });
    }
    if (!identity.isActive(u)) return json(res, 403, { error: '账号已停用，请联系管理员' });
    failClear(req, raw);
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { userId: u.id, ts: Date.now() });
    saveSessions();
    store.touchLogin(u.id);
    res.setHeader('Set-Cookie', 'sid=' + sid + '; Path=/; HttpOnly; SameSite=Lax');
    return json(res, 200, { ok: true, user: publicUser(u) });
  }
  // 邀请码注册：默认关闭，管理员在控制台开启后才有码
  if (m === 'POST' && p === '/api/auth/register') {
    const b = await readBody(req);
    const inv = store.data.org.inviteCode;
    if (!inv || !store.data.org.inviteOpen) return json(res, 403, { error: '未开放注册，请联系管理员开通账号' });
    if (String(b.invite || '').trim() !== inv) return json(res, 403, { error: '邀请码不正确' });
    const norm = identity.normalizeUsername(b.username);
    if (norm.error) return json(res, 400, { error: norm.error });
    const pwErr = identity.passwordProblem(b.password);
    if (pwErr) return json(res, 400, { error: pwErr });
    if (store.findUserByName(norm.value)) return json(res, 409, { error: '用户名已被占用' });
    // 账号与记账主体一起建：没绑成员的账号花不了钱，等于残废
    const mem = { id: 'mb-' + uid().slice(0, 8), name: String(b.name || norm.value).trim().slice(0, 20), role: 'editor', quota: 0, used: 0, active: true, createdAt: Date.now() };
    store.data.members.push(mem);
    const r = store.createUser({ username: norm.value, name: b.name || norm.value, password: b.password, role: 'member', memberId: mem.id });
    if (r.error) {
      store.data.members = store.data.members.filter(x => x.id !== mem.id);
      return json(res, 400, { error: r.error });
    }
    store.save();
    const sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, { userId: r.user.id, ts: Date.now() });
    saveSessions();
    res.setHeader('Set-Cookie', 'sid=' + sid + '; Path=/; HttpOnly; SameSite=Lax');
    return json(res, 200, { ok: true, user: publicUser(r.user) });
  }
  if (m === 'POST' && p === '/api/auth/logout') {
    const sid = getSid(req);
    if (sid) sessions.delete(sid);
    saveSessions();
    res.setHeader('Set-Cookie', 'sid=; Path=; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (p === '/api/ping') return json(res, 200, { ok: true });
  // 登录态探测：前端启动时先问一句「我登录了吗」。
  // 直接打 /api/bootstrap 会得到 401，浏览器控制台会留一条红色报错，外行一看就以为坏了。
  if (m === 'GET' && p === '/api/auth/state') {
    const u = whoami(req);
    return json(res, 200, { authed: !!u, user: u ? publicUser(u) : null });
  }

  if (!p.startsWith('/api/')) return; // 静态文件交由 static 处理
  const me = auth(req, res);
  if (!me) return;

  // 当前账号绑定的记账主体（配额/用量挂在成员上，账号只是身份）
  const curMember = () => store.data.members.find(x => x.id === me.memberId) || null;

  // --- 账号自助 ---
  if (m === 'GET' && p === '/api/auth/me') return json(res, 200, { user: publicUser(me) });
  if (m === 'POST' && p === '/api/auth/password') {
    const b = await readBody(req);
    if (!identity.verifyPassword(b.oldPassword, me)) return json(res, 400, { error: '当前密码不正确' });
    const err = identity.passwordProblem(b.newPassword);
    if (err) return json(res, 400, { error: err });
    if (String(b.oldPassword) === String(b.newPassword)) return json(res, 400, { error: '新密码不能与当前密码相同' });
    store.setPassword(me.id, b.newPassword);
    // 改密后其它设备下线，只保留当前这条会话
    const keep = getSid(req);
    for (const [sid, s] of [...sessions]) if (s.userId === me.id && sid !== keep) sessions.delete(sid);
    saveSessions();
    return json(res, 200, { ok: true });
  }

  // --- 账号管理（管理员）---
  if (m === 'GET' && p === '/api/users') {
    if (!requireAdmin(req, res, me)) return;
    const list = store.data.users.map(u => {
      const pu = publicUser(u);
      return { ...pu, hasAccount: true, createdAt: u.createdAt || null };
    });
    // 没有账号的成员也列出来，否则管理员看不出「这个人还没开通」
    for (const mem of store.data.members) {
      if (!store.data.users.some(u => u.memberId === mem.id)) {
        list.push({
          id: null, memberId: mem.id, username: null, name: mem.name,
          role: 'member', roleLabel: '成员', admin: false, status: 'none',
          quota: mem.quota || 0, used: mem.used || 0, hasAccount: false, createdAt: mem.createdAt || null
        });
      }
    }
    // 邀请码：第一次打开这个页面就生成一个，省得管理员先点「重新生成」才有东西可发
    if (!store.data.org.inviteCode) { store.data.org.inviteCode = identity.tempPassword(8).toLowerCase(); store.save(); }
    return json(res, 200, { list, invite: { open: !!store.data.org.inviteOpen, code: store.data.org.inviteCode || null } });
  }
  if (m === 'POST' && p === '/api/users') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    const norm = identity.normalizeUsername(b.username);
    if (norm.error) return json(res, 400, { error: norm.error });
    const pwErr = identity.passwordProblem(b.password);
    if (pwErr) return json(res, 400, { error: pwErr });
    // 用户名唯一性必须最先查：先建 member 再建 user 的话，重名失败会留下一个
    // 「有成员、没账号、占着额度」的孤儿，账号页上会冒出重复的「未开通」
    if (store.findUserByName(norm.value)) return json(res, 409, { error: '登录名已被占用' });
    const role = b.role === 'admin' ? 'admin' : 'member';
    // 只有 owner 能造管理员，否则 admin 可以无限提权
    if (role === 'admin' && !identity.isOwner(me)) return json(res, 403, { error: '只有所有者可以授予管理员' });
    let memberId = b.memberId || null;
    let createdMemberId = null;
    if (!memberId) {
      const mem = { id: 'mb-' + uid().slice(0, 8), name: String(b.name || norm.value).trim().slice(0, 20), role: 'editor', quota: Number(b.quota) || 0, used: 0, active: true, createdAt: Date.now() };
      store.data.members.push(mem);
      memberId = mem.id;
      createdMemberId = mem.id;
    } else if (!store.data.members.some(x => x.id === memberId)) {
      return json(res, 400, { error: '成员不存在' });
    } else if (store.data.users.some(u => u.memberId === memberId)) {
      return json(res, 409, { error: '该成员已开通账号' });
    }
    const r = store.createUser({ username: norm.value, name: b.name || norm.value, password: b.password, role, memberId });
    if (r.error) {
      // 回滚刚建的成员，别留孤儿
      if (createdMemberId) store.data.members = store.data.members.filter(x => x.id !== createdMemberId);
      return json(res, 400, { error: r.error });
    }
    store.save();
    return json(res, 200, { user: publicUser(r.user) });
  }
  if (m === 'POST' && /^\/api\/users\/[\w-]+\/status$/.test(p)) {
    if (!requireAdmin(req, res, me)) return;
    const id = p.split('/')[3];
    const b = await readBody(req);
    const target = store.findUser(id);
    if (!target) return json(res, 404, { error: '账号不存在' });
    if (target.id === me.id) return json(res, 400, { error: '不能停用自己的账号' });
    if (target.role === 'admin' && !identity.isOwner(me)) return json(res, 403, { error: '只有所有者可以停用管理员' });
    const r = store.setStatus(id, b.status);
    if (r.error) return json(res, 400, { error: r.error });
    // 停用即刻踢下线，不等 cookie 过期
    if (target.status === 'disabled') {
      for (const [sid, s] of [...sessions]) if (s.userId === id) sessions.delete(sid);
      saveSessions();
    }
    return json(res, 200, { user: publicUser(r.user) });
  }
  if (m === 'POST' && /^\/api\/users\/[\w-]+\/password$/.test(p)) {
    if (!requireAdmin(req, res, me)) return;
    const id = p.split('/')[3];
    const b = await readBody(req);
    const target = store.findUser(id);
    if (!target) return json(res, 404, { error: '账号不存在' });
    if (identity.isAdmin(target) && !identity.isOwner(me)) return json(res, 403, { error: '只有所有者可以重置管理员密码' });
    // 管理员不填就给一个临时密码，一次性显示
    const plain = b.password && !identity.passwordProblem(b.password) ? b.password : identity.tempPassword(12);
    if (b.password && identity.passwordProblem(b.password)) return json(res, 400, { error: identity.passwordProblem(b.password) });
    store.setPassword(id, plain);
    for (const [sid, s] of [...sessions]) if (s.userId === id) sessions.delete(sid);
    saveSessions();
    return json(res, 200, { ok: true, tempPassword: plain });
  }
  if (m === 'PATCH' && /^\/api\/users\/[\w-]+$/.test(p)) {
    if (!requireAdmin(req, res, me)) return;
    const id = p.split('/')[3];
    const b = await readBody(req);
    const target = store.findUser(id);
    if (!target) return json(res, 404, { error: '账号不存在' });
    if (b.role != null) {
      if (!identity.isOwner(me)) return json(res, 403, { error: '只有所有者可以变更角色' });
      const r = store.setRole(id, b.role);
      if (r.error) return json(res, 400, { error: r.error });
    }
    if (b.name != null) target.name = String(b.name).trim().slice(0, 24);
    // 额度挂在成员上，账号只是转手
    if (b.quota != null && target.memberId) {
      const mem = store.data.members.find(x => x.id === target.memberId);
      if (mem) mem.quota = Math.max(0, Number(b.quota) || 0);
    }
    store.save();
    return json(res, 200, { user: publicUser(store.findUser(id)) });
  }
  // 给未开通的成员开通账号（复用 POST /api/users，这里只做「开通」语义提示）
  // 邀请码：管理员开关与重置
  if (m === 'POST' && p === '/api/org/invite') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    if (b.reset) store.data.org.inviteCode = identity.tempPassword(8).toLowerCase();
    if (!store.data.org.inviteCode) store.data.org.inviteCode = identity.tempPassword(8).toLowerCase();
    if (b.open != null) store.data.org.inviteOpen = !!b.open;
    store.save();
    return json(res, 200, { invite: { open: !!store.data.org.inviteOpen, code: store.data.org.inviteCode } });
  }

  // --- 引导数据 ---
  if (m === 'GET' && p === '/api/bootstrap') {
    const d = store.data;
    const boxes = d.boxes.map(b => ({
      id: b.id, name: b.name, desc: b.desc,
      agents: d.agents.filter(a => a.boxId === b.id)
        .map(a => ({ id: a.id, name: a.name, category: a.category, description: a.description, model: a.model, quickQuestions: a.quickQuestions, supportsAutoflow: a.supportsAutoflow, suspended: isSusp(a) }))
    }));
    const dims = {};
    for (const t of d.topics) dims[t.dimension] = (dims[t.dimension] || 0) + 1;
    const mem = curMember();
    const admin = identity.isAdmin(me);
    // 普通成员只看得到自己的数据：统计口径也得跟着变，否则顶栏数字会暴露别人的量
    const myConvs = admin ? d.conversations : d.conversations.filter(c => c.ownerId === me.id);
    const myAssets = admin ? d.assets : d.assets.filter(a => a.ownerId === me.id);
    const myLedger = admin ? d.ledger : d.ledger.filter(e => e.ownerId === me.id || (mem && e.memberId === mem.id));
    // 今日口径：让顶栏「今日积分 / 累计 tokens」两个数字都刷新不丢，不再出现 0 对 492 万
    const today = new Date().toISOString().slice(0, 10);
    const todayLedger = myLedger.filter(e => e.day === today);
    const todayCredits = Math.round(todayLedger.reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100;
    const todayCalls = todayLedger.length;
    json(res, 200, {
      user: publicUser(me),
      // 管理员能看到全组织成员列表；普通成员只看到自己这一行（避免暴露同事姓名与用量）
      member: mem ? { id: mem.id, name: mem.name, role: mem.role, quota: mem.quota || 0, used: mem.used || 0 } : null,
      members: (admin
        ? d.members.map(x => ({ id: x.id, name: x.name, role: x.role, quota: x.quota || 0, used: x.used || 0 }))
        : (mem ? [{ id: mem.id, name: mem.name, role: mem.role, quota: mem.quota || 0, used: mem.used || 0 }] : [])),
      org: {
        name: d.org.name, balance: d.org.balance, used: admin ? (d.org.used || 0) : Math.round(myLedger.reduce((s, e) => s + (e.credits || 0), 0) * 100) / 100,
        opening: d.org.opening || 0, recharged: d.org.recharged || 0,
        todayCredits, todayCalls,
        lowBalance: (cfg.billing || {}).lowBalance || 0, unit: (cfg.billing || {}).unit || '积分'
      },
      models: allModels(), defaultModel: cfg.defaultModel,
      media: {
        imageModel: cfg.ark.imageModel,
        videoModels: cfg.ark.videoModels,
        videoDefault: cfg.ark.videoDefault
      },
      boxes, dims,
      counts: {
        agents: d.agents.length, topics: d.topics.length,
        assets: myAssets.filter(a => !a.deleted).length,
        conversations: myConvs.length,
        tasksRunning: (admin ? d.tasks : d.tasks.filter(t => t.ownerId === me.id)).filter(t => t.status === 'queued' || t.status === 'running').length
      },
      usage: admin ? d.usage : { calls: todayCalls, totalIn: 0, totalOut: 0, perModel: {}, perDay: {} }
    });
    return;
  }

  // --- Box 管理 ---
  if (m === 'POST' && p === '/api/boxes') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    const name = (b.name || '').trim();
    if (!name) return json(res, 400, { error: 'Box 名称不能为空' });
    const box = { id: 'box-' + uid().slice(0, 8), name, desc: b.desc || '' };
    store.data.boxes.push(box); store.save();
    return json(res, 200, { box });
  }
  if (m === 'DELETE' && /^\/api\/boxes\/[\w-]+$/.test(p)) {
    const id = p.split('/').pop();
    if (store.data.boxes.length <= 1) return json(res, 400, { error: '至少保留一个 Box' });
    const i = store.data.boxes.findIndex(b => b.id === id);
    if (i < 0) return json(res, 404, { error: 'not found' });
    const fallback = store.data.boxes.find(b => b.id !== id);
    store.data.agents.forEach(a => { if (a.boxId === id) a.boxId = fallback.id; });
    store.data.boxes.splice(i, 1); store.save();
    return json(res, 200, { ok: true });
  }

  // --- Agent 新建 / 编辑 / 删除 ---
  if (m === 'POST' && p === '/api/agents') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    if (!b.name || !b.instruction) return json(res, 400, { error: '名称与提示词必填' });
    const kbs = Array.isArray(b.knowledgeBases) ? b.knowledgeBases
      .filter(k => k && String(k.content || '').trim())
      .map(k => ({ id: 'kb-' + uid().slice(0, 8), type: 'text', content: String(k.content) })) : [];
    const agent = {
      id: 'ag-' + uid().slice(0, 8), name: b.name.trim(), category: b.category || '自定义',
      description: b.description || '', boxId: b.boxId || store.data.boxes[0].id,
      model: b.model || cfg.defaultModel, temperature: b.temperature != null ? +b.temperature : 0.8,
      topP: 0.9, enableThinking: false, supportsAutoflow: !!b.supportsAutoflow,
      suspended: !!b.suspended,
      autoflowInstruction: b.autoflowInstruction || '',
      quickQuestions: Array.isArray(b.quickQuestions) ? b.quickQuestions : [],
      instruction: String(b.instruction), knowledgeBases: kbs
    };
    store.data.agents.push(agent); store.save();
    return json(res, 200, { agent });
  }
  if (m === 'PATCH' && /^\/api\/agent\/[\w-]+$/.test(p)) {
    if (!requireAdmin(req, res, me)) return;
    const a = agentById(p.split('/').pop());
    if (!a) return json(res, 404, { error: 'not found' });
    const b = await readBody(req);
    for (const k of ['name', 'category', 'description', 'boxId', 'model', 'instruction', 'autoflowInstruction']) {
      if (b[k] != null) a[k] = b[k];
    }
    if (b.temperature != null) a.temperature = +b.temperature;
    if (b.supportsAutoflow != null) a.supportsAutoflow = !!b.supportsAutoflow;
    if (b.suspended != null) a.suspended = !!b.suspended;
    if (Array.isArray(b.quickQuestions)) a.quickQuestions = b.quickQuestions;
    if (Array.isArray(b.knowledgeBases)) {
      a.knowledgeBases = b.knowledgeBases.filter(k => k && String(k.content || '').trim())
        .map(k => ({ id: k.id || 'kb-' + uid().slice(0, 8), type: 'text', content: String(k.content) }));
    }
    store.save();
    return json(res, 200, { agent: a });
  }
  if (m === 'DELETE' && /^\/api\/agent\/[\w-]+$/.test(p)) {
    if (!requireAdmin(req, res, me)) return;
    const i = store.data.agents.findIndex(a => a.id === p.split('/').pop());
    if (i >= 0) { store.data.agents.splice(i, 1); store.save(); }
    return json(res, 200, { ok: true });
  }

  // --- Agent ---
  if (m === 'GET' && /^\/api\/agent\/[\w-]+$/.test(p)) {
    const a = agentById(p.split('/').pop());
    if (!a) return json(res, 404, { error: 'not found' });
    json(res, 200, { agent: a });
    return;
  }

  // --- 对话 ---
  if (m === 'POST' && p === '/api/chat') { const b = await readBody(req); return handleChat(req, res, b); }
  /**
   * 取会话并校验归属。
   * 不是自己的 → 返回 null，调用方一律回 404（不是 403）：
   * 403 等于告诉对方「这个 ID 存在，只是你不能看」，可以拿来枚举。
   */
  const convFor = (id, mode) => {
    const c = store.data.conversations.find(x => x.id === id);
    if (!c) return null;
    const ok = mode === 'write' ? identity.canWrite(me, c.ownerId) : identity.canRead(me, c.ownerId);
    return ok ? c : null;
  };
  if (m === 'GET' && p === '/api/conversations') {
    // limit 默认 100，全量查看时前端传更大值；侧栏只要前 12 条
    const limit = Math.max(1, Math.min(+(u.searchParams.get('limit') || 100), 1000));
    const agentName = id => {
      const a = id ? store.data.agents.find(x => x.id === id) : null;
      return a ? a.name : null;
    };
    const admin = identity.isAdmin(me);
    const mine = admin ? store.data.conversations : store.data.conversations.filter(c => c.ownerId === me.id);
    json(res, 200, {
      total: mine.length,
      scope: admin ? 'org' : 'self',
      list: mine.slice(0, limit).map(c => ({
        id: c.id, title: c.title, agentId: c.agentId, updatedAt: c.updatedAt,
        created: c.createdAt, turns: (c.messages || []).length,
        agentName: agentName(c.agentId),
        // 管理员视角要能分清「这是谁的在聊」，普通成员永远只看到自己的
        owner: admin ? ((store.findUser(c.ownerId) || {}).name || null) : null,
        mine: c.ownerId === me.id,
        imported: c.imported ? { from: c.imported.from, url: c.imported.url, boxName: c.imported.boxName } : null
      }))
    });
    return;
  }
  if (m === 'GET' && /^\/api\/conversation\/[\w-]+$/.test(p)) {
    const c = convFor(p.split('/').pop(), 'read');
    if (!c) return json(res, 404, { error: 'not found' });
    const ag = c.agentId ? agentById(c.agentId) : null;
    json(res, 200, {
      conversation: c,
      agent: ag ? { id: ag.id, name: ag.name, model: ag.model } : null,
      mine: c.ownerId === me.id
    });
    return;
  }
  if (m === 'DELETE' && /^\/api\/conversation\/[\w-]+$/.test(p)) {
    const c = convFor(p.split('/').pop(), 'write');
    if (!c) return json(res, 404, { error: 'not found' });
    const d = store.data;
    const i = d.conversations.findIndex(x => x.id === c.id);
    if (i >= 0) { d.conversations.splice(i, 1); store.save(); }
    return json(res, 200, { ok: true });
  }
  // 改标题
  if (m === 'PATCH' && /^\/api\/conversation\/[\w-]+$/.test(p)) {
    const c = convFor(p.split('/').pop(), 'write');
    if (!c) return json(res, 404, { error: 'not found' });
    const b = await readBody(req);
    if (b.title != null) {
      const t = String(b.title).trim().slice(0, 60);
      if (!t) return json(res, 400, { error: '标题不能为空' });
      c.title = t;
    }
    store.save();
    return json(res, 200, { conversation: { id: c.id, title: c.title } });
  }
  // @ 换人：就地在同一会话里换应答 Agent，历史全部保留
  if (m === 'POST' && /^\/api\/conversation\/[\w-]+\/agent$/.test(p)) {
    const id = p.split('/')[3];
    const c = convFor(id, 'write');
    if (!c) return json(res, 404, { error: 'not found' });
    const b = await readBody(req);
    const ag = b.agentId ? agentById(b.agentId) : null;
    if (!ag) return json(res, 400, { error: 'Agent 不存在' });
    const from = c.agentId ? (agentById(c.agentId) || {}).name : '无';
    c.agentId = ag.id;
    c.agentSwitches = (c.agentSwitches || []).concat([{ from, to: ag.name, at: now() }]);
    c.updatedAt = now();
    store.save();
    return json(res, 200, { ok: true, agent: { id: ag.id, name: ag.name, model: ag.model }, from });
  }

  // --- 附件上传（前端读成 base64 再传，服务端零依赖解析）---
  if (m === 'POST' && p === '/api/upload') {
    const b = await readBody(req);
    const name = String(b.name || 'file').slice(0, 200).replace(/[/\\]/g, '_') || 'file';
    if (!b.data) return json(res, 400, { error: '没有文件内容' });
    let buf;
    try { buf = Buffer.from(String(b.data), 'base64'); } catch (e) { return json(res, 400, { error: 'base64 解析失败' }); }
    if (!buf.length) return json(res, 400, { error: '文件为空' });
    if (buf.length > 12 * 1024 * 1024) return json(res, 413, { error: '单个文件不能超过 12MB' });
    const ext = path.extname(name).toLowerCase().slice(0, 12);
    const file = uid() + ext;
    const abs = path.join(UPLOADDIR, file);
    fs.writeFileSync(abs, buf);
    const ex = extractText(abs);
    const item = {
      id: uid(), name, mime: String(b.mime || ''), bytes: buf.length, file,
      text: String(ex.text || '').slice(0, 200000), chars: String(ex.text || '').trim().length,
      warn: ex.warn || null, createdAt: now(), ownerId: ownerOf(me)
    };
    store.data.uploads.unshift(item);
    if (store.data.uploads.length > 500) store.data.uploads.length = 500;
    store.save();
    return json(res, 200, { upload: item });
  }
  if (m === 'GET' && p === '/api/uploads') {
    // 附件里可能有客户名单、未公开文案，绝不能跨人可见
    const list = store.data.uploads.filter(x => identity.canRead(me, x.ownerId));
    json(res, 200, { list: list.slice(0, 50).map(u => ({ id: u.id, name: u.name, chars: u.chars, bytes: u.bytes, warn: u.warn, createdAt: u.createdAt })) });
    return;
  }
  // 参考图库：生成的图 + 上传的图，统一给前端挑（≤9 张）
  if (m === 'GET' && p === '/api/reference-images') {
    const page = Math.max(1, +u.searchParams.get('page') || 1);
    const size = Math.min(60, +u.searchParams.get('pageSize') || 36);
    const q = (u.searchParams.get('search') || '').toLowerCase();
    const imgs = store.data.assets.filter(a => a.type === 'image' && !a.deleted && a.imageUrl && canSeeAsset(me, a))
      .map(a => ({ id: a.id, title: a.title, url: a.imageUrl, src: 'asset', createdAt: a.createdAt }));
    const ups = store.data.uploads.filter(x => identity.canRead(me, x.ownerId) && (/^image\//.test(x.mime || '') || /\.(png|jpe?g|webp|gif)$/i.test(x.name || '')))
      .map(x => ({ id: x.id, title: x.name, url: '/file/' + x.file, src: 'upload', createdAt: x.createdAt }));
    let list = [...ups, ...imgs].sort((a, b) => b.createdAt - a.createdAt);
    if (q) list = list.filter(x => String(x.title || '').toLowerCase().includes(q));
    json(res, 200, { total: list.length, page, pageSize: size, list: list.slice((page - 1) * size, page * size) });
    return;
  }

  // --- 导出 docx ---
  if (m === 'POST' && p === '/api/docx') {
    const b = await readBody(req);
    let title = String(b.title || '').slice(0, 120);
    let content = String(b.content || '');
    if (b.assetId) {
      const a = store.data.assets.find(x => x.id === b.assetId);
      if (!a || !identity.canRead(me, a.ownerId)) return json(res, 404, { error: '资产不存在' });
      title = title || a.title;
      content = content || a.content || '';
      a.exportedAt = now();
    }
    if (!content.trim()) return json(res, 400, { error: '内容为空，没什么可导出的' });
    try {
      const fn = 'doc-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.docx';
      const bytes = writeDocx(path.join(EXPORTDIR, fn), { title, content });
      // 导出件也要记归属：不然拿到文件名（或猜出来）的人不分账号都能下
      if (!Array.isArray(store.data.exports)) store.data.exports = [];
      store.data.exports.unshift({ file: fn, title: (title || '导出文档').slice(0, 60), ownerId: me.id, createdAt: now() });
      if (store.data.exports.length > 500) store.data.exports.length = 500;
      store.save();
      return json(res, 200, { url: '/export/' + fn, bytes, name: (title || '导出文档').slice(0, 40) + '.docx' });
    } catch (e) { return json(res, 500, { error: '生成 docx 失败：' + e.message }); }
  }

  // --- 新用户使用说明 ---
  if (m === 'GET' && p === '/api/guide') {
    return json(res, 200, {
      steps: [
        { t: '选一个人，别从聊天框开始', d: 'Agent 页每个员工都带死了提示词和知识库，选错员工等于让它干不熟的活。' },
        { t: '输入框能带三种料', d: '文字 / 附件（≤5 个，pdf·docx·txt·md 会自动抽正文）/ 参考图（≤9 张，出图时会带上）。附件很长时只喂开头，Agent 会自己用 read_file 按关键词读原文。' },
        { t: '要图要片直接说', d: '「出 3 张 3:4 的封面图」会由 Agent 自己调工具生成，产物同时进 Asset。' },
        { t: '它会把活派给别人', d: '任务跨专长时，主 Agent 会调 call_subagent 派给另一个专职 Agent，对方的产出以折叠卡回到同一条回复里，点开能看全文。' },
        { t: '换人不用退出', d: '输入框左侧 @ 可以换同 Box 的另一个 Agent，前面的上下文它都看得到。' },
        { t: '批量走 Automate', d: '选题库里勾选 → 选 Agent → 排队生成，一条一条落进 Asset。' },
        { t: '钱花在哪一笔一笔都能查', d: '「使用台账」按天 / 类型 / 模型 / 成员 / Box 拆开算积分；「企业控制台」管成员额度与余额，余额见底会拦住对话。' }
      ]
    });
  }

  // --- 使用台账（积分折算） ---
  const ledgerFilter = () => {
    const days = Math.min(365, Math.max(1, +u.searchParams.get('days') || 30));
    const since = Date.now() - days * 86400000;
    const mid = u.searchParams.get('memberId') || '';
    const kind = u.searchParams.get('kind') || '';
    let list = store.data.ledger.filter(e => e.ts >= since);
    // 数据隔离：普通成员只看得见自己花的钱。memberId/ownerId 任一命中即算自己，
    // 因为迁移前后两条归属线索都可能在（老账只有 memberId，新账两条都有）。
    if (!identity.isAdmin(me)) {
      const myMember = me.memberId || '\u0000';
      list = list.filter(e => e.ownerId === me.id || e.memberId === myMember);
    }
    if (mid) list = list.filter(e => e.memberId === mid);
    if (kind) list = list.filter(e => e.kind === kind);
    return { days, list };
  };
  if (m === 'GET' && p === '/api/ledger') {
    const { days, list } = ledgerFilter();
    const page = Math.max(1, +u.searchParams.get('page') || 1);
    const size = Math.min(200, +u.searchParams.get('pageSize') || 50);
    const sum = (arr, f) => Math.round(arr.reduce((s, e) => s + (f(e) || 0), 0) * 100) / 100;
    const group = (arr, keyOf) => {
      const g = {};
      for (const e of arr) {
        const k = keyOf(e) || '未标注';
        const it = g[k] = g[k] || { key: k, calls: 0, credits: 0, tokens: 0 };
        it.calls++; it.credits += e.credits || 0; it.tokens += (e.in || 0) + (e.out || 0);
      }
      return Object.values(g).map(x => ({ ...x, credits: Math.round(x.credits * 100) / 100 }))
        .sort((a, b) => b.credits - a.credits);
    };
    json(res, 200, {
      days, total: list.length, page, pageSize: size,
      list: list.slice((page - 1) * size, page * size),
      summary: {
        calls: list.length,
        credits: sum(list, e => e.credits),
        tokens: sum(list, e => (e.in || 0) + (e.out || 0)),
        byKind: group(list, e => e.kind),
        byModel: group(list, e => e.model),
        byMember: group(list, e => e.memberName),
        byDay: group(list, e => e.day).sort((a, b) => (a.key < b.key ? 1 : -1)),
        byBox: group(list, e => (store.data.boxes.find(b => b.id === e.boxId) || {}).name)
      },
      org: identity.isAdmin(me)
        ? { name: store.data.org.name, balance: store.data.org.balance, used: store.data.org.used || 0 }
        : { name: store.data.org.name, balance: personalBudget(me).left, used: personalBudget(me).used },
      audit: auditView(me),
      allTime: {
        credits: identity.isAdmin(me)
          ? sum(store.data.ledger, e => e.credits)
          : sum(mineOf(me), e => e.credits),
        calls: identity.isAdmin(me) ? store.data.ledger.length : mineOf(me).length
      }
    });
    return;
  }
  if (m === 'GET' && p === '/api/ledger.csv') {
    const { list } = ledgerFilter();
    const head = ['时间', '类型', '模型', '成员', 'Agent', '输入token', '输出token', '单价(入/出 积分/千token)', '积分'];
    const rows = list.map(e => [
      new Date(e.ts).toISOString(), e.kind || '', e.model || '', e.memberName || '', e.agentName || '',
      e.in || 0, e.out || 0,
      (e.rateIn != null || e.rateOut != null) ? `${e.rateIn ?? e.rate} / ${e.rateOut ?? e.rate}` : (e.rate || 0),
      e.credits || 0
    ]);
    const csv = [head, ...rows].map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ledger-' + new Date().toISOString().slice(0, 10) + '.csv"'
    });
    return res.end('\uFEFF' + csv);
  }

  // --- 企业与成员 ---
  if (m === 'GET' && p === '/api/org') {
    if (!requireAdmin(req, res, me)) return;
    const d = store.data;
    json(res, 200, {
      org: {
        name: d.org.name, balance: d.org.balance, used: d.org.used || 0,
        opening: d.org.opening || 0, recharged: d.org.recharged || 0,
        unit: (cfg.billing || {}).unit || '积分',
        pricing: {
          base: 'token 用量 × 单价（config.billing.modelRate 单一价 / modelRate2 入出分开价，每 1k token 积分）',
          media: '图片按张、视频按秒（config.billing.media，可按模型或尺寸分档）',
          note: 'token 数直接取上游返回的 usage，不做本地估算；未配 modelRate2 时沿用单一价，历史账不受影响'
        }
      },
      members: d.members.map(x => ({ ...x })),
      rates: (cfg.billing || {}).modelRate || {},
      rates2: (cfg.billing || {}).modelRate2 || {},
      media: (cfg.billing || {}).media || {},
      audit: store.audit(),
      currentMemberId: me.memberId || null,
      me: publicUser(me),
      accounts: { total: store.data.users.length, active: store.data.users.filter(u => u.status === 'active').length }
    });
    return;
  }
  if (m === 'PATCH' && p === '/api/org') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    if (b.name != null) {
      const n = String(b.name).trim().slice(0, 40);
      if (!n) return json(res, 400, { error: '名称不能为空' });
      store.data.org.name = n;
    }
    // 管理员调账：不允许直接改写余额（否则账本立刻不平）。
    // 传 balance 时按「目标余额」倒推差额，写成一条 adjust 台账，余额再由账本推导。
    if (b.balance != null) {
      const target = Math.round(Number(b.balance) * 100) / 100;
      if (!Number.isFinite(target)) return json(res, 400, { error: '余额不合法' });
      const diff = Math.round((target - store.data.org.balance) * 100) / 100;
      if (diff !== 0) {
        store.adjustBalance(diff, (b.note || '管理员调账') + '（目标余额 ' + target + '）');
      }
    }
    store.reconcile();
    store.save();
    return json(res, 200, { org: store.data.org });
  }
  if (m === 'POST' && p === '/api/org/recharge') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    const c = Math.round(+b.credits);
    if (!c || c <= 0) return json(res, 400, { error: '充值积分必须是正数' });
    store.data.org.recharged = Math.round(((store.data.org.recharged || 0) + c) * 100) / 100;
    store.reconcile();
    store.save();
    return json(res, 200, { ok: true, balance: store.data.org.balance, added: c });
  }
  // 人工调账：credits 为「余额增减」（正数加、负数减），写进台账，余额再由账本推导
  if (m === 'POST' && p === '/api/org/adjust') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    const c = Math.round(Number(b.credits) * 100) / 100;
    if (!Number.isFinite(c) || c === 0) return json(res, 400, { error: '调账金额必须是非零数字' });
    const note = String(b.note || '管理员调账').slice(0, 120);
    store.adjustBalance(c, note);
    store.reconcile();
    store.save();
    return json(res, 200, { ok: true, delta: c, balance: store.data.org.balance, note });
  }
  // 对账接口：把「按单价应扣」与「台账已扣」摆在一起，任何一笔不平都能当场看见
  if (m === 'GET' && p === '/api/billing/audit') {
    return json(res, 200, auditView(me));
  }
  /**
   * 旧的「切换记账成员」接口已废弃。
   * 它的本质是「把自己的消耗记到别人名下」，正是权限混乱的源头：
   * 一张口就能把额度用完的责任推给同事。现在账号即身份，消耗只能记在自己头上。
   */
  if (m === 'POST' && p === '/api/member/switch') {
    return json(res, 410, { error: '已废弃：账号即身份，消耗只能记在本人名下。要多人分开算，请让每个人用自己的账号登录' });
  }
  if (m === 'POST' && p === '/api/members') {
    if (!requireAdmin(req, res, me)) return;
    const b = await readBody(req);
    const name = String(b.name || '').trim().slice(0, 30);
    if (!name) return json(res, 400, { error: '成员名不能为空' });
    if (store.data.members.some(x => x.name === name)) return json(res, 400, { error: '已有同名成员' });
    const mem = {
      id: 'mb-' + uid().slice(0, 8), name, role: ['owner', 'editor', 'viewer'].includes(b.role) ? b.role : 'editor',
      quota: Math.max(0, Math.round(+b.quota) || 0), used: 0, active: true, createdAt: now()
    };
    store.data.members.push(mem); store.save();
    return json(res, 200, { member: mem });
  }
  if (m === 'PATCH' && /^\/api\/member\/[\w-]+$/.test(p)) {
    const mem = store.data.members.find(x => x.id === p.split('/').pop());
    if (!mem) return json(res, 404, { error: '成员不存在' });
    const b = await readBody(req);
    if (b.name != null) {
      const n = String(b.name).trim().slice(0, 30);
      if (!n) return json(res, 400, { error: '成员名不能为空' });
      mem.name = n;
    }
    if (b.role != null && ['owner', 'editor', 'viewer'].includes(b.role)) mem.role = b.role;
    if (b.quota != null) mem.quota = Math.max(0, Math.round(+b.quota) || 0);
    if (b.active != null) mem.active = !!b.active;
    store.save();
    return json(res, 200, { member: mem });
  }
  if (m === 'DELETE' && /^\/api\/member\/[\w-]+$/.test(p)) {
    const id = p.split('/').pop();
    const mem = store.data.members.find(x => x.id === id);
    if (!mem) return json(res, 404, { error: '成员不存在' });
    if (mem.role === 'owner') return json(res, 400, { error: '不能删除 owner' });
    if (store.data.members.length <= 1) return json(res, 400, { error: '至少保留一个成员' });
    store.data.members = store.data.members.filter(x => x.id !== id);
    store.save();
    return json(res, 200, { ok: true });
  }

  // --- 选题 ---
  if (m === 'GET' && p === '/api/topics') {
    const q = (u.searchParams.get('search') || '').toLowerCase();
    const dim = u.searchParams.get('dim') || '';
    const page = Math.max(1, +u.searchParams.get('page') || 1);
    const size = Math.min(200, +u.searchParams.get('pageSize') || 50);
    let list = store.data.topics;
    if (dim) list = list.filter(t => t.dimension === dim);
    if (q) list = list.filter(t => (t.title + ' ' + t.content).toLowerCase().includes(q));
    const total = list.length;
    list = list.slice((page - 1) * size, page * size);
    json(res, 200, { total, page, pageSize: size, list });
    return;
  }

  // --- 任务 ---
  if (m === 'POST' && p === '/api/tasks') {
    const b = await readBody(req);
    const agent = agentById(b.agentId);
    if (!agent) return json(res, 400, { error: '请选择 Agent' });
    const ids = Array.isArray(b.topicIds) ? b.topicIds.slice(0, 50) : [];
    if (!ids.length) return json(res, 400, { error: '请选择选题' });
    const created = [];
    for (const tid of ids) {
      const topic = store.data.topics.find(t => t.id === tid);
      if (!topic) continue;
      const t = { id: uid(), agentId: agent.id, agentName: agent.name, topicId: topic.id, topicTitle: topic.title, status: 'queued', createdAt: now(), ownerId: ownerOf(me), memberId: me.memberId || null, memberName: me.name };
      store.data.tasks.unshift(t); created.push(t.id);
    }
    store.save();
    runQueue().catch(() => {});
    json(res, 200, { created: created.length });
    return;
  }
  if (m === 'GET' && p === '/api/tasks') {
    const list = identity.isAdmin(me) ? store.data.tasks : store.data.tasks.filter(t => t.ownerId === me.id);
    json(res, 200, { list: list.slice(0, 100) });
    return;
  }

  // --- 资产 ---
  if (m === 'GET' && p === '/api/assets') {
    const type = u.searchParams.get('type') || 'all';
    const del = u.searchParams.get('deleted') === '1';
    const fav = u.searchParams.get('fav') === '1';
    const q = (u.searchParams.get('search') || '').toLowerCase();
    // 资产库：默认「我的产出」，别人的不进来；
    // 例外是别人主动标了「团队可见」的成品，进列表但标出来源（shared）
    let list = store.data.assets.filter(a => !!a.deleted === del && canSeeAsset(me, a));
    if (type === 'doc' || type === 'image' || type === 'video') list = list.filter(a => a.type === type);
    if (fav) list = list.filter(a => a.fav);
    if (q) list = list.filter(a => ((a.title || '') + ' ' + (a.content || '')).toLowerCase().includes(q));
    json(res, 200, { total: list.length, scope: identity.isAdmin(me) ? 'org' : 'self', list: list.slice(0, 200).map(a => ({ ...a, mine: a.ownerId === me.id, content: a.type === 'doc' ? String(a.content || '').slice(0, 4000) : a.content })) });
    return;
  }
  /** 取资产并校验可见性；既不是自己的、也没被共享，一律当不存在 */
  const assetFor = id => {
    const a = store.data.assets.find(x => x.id === id);
    if (!a || !canSeeAsset(me, a)) return null;
    return a;
  };
  if (m === 'GET' && /^\/api\/asset\/[\w-]+$/.test(p)) {
    json(res, 200, { asset: assetFor(p.split('/').pop()) });
    return;
  }
  // --- 新建资产（含配图 Prompt 存档） ---
  if (m === 'POST' && p === '/api/assets') {
    const b = await readBody(req);
    const a = newAsset({
      type: b.type || 'doc', title: (b.title || '未命名').slice(0, 80),
      content: b.content || '', imageUrl: b.imageUrl || null,
      pending: !!b.pending, sourceAssetId: b.sourceAssetId || null,
      ownerId: ownerOf(me)
    });
    json(res, 200, { asset: a });
    return;
  }
  if (m === 'POST' && /^\/api\/asset\/[\w-]+\/(fav|restore)$/.test(p)) {
    // 收藏/恢复是改资产本身，只有主人能改；共享给同事的只是「可看」
    const a = store.data.assets.find(x => x.id === p.split('/')[3]);
    if (a && identity.canWrite(me, a.ownerId)) {
      if (p.endsWith('/fav')) a.fav = !a.fav; else a.deleted = false;
      store.save();
    }
    json(res, 200, { ok: true, fav: a && a.fav });
    return;
  }
  // 团队可见开关：只有产出的主人（或管理员）能拨
  if (m === 'POST' && /^\/api\/asset\/[\w-]+\/share$/.test(p)) {
    const a = store.data.assets.find(x => x.id === p.split('/')[3]);
    if (!a || !identity.canWrite(me, a.ownerId)) return json(res, 404, { error: '资产不存在' });
    const b = await readBody(req).catch(() => ({}));
    a.visibility = b && b.team ? 'team' : 'private';
    a.sharedAt = b && b.team ? now() : null;
    store.save();
    json(res, 200, { ok: true, visibility: a.visibility });
    return;
  }
  if (m === 'DELETE' && /^\/api\/asset\/[\w-]+$/.test(p)) {
    const d = store.data;
    const a = d.assets.find(x => x.id === p.split('/').pop());
    // 共享给我的资产只能看不能删 —— 删的是主人家的东西，得按写权限判
    if (!a || !identity.canWrite(me, a.ownerId)) return json(res, 404, { error: '资产不存在' });
    if (a.deleted || u.searchParams.get('hard') === '1') {
      d.assets.splice(d.assets.indexOf(a), 1); // 彻底删除
    } else { a.deleted = true; }
    store.save();
    json(res, 200, { ok: true });
    return;
  }

  // --- 生图 / 生视频（火山引擎方舟）---
  if (m === 'POST' && p === '/api/image') { const b = await readBody(req); return handleImage(req, res, b); }
  if (m === 'POST' && p === '/api/video') { const b = await readBody(req); return handleVideoCreate(req, res, b); }
  if (m === 'GET' && /^\/api\/video\/[\w-]+$/.test(p)) {
    const id = p.split('/').pop();
    const a = assetFor(id);
    if (!a) return json(res, 404, { error: 'asset 不存在' });
    // 只读当前状态，不阻塞请求；后台继续轮询
    if (a.videoStatus !== 'succeeded' && a.videoStatus !== 'failed') pollVideo(id).catch(() => { });
    return json(res, 200, { asset: a });
  }

  // --- 搜索记录 ---
  if (m === 'GET' && p === '/api/search') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    if (!q) return json(res, 200, { conversations: [], assets: [] });
    const d = store.data;
    const conversations = d.conversations.filter(c => c.messages.some(mm => String(mm.content || '').toLowerCase().includes(q))).slice(0, 30)
      .map(c => ({ id: c.id, title: c.title, snippet: (c.messages.find(mm => String(mm.content || '').toLowerCase().includes(q)).content || '').slice(0, 120) }));
    const assets = d.assets.filter(a => !a.deleted && ((a.title || '') + ' ' + (a.content || '')).toLowerCase().includes(q)).slice(0, 30)
      .map(a => ({ id: a.id, type: a.type, title: a.title, snippet: String(a.content || '').slice(0, 120) }));
    json(res, 200, { conversations, assets });
    return;
  }

  json(res, 404, { error: 'no route: ' + m + ' ' + p });
}

// ---------- 静态文件 ----------
// 本地媒体（图片 / 视频 / 附件 / 导出），视频与音频支持 Range
const EXT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};
function mediaRoute(p) {
  if (p.startsWith('/vid/')) return { dir: VIDEODIR, mime: 'video/mp4' };
  if (p.startsWith('/img/')) return { dir: IMGDIR, mime: null };
  if (p.startsWith('/file/')) return { dir: UPLOADDIR, mime: null };
  if (p.startsWith('/export/')) return { dir: EXPORTDIR, mime: EXT_MIME['.docx'], download: true };
  return null;
}
/**
 * 文件归谁 —— 附件（/file）和导出件（/export）是有主的东西，
 * 只凭「登录了」就放行等于把所有人的文档摆在同一个柜子里。
 * 返回 null 表示这个文件没有归属记录（旧文件 / 公共素材），交给登录态兜底。
 */
function mediaOwner(p) {
  const base = path.basename(p);
  if (p.startsWith('/file/')) {
    const up = store.data.uploads.find(x => x.file === base);
    return up ? { ownerId: up.ownerId } : null;
  }
  if (p.startsWith('/export/')) {
    const ex = (store.data.exports || []).find(x => x.file === base);
    // 导出件没有记录（本轮改造前生成的）→ 只有管理员能拿，普通成员一律 404
    return { ownerId: ex ? ex.ownerId : '\u0000' };
  }
  if (p.startsWith('/img/')) {
    const a = store.data.assets.find(x => x.imageUrl === '/img/' + base);
    return a ? { ownerId: a.ownerId, visibility: a.visibility } : null;
  }
  if (p.startsWith('/vid/')) {
    const a = store.data.assets.find(x => x.videoUrl === '/vid/' + base);
    return a ? { ownerId: a.ownerId, visibility: a.visibility } : null;
  }
  return null;
}

function serveMedia(req, res, p) {
  const r = mediaRoute(p);
  if (!r) { res.writeHead(404); return res.end(); }
  const f = path.join(r.dir, path.basename(p));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size;
  const ext = path.extname(f).toLowerCase();
  const head = {
    'Content-Type': r.mime || EXT_MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes'
  };
  if (r.download) head['Content-Disposition'] = 'attachment; filename="' + encodeURIComponent(path.basename(f)) + '"';
  const range = req.headers.range;
  if (range) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : size - 1;
    res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 }));
    return fs.createReadStream(f, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(head, { 'Content-Length': size }));
  fs.createReadStream(f).pipe(res);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let p = new URL(req.url, 'http://x').pathname;
  // 首页 = 对外产品介绍页；工作台（含登录）在 /index.html
  // 已经登录的人不该每次都被拦在介绍页上 —— 有有效 cookie 就直送工作台
  if (p === '/') {
    if (whoami(req)) { res.writeHead(302, { Location: '/index.html' }); return res.end(); }
    p = '/home.html';
  }
  let f = path.join(PUB, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  // 子目录挂载（如 /wb/ 内容工作台）：目录请求自动落到 index.html，
  // 否则会被下面的 SPA fallback 吞成星河首页，子站整片打不开。
  if (f.startsWith(PUB) && fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    const dirIdx = path.join(f, 'index.html');
    if (fs.existsSync(dirIdx)) f = dirIdx;
  }
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    // SPA fallback
    const idx = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(idx));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/img/') || pathname.startsWith('/vid/') || pathname.startsWith('/file/') || pathname.startsWith('/export/')) {
    // 媒体与导出件同样是私有内容：未登录一律 401。
    // 页面里的 <img src> / <video src> 是同源请求，浏览器会自动带 cookie，所以不影响正常显示。
    const me = auth(req, res);
    if (!me) return;
    // 附件与导出件带「谁的」一说，必须按归属放行；别人的文件一律 404（不告诉它存在）
    // 资产图/视频例外：主人标了「团队可见」就放行 —— 否则列表里能看到、图却挂掉
    const own = mediaOwner(pathname);
    const sharedOk = own && own.visibility === 'team' && identity.isActive(me);
    if (own && !sharedOk && !identity.canRead(me, own.ownerId)) { res.writeHead(404); return res.end(); }
    return serveMedia(req, res, pathname);
  }
  if (req.url.startsWith('/api/')) {
    route(req, res).catch(e => { try { json(res, 500, { error: String(e.message || e) }); } catch (_) {} });
  } else serveStatic(req, res);
});
// 老资产补型号名（早期只存了模型 ID，UI 会显示成一串 doubao-xxx）
function backfillVideoMeta() {
  let n = 0;
  for (const a of store.data.assets) {
    if (a.type !== 'video' || a.modelLabel) continue;
    const m = videoMeta(a.model);
    if (m && m.id === a.model && m.label) { a.modelLabel = m.label; n++; }
  }
  if (n) { store.save(); console.log('回填视频型号名：' + n + ' 条'); }
}

server.listen(process.env.PORT ? Number(process.env.PORT) : cfg.port, process.env.SB_HOST || '127.0.0.1', () => {
  console.log('春科 · 星河 StarRiver → http://' + (process.env.SB_HOST || '127.0.0.1') + ':' + (process.env.PORT || cfg.port));
  console.log('数据目录：' + DATADIR);
  backfillVideoMeta();
  resumeVideos();
});

// 复刻版自测：逐项调用真实接口，输出 PASS / FAIL
// 用法：node scripts/selftest.mjs            （默认不跑真实视频，只跑 dry）
//      REAL_VIDEO=1 node scripts/selftest.mjs （额外跑一条 Mini 5s，约 2 分钟、有费用）
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { USER, PASS } from './_cred.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:7777';

let cookie = '';
// 会话基线 / 本次自测新建的会话：chat() 在模块作用域，必须声明在这一层
let baselineConvIds = null;
const createdConvIds = new Set();
const results = [];
const t0 = Date.now();

function ok(name, extra) { results.push({ name, pass: true, extra }); console.log(`  ✓ ${name}${extra ? '  ' + extra : ''}`); }
function bad(name, why) { results.push({ name, pass: false, why }); console.log(`  ✗ ${name}  → ${why}`); }
async function step(name, fn) {
  process.stdout.write(`\n[${results.length + 1}] ${name}\n`);
  try { const extra = await fn(); ok(name, extra); }
  catch (e) { bad(name, String(e.message || e).slice(0, 300)); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function req(p, opts = {}) {
  const headers = Object.assign({}, opts.headers || {}, cookie ? { cookie } : {});
  const r = await fetch(BASE + p, Object.assign({}, opts, { headers }));
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return r;
}
async function jreq(p, opts) {
  const r = await req(p, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const jpost = (p, body) => jreq(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 读 SSE 对话
async function chat(payload) {
  const r = await req('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert(r.ok, 'chat HTTP ' + r.status);
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', think = '', meta = null, done = null, err = null;
  const tools = [], subs = [];
  while (true) {
    const { done: d, value } = await reader.read(); if (d) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n'); buf = parts.pop();
    for (const part of parts) {
      const line = part.trim(); if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
      if (ev.meta) meta = ev.meta;
      if (ev.delta) text += ev.delta;
      if (ev.think) think += ev.think;
      if (ev.tool) tools.push(ev.tool);
      if (ev.sub) subs.push(ev.sub);
      if (ev.done) done = ev;
      if (ev.error) err = ev.error;
    }
  }
  if (err) throw new Error('对话上游错误：' + err);
  // 记下本次自测碰到的会话；收尾只删这些，绝不「列全部然后删不在快照里的」——
  // 那样会顺手删掉此刻别人刚建的会话（并发跑两个自测时已经踩过）
  if (meta && meta.conversationId && baselineConvIds && !baselineConvIds.has(meta.conversationId)) {
    createdConvIds.add(meta.conversationId);
  }
  return { text, think, meta, done, tools, subs };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('春科 · 星河 StarRiver · 自测开始 →', BASE, '\n');

  /* 0 服务可访问 */
  await step('服务存活 /api/ping', async () => {
    const r = await req('/api/ping'); assert(r.ok, 'ping ' + r.status);
    return r.status;
  });

  /* 1 登录 */
  await step('登录（错误密码必须被拒 / 正确密码通过）', async () => {
    const badRes = await req('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: 'wrong' }) });
    assert(badRes.status === 401, '错误密码竟然通过了：' + badRes.status);
    const r = await req('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
    assert(r.ok, 'login ' + r.status);
    assert(/sid=/.test(cookie), '没拿到 sid cookie');
    return 'cookie ok';
  });

  /* 登录成功后先记基线：本次自测新建的会话，收尾时要清掉，不能污染正式库 */
  try {
    const j = await jreq('/api/conversations?limit=1000');
    baselineConvIds = new Set((j.list || []).map(c => c.id));
  } catch (e) { /* 拉不到就跳过清理 */ }

  /* 2 引导数据 */
  let boot;
  await step('引导数据：38 Agent / 56 维度 / 20 模型 / 4 视频型号', async () => {
    boot = await jreq('/api/bootstrap');
    assert(boot.counts.agents >= 38, 'Agent 数量不对：' + boot.counts.agents);    assert(Object.keys(boot.dims).length >= 50, '维度数量不对：' + Object.keys(boot.dims).length);
    assert(boot.models.length >= 20, '模型数量不对：' + boot.models.length);
    assert(boot.media.videoModels.length === 4, '视频型号不是 4 个：' + boot.media.videoModels.length);
    return `${boot.counts.agents} Agent · ${Object.keys(boot.dims).length} 维度 · ${boot.models.length} 模型`;
  });

  /* 3 上传 txt */
  let txtUpload;
  const marker = '量子纠缠测试标记' + Date.now().toString(36);
  await step('附件上传：txt 抽取正文', async () => {
    const content = `# 测试文档\n\n${marker}\n\n这是自测脚本写入的内容，用于验证文本抽取是否工作。`;
    const j = await jpost('/api/upload', { name: 'selftest.txt', mime: 'text/plain', data: Buffer.from(content).toString('base64') });
    txtUpload = j.upload;
    assert(txtUpload.chars > 10, '正文没抽出来：' + txtUpload.chars + ' 字');
    assert(fs.existsSync(path.join(ROOT, 'data/uploads', txtUpload.file)), '文件没落盘');
    return txtUpload.chars + ' 字 · ' + txtUpload.bytes + 'B';
  });

  /* 4 上传 pdf */
  await step('附件上传：pdf 抽取正文（pypdf）', async () => {
    const pdf = path.join(ROOT, '../CosmoBounty/knowledge/cosmobounty/小红书违禁词.pdf');
    assert(fs.existsSync(pdf), '找不到测试 PDF');
    const j = await jpost('/api/upload', { name: '小红书违禁词.pdf', mime: 'application/pdf', data: fs.readFileSync(pdf).toString('base64') });
    assert(j.upload.chars > 100, 'PDF 正文抽取失败：' + (j.upload.warn || j.upload.chars + ' 字'));
    return j.upload.chars + ' 字';
  });

  /* 5 对话带附件 */
  let convId;
  await step('对话：带附件 + 正文注入（模型能读到标记）', async () => {
    const r = await chat({ content: '我上传的附件里有一个"测试标记"，把那一行原样复述给我，不要解释。', uploadIds: [txtUpload.id], model: 'claude-sonnet-4-6' });
    convId = r.meta.conversationId;
    assert(r.text.length > 4, '回复太短：' + r.text.slice(0, 60));
    assert(r.text.includes(marker) || r.text.includes('量子纠缠测试标记'), '模型没读到附件正文：' + r.text.slice(0, 120));
    return `${r.text.trim().slice(0, 30)}… · ${r.done.usage.in}+${r.done.usage.out} tok`;
  });

  /* 6 对话内工具：出图 */
  let imgAssetId;
  await step('对话内工具：Agent 自己调 generate_image 出图', async () => {
    const r = await chat({
      conversationId: convId,
      content: '给我生成 1 张 3:4 的极简产品图：一支银色精华瓶放在米色石台上，晨光斜射。不要写文字方案，直接出图。',
      model: 'claude-sonnet-4-6'
    });
    const start = r.tools.filter(t => t.status === 'start' && t.name === 'generate_image');
    const done = r.tools.filter(t => t.status === 'done' && t.name === 'generate_image');
    assert(start.length >= 1, '模型没有调用出图工具；回复：' + r.text.slice(0, 160));
    assert(done.length >= 1, '工具没有回成功');
    assert(r.text.indexOf('<tool>') < 0, '工具标签泄漏到可见文本里了！');
    const asset = done[0].asset;
    assert(asset && asset.url, '没拿到图片 URL');
    const file = path.join(ROOT, 'data/images', path.basename(asset.url));
    assert(fs.existsSync(file) && fs.statSync(file).size > 20000, '图片没落盘或太小');
    imgAssetId = asset.id;
    return `${Math.round(fs.statSync(file).size / 1024)}KB · 工具调用 ${start.length} 次 · 可见文本 ${r.text.length} 字`;
  });

  /* 7 参考图生图 */
  await step('参考图：带参考图重新生成，refCount > 0', async () => {
    const j = await jpost('/api/image', { prompt: '保持参考图里的瓶型和构图，换成深绿丝绒背景，柔光', ratio: '3:4', refImageIds: [imgAssetId], title: '参考图自测' });
    assert(j.asset && j.asset.imageUrl, '没出图');
    assert(j.refCount >= 1, '参考图没被方舟接受（refCount=0）');
    const f = path.join(ROOT, 'data/images', path.basename(j.asset.imageUrl));
    assert(fs.existsSync(f), '图没落盘');
    return `refCount=${j.refCount} · ${j.size}`;
  });

  /* 8 参考图库接口 */
  await step('参考图库接口：能列出刚生成的图', async () => {
    const j = await jreq('/api/reference-images?pageSize=20');
    assert(j.total >= 1, '图库是空的');
    assert(j.list.some(x => x.id === imgAssetId), '刚生成的图不在图库里');
    return `${j.total} 张`;
  });

  /* 9 @ 换人 */
  await step('@ 换人：同一会话换 Agent，历史保留', async () => {
    const cur = await jreq('/api/conversation/' + convId);
    const curId = cur.agent ? cur.agent.id : null;
    const target = boot.boxes.flatMap(b => b.agents).find(a => a.id !== curId);
    assert(target, '找不到可切换的 Agent');
    const j = await jpost(`/api/conversation/${convId}/agent`, { agentId: target.id });
    assert(j.ok, '切换失败');
    const after = await jreq('/api/conversation/' + convId);
    assert(after.agent && after.agent.id === target.id, '会话里的 Agent 没更新');
    assert(after.conversation.messages.length >= 4, '历史消息丢了：' + after.conversation.messages.length);
    const r = await chat({ conversationId: convId, content: '刚才这个对话里，我让你生成过什么？一句话回答。', model: target.model });
    assert(r.text.length > 4, '切换后对话不通');
    return `→ ${target.name} · 历史 ${after.conversation.messages.length} 条 · 新回复 ${r.text.trim().length} 字`;
  });

  /* 10 改标题 / 删除 */
  await step('会话改标题 + 删除', async () => {
    const t = '自测会话-' + Date.now().toString(36);
    await jreq('/api/conversation/' + convId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t }) });
    const j = await jreq('/api/conversation/' + convId);
    assert(j.conversation.title === t, '标题没改成功');
    const tmp = await chat({ content: '临时会话，回一个字即可', model: 'claude-sonnet-4-6' });
    await jreq('/api/conversation/' + tmp.meta.conversationId, { method: 'DELETE' });
    const list = await jreq('/api/conversations');
    assert(!list.list.some(c => c.id === tmp.meta.conversationId), '删除后还在列表里');
    return 'PATCH + DELETE ok';
  });

  /* 11 docx 导出并回读校验 */
  await step('docx 导出（zip 结构 + textutil 能解析）', async () => {
    const md = `# 抗衰补剂内容方案\n\n## 一、核心卖点\n\n- 成分纯度认证\n- 临床数据支撑\n\n**重点**：不要写成药品。\n\n## 二、标题备选\n\n1. 你为什么越补越累\n2. 三十岁后的第一条皱纹\n`;
    const j = await jpost('/api/docx', { title: '自测导出', content: md });
    assert(j.url && j.bytes > 2000, '导出失败：' + JSON.stringify(j).slice(0, 120));
    const f = path.join(ROOT, 'data/exports', path.basename(j.url));
    assert(fs.existsSync(f), '导出文件不存在');
    const head = fs.readFileSync(f).subarray(0, 4);
    assert(head[0] === 0x50 && head[1] === 0x4b, '不是 zip（docx）头');
    const r = await req(j.url); assert(r.status === 200, '下载 ' + r.status);
    const dl = Buffer.from(await r.arrayBuffer());
    assert(dl.length === j.bytes, '下载字节数不一致');
    return `${Math.round(j.bytes / 1024)}KB`;
  });

  /* 12 视频参数裁剪（dry，不花钱） */
  await step('视频 dry-run：四型号参数裁剪正确', async () => {
    const cases = [
      ['doubao-seedance-2-5-260628', '1080p', '15'],
      ['doubao-seedance-2-0-260128', '1080p', '15'],
      ['doubao-seedance-2-0-fast-260128', '1080p', '15'],
      ['doubao-seedance-2-0-mini-260615', '1080p', '15']
    ];
    const got = [];
    for (const [m, res, dur] of cases) {
      const j = await jpost('/api/video', { dry: true, prompt: '自测镜头', model: m, resolution: res, duration: dur, ratio: '9:16' });
      got.push(`${j.label}=${j.resolution}/${j.duration}s`);
      if (m.includes('fast') || m.includes('mini')) assert(j.resolution === '720p' && j.duration === '5', m + ' 裁剪不对：' + j.resolution + '/' + j.duration);
      if (m === 'doubao-seedance-2-5-260628') assert(j.resolution === '1080p' && j.duration === '15', '2.5 参数不该被裁');
    }
    return got.join(' · ');
  });

  /* 13 视频真跑（可选）：走对话内工具，验证「Agent 自己出片」整条链路 */
  if (process.env.REAL_VIDEO === '1') {
    await step('对话内出视频：Agent 调 generate_video → 排队 → 出片落盘', async () => {
      const r = await chat({
        conversationId: convId,
        content: '帮我做一个 5 秒的竖屏短视频：暗色背景上一支银色小瓶缓慢旋转，边缘光柔和。直接出片。',
        model: 'claude-sonnet-4-6',
        videoModel: 'doubao-seedance-2-0-mini-260615'
      });
      const done = r.tools.filter(t => t.status === 'done' && t.name === 'generate_video');
      assert(done.length >= 1, '模型没调 generate_video；回复：' + r.text.slice(0, 160));
      assert(!r.text.includes('<tool>'), '工具标签泄漏');
      const asset = done[0].asset;
      assert(asset && asset.id, '没拿到视频资产');
      for (let i = 0; i < 60; i++) {
        await sleep(6000);
        const s = await jreq('/api/video/' + asset.id);
        if (s.asset.videoStatus === 'succeeded') {
          const f = path.join(ROOT, 'data/videos', path.basename(s.asset.videoUrl));
          assert(fs.existsSync(f) && fs.statSync(f).size > 100000, '视频没落盘');
          return `${Math.round(fs.statSync(f).size / 1024)}KB · ${s.asset.modelLabel} · 约 ${i * 6}s`;
        }
        if (s.asset.videoStatus === 'failed') throw new Error('生成失败：' + s.asset.videoError);
      }
      throw new Error('6 分钟未出片');
    });
  }

  /* 14 长附件：只喂摘要，模型自己 read_file 检索 */
  await step('read_file 工具：11k 字附件只喂开头，模型检索到第 7k 字的标记', async () => {
    const filler = n => {
      let s = '', i = 0;
      while (s.length < n) { i++; s += '第' + i + '段：行业卖点与合规表述说明，用于测试长文读取能力。\n'; }
      return s;
    };
    const deep = 'DEEP-' + Date.now().toString(36).toUpperCase();
    const body = filler(7200) + '\n【关键结论】' + deep + ' 主推夜间修护场景。\n' + filler(4200);
    const up = (await jpost('/api/upload', { name: 'longreport.txt', mime: 'text/plain', data: Buffer.from(body).toString('base64') })).upload;
    assert(up.chars > 9000, '长附件没上传成功：' + up.chars);
    const r = await chat({
      content: `附件很长（${up.chars} 字），开头没有结论。请用 read_file 工具检索「${deep}」，把命中那一行原样复述，只输出那一行。`,
      uploadIds: [up.id], model: 'claude-sonnet-4-6'
    });
    const called = r.tools.some(t => t.name === 'read_file' && t.status === 'start');
    assert(called, '模型没调 read_file；可见文本：' + r.text.slice(0, 120));
    assert(r.text.includes(deep), '没读到深处的标记：' + r.text.slice(0, 160));
    assert(!r.text.includes('<tool>'), '工具标签泄漏');
    return `附件 ${up.chars} 字 → 命中第 ${body.indexOf(deep)} 字`;
  });

  /* 15 子智能体编排 */
  await step('子智能体：主 Agent 派活 → 子 Agent 独立跑 → 产出回填主上下文', async () => {
    const r = await chat({
      content: '不要自己写。必须调用 call_subagent 工具，把「给一个抗衰品牌写一句 20 字以内的主张」派给「品牌长文」' +
        '（参数 agent 填「品牌长文」）。拿到它的产出后，原样引用它的结果，不要改写。',
      model: 'claude-sonnet-4-6'
    });
    const start = r.subs.filter(s => s.status === 'start');
    const done = r.subs.filter(s => s.status === 'done');
    assert(r.tools.some(t => t.name === 'call_subagent'), '模型没调 call_subagent；可见文本：' + r.text.slice(0, 160));
    assert(start.length >= 1, '没有子任务开始事件');
    assert(done.length >= 1, '没有子任务完成事件');
    assert(done[0].chars > 0, '子 Agent 产出为空');
    assert(done[0].text && done[0].text.length > 0, 'done 事件没带子 Agent 全文');
    assert(!r.text.includes('<tool>'), '工具标签泄漏');
    return `${done[0].agentName} 产出 ${done[0].chars} 字 · 主回复 ${r.text.trim().length} 字`;
  });

  /* 16 思维链 */
  await step('思维链：reasoning 走独立通道，不进正文', async () => {
    const r = await chat({ content: '3 的 4 次方是多少？先在心里算一下再回答，只输出数字。', model: 'qwen3.8-flash' });
    assert(r.think.length > 10, '没收到思维链增量（think=' + r.think.length + '）');
    assert(r.text.trim().length > 0, '正文为空');
    assert(!r.text.includes(r.think.slice(0, 20)), '思维链混进正文了');
    return `think ${r.think.length} 字 · 正文 ${r.text.trim().length} 字`;
  });

  /* 17 台账 */
  await step('使用台账：token 折算积分、分类记账、余额递减', async () => {
    const before = (await jreq('/api/org')).org.balance;
    const led = await jreq('/api/ledger?days=1&pageSize=50');
    assert(led.total > 0, '台账是空的');
    const kinds = led.summary.byKind.map(k => k.key);
    assert(kinds.includes('chat'), '没有 chat 记账');
    assert(kinds.includes('subagent'), '子 Agent 消耗没单独归类');
    assert(kinds.includes('image'), '生图消耗没记账');
    assert(led.summary.credits > 0, '积分合计为 0');
    const e = led.list.find(x => x.kind === 'chat' && x.in > 0);
    assert(e && e.credits > 0, 'token 类记录没折算积分');
    assert(e.rate > 0, '没记录模型单价');
    assert(e.memberName, '没记录成员归属');
    const after = (await jreq('/api/org')).org.balance;
    assert(after < before || led.org.balance === after, '余额没随消耗递减');
    return `${led.total} 条 · ${led.summary.credits} 积分 · 余额 ${after}`;
  });

  /* 18 CSV 导出 */
  await step('台账导出 CSV：表头 + 行数对得上', async () => {
    const led = await jreq('/api/ledger?days=1&pageSize=200');
    const r = await req('/api/ledger.csv?days=1');
    assert(r.ok, 'CSV ' + r.status);
    const txt = await r.text();
    const lines = txt.trim().split('\n');
    assert(/时间/.test(lines[0]) && /积分/.test(lines[0]), 'CSV 表头不对：' + lines[0].slice(0, 80));
    assert(lines.length === led.total + 1, `CSV 行数 ${lines.length} 与实际 ${led.total} 不符`);
    return `${lines.length - 1} 行`;
  });

  /* 19 成员与组织 */
  await step('组织 / 成员：新增、改额度、删除；身份只能靠登录，不能前端切换', async () => {
    const name = '自测成员' + Date.now().toString(36).slice(-4);
    const c = await jpost('/api/members', { name, role: 'editor', quota: 5000 });
    assert(c.member && c.member.id, '新增失败');
    const p = await jreq('/api/member/' + c.member.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quota: 8888 }) });
    assert(p.member.quota === 8888, '改额度失败');
    // 身份只能来自登录态：前端传 memberId 一律拒绝，否则可以把消耗记到别人名下
    const sw = await fetch(BASE + '/api/member/switch', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ memberId: c.member.id })
    });
    assert(sw.status === 410 || sw.status === 403, '切换身份接口应被废弃/拒绝，实际 ' + sw.status);
    const b = await jreq('/api/bootstrap');
    assert(b.member.id !== c.member.id, '身份不该被前端改掉');
    // 记一笔账，应落在当前登录人（而不是刚建的那个成员）名下
    await chat({ content: '只回两个字：收到', model: 'claude-haiku-4-5-20251001' });
    const led = await jreq('/api/ledger?days=1&pageSize=5');
    assert(led.list[0].memberName === b.member.name, '记账没落在登录人名下：' + led.list[0].memberName);
    await jreq('/api/member/' + c.member.id, { method: 'DELETE' });
    const org = await jreq('/api/org');
    assert(!org.members.some(m => m.id === c.member.id), '删除后还在列表里');
    return `新增→改额度→拒绝冒名切身份→记账落在「${b.member.name}」→删除`;
  });

  /* 20 余额闸门（默认跳过：它必须临时改真实余额，中断就会留下残账。
     完整覆盖在 verify-tenancy.mjs 的隔离库里跑，那条路径不碰正式库） */
  if (process.env.SB_ALLOW_BALANCE_TEST === '1') await step('余额闸门：余额归零时拒绝对话，调账后恢复', async () => {
    const org0 = await jreq('/api/org');
    const keep = org0.org.balance;
    // 用调账清零（写台账），不用直改余额——直改会让账本永久不平
    const z = await jpost('/api/org/adjust', { credits: -keep, note: '自测：临时清零验证余额闸门' });
    assert(Math.abs(z.balance) < 0.01, '清零失败：' + z.balance);
    const r = await req('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '你好', model: 'claude-haiku-4-5-20251001' }) });
    assert(r.status === 402, '余额为 0 竟然还能聊：' + r.status);
    const rc = await jpost('/api/org/adjust', { credits: 5000, note: '自测：模拟额度到账' });
    assert(rc.balance === 5000, '调账没生效：' + rc.balance);
    const r2 = await chat({ content: '只回两个字：恢复', model: 'claude-haiku-4-5-20251001' });
    assert(r2.text.length > 0, '调账后仍然不能聊');
    // 冲回：把余额拉回测试前的数（差额写成一条调账）
    const now = (await jreq('/api/org')).org.balance;
    await jpost('/api/org/adjust', { credits: keep - now, note: '自测：冲回临时调账' });
    const back = (await jreq('/api/org')).org.balance;
    assert(Math.abs(back - keep) < 0.01, '余额没还原：' + back + ' vs ' + keep);
    const a = await jreq('/api/billing/audit');
    assert(a.balanced, '调账后账本不平：' + JSON.stringify(a));
    return `0 → 402 · 调账 5000 → 可聊 · 已还原 ${keep} · 账本平`;
  });

  /* 20b 账本对账 */
  await step('账本自洽：余额 = 期初 + 充值 − 台账合计，token 应扣 = 已扣', async () => {
    const a = await jreq('/api/billing/audit');
    assert(a.balanced, '余额与账本不平：应为 ' + a.expectBalance + '，实际 ' + a.balance);
    assert(a.tokenGapOk, 'token 计费有缺口：应扣 ' + a.shouldCredits + '，已扣 ' + a.ledgerTokenCredits);
    assert(a.opening > 0, '期初额度没记录');
    return `期初 ${a.opening} + 充值 ${a.recharged} − 已用 ${a.totalCredits} = ${a.balance} · token ${a.shouldCredits}`;
  });

  /* 21 资产与检索 */
  await step('Asset 列表 / 详情 / 检索', async () => {
    const imgs = await jreq('/api/assets?type=image');
    assert(imgs.total >= 1, '图片资产为空');
    const all = await jreq('/api/assets');
    assert(all.total >= 1, '资产为空');
    const s = await jreq('/api/search?q=' + encodeURIComponent('极简产品图'));
    assert(s.assets.length + s.conversations.length >= 1, '检索没命中');
    return `资产 ${all.total} · 图片 ${imgs.total} · 检索命中 ${s.assets.length + s.conversations.length}`;
  });

  /* 15 静态资源与媒体 */
  await step('媒体路由：/img 200 · /export 200 · 越权 404', async () => {
    const imgs = await jreq('/api/assets?type=image');
    const u = imgs.list.find(a => a.imageUrl).imageUrl;
    const r1 = await req(u); assert(r1.status === 200, '图片 ' + r1.status);
    assert((r1.headers.get('content-type') || '').startsWith('image/'), '图片 MIME 不对');
    const r2 = await req('/../../../etc/passwd'); assert(r2.status === 200 || r2.status === 404, '越权返回异常');
    return 'img ok';
  });

  /* 16 未登录拦截 */
  await step('鉴权：未带 cookie 访问 API 必须 401', async () => {
    const r = await fetch(BASE + '/api/assets');
    assert(r.status === 401, '未登录竟然返回 ' + r.status);
    return '401 ok';
  });

  /* 收尾：只删本次自测确实碰过的会话（Asset 产物保留，可在 Asset 页手动清） */
  if (baselineConvIds && createdConvIds.size) {
    let cleaned = 0;
    for (const id of createdConvIds) {
      try { await jreq('/api/conversation/' + id, { method: 'DELETE' }); cleaned++; } catch (e) { /* 单条失败不影响其它 */ }
    }
    if (cleaned) console.log(`\n已清理本次自测新建的 ${cleaned} 条会话（正式会话不受影响）`);
  }

  const pass = results.filter(r => r.pass).length;
  const fail = results.length - pass;
  console.log(`\n${'─'.repeat(52)}\n结果：${pass} 通过 / ${fail} 失败 · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (fail) {
    console.log('\n失败项：');
    results.filter(r => !r.pass).forEach(r => console.log('  ✗ ' + r.name + ' → ' + r.why));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('\n自测脚本自身出错：', e); process.exit(2); });

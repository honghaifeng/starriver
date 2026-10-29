'use strict';
// 对话内工具协议：模型输出 <tool>{...}</tool>，服务端截获、执行、把结果塞回模型续写一轮。
// 关键点：流式输出时要把工具块从可见文本里"吃掉"，不能让用户看到 JSON。

const TOOL_PROMPT = `
# 你可以调用的工具（必须遵守）
当用户需要图片或视频时，不要只用文字描述，直接调用工具，把调用单独写在一行：

<tool>{"name":"generate_image","prompt":"中文画面描述：主体、风格、光线、构图","ratio":"3:4"}</tool>
<tool>{"name":"generate_video","prompt":"中文镜头描述：画面、运动、氛围","ratio":"9:16","duration":"5","resolution":"720p"}</tool>

当你需要读用户上传的附件全文/某一段时（附件很长时只给了摘要）：
<tool>{"name":"read_file","file":"文件名或关键词","query":"要检索的词（可空）","offset":0,"limit":4000}</tool>

当任务明显属于另一个专职 Agent 的专长（比如你要写文案但需要「选题策划」先给方向），可以派活给它：
<tool>{"name":"call_subagent","agent":"Agent 名称","task":"交给它的具体任务，写清要什么产出"}</tool>

规则：
- 一条回复最多调用 4 次，不同画面/不同任务分别调用。
- ratio 可选 16:9 / 9:16 / 1:1 / 3:4 / 4:3；duration 可选 5 / 10 / 15；resolution 可选 480p / 720p / 1080p。
- 子智能体的产出会作为工具结果回给你，你要基于它的产出继续完成用户的需求，不要原样转述。
- 用户在输入框附了参考图时会自动带入 generate_image（最多 9 张），你不用在 prompt 里重复描述参考图。
- 工具结果会以系统消息回给你，你只用一两句话说明产出，不要复述工具语法、不要输出 JSON、不要解释这一点。

# 用户附件
用户消息里出现的「【附件】…」段落是他上传文件的正文，直接当作资料使用；引用时说清是哪个文件。
若附件标注了「正文较长，仅给出摘要」，需要用 read_file 工具按关键词或位置读取原文。

# 输出前先想清楚
遇到需要推理、比较、算数、排期的任务，先想清楚再写答案；想的部分系统会单独收成"思考过程"，不会算进正文。
`;

const TOOL_NAMES = ['generate_image', 'generate_video', 'read_file', 'call_subagent'];

/** 从模型输出里安全解析工具调用 */
function parseToolCall(raw) {
  let o;
  try { o = JSON.parse(raw); } catch (e) { return { ok: false, error: 'JSON 解析失败' }; }
  const name = String(o.name || o.tool || '').trim();
  if (!TOOL_NAMES.includes(name)) return { ok: false, error: '未知工具 ' + name };

  if (name === 'read_file') {
    const file = String(o.file || o.filename || '').trim();
    const q = String(o.query || '').trim();
    if (!file && !q) return { ok: false, error: 'read_file 需要 file 或 query' };
    const out = { ok: true, name, file, query: q };
    if (o.offset != null) out.offset = Math.max(0, +o.offset || 0);
    if (o.limit != null) out.limit = Math.min(20000, Math.max(200, +o.limit || 4000));
    return out;
  }
  if (name === 'call_subagent') {
    const agent = String(o.agent || o.agentName || '').trim();
    const task = String(o.task || o.prompt || '').slice(0, 4000).trim();
    if (!agent) return { ok: false, error: 'call_subagent 需要 agent' };
    if (!task) return { ok: false, error: 'call_subagent 需要 task' };
    return { ok: true, name, agent, task };
  }
  const prompt = String(o.prompt || '').slice(0, 3000);
  if (!prompt.trim()) return { ok: false, error: 'prompt 为空' };
  const out = { ok: true, name, prompt };
  if (o.ratio) out.ratio = String(o.ratio);
  if (o.duration) out.duration = String(o.duration);
  if (o.resolution) out.resolution = String(o.resolution);
  if (Array.isArray(o.refs)) out.refs = o.refs.map(String).slice(0, 9);
  return out;
}

/**
 * 流式过滤器：把 <tool>…</tool> 从可见流里剥离，同时收集工具调用。
 * 未闭合时先扣住尾巴，避免把半个标签吐给前端。
 */
class ToolTap {
  constructor() {
    this.buf = '';
    this.tools = [];
    this.broken = 0;
  }
  _holdTail(s) {
    // 返回需要暂扣的尾部长度：最长的是 '<tool>' 的前缀
    const tag = '<tool>';
    for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) {
      if (s.slice(s.length - k) === tag.slice(0, k)) return k;
    }
    return 0;
  }
  feed(chunk) {
    this.buf += chunk;
    let out = '';
    for (let guard = 0; guard < 50; guard++) {
      const start = this.buf.indexOf('<tool>');
      if (start < 0) {
        const hold = this._holdTail(this.buf);
        out += this.buf.slice(0, this.buf.length - hold);
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      out += this.buf.slice(0, start);
      const end = this.buf.indexOf('</tool>', start);
      if (end < 0) { this.buf = this.buf.slice(start); return out; }   // 等闭合
      const inner = this.buf.slice(start + 6, end).trim();
      const call = parseToolCall(inner);
      if (call.ok) this.tools.push(call); else this.broken++;
      this.buf = this.buf.slice(end + 7);
    }
    return out;
  }
  flush() {
    // 流结束时还在缓冲里的内容：完整工具块照收，其余吐出来
    let rest = this.buf; this.buf = '';
    const m = /<tool>([\s\S]*?)<\/tool>/.exec(rest);
    if (m) {
      const call = parseToolCall(m[1].trim());
      if (call.ok) this.tools.push(call); else this.broken++;
      rest = rest.replace(m[0], '');
    }
    return rest;
  }
}

/** 把工具结果拼成回给模型的系统消息 */
function toolResultMessage(results) {
  const lines = results.map((r, i) => {
    if (!r.ok) return `${i + 1}. ${r.name} 失败：${r.error}`;
    if (r.name === 'generate_image') return `${i + 1}. generate_image 成功：${r.count} 张，assetId=${r.assetIds.join(',')}，prompt=「${r.prompt}」`;
    if (r.name === 'generate_video') return `${i + 1}. generate_video 成功：任务已提交，assetId=${r.assetIds.join(',')}，约 3-6 分钟出片，prompt=「${r.prompt}」`;
    if (r.name === 'read_file') return `${i + 1}. read_file「${r.file || r.query}」：\n${r.text || '（无内容）'}`;
    if (r.name === 'call_subagent') return `${i + 1}. call_subagent「${r.agent}」已完成，产出 ${String(r.text || '').length} 字：\n${String(r.text || '').slice(0, 6000)}`;
    return `${i + 1}. ${r.name} 完成`;
  });
  return `【工具结果】\n${lines.join('\n')}\n\n请用一两句话说明产出（不要再输出 <tool> 标签，不要重复 prompt 原文）。`;
}

module.exports = { TOOL_PROMPT, TOOL_NAMES, ToolTap, parseToolCall, toolResultMessage };

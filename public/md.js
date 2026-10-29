/* 轻量 markdown 渲染器 · 零依赖 · 先转义再解析，杜绝 HTML 注入
 * 支持：标题 / 加粗 / 斜体 / 行内代码 / 代码块 / 列表 / 引用 / 表格 / 链接 / 分隔线 / 自动换行
 * 流式友好：未闭合的 ``` 会自动补尾，避免半截内容把整段吞成纯文本
 */
(function () {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 行内样式：先占位行内代码，避免其中的 * _ 被误处理 */
  function inline(s) {
    const codes = [];
    let out = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });
    out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\u0000C(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
    return out;
  }

  /* 表格：识别 | a | b | + |---|---| */
  function isTableRow(l) { return /^\s*\|.*\|\s*$/.test(l); }
  function isTableSep(l) { return /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes('-'); }

  function splitRow(l) {
    return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
  }

  function md(src) {
    if (src == null) return '';
    let text = String(src).replace(/\r\n?/g, '\n');

    /* 0. 抽出代码块之前，先处理两类「原始 HTML 指令块」：
       - <details>…</details>：归档消息里的折叠块（多为思考过程），转成真正可折叠的 UI，不再裸显标签
       - <image_instruction>…</image_instruction>：生图指令，折叠成「图片生成指令」备查块，不干扰正文阅读 */
    const details = [];
    const stripTags = s => s.replace(/<[^>]+>/g, '');
    text = text.replace(/<details[^>]*>([\s\S]*?)(?:<\/details>|$)/gi, (_, inner) => {
      // 流式中途：<summary> 可能还没闭合，先补尾再解析，避免裸标签漏进正文
      if (/<summary[^>]*>/i.test(inner) && !/<\/summary>/i.test(inner)) inner += '</summary>';
      const sm = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      const summary = sm ? stripTags(sm[1]).trim() : '展开';
      const body = inner.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, '').trim();
      details.push({ summary, body });
      return '\u0000D' + (details.length - 1) + '\u0000';
    });
    text = text.replace(/<image_instruction[^>]*>([\s\S]*?)(?:<\/image_instruction>|$)/gi, (_, inner) => {
      details.push({ summary: '图片生成指令', body: stripTags(inner).trim() });
      return '\u0000D' + (details.length - 1) + '\u0000';
    });

    const renderDetails = d =>
      '<details class="md-details"><summary>' + inline(esc(d.summary)) + '</summary>' +
      '<div class="md-details-body">' + (d.body ? md(d.body) : '<p class="md-details-empty">（空）</p>') + '</div></details>';

    /* 1. 抽出代码块（未闭合也吃进去，流式时补尾） */
    const blocks = [];
    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (_, lang, code) => {
      blocks.push({ lang: String(lang || '').trim(), code });
      return '\u0000B' + (blocks.length - 1) + '\u0000';
    });

    /* 2. 转义剩下的正文（代码块已抽走，不会被二次转义） */
    text = esc(text);

    const lines = text.split('\n');
    const out = [];
    let i = 0;

    const flushList = (tag, items) => {
      out.push('<' + tag + '>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</' + tag + '>');
    };

    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trimEnd();

      /* 代码块占位 */
      const bm = line.match(/^\u0000B(\d+)\u0000$/);
      if (bm) {
        const b = blocks[+bm[1]];
        out.push('<pre class="md-pre"' + (b.lang ? ' data-lang="' + esc(b.lang) + '"' : '') +
          '><code>' + esc(b.code.replace(/\n$/, '')) + '</code></pre>');
        i++; continue;
      }

      /* 折叠块占位（details / 图片指令） */
      const dm = line.trim().match(/^\u0000D(\d+)\u0000$/);
      if (dm) { out.push(renderDetails(details[+dm[1]])); i++; continue; }

      /* 空行 */
      if (!line.trim()) { i++; continue; }

      /* 分隔线 */
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push('<hr>'); i++; continue; }

      /* 标题 */
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = Math.min(h[1].length, 6);
        out.push('<h' + lv + '>' + inline(h[2].trim()) + '</h' + lv + '>');
        i++; continue;
      }

      /* 表格 */
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && isTableRow(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        out.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
          head.map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }

      /* 引用（连续） */
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + buf.map(x => inline(x)).join('<br>') + '</blockquote>');
        continue;
      }

      /* 无序列表 */
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        flushList('ul', items); continue;
      }

      /* 有序列表 */
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
          i++;
        }
        flushList('ol', items); continue;
      }

      /* 普通段落：连续行合并，单行内换行保留 */
      const buf = [];
      while (i < lines.length) {
        const l2 = lines[i];
        if (!l2.trim()) break;
        if (/^\u0000B\d+\u0000$/.test(l2.trim())) break;
        if (/^\u0000D\d+\u0000$/.test(l2.trim())) break;
        if (/^\s{0,3}#{1,6}\s/.test(l2)) break;
        if (/^\s*>\s?/.test(l2)) break;
        if (/^\s*[-*+]\s+/.test(l2)) break;
        if (/^\s*\d+[.)]\s+/.test(l2)) break;
        if (isTableRow(l2) && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
        buf.push(l2);
        i++;
      }
      if (buf.length) out.push('<p>' + buf.map(x => inline(x)).join('<br>') + '</p>');
      else i++;
    }
    return out.join('\n')
      .replace(/\u0000D(\d+)\u0000/g, (_, n) => renderDetails(details[+n])); /* 兜底：夹在段落里的折叠块也不裸显占位符 */
  }

  window.md = md;
  window.mdEsc = esc;
})();

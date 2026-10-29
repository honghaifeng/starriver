// 合规体检：把客户《小红书违禁词》清单变成可以逐条核对的检查器。
//
// 为什么要有这个文件（2026-10-29）：
//   之前「避开违禁词」全靠模型自觉。指令里写了「不许出现」，
//   但模型偶尔会写「抗炎」「激素未检出」「遵医嘱」，稿子直接不能发。
//   更糟的是没人当场知道——要等客户打回来。
//   这里做的是：稿子一写完就逐词扫一遍，告诉人「第几处、什么词、建议改成什么」。
//
// 三个设计取舍：
//   1. 词表来自 PDF 脚本生成（scripts/build-compliance-dict.py），不手敲 —— 客户补词时能重跑 + diff。
//   2. 命中只做「提示」，除了真正的清单词不自动改正文 —— 自动改会把「抗炎」改成病句。
//   3. 分三级：block（清单词，会被打回）／warn（提示字兜底和广告法绝对化用语，需要人判断）／pass。

'use strict';

const DICT = require('./compliance-dict.json');

// ---------------------------------------------------------------- 归一化
// 「抗 炎」「抗\u200b炎」「抗·炎」在平台审核眼里都是同一个词，
// 但在字符串里 indexOf 查不到。所以扫描前先归一化，同时维护
// 「归一化下标 → 原文下标」的映射，保证报出来的位置能指回原文。
const SKIP_ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfeff, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e]);
const SKIP_SPACE = new Set([0x20, 0x09, 0x0a, 0x0d, 0x00a0, 0x3000, 0x1680]);
const SKIP_DOT = new Set([0x00b7, 0x2022, 0x30fb, 0x2027, 0x22c6]);

function normalize(text) {
  const s = String(text == null ? '' : text);
  const chars = [];
  const map = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (SKIP_ZERO_WIDTH.has(code) || SKIP_SPACE.has(code) || SKIP_DOT.has(code)) continue;
    let ch = s[i];
    // 全角字母数字标点 → 半角，这样「１００％」也能命中「100%」
    if (code >= 0xff01 && code <= 0xff5e) ch = String.fromCharCode(code - 0xfee0);
    chars.push(ch);
    map.push(i);
  }
  return { text: chars.join(''), map };
}

// ---------------------------------------------------------------- 逐词扫描
function findByLiteral(norm, word) {
  const w = normalize(word).text;
  if (!w) return [];
  const out = [];
  let i = norm.indexOf(w);
  while (i !== -1) {
    out.push({ i, n: w.length });
    i = norm.indexOf(w, i + w.length);
  }
  return out;
}

// 同一段文字可能被多个词命中（「妇科疾病」同时命中「妇科」和「妇科疾病」），
// 报两条会让用户以为有两处问题。按「长的优先」贪心取不重叠区间。
function pickNonOverlapping(all) {
  const sorted = all.slice().sort((a, b) => b.n - a.n || a.i - b.i);
  const taken = [];
  for (const c of sorted) {
    let clash = false;
    for (const t of taken) {
      if (c.i < t.i + t.n && t.i < c.i + c.n) { clash = true; break; }
    }
    if (!clash) taken.push(c);
  }
  return taken.sort((a, b) => a.i - b.i);
}

function coveredBy(ranges, pos) {
  for (const r of ranges) if (pos >= r.i && pos < r.i + r.n) return true;
  return false;
}

function snippetOf(raw, start, end, pad) {
  const p = pad == null ? 14 : pad;
  const a = Math.max(0, start - p);
  const b = Math.min(raw.length, end + p);
  return {
    before: (a > 0 ? '…' : '') + raw.slice(a, start),
    hit: raw.slice(start, end),
    after: raw.slice(end, b) + (b < raw.length ? '…' : '')
  };
}

const CAT_LABEL = DICT.cats || {};
const LEVEL_OF_CAT = {
  // 客户清单里的词：出现在标题/正文/口播里会被打回，一律 block
  disease: 'block', medical: 'block', drug: 'block', efficacy: 'block',
  exam: 'block', form: 'block', sexual: 'block', other: 'block',
  absolute: 'warn'
};

/**
 * 体检一份文本。
 * @param {string} text 正文
 * @param {object} [opts] { absolute:false 可关闭广告法绝对化检查, hint:false 可关闭提示字兜底, maxSamples:3 }
 * @returns {{level:string, total:number, counts:object, hits:Array, chars:number, dict:object}}
 */
function check(text, opts) {
  const o = opts || {};
  const raw = String(text == null ? '' : text);
  const { text: norm, map } = normalize(raw);

  const candidate = [];
  for (const it of DICT.words) {
    for (const c of findByLiteral(norm, it.w)) candidate.push({ i: c.i, n: c.n, word: it.w, cat: it.cat, sug: it.sug, src: it.src, kind: 'dict' });
  }
  if (o.absolute !== false) {
    for (const it of DICT.absolute || []) {
      for (const c of findByLiteral(norm, it.w)) candidate.push({ i: c.i, n: c.n, word: it.w, cat: 'absolute', sug: it.sug, src: it.src, kind: 'absolute' });
    }
  }
  const picked = pickNonOverlapping(candidate);

  // 广告法的「最」「第一」是高频正常词（最后、第一步），
  // 词表里没放裸字，这里再兜一层：命中位置落在允许短语内就忽略。
  const allowRanges = [];
  for (const a of DICT.absoluteAllow || []) for (const c of findByLiteral(norm, a)) allowRanges.push(c);
  const dictRanges = [];
  for (const it of DICT.words) for (const c of findByLiteral(norm, it.w)) dictRanges.push(c);

  // 提示字兜底：客户确认文档事项 1 说这七个字是「类别的共同特征」，
  // 不是带这个字就禁。所以只做 warn，且「科普/科学/科技」这类词明确放行。
  const hintRanges = [];
  for (const a of DICT.hintAllow || []) for (const c of findByLiteral(norm, a)) hintRanges.push(c);

  const hits = [];
  const push = (item, start, end) => {
    let h = hits.find(x => x.word === item.word && x.cat === item.cat);
    if (!h) {
      h = {
        word: item.word, cat: item.cat, catLabel: item.kind === 'hint' ? '提示字（疑似）' : (CAT_LABEL[item.cat] || item.cat),
        level: (item.kind === 'absolute' || item.kind === 'hint') ? 'warn' : (LEVEL_OF_CAT[item.cat] || 'block'),
        sug: item.sug || '', src: item.src || '', kind: item.kind,
        count: 0, samples: []
      };
      hits.push(h);
    }
    h.count++;
    if (h.samples.length < (o.maxSamples || 3)) {
      h.samples.push(Object.assign({ start, end }, snippetOf(raw, start, end)));
    }
  };

  for (const c of picked) {
    if (c.kind === 'absolute' && coveredBy(allowRanges, c.i)) continue;
    push(c, map[c.i], map[c.i + c.n - 1] + 1);
  }

  if (o.hint !== false) {
    for (const ch of DICT.hintChars || []) {
      const idxs = findByLiteral(norm, ch);
      for (const c of idxs) {
        if (coveredBy(dictRanges, c.i)) continue;      // 已经当成完整词报过了，不重复
        if (coveredBy(hintRanges, c.i)) continue;      // 科普 / 科学 / 科技 放行
        push({ word: ch, cat: 'hint', sug: '', src: '提示字', kind: 'hint' }, map[c.i], map[c.i] + 1);
      }
    }
  }

  const counts = { block: 0, warn: 0 };
  for (const h of hits) counts[h.level] = (counts[h.level] || 0) + h.count;
  const level = counts.block > 0 ? 'block' : (counts.warn > 0 ? 'warn' : 'pass');

  // 列表顺序：要改的在前，同类按出现次数多、位置靠前
  hits.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'block' ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return (a.samples[0] ? a.samples[0].start : 0) - (b.samples[0] ? b.samples[0].start : 0);
  });

  return {
    level,
    total: hits.reduce((s, h) => s + h.count, 0),
    counts,
    hits,
    chars: raw.length,
    dict: { count: DICT.meta.count, builtAt: DICT.meta.builtAt, name: DICT.meta.name }
  };
}

// 「3 处必须改，1 处建议改」—— 一句话让人知道要不要动手
function summaryLine(r) {
  if (!r || !r.total) return '未发现违禁词';
  const parts = [];
  if (r.counts.block) parts.push(r.counts.block + ' 处必须改');
  if (r.counts.warn) parts.push(r.counts.warn + ' 处建议改');
  return parts.join('，');
}

module.exports = { check, summaryLine, normalize, DICT, CAT_LABEL };

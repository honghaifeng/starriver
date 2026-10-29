// 合规体检的自测：验证「什么该报、什么不该报、报的位置准不准」。
//
// 这类检查器最大的风险不是漏报，是误报——一旦把「第一步」「科普」也标红，
// 用户就会学会无视它，那这份词表等于没做。所以一半断言是「不该报」的用例。
//
// 用法：node scripts/verify-compliance.mjs [--http http://127.0.0.1:7788]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../lib/compliance');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra == null ? '' : '→ ' + JSON.stringify(extra)); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

console.log('【合规体检 · 词表】');
{
  const d = C.DICT;
  ok('词表已生成', !!d && Array.isArray(d.words) && d.words.length > 200, d && d.words.length);
  ok('客户口径 248 已记录', d.meta && d.meta.customerClaim === 248, d.meta && d.meta.customerClaim);
  ok('绝对化用语单独存放', Array.isArray(d.absolute) && d.absolute.length >= 20, d.absolute && d.absolute.length);
  ok('七个提示字齐全', (d.hintChars || []).join('') === '科诊疗病痛毒菌', d.hintChars);
  const noCat = d.words.filter(w => !w.cat);
  eq('每条词都有分类', noCat.length, 0);
  const dup = d.words.map(w => w.w).filter((w, i, a) => a.indexOf(w) !== i);
  eq('无重复词条', dup.length, 0);
}

console.log('\n【合规体检 · 该报的必须报】');
const hitWords = (t, o) => C.check(t, o).hits.map(h => h.word);
{
  const r1 = C.check('日间瓶主打供能抗炎，这是核心卖点。');
  eq('抗炎 → block', r1.level, 'block');
  eq('抗炎 分类正确', r1.hits[0].catLabel, '功效宣称');
  ok('抗炎 带替换建议', /删去/.test(r1.hits[0].sug), r1.hits[0].sug);

  const r2 = C.check('激素、农残、重金属未检出，五项都有第三方报告。');
  ok('激素 → 命中', hitWords('激素、农残未检出').includes('激素'), hitWords('激素、农残未检出'));

  const r3 = C.check('孕期和哺乳期人群请遵医嘱。');
  ok('医嘱 → 命中（不只是「医生」）', r3.hits.some(h => h.word === '医嘱'), r3.hits.map(h => h.word));

  const r4 = C.check('痛经那几天可以加量吗？');
  ok('痛经 → 命中', r4.hits.some(h => h.word === '痛经'), r4.hits.map(h => h.word));

  const r5 = C.check('三甲医院的临床数据');
  ok('三甲 + 临床 都命中', ['三甲', '临床'].every(w => r5.hits.some(h => h.word === w)), r5.hits.map(h => h.word));
}

console.log('\n【合规体检 · 位置要能指回原文】');
{
  const t = '开头一段话。日间瓶主打供能抗炎，后面继续。';
  const r = C.check(t);
  const s = r.hits[0].samples[0];
  ok('start/end 落在原文上', t.slice(s.start, s.end) === '抗炎', { start: s.start, end: s.end, got: t.slice(s.start, s.end) });
  ok('样例带上下文', s.before.endsWith('供能') && s.after.startsWith('，'), s);
}

console.log('\n【合规体检 · 绕过手法要能识别】');
{
  ok('空格隔开仍命中', hitWords('抗 炎 效 果').includes('抗炎'), hitWords('抗 炎 效 果'));
  ok('零宽字符仍命中', hitWords('激\u200b素未检出').includes('激素'), hitWords('激\u200b素未检出'));
  ok('间隔点仍命中', hitWords('抗·炎').includes('抗炎'), hitWords('抗·炎'));
  ok('全角数字仍命中', hitWords('１００％有效').length > 0, hitWords('１００％有效'));
}

console.log('\n【合规体检 · 不该报的绝不能报】');
{
  eq('空文本 → pass', C.check('').level, 'pass');
  eq('干净文案 → pass', C.check('早两粒晚一粒，一盒三十天。早餐后半小时温水送服，坚持四周再看体感变化。').level, 'pass');
  eq('科普/科学 → 不因提示字误报', C.check('用科学的方式理解抗衰，这是科普，不是玄学。').level, 'pass');
  eq('第一步/最后 → 不被绝对化误报', C.check('第一步先看清成分表，最后再决定买不买。').total, 0);
  ok('儿科 → 提示字 warn（不是 block）', (() => {
    const r = C.check('儿科圈子里讨论度很高');
    return r.level === 'warn' && r.hits[0].word === '科';
  })(), C.check('儿科圈子里讨论度很高').hits);
}

console.log('\n【合规体检 · 分级与统计】');
{
  const r = C.check('这是全网销量第一的产品，还能抗炎。');
  const first = r.hits[0];
  eq('block 排在 warn 前面', first.level, 'block');
  ok('绝对化单独算 warn', r.counts.warn >= 1 && r.counts.block >= 1, r.counts);

  const r2 = C.check('抗炎、抗炎、抗炎');
  eq('同词多次合并为一条', r2.hits.length, 1);
  eq('出现次数统计准确', r2.hits[0].count, 3);
  ok('样例最多 3 个', r2.hits[0].samples.length === 3, r2.hits[0].samples.length);

  // 长词优先：不能「妇科疾病」和「妇科」各报一次，用户会以为有两处问题
  const r3 = C.check('妇科疾病要早看');
  ok('重叠区间只报最长的一条', r3.hits.length === 1, r3.hits.map(h => h.word));
  eq('报的是长词', r3.hits[0].word, '妇科疾病');

  eq('summaryLine 文案', C.summaryLine({ total: 4, counts: { block: 3, warn: 1 } }), '3 处必须改，1 处建议改');
  eq('summaryLine 无命中', C.summaryLine({ total: 0, counts: {} }), '未发现违禁词');
}

console.log('\n【合规体检 · 开关】');
{
  const t = '销量第一，儿科都在用。';
  ok('默认两项都开', C.check(t).counts.warn >= 2, C.check(t).counts);
  ok('absolute:false 关掉绝对化', !C.check('销量第一', { absolute: false }).hits.length, C.check('销量第一', { absolute: false }).hits);
  ok('hint:false 关掉提示字', !C.check('儿科', { hint: false }).hits.length, C.check('儿科', { hint: false }).hits);
}

console.log('\n【合规体检 · 性能】');
{
  const big = '昼夜节律与抗衰的关系，这一段重复很多次用来测性能。'.repeat(1000);
  const t0 = Date.now();
  const r = C.check(big);
  const ms = Date.now() - t0;
  ok(`2 万字扫描 < 500ms（实测 ${ms}ms / ${big.length} 字）`, ms < 500, { ms, chars: big.length });
  ok('长文本不崩', typeof r.total === 'number');
}

// ---------------------------------------------------------------- HTTP（可选）
const argHttp = process.argv.indexOf('--http');
if (argHttp > 0) {
  const base = process.argv[argHttp + 1];
  const user = process.env.SB_TEST_USER || 'demo';
  const pw = process.env.SB_TEST_PASS || 'star-river-2026';
  console.log('\n【合规体检 · HTTP 接口】' + base);
  const jar = [];
  const req = async (path, opts = {}) => {
    const r = await fetch(base + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', cookie: jar.join('; '), ...(opts.headers || {}) }
    });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    for (const c of sc) jar.push(c.split(';')[0]);
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const anon = await req('/api/compliance/check', { method: 'POST', body: JSON.stringify({ text: '抗炎' }) });
  ok('未登录 → 401', anon.status === 401, anon.status);

  const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pw }) });
  ok('登录成功', login.status === 200, login.status);

  const empty = await req('/api/compliance/check', { method: 'POST', body: JSON.stringify({ text: '   ' }) });
  ok('空文本 → 400', empty.status === 400, empty.status);

  const good = await req('/api/compliance/check', { method: 'POST', body: JSON.stringify({ text: '日间瓶主打供能抗炎，激素未检出。' }) });
  ok('正常体检 → 200', good.status === 200, good.status);
  ok('返回 summary', typeof good.body.summary === 'string' && good.body.summary.includes('必须改'), good.body.summary);
  ok('返回 result.hits', Array.isArray(good.body.result.hits) && good.body.result.hits.length >= 2, good.body.result && good.body.result.hits.length);

  const dict = await req('/api/compliance/dict');
  ok('词表接口 → 200', dict.status === 200, dict.status);
  ok('词表条数与本地一致', dict.body.counts && dict.body.counts.words === C.DICT.words.length, dict.body.counts);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);

// 标定上游每个模型的真实单价（$/M in / out）——不依赖上游是否公开价目表
//
// 原理：New API 的 GET /v1/dashboard/billing/usage 返回累计消费（单位：美分）。
// 在同一把 key 上连发两组「输入/输出配比明显不同」的请求，用两组
//   (token 数 → 消费增量)
// 解二元一次方程，即得输入价 pi 与输出价 po。
//
// 用法：
//   node scripts/calibrate-upstream-price.mjs                 # 标定 config 里全部模型
//   node scripts/calibrate-upstream-price.mjs --models=a,b    # 只标定指定模型
//   node scripts/calibrate-upstream-price.mjs --force         # 已标定的重算
// 产物：data/price-calib.json
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const OUT = path.join(root, 'data', 'price-calib.json');
const argOf = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const forced = process.argv.includes('--force');

const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const keyFor = m => (cfg.providers.find(p => p.models.includes(m)) || cfg.providers[0]).apiKey;

async function spent(key) {
  const r = await fetch(cfg.baseUrl + '/v1/dashboard/billing/usage?start_date=' + day(-2) + '&end_date=' + day(1),
    { headers: { Authorization: 'Bearer ' + key } });
  const j = await r.json();
  if (typeof j.total_usage !== 'number') throw new Error('账单接口异常：' + JSON.stringify(j).slice(0, 120));
  return j.total_usage;      // 美分
}
async function call(model, txt, max) {
  const r = await fetch(cfg.baseUrl + '/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + keyFor(model), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: txt }], max_tokens: max, stream: true, stream_options: { include_usage: true } }),
    signal: AbortSignal.timeout(75000)   // 上游偶发挂住，不能把整批标定拖死
  });
  const t = await r.text();
  const ls = t.split('\n').filter(l => l.startsWith('data:') && l.includes('"prompt_tokens"'));
  if (!ls.length) throw new Error(t.slice(0, 160));
  const u = JSON.parse(ls[ls.length - 1].slice(5)).usage;
  return { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 };
}
async function batch(model, cases, wait) {
  const k = keyFor(model);
  const t0 = await spent(k);
  const pts = [];
  for (const [txt, max] of cases) pts.push(await call(model, txt, max));
  await new Promise(r => setTimeout(r, wait));
  const t1 = await spent(k);
  return {
    in: pts.reduce((s, p) => s + p.in, 0),
    out: pts.reduce((s, p) => s + p.out, 0),
    cents: +(t1 - t0).toFixed(6)
  };
}
// 解 in*pi/1e6 + out*po/1e6 = cents/100
function solve(a, b) {
  const det = (a.in / 1e6) * (b.out / 1e6) - (a.out / 1e6) * (b.in / 1e6);
  if (Math.abs(det) < 1e-12) return null;
  const y1 = a.cents / 100, y2 = b.cents / 100;
  const pi = (y1 * (b.out / 1e6) - (a.out / 1e6) * y2) / det;
  const po = ((a.in / 1e6) * y2 - y1 * (b.in / 1e6)) / det;
  return { inPerM: pi, outPerM: po, ratio: pi > 0 ? po / pi : NaN };
}
// 两组请求：短（小输出、多调用，摊掉取整噪声）+ 长（输出主导）
const SHORT = [['写三句关于秋天的短句，每句一行。', 300], ['写三句关于星空的短句，每句一行。', 300], ['写三句关于江水的短句，每句一行。', 300]];
const LONG = [['写一段 800 字左右的中文说明文，主题：秋日江面。', 1400], ['写一段 800 字左右的中文说明文，主题：夜空星轨。', 1400]];

async function calibrate(model) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await batch(model, SHORT, 4000);
    const l = await batch(model, LONG, 9000);
    const p = solve(s, l);
    if (p && p.inPerM > 0.01 && p.ratio > 1 && p.ratio < 30) {
      return {
        inPerM: +p.inPerM.toFixed(3), outPerM: +p.outPerM.toFixed(3), ratio: +p.ratio.toFixed(2),
        tokens: (s.in + s.out) + (l.in + l.out), cents: +(s.cents + l.cents).toFixed(4),
        sample: { s, l }, at: Date.now()
      };
    }
  }
  return { error: 'solve-unstable' };
}

const want = argOf('models');
const models = want ? want.split(',') : [...new Set(cfg.providers.flatMap(p => p.models))];
const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const model of models) {
  const old = results[model];
  if (old && !old.error && !forced) { console.log('[skip]', model, old.inPerM + '/' + old.outPerM); continue; }
  try {
    const r = await calibrate(model);
    results[model] = r;
    console.log(r.error ? '[fail] ' + model + ' ' + r.error : `[ok]   ${model}  ${r.inPerM} / ${r.outPerM}  (x${r.ratio})`);
  } catch (e) {
    results[model] = { error: String(e.message || e).slice(0, 160) };
    console.log('[err]  ', model, results[model].error);
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
}
console.log('\nDONE -> data/price-calib.json');

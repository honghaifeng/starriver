// 生成可直接合并进 config.json 的定价片段：report/pricing-proposal.json
//   1 积分 = ¥0.01 ｜ 单价 = 上游成本 × K ｜ 输出价 = 输入价 × 上游实际倍数
// 用法：node scripts/emit-price-proposal.mjs [--k=2.8] [--credit=0.01] [--fx=7.2]
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const calib = JSON.parse(fs.readFileSync(path.join(root, 'data/price-calib.json'), 'utf8'));
const arg = (k, d) => { const h = process.argv.find(a => a.startsWith('--' + k + '=')); return h ? +h.split('=')[1] : d; };

const K = arg('k', 2.8), CREDIT = arg('credit', 0.01), FX = arg('fx', 7.2);
const snap = x => Math.round(x * 2) / 2;

const prices = {}, table = [];
for (const [model, v] of Object.entries(calib)) {
  if (v.error || !(v.inPerM > 0)) continue;
  const r = v.outPerM / v.inPerM;
  if (!(r >= 1.5 && r <= 10)) continue;   // 标定噪声解出的离谱比例不入表
  const inRate = snap(v.inPerM * FX / CREDIT / 1000 * K);
  const outRate = snap(inRate * v.outPerM / v.inPerM);
  prices[model] = { in: inRate, out: outRate };
  table.push({ model, upIn: v.inPerM, upOut: v.outPerM, inRate, outRate, ratio: +r.toFixed(2) });
}

const out = {
  _说明: {
    单位: '积分 / 1k token',
    积分面值: `1 积分 = ¥${CREDIT}`,
    汇率: `1 USD = ¥${FX}`,
    成本加成: `×${K}（毛利约 ${((1 - 1 / K) * 100).toFixed(0)}%）`,
    用法: '把 billing.modelRate2 整块合并进 config.json 的 billing 字段；不配置则继续使用旧的 modelRate 单一价',
    输出价: '按上游真实的 输出/输入 倍数计算，不再拉平'
  },
  现在的单一价: cfg.billing.modelRate,
  建议: { billing: { modelRate2: prices } },
  明细: table.sort((a, b) => b.upIn - a.upIn)
};

fs.writeFileSync(path.join(root, 'report/pricing-proposal.json'), JSON.stringify(out, null, 2));
console.log('report/pricing-proposal.json 已生成（' + table.length + ' 个模型）');
for (const t of table) console.log(`  ${t.model.padEnd(30)} $${t.upIn}/${t.upOut}  →  ${t.inRate} / ${t.outRate} 积分/1k`);

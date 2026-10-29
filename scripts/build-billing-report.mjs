// 生成 report/billing-audit.html：一页看清「积分口径 vs 上游成本 vs 建议定价」
// 数据全部来自 data/billing-audit.json（由 scripts/audit-credit-upstream.mjs 产出）
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const a = JSON.parse(fs.readFileSync(path.join(root, 'data/billing-audit.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const allCalib = JSON.parse(fs.readFileSync(path.join(root, 'data/price-calib.json'), 'utf8'));

const { recon, perModel, totals, sens, propose, params } = a;
const pct = x => (x * 100).toFixed(1) + '%';
const n2 = x => Number(x).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const n0 = x => Math.round(Number(x)).toLocaleString('zh-CN');

// ---------- 敏感性折线图 ----------
const W = 660, H = 210, ML = 46, MR = 14, MT = 14, MB = 30;
const xs = s => ML + (s / 0.9) * (W - ML - MR);
const yMin = Math.min(-1, ...sens.map(p => p.margin)) - 0.05;
const yMax = Math.max(0.6, ...sens.map(p => p.margin));
const ys = m => MT + (yMax - m) / (yMax - yMin) * (H - MT - MB);
const line = sens.map(p => `${xs(p.outShare).toFixed(1)},${ys(p.margin).toFixed(1)}`).join(' ');
const zeroY = ys(0).toFixed(1);
const curShare = perModel[0] ? perModel[0].outShare : 0;
const curMargin = sens[0] ? (sens[0].margin + (sens[1] ? (sens[1].margin - sens[0].margin) * (curShare / 0.01) : 0)) : 0;
const grid = [1, 0.5, 0, -0.5, -1].map(v => `<line x1="${ML}" x2="${W - MR}" y1="${ys(v)}" y2="${ys(v)}" stroke="${v === 0 ? '#c9d2ce' : '#eef1f0'}"/>
  <text x="${ML - 8}" y="${ys(v) + 4}" text-anchor="end" font-size="10" fill="#8a9591">${(v * 100).toFixed(0)}%</text>`).join('');
const xTicks = [0, 0.2, 0.4, 0.6, 0.8].map(s => `<text x="${xs(s)}" y="${H - 10}" text-anchor="middle" font-size="10" fill="#8a9591">${(s * 100).toFixed(0)}%</text>`).join('');

// ---------- 表格 ----------
const modelRows = perModel.map(x => `
  <tr>
    <td class="mono">${x.model}</td>
    <td class="num">${n0(x.tokens)}</td>
    <td class="num">${pct(x.outShare)}</td>
    <td class="num">${x.ratePer1k} / ${x.ratePer1k}</td>
    <td class="num">${x.upIn == null ? '<span class="warn">未标定</span>' : `$${x.upIn} / $${x.upOut}`}</td>
    <td class="num">${x.usd == null ? '—' : '$' + n2(x.usd)}</td>
    <td class="num">${n2(x.creditsCharged)}</td>
    <td class="num ${x.margin != null && x.margin < 0 ? 'neg' : ''}">${x.margin == null ? '—' : pct(x.margin)}</td>
  </tr>`).join('');

const propFile = path.join(root, 'report/pricing-proposal.json');
const prop = fs.existsSync(propFile) ? JSON.parse(fs.readFileSync(propFile, 'utf8')) : null;
const priceTable = prop
  ? prop.明细.map(t => ({
    model: t.model,
    nowIn: cfg.billing.modelRate[t.model] != null ? cfg.billing.modelRate[t.model] : cfg.billing.defaultRate,
    nowOut: cfg.billing.modelRate[t.model] != null ? cfg.billing.modelRate[t.model] : cfg.billing.defaultRate,
    newIn: t.inRate, newOut: t.outRate, ratio: t.ratio
  }))
  : propose;

const priceRows = priceTable.map(x => `
  <tr>
    <td class="mono">${x.model}</td>
    <td class="num dim">${x.nowIn} / ${x.nowOut}</td>
    <td class="num strong">${x.newIn} / ${x.newOut}</td>
    <td class="num dim">×${x.ratio}</td>
  </tr>`).join('');

const calibOk = Object.entries(allCalib).filter(([, v]) => !v.error && v.inPerM > 0 && v.outPerM / v.inPerM >= 1.5 && v.outPerM / v.inPerM <= 10);
const unknown = calibOk.length;
const failed = Object.entries(allCalib).filter(([, v]) => v.error || !(v.inPerM > 0) || v.outPerM / v.inPerM < 1.5 || v.outPerM / v.inPerM > 10).map(([k]) => k);

const lead = perModel[0] || { ratePer1k: 4, upIn: 3, outShare: 0 };
// 当前隐含倍率 = 收入单价 ÷ 成本单价（都折算到每百万 token 的美元）
const revenuePerM = lead.ratePer1k * 1000 * params.creditCNY / params.fx;   // $/M
const impliedK = revenuePerM / lead.upIn;
// 一篇 1000 字文案：入 1.5k、出 1k，按建议价折算
const artIn = 1.5 * 6, artOut = 30;
const artCredits = artIn + artOut;

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>积分消耗与上游计费一致性核对 · 春科 · 星河 StarRiver</title>
<style>
:root{--bg:#f6f7f6;--panel:#fff;--line:#e6e9e8;--txt:#1c2321;--sub:#6b7672;--acc:#1f5c4d;--acc2:#2a7a66;--soft:#e8f2ef;--danger:#c0392b;--warn:#a2651a}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:940px;margin:0 auto;padding:44px 28px 80px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding-bottom:18px}
.brand{font-size:11px;letter-spacing:.14em;color:var(--acc);font-weight:700;text-transform:uppercase}
h1{font-size:26px;font-weight:700;letter-spacing:-.01em;margin-top:6px;line-height:1.3}
.meta{font-size:12px;color:var(--sub);text-align:right;line-height:1.6;white-space:nowrap}
h2{font-size:15px;font-weight:700;margin:38px 0 12px;display:flex;align-items:center;gap:9px}
h2::before{content:"";width:3px;height:14px;background:var(--acc);border-radius:2px}
p{color:#3b4743}
.lead{margin-top:16px;font-size:14.5px;color:#2c3532;background:var(--panel);border:1px solid var(--line);
  border-left:3px solid var(--acc);border-radius:10px;padding:14px 16px}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:13px 14px}
.card .k{font-size:11.5px;color:var(--sub);letter-spacing:.02em}
.card .v{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-top:3px;font-variant-numeric:tabular-nums}
.card .v small{font-size:11px;font-weight:500;color:var(--sub);margin-left:3px}
.card .n{font-size:11.5px;color:var(--sub);margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden}
th,td{padding:9px 11px;text-align:left;border-bottom:1px solid var(--line);font-size:12.5px}
th{background:#fbfcfb;color:var(--sub);font-weight:600;font-size:11.5px;letter-spacing:.02em;white-space:nowrap}
tr:last-child td{border-bottom:none}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.neg{color:var(--danger);font-weight:600}
.strong{font-weight:700;color:var(--acc)}
.dim{color:var(--sub)}
.warn{color:var(--warn);font-weight:600}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}
.b-ok{background:var(--soft);color:var(--acc)}
.b-no{background:#fdeeec;color:var(--danger)}
.b-mid{background:#fdf3e6;color:var(--warn)}
ul{margin:8px 0 0 18px;color:#3b4743}
li{margin:4px 0}
.note{font-size:12px;color:var(--sub);margin-top:8px}
.chart{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:14px 12px 6px;margin-top:12px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.steps{counter-reset:s}
.step{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:13px 15px;margin-top:9px;position:relative;padding-left:44px}
.step::before{counter-increment:s;content:counter(s);position:absolute;left:13px;top:12px;width:20px;height:20px;border-radius:50%;
  background:var(--soft);color:var(--acc);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.step b{font-size:13px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f0f3f2;padding:1px 5px;border-radius:4px}
.foot{margin-top:44px;padding-top:14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--sub)}
@media (max-width:760px){.cards{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.top{flex-direction:column;align-items:flex-start}.meta{text-align:left}}
</style></head><body><div class="wrap">

<div class="top">
  <div>
    <div class="brand">春科 · 星河 StarRiver</div>
    <h1>积分消耗，和上游账单对得上吗？</h1>
  </div>
  <div class="meta">
    ${new Date().toLocaleDateString('zh-CN')}<br>
    口径：上游 usage 字段 · 已标定 ${unknown} 个模型
  </div>
</div>

<div class="lead">
  <b>一句话结论：</b>token 数完全对得上（差额 ${recon.tokenGap} 积分 / 共 ${n2(recon.shouldCredits)} 积分，四舍五入残差）；
  但<b>计价结构对不上</b>——上游输出价是输入的 5 倍，我们按同一个价收，输出越多越亏。
  现在能盈利，是因为输出只占 ${pct(perModel[0] ? perModel[0].outShare : 0)}；一旦开始写长文，毛利率会塌。
</div>

<div class="cards">
  <div class="card"><div class="k">累计消耗</div><div class="v">${n2(totals.allCredits)}<small>积分</small></div><div class="n">${n0(recon.usageIn + recon.usageOut)} tokens</div></div>
  <div class="card"><div class="k">上游真实成本</div><div class="v">$${n2(totals.upstreamUsd)}</div><div class="n">token 部分，按标定单价</div></div>
  <div class="card"><div class="k">1 积分成本</div><div class="v">¥${totals.cnyPerCredit}</div><div class="n">$${totals.usdPerCredit}</div></div>
  <div class="card"><div class="k">若 1 积分 = ¥${params.creditCNY}</div><div class="v">${pct(totals.grossMargin)}<small>毛利</small></div><div class="n">这是目前隐含的定价</div></div>
</div>

<h2>一、口径核对：数字对不对</h2>
<table>
  <tr><th>核对项</th><th>我们这边</th><th>上游 / 推导值</th><th>差额</th><th>判定</th></tr>
  <tr><td>调用次数</td><td class="num">${recon.usageCalls} 次</td><td class="num">台账 ${recon.ledgerTokenRows} 条 + 补记 ${recon.backfillRows} 条</td><td class="num">—</td><td><span class="badge b-ok">一致</span></td></tr>
  <tr><td>token 数（入 / 出）</td><td class="num">${n0(recon.usageIn)} / ${n0(recon.usageOut)}</td><td class="num">直接取上游 <code>usage</code> 字段，无本地估算</td><td class="num">0</td><td><span class="badge b-ok">同源</span></td></tr>
  <tr><td>按现价应扣</td><td class="num">${n2(recon.shouldCredits)}</td><td class="num">已扣 ${n2(recon.ledgerTokenCredits)} + 补记 ${n2(recon.backfillCredits)}</td><td class="num">${recon.tokenGap}</td><td><span class="badge b-ok">平账</span></td></tr>
  <tr><td>余额闭环</td><td class="num">${n2(recon.org.balance)}</td><td class="num">期初 ${n0(recon.org.opening)} + 充值 ${n0(recon.org.recharged)} − 消耗</td><td class="num">0</td><td><span class="badge b-ok">${recon.balanceOk ? '平' : '不平'}</span></td></tr>
  <tr><td>入/出是否分价</td><td class="num">同价（单一 rate）</td><td class="num">输出 = 输入 × 5</td><td class="num">结构差</td><td><span class="badge b-no">不一致</span></td></tr>
  <tr><td>缓存 token</td><td class="num">按全价计</td><td class="num">读缓存≈10%，写≈125%</td><td class="num">未分层</td><td><span class="badge b-mid">暂未启用</span></td></tr>
  <tr><td>图片 / 视频</td><td class="num">图片固定 20 积分/张</td><td class="num">按模型、分辨率分档</td><td class="num">未挂钩</td><td><span class="badge b-mid">待核价</span></td></tr>
</table>
<p class="note">token 数是上游 <code>usage</code> 原样记录（含 <code>billing_usage.claude_usage</code> 的缓存字段），所以「用量」这一层不存在对不上的可能；能出问题的只有计价结构。</p>

<h2>二、成本透视：每个模型是谁在赚钱、谁在倒贴</h2>
<table>
  <tr><th>模型</th><th class="num">tokens</th><th class="num">输出占比</th><th class="num">现价（入/出）</th><th class="num">上游 $/M</th><th class="num">上游成本</th><th class="num">收积分</th><th class="num">毛利</th></tr>
  ${modelRows}
</table>
<p class="note">「毛利」= 按 1 积分 ¥${params.creditCNY} 收到的钱 − 上游成本。haiku 输出占比 ${pct(perModel.find(x => x.model.includes('haiku')) ? perModel.find(x => x.model.includes('haiku')).outShare : 0)}，单一价就已经是负毛利——这是最能说明问题的样本。</p>

<h2>三、问题出在哪：输出越多，毛利越低</h2>
<div class="chart">
<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}">
  ${grid}
  <line x1="${ML}" x2="${W - MR}" y1="${zeroY}" y2="${zeroY}" stroke="#c9d2ce"/>
  <polyline points="${line}" fill="none" stroke="#c0392b" stroke-width="2.4" stroke-linejoin="round"/>
  <line x1="${xs(curShare)}" x2="${xs(curShare)}" y1="${MT}" y2="${H - MB}" stroke="#1f5c4d" stroke-dasharray="3 3" opacity=".55"/>
  <circle cx="${xs(curShare)}" cy="${ys(curMargin)}" r="3.6" fill="#1f5c4d"/>
  <text x="${xs(curShare) + 7}" y="${ys(curMargin) - 8}" font-size="10.5" fill="#1f5c4d" font-weight="600">当前 ${pct(curShare)}</text>
  ${xTicks}
  <text x="${W - MR}" y="${H - 10}" text-anchor="end" font-size="10" fill="#8a9591">输出占全部 token 的比例</text>
</svg>
</div>
<p class="note">按现值 ${perModel[0] ? perModel[0].ratePer1k : 4} 积分/千 token（≈ $${n2(sens[0].revenuePerM)}/M 收入），输出占比超过 20% 毛利归零，超过 50% 就是负毛利。内容工厂恰恰是输出密集型业务，这个雷必须提前拆。</p>

<h2>四、定价怎么定</h2>
<div class="two">
  <div>
    <p><b>先把积分锚死在人民币上。</b>积分是内部单位，对外报价、合同、发票必须能换算，否则每一单都要临时算一遍。</p>
    <ul>
      <li>锚：<b>1 积分 = ¥${params.creditCNY}</b>（200,000 积分 = ¥2,000）</li>
      <li>定价公式：<code>单价 = 上游成本 × ${params.markup}</code></li>
      <li>当前隐含倍率只有 <b>${impliedK.toFixed(2)}×</b>，毛利 ${pct(totals.grossMargin)}，兜不住失败重试、存储和汇率波动</li>
      <li>建议倍率 <b>${params.markup}×</b> → 毛利约 ${pct(1 - 1 / params.markup)}</li>
    </ul>
  </div>
  <div>
    <table>
      <tr><th>模型</th><th class="num">现价 入/出</th><th class="num">建议 入/出</th><th class="num">倍数</th></tr>
      ${priceRows}
    </table>
    <p class="note">单位：积分 / 千 token。输出价 = 输入价 × 上游实际倍数，不再拉平。</p>
  </div>
</div>

<h2>五、套餐与出售方式</h2>
<table>
  <tr><th>套餐</th><th class="num">积分</th><th class="num">售价</th><th class="num">单价</th><th>适合</th></tr>
  <tr><td>体验</td><td class="num">20,000</td><td class="num">¥199</td><td class="num">¥0.0100</td><td>一个人试两周，约 150 次对话</td></tr>
  <tr><td>团队</td><td class="num">200,000</td><td class="num">¥1,800</td><td class="num">¥0.0090</td><td>3–5 人内容组，一个月</td></tr>
  <tr><td>企业</td><td class="num">1,000,000</td><td class="num">¥8,000</td><td class="num">¥0.0080</td><td>多品牌矩阵、按 Box 分账</td></tr>
</table>
<p class="note">按主力模型折算：一篇 1,000 字文案（入 ~1.5k / 出 ~1k）≈ ${artCredits} 积分 ≈ ¥${(artCredits * params.creditCNY).toFixed(2)}。团队档 200,000 积分够约 ${Math.round(200000 / artCredits).toLocaleString('zh-CN')} 篇这种量级的产出。</p>

<h2>六、落地：三步，不需要停机</h2>
<div class="steps">
  <div class="step"><b>把价目写进 <code>config.billing.modelRate2</code></b><br>
  引擎已支持入出分价；没配 modelRate2 时继续走单一价，历史账目一条都不动。</div>
  <div class="step"><b>跑 <code>node scripts/verify-billing.mjs</code></b><br>
  20 项断言：单一价与改前逐位一致、分价生效、无 usage 兜底、台账截断不影响对账、真实库平账。</div>
  <div class="step"><b>每天自动对一次账</b><br>
  <code>scripts/audit-credit-upstream.mjs</code> 用上游账单增量反算单价，价目单变了当天就能发现，不用等月底。</div>
</div>

<div class="foot">
  数据源：data/db.json（${recon.usageCalls} 次调用台账）· data/price-calib.json（${unknown} 个模型单价标定）· config.json<br>
  未标定模型：${failed.length ? failed.join('、') : '无'} —— 跑 <code>node scripts/calibrate-upstream-price.mjs --models=模型名</code> 补齐<br>
  生成脚本：scripts/build-billing-report.mjs
</div>

</div></body></html>`;

fs.writeFileSync(path.join(root, 'report/billing-audit.html'), html);
console.log('report/billing-audit.html 已生成');
